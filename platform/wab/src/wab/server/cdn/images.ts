import { logger } from "@/wab/server/observability";
import { getSupabaseConfig } from "@/wab/server/secrets";
import { md5 } from "@/wab/server/util/hash";
import { parseDataUrl } from "@/wab/shared/data-urls";
import { isSVG } from "@/wab/shared/svg-utils";
import * as Sentry from "@sentry/node";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import FileType from "file-type";
import { extension } from "mime-types";
import sharp from "sharp";
import { failableAsync } from "ts-failable";

const siteAssetsBucket =
  process.env.SITE_ASSETS_BUCKET || "copilot-images";

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }
  const config = getSupabaseConfig();
  if (!config.url || !config.serviceRoleKey) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  supabaseClient = createClient(config.url, config.serviceRoleKey);
  return supabaseClient;
}

let bucketEnsured = false;

async function ensureBucketExists(client: SupabaseClient, bucket: string) {
  if (bucketEnsured) {
    return;
  }
  const { error } = await client.storage.getBucket(bucket);
  if (error) {
    logger().info(`Bucket "${bucket}" not found, creating it...`);
    const { error: createError } = await client.storage.createBucket(bucket, {
      public: true,
    });
    if (createError && !createError.message.includes("already exists")) {
      throw new Error(`Failed to create bucket "${bucket}": ${createError.message}`);
    }
  }
  bucketEnsured = true;
}

async function getFileType(buffer: Buffer | ArrayBuffer) {
  let fileType = await FileType.fromBuffer(buffer);
  if ((!fileType || fileType.mime === "application/xml") && isSVG(buffer)) {
    fileType = {
      mime: "image/svg+xml" as FileType.MimeType,
      ext: "svg" as FileType.FileExtension,
    };
  }
  return fileType;
}

export async function uploadDataUriToS3(
  dataUri: string,
  opts?: { imageOnly?: boolean }
) {
  return failableAsync<string, Error>(async ({ success }) => {
    if (!dataUri.startsWith("data:")) {
      // Already uploaded
      return success(dataUri);
    }
    const parsed = parseDataUrl(dataUri);
    const contentType = parsed.contentType;
    const fileBuffer = parsed.toBuffer();

    return (await uploadFileToS3(fileBuffer, { ...opts, contentType })).map(
      (res) => res.url
    );
  });
}

export async function uploadFileToS3(
  fileBuffer: Buffer,
  opts?: { imageOnly?: boolean; contentType?: string }
) {
  return failableAsync<{ url: string; mimeType: string | undefined }, Error>(
    async ({ success, failure }) => {
      const imageOnly = opts?.imageOnly ?? true;

      const fileType = await getFileType(fileBuffer);
      const mime = fileType?.mime ?? opts?.contentType;
      const ext = fileType?.ext ?? (mime && extension(mime));

      const optimizedBuffer =
        fileType?.mime === "image/jpeg" || fileType?.mime === "image/png"
          ? await sharp(fileBuffer)
              .jpeg({ progressive: true, force: false, mozjpeg: true })
              .png({ progressive: true, force: false })
              .toBuffer()
          : fileBuffer;

      if (!fileType && (imageOnly || !mime || !ext)) {
        return failure(new Error("Invalid file type"));
      }

      const fileHash = md5(fileBuffer);
      const storagePath = `${fileHash}.${ext}`;

      try {
        const client = getSupabaseClient();
        const config = getSupabaseConfig();
        logger().info(
          `Supabase upload: bucket=${siteAssetsBucket}, url=${config.url}, path=${storagePath}`
        );

        // Ensure the bucket exists (creates it if missing)
        await ensureBucketExists(client, siteAssetsBucket);

        const { error } = await client.storage
          .from(siteAssetsBucket)
          .upload(storagePath, optimizedBuffer, {
            contentType: mime,
            upsert: true,
          });

        if (error) {
          throw new Error(`Supabase upload failed: ${error.message}`);
        }

        const {
          data: { publicUrl },
        } = client.storage.from(siteAssetsBucket).getPublicUrl(storagePath);

        return success({
          url: publicUrl,
          mimeType: mime,
        });
      } catch (err) {
        logger().error(`Could not upload asset to Supabase.`, err);
        Sentry.captureMessage(
          `Could not upload asset to Supabase (${err.message}).`
        );
        return failure(err);
      }
    }
  );
}

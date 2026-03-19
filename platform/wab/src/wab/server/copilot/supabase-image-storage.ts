import { getSupabaseConfig } from "@/wab/server/secrets";
import { logger } from "@/wab/server/observability";
import { CopilotImage } from "@/wab/shared/ApiSchema";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export interface StoredCopilotImage {
  publicUrl: string;
  path: string;
  mediaType: string;
}

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) {
    return supabaseClient;
  }
  const config = getSupabaseConfig();
  if (!config.url || !config.serviceRoleKey) {
    return null;
  }
  supabaseClient = createClient(config.url, config.serviceRoleKey);
  return supabaseClient;
}

function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

function getContentType(imageType: string): string {
  return `image/${imageType === "jpg" ? "jpeg" : imageType}`;
}

export async function uploadCopilotImage(
  image: CopilotImage,
  projectId: string
): Promise<StoredCopilotImage | null> {
  const client = getSupabaseClient();
  if (!client) {
    logger().warn(
      "Supabase not configured — skipping copilot image upload"
    );
    return null;
  }

  const config = getSupabaseConfig();
  const bucket = config.imageBucket || "copilot-images";
  const buffer = base64ToBuffer(image.base64);
  const hash = createHash("md5").update(buffer).digest("hex");
  const contentType = getContentType(image.type);
  const path = `${projectId}/${hash}.${image.type}`;

  const { error } = await client.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  });

  if (error) {
    logger().error(`Supabase image upload failed: ${error.message}`);
    return null;
  }

  const {
    data: { publicUrl },
  } = client.storage.from(bucket).getPublicUrl(path);

  logger().info(`Copilot image uploaded to Supabase: ${path}`);

  return { publicUrl, path, mediaType: contentType };
}

export async function uploadCopilotImages(
  images: CopilotImage[],
  projectId: string
): Promise<StoredCopilotImage[]> {
  const results = await Promise.all(
    images.map((img) => uploadCopilotImage(img, projectId))
  );
  return results.filter((r): r is StoredCopilotImage => r !== null);
}

import { logger } from "@/wab/server/observability";
import { withSpan } from "@/wab/server/util/apm-util";
import { ensureInstance } from "@/wab/shared/common";
import S3 from "aws-sdk/clients/s3";
import path from "path";

/**
 * True when an S3-compatible store is configured. Self-hosted single-tenant
 * deployments may run without S3 (no AWS creds, no S3_ENDPOINT); in that case
 * the loader cache degrades gracefully (compute without caching) instead of
 * throwing "Missing credentials in config". Set S3_ENDPOINT or AWS creds to
 * re-enable real caching (and chunked-bundle serving via getLoaderChunk).
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.S3_ENDPOINT ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

export async function upsertS3CacheEntry<T>(opts: {
  bucket: string;
  key: string;
  compute: () => Promise<T>;
  serialize: (obj: T) => string;
  deserialize: (str: string) => T;
}): Promise<{ data: T; cacheHit: boolean }> {
  const { bucket, key, compute: f, serialize, deserialize } = opts;
  if (!isS3Configured()) {
    // No S3 store: skip cache, compute and return directly.
    return { data: await f(), cacheHit: false };
  }
  const s3 = new S3({ endpoint: process.env.S3_ENDPOINT });

  try {
    const obj = await s3
      .getObject({
        Bucket: bucket,
        Key: key,
      })
      .promise();
    const serialized = ensureInstance(obj.Body, Buffer).toString("utf8");
    logger().info(`S3 cache hit for ${bucket} ${key}`);
    return { data: deserialize(serialized), cacheHit: true };
  } catch (err) {
    if (err.code === "TimeoutError") {
      throw err;
    }
    logger().info(`S3 cache miss for ${bucket} ${key}; computing`);
    const content = await withSpan("s3-cache-compute", async () => {
      return await f();
    });
    const serialized = serialize(content);
    try {
      await s3
        .putObject({
          Bucket: bucket,
          Key: key,
          Body: serialized,
        })
        .promise();
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        throw e;
      }
      logger().error("Unable to add content to S3", e as any);
    }
    return { data: content, cacheHit: false };
  }
}

export async function uploadFilesToS3(opts: {
  bucket: string;
  key: string;
  files: Record<string, string>;
}) {
  const { bucket, key, files } = opts;
  if (!isS3Configured()) {
    // No S3 store configured (self-hosted); skip upload.
    return;
  }
  const s3 = new S3({ endpoint: process.env.S3_ENDPOINT });
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await s3
        .putObject({
          Bucket: bucket,
          Key: path.join(key, file),
          Body: content,
        })
        .promise();
    })
  );
}

import "server-only";
import { supabaseAdmin } from "../../auth/supabase";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";

/**
 * Thin wrapper over Supabase Storage. Uses the service client, so callers
 * MUST have authorized the request before calling any of these.
 */
export async function putObject(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabaseAdmin().storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) {
    logger.error("documents.storage_upload_failed", { bucket, err: error.message });
    throw new AppError("INTEGRATION", "The file could not be stored. Please try again.");
  }
}

export async function removeObject(bucket: string, path: string) {
  const { error } = await supabaseAdmin().storage.from(bucket).remove([path]);
  if (error) logger.error("documents.storage_remove_failed", { bucket, err: error.message });
}

export async function signedDownloadUrl(bucket: string, path: string, fileName: string, expiresInSeconds = 60) {
  const { data, error } = await supabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds, { download: fileName });
  if (error || !data?.signedUrl) {
    logger.error("documents.signed_url_failed", { bucket, err: error?.message });
    throw new AppError("INTEGRATION", "The download link could not be created. Please try again.");
  }
  return data.signedUrl;
}

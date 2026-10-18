import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

const VERSION = "v1";

function key() {
  return Buffer.from(env().APP_ENCRYPTION_KEY, "base64");
}

/**
 * AES-256-GCM field encryption for identity and bank numbers. Output format:
 * "v1.<iv>.<tag>.<ciphertext>" (base64url). The key lives only in the app
 * environment, so a database dump alone does not reveal these values.
 */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptField(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export const last4 = (value: string) => value.replace(/\s+/g, "").slice(-4);

/** Masks all but the last four characters, e.g. "XXXXXXXX1234". */
export const mask = (lastFour: string | null | undefined, length = 8) =>
  lastFour ? `${"•".repeat(length)}${lastFour}` : null;

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

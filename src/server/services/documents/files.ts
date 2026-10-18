import { createHash } from "node:crypto";
import { ALLOWED_FILE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/validation/documents";
import { validation } from "../../lib/errors";

type Ext = keyof typeof ALLOWED_FILE_TYPES;

export type InspectedFile = {
  bytes: Uint8Array;
  fileName: string;
  ext: Ext;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const SIG = {
  pdf: ascii("%PDF-"),
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
  riff: ascii("RIFF"),
  webp: ascii("WEBP"),
  zip: [0x50, 0x4b, 0x03, 0x04],
};

/** Binary signatures that must never be accepted as a "text" upload. */
const BINARY_SIGNATURES = [SIG.pdf, SIG.png, SIG.jpeg, SIG.riff, SIG.zip, ascii("MZ"), [0x7f, 0x45, 0x4c, 0x46], [0x1f, 0x8b]];

function containsAscii(bytes: Uint8Array, needle: string) {
  // Zip central-directory file names are stored uncompressed, so OOXML part
  // names ("word/", "xl/") are visible in the raw bytes.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle, 0, "latin1");
}

function looksLikeText(bytes: Uint8Array) {
  if (BINARY_SIGNATURES.some((sig) => startsWith(bytes, sig))) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (const b of sample) {
    // NUL or other C0 control characters (except tab, LF, CR, FF) indicate binary content.
    if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c)) return false;
  }
  return true;
}

/** Magic-byte check: the content must match the declared type. */
export function contentMatches(ext: Ext, bytes: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(bytes, SIG.pdf);
    case "png":
      return startsWith(bytes, SIG.png);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, SIG.jpeg);
    case "webp":
      return startsWith(bytes, SIG.riff) && startsWith(bytes, SIG.webp, 8);
    case "docx":
      return startsWith(bytes, SIG.zip) && containsAscii(bytes, "[Content_Types].xml") && containsAscii(bytes, "word/");
    case "xlsx":
      return startsWith(bytes, SIG.zip) && containsAscii(bytes, "[Content_Types].xml") && containsAscii(bytes, "xl/");
    case "csv":
    case "txt":
    case "md":
      return looksLikeText(bytes);
  }
}

/**
 * Strip directories, control and reserved characters; collapse whitespace;
 * keep the extension. The stored object name is a random UUID regardless, so
 * this only affects the name shown and used for downloads.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*;`$]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "")
    .trim();
  if (!cleaned) return "document";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

function extensionOf(fileName: string): Ext | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return ext in ALLOWED_FILE_TYPES ? (ext as Ext) : null;
}

/** Browsers report these for files they cannot classify; fall back to the extension. */
const GENERIC_MIME = new Set(["", "application/octet-stream", "binary/octet-stream"]);
/** Common alternative spellings browsers and OSes send. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "application/csv": "text/csv",
  "text/x-csv": "text/csv",
  "application/vnd.ms-excel": "text/csv",
  "text/x-markdown": "text/markdown",
};

/**
 * Validate an uploaded file: size, allow-listed type (extension AND declared
 * MIME must agree) and magic bytes. Returns the bytes and a SHA-256 digest.
 */
export async function inspectUpload(file: File): Promise<InspectedFile> {
  if (!file || typeof file.arrayBuffer !== "function") throw validation("Choose a file to upload.", { file: ["Choose a file"] });
  if (file.size <= 0) throw validation("The file is empty.", { file: ["The file is empty"] });
  if (file.size > MAX_UPLOAD_BYTES) {
    throw validation("Files can be at most 25 MB.", { file: ["Files can be at most 25 MB"] });
  }
  const fileName = sanitizeFileName(file.name || "document");
  const ext = extensionOf(fileName);
  if (!ext) {
    throw validation("This file type is not allowed. Upload a PDF, image, Word, Excel, CSV or text file.", {
      file: ["File type not allowed"],
    });
  }
  const expected = ALLOWED_FILE_TYPES[ext];
  const declaredRaw = (file.type || "").toLowerCase().split(";")[0].trim();
  const declared = MIME_ALIASES[declaredRaw] ?? declaredRaw;
  // text/plain is acceptable for csv/md, which many systems report generically.
  const textish = (ext === "csv" || ext === "md") && declared === "text/plain";
  if (!GENERIC_MIME.has(declared) && declared !== expected && !textish) {
    throw validation("The file type does not match its extension.", { file: ["File type does not match its extension"] });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw validation("The upload was incomplete. Please try again.", { file: ["Upload incomplete"] });
  }
  if (!contentMatches(ext, bytes)) {
    throw validation("The file content does not match its type. It may be corrupted or renamed.", {
      file: ["File content does not match its type"],
    });
  }
  return {
    bytes,
    fileName,
    ext,
    mimeType: expected,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

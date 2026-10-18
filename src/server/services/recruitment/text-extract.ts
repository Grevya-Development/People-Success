/**
 * Minimal, dependency-free text extraction for resumes.
 *
 * - DOCX: reads word/document.xml from the zip container (stored or deflated
 *   entries, via node:zlib) and turns paragraphs into lines.
 * - PDF: inflates FlateDecode content streams and collects text-showing
 *   operators (Tj, TJ, ', ") inside BT/ET blocks. This works for PDFs whose
 *   fonts use standard (WinAnsi/Latin) encodings, e.g. most "Save as PDF"
 *   output from simple templates. PDFs that use embedded CID fonts without a
 *   simple encoding, scanned images, or encrypted files yield little or no
 *   readable text; the caller then asks the recruiter to paste the text.
 *
 * Deliberately not a full PDF parser: no new native dependency is added.
 */
import { inflateRawSync, inflateSync } from "node:zlib";

export type Extraction = { text: string | null; method: "pdf" | "docx"; warning: string | null };

const MAX_TEXT = 60_000;

/* ------------------------------------------------------------------ */
/* DOCX                                                                */
/* ------------------------------------------------------------------ */

function readZipEntry(buf: Buffer, wanted: string): Buffer | null {
  // End of central directory: scan backwards (comment is at most 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name === wanted) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 });
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return XML_ENTITIES[e.toLowerCase()] ?? "";
  });
}

export function extractDocxText(bytes: Uint8Array): string | null {
  try {
    const xml = readZipEntry(Buffer.from(bytes), "word/document.xml");
    if (!xml) return null;
    const text = decodeXmlEntities(
      xml
        .toString("utf8")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, ""),
    );
    return tidy(text);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

function decodeLiteral(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === undefined) break;
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b" || n === "f") out += "";
    else if (n === "\n" || n === "\r") out += "";
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
    } else out += n;
  }
  return out;
}

function decodeHex(hex: string) {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const padded = clean.length % 2 ? clean + "0" : clean;
  return Buffer.from(padded, "hex").toString("latin1");
}

/** Read a PDF string token starting at s[i] === "(" ; returns [value, nextIndex]. */
function readLiteral(s: string, i: number): [string, number] {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  return [decodeLiteral(s.slice(i + 1, j)), j + 1];
}

/** Extract shown text from one decoded content stream. */
export function textFromContentStream(content: string): string {
  let out = "";
  let inText = false;
  const operands: string[] = [];
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    if (c === "(") {
      const [v, next] = readLiteral(content, i);
      operands.push(v);
      i = next;
      continue;
    }
    if (c === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i);
      if (end < 0) break;
      operands.push(decodeHex(content.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    if (c === "[") {
      // TJ array: strings with kerning numbers; large negative gaps are spaces.
      const end = (() => {
        let depth = 0;
        for (let j = i; j < content.length; j++) {
          if (content[j] === "(") {
            const [, next] = readLiteral(content, j);
            j = next - 1;
            continue;
          }
          if (content[j] === "[") depth++;
          if (content[j] === "]" && --depth === 0) return j;
        }
        return content.length - 1;
      })();
      const inner = content.slice(i + 1, end);
      let s = "";
      let k = 0;
      while (k < inner.length) {
        if (inner[k] === "(") {
          const [v, next] = readLiteral(inner, k);
          s += v;
          k = next;
        } else if (inner[k] === "<") {
          const e = inner.indexOf(">", k);
          s += decodeHex(inner.slice(k + 1, e < 0 ? inner.length : e));
          k = e < 0 ? inner.length : e + 1;
        } else {
          const num = /^-?\d*\.?\d+/.exec(inner.slice(k));
          if (num) {
            if (Number(num[0]) < -180) s += " ";
            k += num[0].length;
          } else k++;
        }
      }
      operands.push(s);
      i = end + 1;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Operator or number/name token.
    const tok = /^[^\s()<>[\]{}/%]+|^\/[^\s()<>[\]{}/%]*/.exec(content.slice(i, i + 64));
    if (!tok) {
      i++;
      continue;
    }
    const t = tok[0];
    i += t.length;
    if (t === "BT") {
      inText = true;
      operands.length = 0;
      continue;
    }
    if (t === "ET") {
      inText = false;
      out += "\n";
      operands.length = 0;
      continue;
    }
    if (!inText) {
      if (/^[A-Za-z*'"]+$/.test(t)) operands.length = 0;
      continue;
    }
    if (t === "Tj" || t === "TJ") out += operands.at(-1) ?? "";
    else if (t === "'" || t === '"') out += "\n" + (operands.at(-1) ?? "");
    else if (t === "T*") out += "\n";
    else if (t === "Td" || t === "TD") {
      const ty = Number(operands.at(-1));
      out += Number.isFinite(ty) && Math.abs(ty) > 0.5 ? "\n" : " ";
    } else if (t === "Tm") out += "\n";
    else if (!/^[A-Za-z*]+$/.test(t)) {
      operands.push(t);
      continue;
    }
    if (/^[A-Za-z*'"]+$/.test(t)) operands.length = 0;
  }
  return out;
}

export function extractPdfText(bytes: Uint8Array): string | null {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  if (/\/Encrypt\b/.test(raw)) return null;
  const parts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let total = 0;
  while ((m = re.exec(raw)) && total < 200) {
    const dictStart = raw.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : "";
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    re.lastIndex = end + 9;
    total++;
    // Skip images, fonts and other binary resources.
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/Length2|\/Type\s*\/(XRef|XObject)/.test(dict)) continue;
    let data = buf.subarray(start, end);
    try {
      if (/\/FlateDecode/.test(dict)) data = inflateSync(data, { maxOutputLength: 10 * 1024 * 1024 });
      else if (/\/Filter/.test(dict)) continue;
    } catch {
      continue;
    }
    const content = data.toString("latin1");
    if (!/\bBT\b/.test(content)) continue;
    parts.push(textFromContentStream(content));
  }
  return tidy(parts.join("\n"));
}

/* ------------------------------------------------------------------ */
/* Common                                                              */
/* ------------------------------------------------------------------ */

function tidy(text: string): string | null {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
  return cleaned || null;
}

/** Share of characters that look like natural-language text. */
export function readability(text: string) {
  if (!text) return 0;
  const good = text.match(/[A-Za-z0-9\s.,;:()@+\-/'&%]/g)?.length ?? 0;
  return good / text.length;
}

export function extractResumeText(bytes: Uint8Array, mimeType: string): Extraction {
  const isPdf = mimeType === "application/pdf";
  const text = isPdf ? extractPdfText(bytes) : extractDocxText(bytes);
  const method = isPdf ? "pdf" : "docx";
  if (!text || text.length < 40) {
    return {
      text: null,
      method,
      warning: isPdf
        ? "No readable text could be extracted from this PDF (it may be scanned or use embedded fonts). Paste the resume text instead."
        : "No text could be read from this document. Paste the resume text instead.",
    };
  }
  if (readability(text) < 0.85) {
    return { text: null, method, warning: "The extracted text looks garbled (embedded font encoding). Paste the resume text instead." };
  }
  return { text, method, warning: null };
}

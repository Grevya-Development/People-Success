import { PLACEHOLDER_PATTERN } from "@/lib/validation/documents";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export type TemplateData = Record<string, unknown>;

function lookup(data: TemplateData, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    // Own properties only: never walk into prototypes (e.g. {{constructor.name}}).
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export type RenderResult = { output: string; missing: string[]; used: string[] };

/**
 * Replace {{placeholders}} with values from `data`. Values are HTML-escaped
 * by default so rendered output is safe to embed in HTML/PDF. Missing values
 * are left visible as "[[placeholder]]" and reported.
 */
export function resolvePlaceholders(text: string, data: TemplateData, opts: { escape?: boolean } = {}): RenderResult {
  const escape = opts.escape ?? true;
  const missing = new Set<string>();
  const used = new Set<string>();
  const output = text.replace(PLACEHOLDER_PATTERN, (_m, path: string) => {
    used.add(path);
    const value = stringify(lookup(data, path));
    if (value === null) {
      missing.add(path);
      return `[[${path}]]`;
    }
    return escape ? escapeHtml(value) : value;
  });
  return { output, missing: [...missing], used: [...used] };
}

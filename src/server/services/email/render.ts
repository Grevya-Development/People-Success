/**
 * Branded transactional email layout. Matches supabase/templates/*.html so
 * auth emails and app emails look the same. Every user-provided string is
 * HTML-escaped; `body` paragraphs are plain text.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Only http(s) links are rendered as buttons; anything else is dropped. */
function safeHref(href: string) {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type RenderEmailInput = {
  title: string;
  /** Paragraphs of plain text. */
  body: string | string[];
  cta?: { label: string; href: string };
  /** Small print under the button. */
  footer?: string;
};

export function renderEmail({ title, body, cta, footer }: RenderEmailInput): { html: string; text: string } {
  const paragraphs = Array.isArray(body) ? body : [body];
  const href = cta ? safeHref(cta.href) : null;

  const html = `<!doctype html>
<html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#212121">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e6e2;border-radius:10px">
<tr><td style="padding:28px 32px 8px;font-size:15px;font-weight:600">PeopleSuccess <span style="color:#8a8a86;font-weight:500">by Grevya</span></td></tr>
<tr><td style="padding:8px 32px 28px;font-size:14px;line-height:1.6">
<h1 style="font-size:18px;margin:12px 0 8px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 16px;color:#4b4b48">${escapeHtml(p)}</p>`).join("\n")}
${
  cta && href
    ? `<a href="${escapeHtml(href)}" style="display:inline-block;margin-top:4px;background:#212121;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:600">${escapeHtml(cta.label)}</a>
<p style="margin:16px 0 0;color:#8a8a86;font-size:12px;word-break:break-all">Or paste this link into your browser: ${escapeHtml(href)}</p>`
    : ""
}
${footer ? `<p style="margin:24px 0 0;color:#8a8a86;font-size:12px">${escapeHtml(footer)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    title,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(cta && href ? [`${cta.label}: ${href}`, ""] : []),
    ...(footer ? [footer] : []),
    "",
    "PeopleSuccess by Grevya",
  ].join("\n");

  return { html, text };
}

import { Fragment, type ReactNode } from "react";
import { cn } from "cn";

/**
 * Minimal, safe Markdown renderer for policies and letter previews.
 *
 * It never produces HTML strings: input is parsed into React elements, so
 * every piece of text is escaped by React and raw HTML in the source shows up
 * as literal text. Supported: headings, paragraphs (single newlines become
 * line breaks), bullet and numbered lists, block quotes, horizontal rules,
 * **bold**, *italic*, `code` and [links](https://...) (http, https, mailto only).
 */

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "rule" };

const LIST_ITEM = /^\s*(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, "") });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = !!item[2];
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m && !!m[2] === ordered) {
          items.push(m[3]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        } else break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quote });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !LIST_ITEM.test(lines[i]) && !/^\s*>/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", lines: para });
  }
  return blocks;
}

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${n++}`;
    if (m[2] ?? m[3]) out.push(<strong key={key}>{inline(m[2] ?? m[3], key)}</strong>);
    else if (m[4] ?? m[5]) out.push(<em key={key}>{inline(m[4] ?? m[5], key)}</em>);
    else if (m[6]) out.push(<code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{m[6]}</code>);
    else if (m[7]) {
      const href = safeHref(m[8]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline underline-offset-2">
            {m[7]}
          </a>
        ) : (
          <Fragment key={key}>{m[0]}</Fragment>
        ),
      );
    }
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(ls: string[], key: string) {
  return ls.map((l, i) => (
    <Fragment key={`${key}-${i}`}>
      {i > 0 ? <br /> : null}
      {inline(l, `${key}-${i}`)}
    </Fragment>
  ));
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-lg font-semibold",
  2: "text-base font-semibold",
  3: "text-sm font-semibold",
};

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case "heading": {
            // Policy pages already have an h1; content headings start at h2.
            const level = Math.min(b.level + 1, 6) as 2 | 3 | 4 | 5 | 6;
            const Tag = `h${level}` as const;
            return (
              <Tag key={key} className={cn("pt-2 text-foreground", HEADING_CLASS[b.level] ?? "text-sm font-semibold")}>
                {inline(b.text, key)}
              </Tag>
            );
          }
          case "paragraph":
            return <p key={key}>{lines(b.lines, key)}</p>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={key} className={cn("space-y-1 pl-5", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">
                {lines(b.lines, key)}
              </blockquote>
            );
          case "rule":
            return <hr key={key} className="border-border" />;
        }
      })}
    </div>
  );
}

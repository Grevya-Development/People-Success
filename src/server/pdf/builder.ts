import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

/**
 * Minimal document layout over pdf-lib: flowing text with wrapping, key/value
 * grids, tables and automatic page breaks. Uses the standard Helvetica fonts
 * (WinAnsi), so text is normalized to that character set (₹ → "INR").
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.42, 0.42, 0.4);
const RULE = rgb(0.86, 0.86, 0.84);
const BAND = rgb(0.965, 0.965, 0.955);

export function toWinAnsi(s: string) {
  return s
    .replace(/₹\s?/g, "INR ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

export class PdfBuilder {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private y = 0;
  private footerText = "";

  static async create(meta: { title: string; author?: string; footer?: string }) {
    const b = new PdfBuilder();
    b.doc = await PDFDocument.create();
    b.doc.setTitle(toWinAnsi(meta.title));
    b.doc.setAuthor(toWinAnsi(meta.author ?? "PeopleSuccess"));
    b.doc.setProducer("PeopleSuccess by Grevya");
    b.doc.setCreator("PeopleSuccess by Grevya");
    b.regular = await b.doc.embedFont(StandardFonts.Helvetica);
    b.bold = await b.doc.embedFont(StandardFonts.HelveticaBold);
    b.footerText = toWinAnsi(meta.footer ?? "");
    b.newPage();
    return b;
  }

  get contentWidth() {
    return A4.width - MARGIN * 2;
  }

  private newPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 24) this.newPage();
  }

  spacer(h = 10) {
    this.y -= h;
    return this;
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= 10;
    return this;
  }

  private wrap(text: string, font: PDFFont, size: number, width: number) {
    const lines: string[] = [];
    for (const para of toWinAnsi(text).split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
        else {
          if (line) lines.push(line);
          line = w;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const lineHeight = size * 1.42;
    for (const line of this.wrap(text, font, size, this.contentWidth)) {
      this.ensure(lineHeight);
      const w = font.widthOfTextAtSize(line, size);
      const x = opts.align === "right" ? A4.width - MARGIN - w : opts.align === "center" ? (A4.width - w) / 2 : MARGIN;
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lineHeight;
    }
    this.y -= opts.gap ?? 2;
    return this;
  }

  /** Company letterhead: name, legal name / address line, and a document title. */
  letterhead(company: { name: string; legalName?: string | null; addressLine?: string | null }, title: string, subtitle?: string) {
    this.text(company.name, { size: 15, bold: true, gap: 0 });
    if (company.legalName && company.legalName !== company.name) this.text(company.legalName, { size: 9, color: MUTED, gap: 0 });
    if (company.addressLine) this.text(company.addressLine, { size: 9, color: MUTED, gap: 0 });
    this.spacer(10).rule();
    this.text(title, { size: 12.5, bold: true, gap: 1 });
    if (subtitle) this.text(subtitle, { size: 9.5, color: MUTED });
    return this.spacer(6);
  }

  /** Two- or three-column label/value grid. */
  grid(pairs: [string, string][], columns = 2) {
    const colWidth = this.contentWidth / columns;
    for (let i = 0; i < pairs.length; i += columns) {
      this.ensure(28);
      const row = pairs.slice(i, i + columns);
      row.forEach(([label, value], c) => {
        const x = MARGIN + c * colWidth;
        this.page.drawText(toWinAnsi(label), { x, y: this.y - 8, size: 7.5, font: this.regular, color: MUTED });
        const v = this.wrap(value || "-", this.bold, 9.5, colWidth - 10)[0] ?? "-";
        this.page.drawText(v, { x, y: this.y - 20, size: 9.5, font: this.bold, color: INK });
      });
      this.y -= 28;
    }
    return this.spacer(4);
  }

  /**
   * Table with optional right-aligned numeric columns and a bold totals row.
   * Widths are fractions of the content width.
   */
  table(columns: { header: string; width: number; align?: "left" | "right" }[], rows: string[][], opts: { totals?: string[]; size?: number } = {}) {
    const size = opts.size ?? 9;
    const rowH = size * 2.1;
    const xs: number[] = [];
    let acc = MARGIN;
    for (const c of columns) {
      xs.push(acc);
      acc += c.width * this.contentWidth;
    }
    const drawRow = (cells: string[], font: PDFFont, band: boolean) => {
      this.ensure(rowH);
      if (band) this.page.drawRectangle({ x: MARGIN, y: this.y - rowH, width: this.contentWidth, height: rowH, color: BAND });
      cells.forEach((cell, i) => {
        const col = columns[i];
        const w = col.width * this.contentWidth - 8;
        let t = toWinAnsi(cell ?? "");
        while (t.length > 1 && font.widthOfTextAtSize(t, size) > w) t = t.slice(0, -2) + ".";
        const tw = font.widthOfTextAtSize(t, size);
        const x = col.align === "right" ? xs[i] + col.width * this.contentWidth - 4 - tw : xs[i] + 4;
        this.page.drawText(t, { x, y: this.y - rowH + size * 0.75, size, font, color: INK });
      });
      this.y -= rowH;
    };
    drawRow(columns.map((c) => c.header), this.bold, true);
    for (const r of rows) drawRow(r, this.regular, false);
    if (opts.totals) {
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.6, color: RULE });
      drawRow(opts.totals, this.bold, false);
    }
    return this.spacer(8);
  }

  async toBytes() {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = `${this.footerText ? this.footerText + "  ·  " : ""}Page ${i + 1} of ${pages.length}`;
      const w = this.regular.widthOfTextAtSize(label, 7.5);
      p.drawText(label, { x: (A4.width - w) / 2, y: 24, size: 7.5, font: this.regular, color: MUTED });
    });
    return this.doc.save();
  }
}

export const formatInr = (paise: number) =>
  `INR ${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;

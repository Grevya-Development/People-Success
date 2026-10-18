import { and, desc, eq } from "drizzle-orm";
import { addDays, addMonths, addWeeks, format } from "date-fns";
import { z } from "zod";
import { authorize, can, type RequestContext } from "../../auth/context";
import { savedReports, users } from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError, forbidden, notFound } from "../../lib/errors";
import { PdfBuilder } from "../../pdf/builder";
import { toCsv } from "@/lib/csv";
import { REPORTS, reportDefinition, type ReportDefinition, type ReportParams } from "./catalog";

export const PREVIEW_ROWS = 200;
export const EXPORT_ROWS = 50_000;

export const reportParamsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departmentId: z.uuid().nullish(),
  locationId: z.uuid().nullish(),
});

function canRun(ctx: RequestContext, def: ReportDefinition) {
  return def.permissions.every((p) => can(ctx, p, "all"));
}

/** Reports the viewer may run, for the catalogue page. */
export function availableReports(ctx: RequestContext) {
  return REPORTS.filter((r) => canRun(ctx, r)).map(({ query: _q, ...rest }) => {
    void _q;
    return rest;
  });
}

function validate(p: ReportParams) {
  if (p.from > p.to) throw new AppError("VALIDATION", "The start date must be before the end date.");
}

export async function runReport(ctx: RequestContext, key: string, params: ReportParams, limit = PREVIEW_ROWS) {
  const def = reportDefinition(key);
  if (!def) throw notFound("Report");
  if (!canRun(ctx, def)) throw forbidden();
  validate(params);
  const rows = await ctx.db((tx) => def.query(tx, params, limit + 1));
  return { def, rows: rows.slice(0, limit), truncated: rows.length > limit };
}

function formatCell(type: string, v: unknown) {
  if (v === null || v === undefined) return "";
  if (type === "money") return (Number(v) / 100).toFixed(2);
  if (type === "percent") return `${(Number(v) * 100).toFixed(1)}%`;
  return String(v);
}

/** Export with permission checks and an audit record. Returns file bytes. */
export async function exportReport(ctx: RequestContext, key: string, params: ReportParams, fmt: "csv" | "pdf") {
  authorize(ctx, "reports.export", "all");
  const { def, rows, truncated } = await runReport(ctx, key, params, fmt === "pdf" ? 1000 : EXPORT_ROWS);
  await ctx.db((tx) =>
    audit(tx, ctx, {
      action: "report.exported",
      entityType: "report",
      entityId: key,
      metadata: { format: fmt, rows: rows.length, truncated, params, sensitive: def.sensitive },
    }),
  );
  const fileBase = `${key}-${params.from}-to-${params.to}`;
  if (fmt === "csv") {
    const csv = toCsv([def.columns.map((c) => (c.type === "money" ? `${c.label} (INR)` : c.label)), ...rows.map((r) => def.columns.map((c) => formatCell(c.type, r[c.key])))]);
    return { bytes: new TextEncoder().encode(csv), contentType: "text/csv; charset=utf-8", fileName: `${fileBase}.csv` };
  }
  const pdf = await PdfBuilder.create({ title: def.title, footer: `${ctx.tenantName} · ${def.title}${def.sensitive ? " · Confidential" : ""}` });
  pdf.letterhead({ name: ctx.tenantName }, def.title, `${def.usesDateRange ? `${params.from} to ${params.to} · ` : ""}Generated ${format(new Date(), "dd MMM yyyy HH:mm")}${truncated ? " · first 1,000 rows" : ""}`);
  const cols = def.columns.slice(0, 8);
  const width = 1 / cols.length;
  pdf.table(
    cols.map((c) => ({ header: c.label, width, align: ["number", "money", "percent"].includes(c.type) ? ("right" as const) : ("left" as const) })),
    rows.map((r) => cols.map((c) => formatCell(c.type, r[c.key]))),
    { size: 7.5 },
  );
  return { bytes: await pdf.toBytes(), contentType: "application/pdf", fileName: `${fileBase}.pdf` };
}

/* ------------------------------------------------------------------ */
/* Saved & scheduled reports                                           */
/* ------------------------------------------------------------------ */

export const saveReportSchema = z.object({
  name: z.string().trim().min(2, "Name the report").max(120),
  reportKey: z.string().min(1),
  filters: z.object({ rangeDays: z.coerce.number().int().min(1).max(366), departmentId: z.uuid().nullish(), locationId: z.uuid().nullish() }),
  schedule: z.enum(["none", "daily", "weekly", "monthly"]),
  recipientUserIds: z.array(z.uuid()).max(20),
});

export function nextRunAt(schedule: string, from = new Date()) {
  // 08:00 IST = 02:30 UTC.
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 2, 30));
  const step = schedule === "daily" ? addDays : schedule === "weekly" ? addWeeks : addMonths;
  let next = base;
  while (next <= from) next = step(next, 1);
  return next;
}

export async function saveReport(ctx: RequestContext, input: z.infer<typeof saveReportSchema>) {
  authorize(ctx, "reports.view", "all");
  const def = reportDefinition(input.reportKey);
  if (!def || !canRun(ctx, def)) throw forbidden();
  if (input.schedule !== "none") authorize(ctx, "reports.export", "all");
  return ctx.db(async (tx) => {
    // Recipients must be members of this tenant (RLS on users limits lookups to members).
    const recipients = input.recipientUserIds.length
      ? await tx.select({ id: users.id, email: users.email }).from(users)
      : [];
    const allowed = recipients.filter((r) => input.recipientUserIds.includes(r.id));
    if (allowed.length !== input.recipientUserIds.length) throw new AppError("VALIDATION", "Some recipients are not members of this organization.");
    const [row] = await tx
      .insert(savedReports)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        reportKey: input.reportKey,
        filters: input.filters,
        schedule: input.schedule === "none" ? null : input.schedule,
        format: "csv",
        recipients: allowed.map((r) => r.id),
        nextRunAt: input.schedule === "none" ? null : nextRunAt(input.schedule),
        createdBy: ctx.userId,
      })
      .returning({ id: savedReports.id });
    await audit(tx, ctx, { action: "report.saved", entityType: "saved_report", entityId: row.id, metadata: { reportKey: input.reportKey, schedule: input.schedule } });
    return row;
  });
}

export async function listSavedReports(ctx: RequestContext) {
  authorize(ctx, "reports.view", "all");
  return ctx.db((tx) =>
    tx
      .select()
      .from(savedReports)
      .where(and(eq(savedReports.tenantId, ctx.tenantId)))
      .orderBy(desc(savedReports.createdAt))
      .limit(100),
  );
}

export async function deleteSavedReport(ctx: RequestContext, id: string) {
  authorize(ctx, "reports.view", "all");
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(savedReports).where(eq(savedReports.id, id));
    if (!r) throw notFound("Saved report");
    if (r.createdBy !== ctx.userId && !can(ctx, "settings.manage", "all")) throw forbidden();
    await tx.delete(savedReports).where(eq(savedReports.id, id));
    await audit(tx, ctx, { action: "report.deleted", entityType: "saved_report", entityId: id });
  });
}

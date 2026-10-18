import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { documentTemplates, documentTemplateVersions, legalEntities, users } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, notFound } from "../../lib/errors";
import { formatDate, todayIn } from "@/lib/format";
import { extractPlaceholders, type CreateTemplateInput, type TEMPLATE_KINDS } from "@/lib/validation/documents";
import { resolvePlaceholders, type TemplateData } from "./render";

type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const canManageTemplates = (ctx: RequestContext) => can(ctx, "templates.manage", "all");

function requireManage(ctx: RequestContext) {
  if (!canManageTemplates(ctx)) throw forbidden();
}

export type TemplateListItem = {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  isActive: boolean;
  currentVersion: number;
  placeholders: string[];
  updatedAt: string;
};

export async function listTemplates(ctx: RequestContext): Promise<TemplateListItem[]> {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({ t: documentTemplates, placeholders: documentTemplateVersions.placeholders })
      .from(documentTemplates)
      .leftJoin(
        documentTemplateVersions,
        and(
          eq(documentTemplateVersions.templateId, documentTemplates.id),
          eq(documentTemplateVersions.version, documentTemplates.currentVersion),
        ),
      )
      .orderBy(desc(documentTemplates.isActive), asc(documentTemplates.name))
      .limit(500);
    return rows.map(({ t, placeholders }) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      description: t.description,
      isActive: t.isActive,
      currentVersion: t.currentVersion,
      placeholders: placeholders ?? [],
      updatedAt: t.updatedAt.toISOString(),
    }));
  });
}

export type TemplateDetail = TemplateListItem & {
  subject: string | null;
  body: string;
  versions: { version: number; createdAt: string; createdByName: string | null; placeholders: string[] }[];
};

async function loadTemplate(tx: Tx, id: string) {
  const [t] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, id));
  if (!t) throw notFound("Template");
  const [current] = await tx
    .select()
    .from(documentTemplateVersions)
    .where(and(eq(documentTemplateVersions.templateId, id), eq(documentTemplateVersions.version, t.currentVersion)));
  if (!current) throw notFound("Template version");
  return { t, current };
}

export async function getTemplate(ctx: RequestContext, id: string): Promise<TemplateDetail> {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const { t, current } = await loadTemplate(tx, id);
    const versions = await tx
      .select({
        version: documentTemplateVersions.version,
        createdAt: documentTemplateVersions.createdAt,
        placeholders: documentTemplateVersions.placeholders,
        createdByName: users.fullName,
        createdByEmail: users.email,
      })
      .from(documentTemplateVersions)
      .leftJoin(users, eq(users.id, documentTemplateVersions.createdBy))
      .where(eq(documentTemplateVersions.templateId, id))
      .orderBy(desc(documentTemplateVersions.version))
      .limit(100);
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      description: t.description,
      isActive: t.isActive,
      currentVersion: t.currentVersion,
      placeholders: current.placeholders,
      updatedAt: t.updatedAt.toISOString(),
      subject: current.subject,
      body: current.body,
      versions: versions.map((v) => ({
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        createdByName: v.createdByName ?? v.createdByEmail ?? null,
        placeholders: v.placeholders,
      })),
    };
  });
}

async function insertTemplate(tx: Tx, ctx: RequestContext, input: CreateTemplateInput) {
  const [t] = await tx
    .insert(documentTemplates)
    .values({ tenantId: ctx.tenantId, kind: input.kind, name: input.name, description: input.description, currentVersion: 1 })
    .returning({ id: documentTemplates.id });
  await tx.insert(documentTemplateVersions).values({
    tenantId: ctx.tenantId,
    templateId: t.id,
    version: 1,
    subject: input.subject,
    body: input.body,
    placeholders: extractPlaceholders(input.subject, input.body),
    createdBy: ctx.userId,
  });
  return t;
}

export async function createTemplate(ctx: RequestContext, input: CreateTemplateInput) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const t = await insertTemplate(tx, ctx, input);
    await audit(tx, ctx, {
      action: "template.created",
      entityType: "document_template",
      entityId: t.id,
      metadata: { name: input.name, kind: input.kind },
    });
    return { id: t.id };
  });
}

/** Saves metadata in place; a changed body or subject creates a new version. */
export async function updateTemplate(ctx: RequestContext, input: CreateTemplateInput & { id: string }) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [t] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, input.id)).for("update");
    if (!t) throw notFound("Template");
    const { current } = await loadTemplate(tx, input.id);
    const bodyChanged = current.body !== input.body || (current.subject ?? null) !== (input.subject ?? null);
    const version = bodyChanged ? t.currentVersion + 1 : t.currentVersion;
    if (bodyChanged) {
      await tx.insert(documentTemplateVersions).values({
        tenantId: ctx.tenantId,
        templateId: t.id,
        version,
        subject: input.subject,
        body: input.body,
        placeholders: extractPlaceholders(input.subject, input.body),
        createdBy: ctx.userId,
      });
    }
    const meta = { kind: input.kind, name: input.name, description: input.description };
    await tx
      .update(documentTemplates)
      .set({ ...meta, currentVersion: version })
      .where(eq(documentTemplates.id, t.id));
    await audit(tx, ctx, {
      action: "template.updated",
      entityType: "document_template",
      entityId: t.id,
      changes: diff(
        { kind: t.kind, name: t.name, description: t.description, currentVersion: t.currentVersion },
        { ...meta, currentVersion: version },
      ),
    });
    return { id: t.id, version, newVersion: bodyChanged };
  });
}

export async function setTemplateActive(ctx: RequestContext, input: { id: string; isActive: boolean }) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [t] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, input.id)).for("update");
    if (!t) throw notFound("Template");
    if (t.isActive === input.isActive) return { id: t.id };
    await tx.update(documentTemplates).set({ isActive: input.isActive }).where(eq(documentTemplates.id, t.id));
    await audit(tx, ctx, {
      action: input.isActive ? "template.activated" : "template.deactivated",
      entityType: "document_template",
      entityId: t.id,
      changes: diff({ isActive: t.isActive }, { isActive: input.isActive }),
    });
    return { id: t.id };
  });
}

export type RenderedTemplate = {
  templateId: string;
  version: number;
  subject: string | null;
  output: string;
  placeholders: string[];
  missing: string[];
};

/**
 * Resolve a template's current (or given) version with `data`. Values are
 * HTML-escaped unless `escape: false` (used by previews that render through
 * React, which escapes on its own).
 */
export async function renderTemplate(
  ctx: RequestContext,
  templateId: string,
  data: TemplateData,
  opts: { version?: number; escape?: boolean } = {},
): Promise<RenderedTemplate> {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [t] = await tx.select().from(documentTemplates).where(eq(documentTemplates.id, templateId));
    if (!t) throw notFound("Template");
    const version = opts.version ?? t.currentVersion;
    const [v] = await tx
      .select()
      .from(documentTemplateVersions)
      .where(and(eq(documentTemplateVersions.templateId, templateId), eq(documentTemplateVersions.version, version)));
    if (!v) throw notFound("Template version");
    const body = resolvePlaceholders(v.body, data, { escape: opts.escape });
    const subject = v.subject ? resolvePlaceholders(v.subject, data, { escape: opts.escape }) : null;
    return {
      templateId,
      version,
      subject: subject?.output ?? null,
      output: body.output,
      placeholders: v.placeholders,
      missing: [...new Set([...(subject?.missing ?? []), ...body.missing])],
    };
  });
}

/** Illustrative values for previews. Clearly fictional; never real employee data. */
export async function sampleTemplateData(ctx: RequestContext): Promise<TemplateData> {
  const company = await ctx.db(async (tx) => {
    const [le] = await tx
      .select({ name: legalEntities.name, legalName: legalEntities.legalName, address: legalEntities.address })
      .from(legalEntities)
      .orderBy(desc(legalEntities.isDefault))
      .limit(1);
    return le ?? null;
  });
  const address = company?.address
    ? [company.address.line1, company.address.line2, company.address.city, company.address.postalCode].filter(Boolean).join(", ")
    : "";
  return {
    today: formatDate(todayIn()),
    company: {
      name: company?.name ?? ctx.tenantName,
      legalName: company?.legalName ?? `${ctx.tenantName} Private Limited`,
      address: address || "12, MG Road, Bengaluru 560001",
    },
    employee: {
      fullName: "Ananya Sharma",
      firstName: "Ananya",
      employeeCode: "EMP0042",
      designation: "Senior Software Engineer",
      department: "Engineering",
      location: "Bengaluru",
      joiningDate: "01 Apr 2024",
      lastWorkingDate: "30 Sep 2026",
      manager: "Rohan Mehta",
    },
    offer: { annualCtc: "₹18,00,000", validUntil: "31 Oct 2026" },
    signatory: { name: "Priya Nair", designation: "Head of People" },
  };
}

/* ------------------------------------------------------------------ */
/* Standard templates                                                  */
/* ------------------------------------------------------------------ */

export const STANDARD_TEMPLATES: CreateTemplateInput[] = [
  {
    kind: "offer_letter",
    name: "Offer letter (standard)",
    description: "Employment offer with role, joining date and annual CTC.",
    subject: "Offer of employment – {{employee.designation}}",
    body: `{{today}}

Dear {{employee.fullName}},

We are delighted to offer you the position of **{{employee.designation}}** in the {{employee.department}} team at {{company.legalName}}, based at {{employee.location}}.

## Terms of the offer

- Date of joining: {{employee.joiningDate}}
- Reporting to: {{employee.manager}}
- Annual cost to company (CTC): {{offer.annualCtc}}

Your detailed compensation structure and terms of employment will be set out in your appointment letter. This offer is subject to satisfactory verification of your documents and background.

Please confirm your acceptance by {{offer.validUntil}}.

We look forward to welcoming you.

Warm regards,

{{signatory.name}}
{{signatory.designation}}
{{company.legalName}}`,
  },
  {
    kind: "experience_letter",
    name: "Experience letter (standard)",
    description: "Certifies the period of employment and role held.",
    subject: "Experience certificate – {{employee.fullName}}",
    body: `{{today}}

## To whom it may concern

This is to certify that **{{employee.fullName}}** (Employee code {{employee.employeeCode}}) was employed with {{company.legalName}} from {{employee.joiningDate}} to {{employee.lastWorkingDate}}.

At the time of leaving, {{employee.firstName}} held the position of {{employee.designation}} in the {{employee.department}} department.

During this period we found {{employee.firstName}} to be sincere and diligent. We wish them every success in their future endeavours.

For {{company.legalName}}

{{signatory.name}}
{{signatory.designation}}`,
  },
  {
    kind: "relieving_letter",
    name: "Relieving letter (standard)",
    description: "Confirms acceptance of resignation and the relieving date.",
    subject: "Relieving letter – {{employee.fullName}}",
    body: `{{today}}

Dear {{employee.fullName}},

This is with reference to your resignation. We confirm that your resignation has been accepted and you are relieved from the services of {{company.legalName}} with effect from the close of business on {{employee.lastWorkingDate}}.

Your full and final settlement will be processed as per company policy. Please note that the confidentiality obligations in your terms of employment continue to apply.

We thank you for your contributions as {{employee.designation}} and wish you the very best.

For {{company.legalName}}

{{signatory.name}}
{{signatory.designation}}`,
  },
];

/** Adds the standard templates that do not exist yet (matched by name). Idempotent. */
export async function installStandardTemplates(ctx: RequestContext) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const existing = await tx
      .select({ name: documentTemplates.name })
      .from(documentTemplates)
      .where(inArray(documentTemplates.name, STANDARD_TEMPLATES.map((t) => t.name)));
    const have = new Set(existing.map((e) => e.name));
    const added: string[] = [];
    for (const tpl of STANDARD_TEMPLATES) {
      if (have.has(tpl.name)) continue;
      const t = await insertTemplate(tx, ctx, tpl);
      added.push(t.id);
    }
    if (added.length) {
      await audit(tx, ctx, {
        action: "template.standard_installed",
        entityType: "document_template",
        metadata: { added: added.length, ids: added },
      });
    }
    return { added: added.length };
  });
}

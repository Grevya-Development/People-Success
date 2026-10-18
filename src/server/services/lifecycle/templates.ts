import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, type RequestContext } from "../../auth/context";
import {
  departments,
  legalEntities,
  lifecyclePlans,
  lifecycleTemplateTasks,
  lifecycleTemplates,
  locations,
  policies,
} from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { notFound, validation } from "../../lib/errors";
import type { PlanKind, templateSchema, templateTaskSchema } from "@/lib/validation/lifecycle";
import type { TaskConfig } from "./shared";

const requireManage = (ctx: RequestContext) => authorize(ctx, "onboarding.manage", "all");

type TemplateRow = typeof lifecycleTemplates.$inferSelect;
type Conditions = Record<string, string | string[]>;

export type TemplateListItem = {
  id: string;
  kind: PlanKind;
  name: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  conditions: { label: string; value: string }[];
  taskCount: number;
  planCount: number;
};

/** Human labels for a template's conditions. */
async function conditionLabels(tx: Tx, rows: TemplateRow[]) {
  const ids = (key: string) => [...new Set(rows.flatMap((r) => [r.conditions[key]].flat().filter(Boolean) as string[]))];
  const [deps, locs, les] = await Promise.all([
    ids("departmentId").length ? tx.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, ids("departmentId"))) : [],
    ids("locationId").length ? tx.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, ids("locationId"))) : [],
    ids("legalEntityId").length ? tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities).where(inArray(legalEntities.id, ids("legalEntityId"))) : [],
  ]);
  const names = new Map([...deps, ...locs, ...les].map((r) => [r.id, r.name]));
  return (c: Conditions) =>
    Object.entries(c).map(([key, v]) => {
      const values = [v].flat();
      const label = { departmentId: "Department", locationId: "Location", legalEntityId: "Legal entity", employmentType: "Employment type" }[key] ?? key;
      return { label, value: values.map((x) => names.get(x) ?? x.replace(/_/g, " ")).join(", ") };
    });
}

export async function listTemplates(ctx: RequestContext, kind?: PlanKind): Promise<TemplateListItem[]> {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(lifecycleTemplates)
      .where(kind ? eq(lifecycleTemplates.kind, kind) : undefined)
      .orderBy(asc(lifecycleTemplates.kind), desc(lifecycleTemplates.priority), asc(lifecycleTemplates.name));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [taskCounts, planCounts, labels] = await Promise.all([
      tx.select({ id: lifecycleTemplateTasks.templateId, n: count() }).from(lifecycleTemplateTasks).where(inArray(lifecycleTemplateTasks.templateId, ids)).groupBy(lifecycleTemplateTasks.templateId),
      tx.select({ id: lifecyclePlans.templateId, n: count() }).from(lifecyclePlans).where(inArray(lifecyclePlans.templateId, ids)).groupBy(lifecyclePlans.templateId),
      conditionLabels(tx, rows),
    ]);
    const tc = new Map(taskCounts.map((r) => [r.id, r.n]));
    const pc = new Map(planCounts.map((r) => [r.id, r.n]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      description: r.description,
      priority: r.priority,
      isActive: r.isActive,
      conditions: labels(r.conditions),
      taskCount: tc.get(r.id) ?? 0,
      planCount: pc.get(r.id) ?? 0,
    }));
  });
}

export type TemplateTaskItem = {
  id: string;
  title: string;
  description: string | null;
  ownerGroup: string;
  dueOffsetDays: number;
  kind: string;
  config: TaskConfig;
  sortOrder: number;
};

export type TemplateDetail = Omit<TemplateListItem, "taskCount" | "planCount" | "conditions"> & {
  conditionLabels: { label: string; value: string }[];
  departmentId: string | null;
  locationId: string | null;
  legalEntityId: string | null;
  employmentType: string | null;
  tasks: TemplateTaskItem[];
  planCount: number;
};

const single = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function getTemplate(ctx: RequestContext, id: string): Promise<TemplateDetail> {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [t] = await tx.select().from(lifecycleTemplates).where(eq(lifecycleTemplates.id, id));
    if (!t) throw notFound("Template");
    const [taskRows, [{ n }], labels] = await Promise.all([
      tx.select().from(lifecycleTemplateTasks).where(eq(lifecycleTemplateTasks.templateId, id)).orderBy(asc(lifecycleTemplateTasks.sortOrder), asc(lifecycleTemplateTasks.createdAt)),
      tx.select({ n: count() }).from(lifecyclePlans).where(eq(lifecyclePlans.templateId, id)),
      conditionLabels(tx, [t]),
    ]);
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      description: t.description,
      priority: t.priority,
      isActive: t.isActive,
      conditionLabels: labels(t.conditions),
      departmentId: single(t.conditions.departmentId),
      locationId: single(t.conditions.locationId),
      legalEntityId: single(t.conditions.legalEntityId),
      employmentType: single(t.conditions.employmentType),
      planCount: n,
      tasks: taskRows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        ownerGroup: r.ownerGroup,
        dueOffsetDays: r.dueOffsetDays,
        kind: r.kind,
        config: r.config as TaskConfig,
        sortOrder: r.sortOrder,
      })),
    };
  });
}

function conditionsFrom(input: z.output<typeof templateSchema>): Conditions {
  const c: Conditions = {};
  if (input.departmentId) c.departmentId = input.departmentId;
  if (input.locationId) c.locationId = input.locationId;
  if (input.legalEntityId) c.legalEntityId = input.legalEntityId;
  if (input.employmentType) c.employmentType = input.employmentType;
  return c;
}

export async function saveTemplate(ctx: RequestContext, input: z.output<typeof templateSchema>) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    // Referenced org records must exist in this tenant (RLS hides others).
    const refs: [string, string | null, () => Promise<unknown[]>][] = [
      ["departmentId", input.departmentId, () => tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId!))],
      ["locationId", input.locationId, () => tx.select({ id: locations.id }).from(locations).where(eq(locations.id, input.locationId!))],
      ["legalEntityId", input.legalEntityId, () => tx.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.id, input.legalEntityId!))],
    ];
    for (const [field, value, q] of refs) {
      if (value && !(await q()).length) throw validation("That selection is no longer valid.", { [field]: ["Not found"] });
    }
    const values = {
      kind: input.kind,
      name: input.name,
      description: input.description,
      priority: input.priority,
      isActive: input.isActive,
      conditions: conditionsFrom(input),
    };
    if (input.id) {
      const [before] = await tx.select().from(lifecycleTemplates).where(eq(lifecycleTemplates.id, input.id)).for("update");
      if (!before) throw notFound("Template");
      const { kind: _kind, ...patch } = values;
      void _kind;
      await tx.update(lifecycleTemplates).set(patch).where(eq(lifecycleTemplates.id, input.id));
      await audit(tx, ctx, { action: "lifecycle_template.updated", entityType: "lifecycle_template", entityId: input.id, changes: diff(before as Record<string, unknown>, patch) });
      return { id: input.id };
    }
    const [row] = await tx.insert(lifecycleTemplates).values({ tenantId: ctx.tenantId, ...values }).returning({ id: lifecycleTemplates.id });
    await audit(tx, ctx, { action: "lifecycle_template.created", entityType: "lifecycle_template", entityId: row.id, metadata: { kind: input.kind, name: input.name } });
    return { id: row.id };
  });
}

/** Templates that started plans are deactivated rather than deleted, to keep plan history explainable. */
export async function deleteTemplate(ctx: RequestContext, id: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [t] = await tx.select().from(lifecycleTemplates).where(eq(lifecycleTemplates.id, id)).for("update");
    if (!t) throw notFound("Template");
    const [{ n }] = await tx.select({ n: count() }).from(lifecyclePlans).where(eq(lifecyclePlans.templateId, id));
    if (n > 0) {
      await tx.update(lifecycleTemplates).set({ isActive: false }).where(eq(lifecycleTemplates.id, id));
      await audit(tx, ctx, { action: "lifecycle_template.deactivated", entityType: "lifecycle_template", entityId: id });
      return { outcome: "deactivated" as const };
    }
    await tx.delete(lifecycleTemplates).where(eq(lifecycleTemplates.id, id));
    await audit(tx, ctx, { action: "lifecycle_template.deleted", entityType: "lifecycle_template", entityId: id, metadata: { name: t.name } });
    return { outcome: "deleted" as const };
  });
}

function taskConfigFrom(input: z.output<typeof templateTaskSchema>): TaskConfig {
  const c: TaskConfig = { required: input.required };
  if (input.kind === "document_upload" && input.documentCategory) {
    c.documentCategory = input.documentCategory;
  }
  if (input.kind === "acknowledgement" && input.policyId) c.policyId = input.policyId;
  if (input.kind === "checkin" && input.checkinDay) c.checkinDay = input.checkinDay;
  if (input.kind === "form" && input.formTarget) c.formTarget = input.formTarget;
  if (input.code) c.code = input.code;
  return c;
}

export async function saveTemplateTask(ctx: RequestContext, input: z.output<typeof templateTaskSchema>) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [t] = await tx.select({ id: lifecycleTemplates.id }).from(lifecycleTemplates).where(eq(lifecycleTemplates.id, input.templateId));
    if (!t) throw notFound("Template");
    if (input.policyId) {
      const [p] = await tx.select({ id: policies.id }).from(policies).where(eq(policies.id, input.policyId));
      if (!p) throw validation("That policy no longer exists.", { policyId: ["Not found"] });
    }
    const values = {
      title: input.title,
      description: input.description,
      ownerGroup: input.ownerGroup,
      dueOffsetDays: input.dueOffsetDays,
      kind: input.kind,
      config: taskConfigFrom(input),
      sortOrder: input.sortOrder,
    };
    if (input.id) {
      const res = await tx
        .update(lifecycleTemplateTasks)
        .set(values)
        .where(and(eq(lifecycleTemplateTasks.id, input.id), eq(lifecycleTemplateTasks.templateId, input.templateId)))
        .returning({ id: lifecycleTemplateTasks.id });
      if (!res.length) throw notFound("Template task");
      await audit(tx, ctx, { action: "lifecycle_template.task_updated", entityType: "lifecycle_template", entityId: input.templateId, metadata: { taskId: input.id, title: input.title } });
      return { id: input.id };
    }
    const [row] = await tx
      .insert(lifecycleTemplateTasks)
      .values({ tenantId: ctx.tenantId, templateId: input.templateId, ...values })
      .returning({ id: lifecycleTemplateTasks.id });
    await audit(tx, ctx, { action: "lifecycle_template.task_added", entityType: "lifecycle_template", entityId: input.templateId, metadata: { taskId: row.id, title: input.title } });
    return { id: row.id };
  });
}

export async function deleteTemplateTask(ctx: RequestContext, id: string) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx.delete(lifecycleTemplateTasks).where(eq(lifecycleTemplateTasks.id, id)).returning();
    if (!row) throw notFound("Template task");
    await audit(tx, ctx, { action: "lifecycle_template.task_removed", entityType: "lifecycle_template", entityId: row.templateId, metadata: { taskId: id, title: row.title } });
    return { templateId: row.templateId };
  });
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type MatchSubject = {
  departmentId: string | null;
  locationId: string | null;
  legalEntityId: string | null;
  employmentType: string | null;
};

export function templateMatches(conditions: Conditions, s: MatchSubject) {
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = s[key as keyof MatchSubject] ?? null;
    const allowed = [expected].flat();
    return allowed.length === 0 || (actual !== null && allowed.includes(actual));
  });
}

/**
 * Best active template for a subject: every condition must match; ties go to
 * the higher priority, then the more specific template, then the oldest.
 */
export async function selectTemplate(tx: Tx, tenantId: string, kind: PlanKind, s: MatchSubject) {
  const rows = await tx
    .select()
    .from(lifecycleTemplates)
    .where(and(eq(lifecycleTemplates.tenantId, tenantId), eq(lifecycleTemplates.kind, kind), eq(lifecycleTemplates.isActive, true)))
    .orderBy(asc(lifecycleTemplates.createdAt));
  const candidates = rows.filter((r) => templateMatches(r.conditions, s));
  candidates.sort((a, b) => b.priority - a.priority || Object.keys(b.conditions).length - Object.keys(a.conditions).length);
  return candidates[0] ?? null;
}

export async function templateOptions(ctx: RequestContext, kind: PlanKind) {
  return ctx.db((tx) =>
    tx
      .select({ id: lifecycleTemplates.id, name: lifecycleTemplates.name, priority: lifecycleTemplates.priority })
      .from(lifecycleTemplates)
      .where(and(eq(lifecycleTemplates.kind, kind), eq(lifecycleTemplates.isActive, true)))
      .orderBy(desc(lifecycleTemplates.priority), asc(lifecycleTemplates.name)),
  );
}

/* ------------------------------------------------------------------ */
/* Standard templates                                                  */
/* ------------------------------------------------------------------ */

type StandardTask = { title: string; description: string; ownerGroup: string; dueOffsetDays: number; kind: string; config: TaskConfig };

export const STANDARD_ONBOARDING: { name: string; description: string; tasks: StandardTask[] } = {
  name: "Standard onboarding",
  description: "Pre-joining paperwork, day-one readiness and 30/60/90-day check-ins for every new joiner.",
  tasks: [
    { title: "Complete personal details", description: "Contact details, address and emergency contact in your profile.", ownerGroup: "employee", dueOffsetDays: -7, kind: "form", config: { formTarget: "personal" } },
    { title: "Upload identity documents (PAN and Aadhaar)", description: "Clear scans or photos of your PAN card and Aadhaar.", ownerGroup: "employee", dueOffsetDays: -7, kind: "document_upload", config: { documentCategory: "identity" } },
    { title: "Add bank account details", description: "Salary account number, IFSC and account holder name.", ownerGroup: "employee", dueOffsetDays: -5, kind: "form", config: { formTarget: "bank" } },
    { title: "Upload education certificates", description: "Highest qualification degree or marksheets.", ownerGroup: "employee", dueOffsetDays: -5, kind: "document_upload", config: { documentCategory: "education" } },
    { title: "Read and acknowledge company policies", description: "Every published policy that needs an acknowledgement.", ownerGroup: "employee", dueOffsetDays: 0, kind: "acknowledgement", config: {} },
    { title: "Prepare laptop and IT equipment", description: "Raise and fulfil the equipment request; record the asset on the profile.", ownerGroup: "it", dueOffsetDays: -3, kind: "checklist", config: {} },
    { title: "Create email and system accounts", description: "Work email, SSO, and the tools this role needs.", ownerGroup: "it", dueOffsetDays: -2, kind: "checklist", config: {} },
    { title: "Assign an onboarding buddy", description: "Pick a buddy from the team and introduce them before day one.", ownerGroup: "manager", dueOffsetDays: -3, kind: "checklist", config: {} },
    { title: "Share the orientation schedule", description: "First-week agenda: induction, HR session, team introductions.", ownerGroup: "hr", dueOffsetDays: -2, kind: "checklist", config: {} },
    { title: "First-day checklist", description: "Welcome, workspace, ID card, access card and team lunch.", ownerGroup: "manager", dueOffsetDays: 0, kind: "checklist", config: {} },
    { title: "Buddy: first-week catch-up", description: "Check in on tools, people and questions.", ownerGroup: "buddy", dueOffsetDays: 5, kind: "checklist", config: { required: false } },
    { title: "30-day check-in", description: "How is the new joiner settling in? Capture notes and follow-ups.", ownerGroup: "manager", dueOffsetDays: 30, kind: "checkin", config: { checkinDay: 30 } },
    { title: "60-day check-in", description: "Progress against early goals and support needed.", ownerGroup: "manager", dueOffsetDays: 60, kind: "checkin", config: { checkinDay: 60 } },
    { title: "90-day check-in", description: "Review the first 90 days and set goals for probation.", ownerGroup: "manager", dueOffsetDays: 90, kind: "checkin", config: { checkinDay: 90 } },
    { title: "Probation review reminder", description: "Complete the probation review before the probation end date.", ownerGroup: "manager", dueOffsetDays: 90, kind: "checklist", config: { anchor: "probation_end", required: false } },
  ],
};

export const STANDARD_OFFBOARDING: { name: string; description: string; tasks: StandardTask[] } = {
  name: "Standard offboarding",
  description: "Handover, asset return, access revocation, exit interview, settlement inputs and exit letters.",
  tasks: [
    { title: "Prepare a handover plan", description: "Open work, documents, contacts and credentials to transfer.", ownerGroup: "employee", dueOffsetDays: -14, kind: "checklist", config: { code: "handover" } },
    { title: "Review and accept the handover", description: "Confirm the handover is complete and responsibilities are reassigned.", ownerGroup: "manager", dueOffsetDays: -3, kind: "checklist", config: { code: "handover_review" } },
    { title: "Collect company assets", description: "Laptop, ID card, access card and any other assigned assets.", ownerGroup: "it", dueOffsetDays: 0, kind: "checklist", config: { code: "asset_return" } },
    { title: "Revoke system access", description: "Disable email, SSO and tool accounts on the last working day.", ownerGroup: "it", dueOffsetDays: 0, kind: "checklist", config: { code: "access_revocation" } },
    { title: "Reconcile final attendance and leave", description: "Close attendance and confirm the leave balance for encashment.", ownerGroup: "hr", dueOffsetDays: -1, kind: "checklist", config: { code: "leave_reconciliation" } },
    { title: "Conduct the exit interview", description: "Confidential conversation; record ratings and reasons.", ownerGroup: "hr", dueOffsetDays: -3, kind: "form", config: { code: "exit_interview" } },
    { title: "Prepare settlement inputs", description: "Notice recovery or pay in lieu, leave encashment and other recoveries for payroll.", ownerGroup: "finance", dueOffsetDays: 0, kind: "form", config: { code: "settlement_inputs" } },
    { title: "Issue experience and relieving letters", description: "Generate the letters; they become visible to the employee after the last working day.", ownerGroup: "hr", dueOffsetDays: 0, kind: "checklist", config: { code: "letters" } },
  ],
};

/** Adds the standard onboarding and offboarding templates that do not exist yet (by name). Idempotent. */
export async function installStandardTemplates(ctx: RequestContext) {
  requireManage(ctx);
  return ctx.db(async (tx) => {
    let added = 0;
    for (const [kind, std] of [
      ["onboarding", STANDARD_ONBOARDING],
      ["offboarding", STANDARD_OFFBOARDING],
    ] as const) {
      const [row] = await tx
        .insert(lifecycleTemplates)
        .values({ tenantId: ctx.tenantId, kind, name: std.name, description: std.description, priority: 0, conditions: {} })
        .onConflictDoNothing()
        .returning({ id: lifecycleTemplates.id });
      if (!row) continue;
      await tx.insert(lifecycleTemplateTasks).values(
        std.tasks.map((t, i) => ({ tenantId: ctx.tenantId, templateId: row.id, ...t, sortOrder: (i + 1) * 10 })),
      );
      added++;
    }
    if (added) await audit(tx, ctx, { action: "lifecycle_template.standard_installed", entityType: "lifecycle_template", metadata: { added } });
    return { added };
  });
}

/** Published policies that need acknowledgement (for acknowledgement tasks). */
export async function acknowledgementPolicyOptions(ctx: RequestContext) {
  requireManage(ctx);
  return ctx.db((tx) =>
    tx
      .select({ value: policies.id, label: policies.title })
      .from(policies)
      .where(and(eq(policies.status, "published"), eq(policies.requiresAcknowledgement, true)))
      .orderBy(asc(policies.title)),
  );
}

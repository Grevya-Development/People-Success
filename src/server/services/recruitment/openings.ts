import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { applications, departments, employees, jobOpenings, jobRequisitions, locations } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { AppError, invalidState, notFound, validation } from "../../lib/errors";
import { slugify, type OpeningInput, type OpeningStatus } from "@/lib/validation/recruitment";
import { canManageRecruitment, requireRecruitmentManage, requireRecruitmentView, toPaise, userNames } from "./shared";

type Row = typeof jobOpenings.$inferSelect;

export type OpeningListItem = {
  id: string;
  title: string;
  slug: string;
  status: OpeningStatus;
  department: string | null;
  location: string | null;
  workMode: string;
  openings: number;
  activeApplicants: number;
  hired: number;
  publishedAt: string | null;
  closesOn: string | null;
  requisitionCode: string | null;
};

export async function listOpenings(ctx: RequestContext, opts: { status?: OpeningStatus } = {}): Promise<OpeningListItem[]> {
  requireRecruitmentView(ctx);
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        o: jobOpenings,
        department: departments.name,
        location: locations.name,
        requisitionCode: jobRequisitions.code,
        active: sql<number>`(select count(*)::int from applications a where a.opening_id = ${jobOpenings.id} and a.status = 'active')`,
        hired: sql<number>`(select count(*)::int from applications a where a.opening_id = ${jobOpenings.id} and a.status = 'hired')`,
      })
      .from(jobOpenings)
      .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
      .leftJoin(locations, eq(locations.id, jobOpenings.locationId))
      .leftJoin(jobRequisitions, eq(jobRequisitions.id, jobOpenings.requisitionId))
      .where(opts.status ? eq(jobOpenings.status, opts.status) : undefined)
      .orderBy(sql`case ${jobOpenings.status} when 'published' then 0 when 'draft' then 1 when 'paused' then 2 else 3 end`, desc(jobOpenings.createdAt))
      .limit(500);
    return rows.map(({ o, ...x }) => ({
      id: o.id,
      title: o.title,
      slug: o.slug,
      status: o.status,
      department: x.department,
      location: x.location,
      workMode: o.workMode,
      openings: o.openings,
      activeApplicants: x.active,
      hired: x.hired,
      publishedAt: o.publishedAt?.toISOString() ?? null,
      closesOn: o.closesOn,
      requisitionCode: x.requisitionCode,
    }));
  });
}

export type OpeningDetail = {
  id: string;
  title: string;
  slug: string;
  status: OpeningStatus;
  description: string;
  requirements: string | null;
  skills: string[];
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  department: string | null;
  location: string | null;
  workMode: string;
  employmentType: string;
  salaryMinAnnual: number | null;
  salaryMaxAnnual: number | null;
  showSalary: boolean;
  openings: number;
  hired: number;
  publishedAt: string | null;
  closesOn: string | null;
  hiringManager: string | null;
  recruiter: string | null;
  requisition: { id: string; code: string; status: string } | null;
  questions: Row["questions"];
  raw: OpeningInput;
  canManage: boolean;
};

export async function getOpening(ctx: RequestContext, id: string): Promise<OpeningDetail> {
  requireRecruitmentView(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ o: jobOpenings, department: departments.name, location: locations.name, hm: employees.displayName, req: { id: jobRequisitions.id, code: jobRequisitions.code, status: jobRequisitions.status } })
      .from(jobOpenings)
      .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
      .leftJoin(locations, eq(locations.id, jobOpenings.locationId))
      .leftJoin(employees, eq(employees.id, jobOpenings.hiringManagerEmployeeId))
      .leftJoin(jobRequisitions, eq(jobRequisitions.id, jobOpenings.requisitionId))
      .where(eq(jobOpenings.id, id));
    if (!row) throw notFound("Job opening");
    const o = row.o;
    const names = await userNames(tx, [o.recruiterUserId]);
    const [{ hired }] = await tx
      .select({ hired: sql<number>`count(*)::int` })
      .from(applications)
      .where(and(eq(applications.openingId, o.id), eq(applications.status, "hired")));
    return {
      id: o.id,
      title: o.title,
      slug: o.slug,
      status: o.status,
      description: o.description,
      requirements: o.requirements,
      skills: o.skills,
      experienceMinYears: o.experienceMinYears,
      experienceMaxYears: o.experienceMaxYears,
      department: row.department,
      location: row.location,
      workMode: o.workMode,
      employmentType: o.employmentType,
      salaryMinAnnual: o.salaryMinAnnual,
      salaryMaxAnnual: o.salaryMaxAnnual,
      showSalary: o.showSalary,
      openings: o.openings,
      hired,
      publishedAt: o.publishedAt?.toISOString() ?? null,
      closesOn: o.closesOn,
      hiringManager: row.hm,
      recruiter: o.recruiterUserId ? (names.get(o.recruiterUserId) ?? null) : null,
      requisition: row.req?.id ? row.req : null,
      questions: o.questions,
      raw: {
        requisitionId: o.requisitionId,
        title: o.title,
        slug: o.slug,
        description: o.description,
        requirements: o.requirements,
        skills: o.skills,
        experienceMinYears: o.experienceMinYears,
        experienceMaxYears: o.experienceMaxYears,
        departmentId: o.departmentId,
        locationId: o.locationId,
        workMode: o.workMode,
        employmentType: o.employmentType,
        salaryMinAnnual: o.salaryMinAnnual == null ? null : o.salaryMinAnnual / 100,
        salaryMaxAnnual: o.salaryMaxAnnual == null ? null : o.salaryMaxAnnual / 100,
        showSalary: o.showSalary,
        openings: o.openings,
        closesOn: o.closesOn,
        hiringManagerEmployeeId: o.hiringManagerEmployeeId,
        recruiterUserId: o.recruiterUserId,
        questions: o.questions,
      },
      canManage: canManageRecruitment(ctx),
    };
  });
}

/** Prefill for "Open a job" from an approved requisition. */
export async function openingDefaultsFromRequisition(ctx: RequestContext, requisitionId: string): Promise<Partial<OpeningInput> | null> {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [r] = await tx.select().from(jobRequisitions).where(eq(jobRequisitions.id, requisitionId));
    if (!r || r.status !== "approved") return null;
    return {
      requisitionId: r.id,
      title: r.title,
      departmentId: r.departmentId,
      locationId: r.locationId,
      employmentType: r.employmentType,
      openings: r.headcount,
      hiringManagerEmployeeId: r.hiringManagerEmployeeId,
      recruiterUserId: r.recruiterUserId,
    };
  });
}

async function uniqueSlug(tx: Tx, base: string, selfId?: string) {
  const root = slugify(base) || "job";
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const [taken] = await tx
      .select({ id: jobOpenings.id })
      .from(jobOpenings)
      .where(and(eq(jobOpenings.slug, candidate), selfId ? ne(jobOpenings.id, selfId) : undefined));
    if (!taken) return candidate;
  }
  throw new AppError("CONFLICT", "Could not find a free link for this job. Choose a different link.");
}

async function assertRefs(tx: Tx, input: OpeningInput) {
  if (input.requisitionId) {
    const [r] = await tx.select({ status: jobRequisitions.status }).from(jobRequisitions).where(eq(jobRequisitions.id, input.requisitionId));
    if (!r) throw validation("Requisition not found.", { requisitionId: ["Not found"] });
    if (r.status !== "approved" && r.status !== "filled") throw validation("Jobs can only be opened from approved requisitions.", { requisitionId: ["Not approved"] });
  }
  if (input.departmentId && !(await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId))).length) {
    throw validation("Department not found.", { departmentId: ["Not found"] });
  }
  if (input.locationId && !(await tx.select({ id: locations.id }).from(locations).where(eq(locations.id, input.locationId))).length) {
    throw validation("Location not found.", { locationId: ["Not found"] });
  }
  if (input.hiringManagerEmployeeId && !(await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.hiringManagerEmployeeId))).length) {
    throw validation("Hiring manager not found.", { hiringManagerEmployeeId: ["Not found"] });
  }
}

function values(input: OpeningInput) {
  const ids = new Set<string>();
  const questions = input.questions.map((q, i) => {
    let id = q.id || `q${i + 1}`;
    while (ids.has(id)) id = `${id}_${i}`;
    ids.add(id);
    return { ...q, id };
  });
  return {
    requisitionId: input.requisitionId,
    title: input.title,
    description: input.description,
    requirements: input.requirements,
    skills: input.skills,
    experienceMinYears: input.experienceMinYears,
    experienceMaxYears: input.experienceMaxYears,
    departmentId: input.departmentId,
    locationId: input.locationId,
    workMode: input.workMode,
    employmentType: input.employmentType,
    salaryMinAnnual: input.salaryMinAnnual == null ? null : toPaise(input.salaryMinAnnual),
    salaryMaxAnnual: input.salaryMaxAnnual == null ? null : toPaise(input.salaryMaxAnnual),
    showSalary: input.showSalary,
    openings: input.openings,
    closesOn: input.closesOn,
    hiringManagerEmployeeId: input.hiringManagerEmployeeId,
    recruiterUserId: input.recruiterUserId,
    questions,
  };
}

export async function createOpening(ctx: RequestContext, input: OpeningInput) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    await assertRefs(tx, input);
    const slug = await uniqueSlug(tx, input.slug || input.title);
    const v = values(input);
    const [o] = await tx
      .insert(jobOpenings)
      .values({ tenantId: ctx.tenantId, ...v, slug, status: "draft", createdBy: ctx.userId, recruiterUserId: v.recruiterUserId ?? ctx.userId })
      .returning({ id: jobOpenings.id });
    await audit(tx, ctx, { action: "opening.created", entityType: "job_opening", entityId: o.id, metadata: { title: input.title, slug, requisitionId: input.requisitionId } });
    return { id: o.id, slug };
  });
}

export async function updateOpening(ctx: RequestContext, id: string, input: OpeningInput) {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(jobOpenings).where(eq(jobOpenings.id, id)).for("update");
    if (!before) throw notFound("Job opening");
    if (before.status === "closed") throw invalidState("Closed jobs cannot be edited.");
    await assertRefs(tx, input);
    const slug = input.slug && input.slug !== before.slug ? await uniqueSlug(tx, input.slug, id) : before.slug;
    const v = { ...values(input), slug };
    await tx.update(jobOpenings).set(v).where(eq(jobOpenings.id, id));
    await audit(tx, ctx, { action: "opening.updated", entityType: "job_opening", entityId: id, changes: diff(before as Record<string, unknown>, v) });
    return { id, slug };
  });
}

/** draft/paused → published, published → paused, any → closed. */
export async function transitionOpening(ctx: RequestContext, id: string, to: "published" | "paused" | "closed") {
  requireRecruitmentManage(ctx);
  return ctx.db(async (tx) => {
    const [o] = await tx.select().from(jobOpenings).where(eq(jobOpenings.id, id)).for("update");
    if (!o) throw notFound("Job opening");
    const allowed: Record<string, OpeningStatus[]> = { published: ["draft", "paused"], paused: ["published"], closed: ["draft", "published", "paused"] };
    if (!allowed[to].includes(o.status)) throw invalidState(`A ${o.status} job cannot be ${to === "published" ? "published" : to}.`);
    if (to === "published") {
      if (o.requisitionId) {
        const [r] = await tx.select({ status: jobRequisitions.status }).from(jobRequisitions).where(eq(jobRequisitions.id, o.requisitionId));
        if (r && r.status !== "approved") throw invalidState(`The requisition is ${r.status.replace(/_/g, " ")}; it must be approved to publish this job.`);
      }
      if (o.closesOn && o.closesOn < new Date().toISOString().slice(0, 10)) throw invalidState("The closing date has passed. Update it before publishing.");
    }
    await tx
      .update(jobOpenings)
      .set({ status: to, ...(to === "published" && !o.publishedAt ? { publishedAt: new Date() } : {}) })
      .where(eq(jobOpenings.id, id));
    await audit(tx, ctx, { action: `opening.${to}`, entityType: "job_opening", entityId: id, changes: diff({ status: o.status }, { status: to }) });
    return { id, status: to };
  });
}

export async function openingOptions(ctx: RequestContext, opts: { onlyOpen?: boolean } = {}) {
  requireRecruitmentView(ctx);
  const rows = await ctx.db((tx) =>
    tx
      .select({ id: jobOpenings.id, title: jobOpenings.title, status: jobOpenings.status })
      .from(jobOpenings)
      .where(opts.onlyOpen ? sql`${jobOpenings.status} in ('draft','published','paused')` : undefined)
      .orderBy(desc(jobOpenings.createdAt))
      .limit(500),
  );
  return rows.map((r) => ({ value: r.id, label: r.title, hint: r.status }));
}

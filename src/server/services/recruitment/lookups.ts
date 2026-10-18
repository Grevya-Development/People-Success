import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { RequestContext } from "../../auth/context";
import { departments, designations, employees, legalEntities, locations, positions, users } from "../../db/schema";
import { usersWithPermission } from "./shared";

export type Option = { value: string; label: string; hint?: string };

export type RecruitmentLookups = {
  departments: Option[];
  designations: Option[];
  locations: Option[];
  legalEntities: Option[];
  defaultLegalEntityId: string | null;
  positions: Option[];
  employees: Option[];
  recruiters: Option[];
  interviewers: Option[];
};

/** Options for requisition, opening, interview and offer forms (one round trip). */
export async function recruitmentLookups(ctx: RequestContext): Promise<RecruitmentLookups> {
  return ctx.db(async (tx) => {
    const [deps, desigs, locs, les, pos, emps, recruiterIds, interviewerIds] = await Promise.all([
      tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
      tx.select({ id: designations.id, name: designations.title }).from(designations).where(eq(designations.isActive, true)).orderBy(asc(designations.title)),
      tx.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.isActive, true)).orderBy(asc(locations.name)),
      tx.select({ id: legalEntities.id, name: legalEntities.name, isDefault: legalEntities.isDefault }).from(legalEntities).where(eq(legalEntities.isActive, true)).orderBy(asc(legalEntities.name)),
      tx.select({ id: positions.id, code: positions.code, title: positions.title }).from(positions).where(inArray(positions.status, ["planned", "open"])).orderBy(asc(positions.code)).limit(1000),
      tx
        .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
        .from(employees)
        .where(and(isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice"])))
        .orderBy(asc(employees.displayName))
        .limit(5000),
      usersWithPermission(tx, ctx.tenantId, "recruitment.manage"),
      usersWithPermission(tx, ctx.tenantId, "interviews.feedback"),
    ]);
    const ids = [...new Set([...recruiterIds, ...interviewerIds])];
    const people = ids.length
      ? await tx.select({ id: users.id, name: sql<string>`coalesce(${users.fullName}, ${users.email})`, email: users.email }).from(users).where(inArray(users.id, ids))
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    const toOpt = (uid: string): Option | null => {
      const p = byId.get(uid);
      return p ? { value: p.id, label: p.name, hint: p.email } : null;
    };
    const sortOpts = (o: (Option | null)[]) => (o.filter(Boolean) as Option[]).sort((a, b) => a.label.localeCompare(b.label));
    return {
      departments: deps.map((d) => ({ value: d.id, label: d.name })),
      designations: desigs.map((d) => ({ value: d.id, label: d.name })),
      locations: locs.map((l) => ({ value: l.id, label: l.name })),
      legalEntities: les.map((l) => ({ value: l.id, label: l.name })),
      defaultLegalEntityId: les.find((l) => l.isDefault)?.id ?? les[0]?.id ?? null,
      positions: pos.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })),
      employees: emps.map((e) => ({ value: e.id, label: e.name, hint: e.code })),
      recruiters: sortOpts(recruiterIds.map(toOpt)),
      interviewers: sortOpts(interviewerIds.map(toOpt)),
    };
  });
}

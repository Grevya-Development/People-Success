import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { authorize, can, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import {
  costCenters,
  departments,
  designations,
  employees,
  legalEntities,
  locations,
  positions,
} from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { conflict, notFound, validation } from "../../lib/errors";
import type { PositionInput, PositionStatus } from "@/lib/validation/organization";

/** Budgets are compensation-like: visible to org managers and tenant-wide compensation viewers. */
export const canSeeBudgets = (ctx: RequestContext) => can(ctx, "org.manage", "all") || can(ctx, "compensation.view", "all");
export const canManagePositions = (ctx: RequestContext) => can(ctx, "org.manage", "all");

const toPaise = (rupees: number) => Math.round(rupees * 100);

export type PositionRow = {
  id: string;
  code: string;
  title: string;
  status: PositionStatus;
  departmentId: string | null;
  department: string | null;
  locationId: string | null;
  location: string | null;
  designationId: string | null;
  designation: string | null;
  legalEntityId: string | null;
  legalEntity: string | null;
  costCenterId: string | null;
  costCenter: string | null;
  reportsToPositionId: string | null;
  reportsTo: string | null;
  employeeId: string | null;
  incumbent: string | null;
  /** Paise. Null when not budgeted or hidden from the caller. */
  budgetedAnnualCtc: number | null;
  currency: string;
  updatedAt: string;
};

export async function listPositions(ctx: RequestContext): Promise<PositionRow[]> {
  authorize(ctx, "org.view");
  const showBudget = canSeeBudgets(ctx);
  const rows = await ctx.db((tx) =>
    tx
      .select({
        p: positions,
        department: departments.name,
        location: locations.name,
        designation: designations.title,
        legalEntity: legalEntities.name,
        costCenter: sql<string | null>`case when ${costCenters.id} is null then null else ${costCenters.code} || ' · ' || ${costCenters.name} end`,
        reportsTo: sql<string | null>`(select pp.code || ' · ' || pp.title from positions pp where pp.id = "positions"."reports_to_position_id")`,
        incumbent: employees.displayName,
      })
      .from(positions)
      .leftJoin(departments, eq(departments.id, positions.departmentId))
      .leftJoin(locations, eq(locations.id, positions.locationId))
      .leftJoin(designations, eq(designations.id, positions.designationId))
      .leftJoin(legalEntities, eq(legalEntities.id, positions.legalEntityId))
      .leftJoin(costCenters, eq(costCenters.id, positions.costCenterId))
      .leftJoin(employees, and(eq(employees.id, positions.employeeId), isNull(employees.deletedAt)))
      .orderBy(sql`case ${positions.status} when 'open' then 0 when 'planned' then 1 when 'filled' then 2 when 'frozen' then 3 else 4 end`, asc(positions.code))
      .limit(5000),
  );
  return rows.map((r) => ({
    id: r.p.id,
    code: r.p.code,
    title: r.p.title,
    status: r.p.status,
    departmentId: r.p.departmentId,
    department: r.department,
    locationId: r.p.locationId,
    location: r.location,
    designationId: r.p.designationId,
    designation: r.designation,
    legalEntityId: r.p.legalEntityId,
    legalEntity: r.legalEntity,
    costCenterId: r.p.costCenterId,
    costCenter: r.costCenter,
    reportsToPositionId: r.p.reportsToPositionId,
    reportsTo: r.reportsTo,
    employeeId: r.p.employeeId,
    incumbent: r.incumbent,
    budgetedAnnualCtc: showBudget ? r.p.budgetedAnnualCtc : null,
    currency: r.p.currency,
    updatedAt: r.p.updatedAt.toISOString(),
  }));
}

export type Option = { value: string; label: string; hint?: string };

export type PositionLookups = {
  departments: Option[];
  locations: Option[];
  designations: Option[];
  legalEntities: Option[];
  costCenters: Option[];
  positions: Option[];
  employees: Option[];
};

export async function positionLookups(ctx: RequestContext): Promise<PositionLookups> {
  authorize(ctx, "org.manage", "all");
  return ctx.db(async (tx) => {
    const [deps, locs, desigs, les, ccs, pos, emps] = await Promise.all([
      tx.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.name)),
      tx.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.isActive, true)).orderBy(asc(locations.name)),
      tx.select({ id: designations.id, title: designations.title }).from(designations).where(eq(designations.isActive, true)).orderBy(asc(designations.title)),
      tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities).where(eq(legalEntities.isActive, true)).orderBy(asc(legalEntities.name)),
      tx.select({ id: costCenters.id, code: costCenters.code, name: costCenters.name }).from(costCenters).where(eq(costCenters.isActive, true)).orderBy(asc(costCenters.code)),
      tx.select({ id: positions.id, code: positions.code, title: positions.title }).from(positions).where(sql`${positions.status} <> 'closed'`).orderBy(asc(positions.code)).limit(5000),
      tx
        .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
        .from(employees)
        .where(and(isNull(employees.deletedAt), inArray(employees.status, ["pending", "active", "on_notice"])))
        .orderBy(asc(employees.displayName))
        .limit(5000),
    ]);
    return {
      departments: deps.map((d) => ({ value: d.id, label: d.name })),
      locations: locs.map((l) => ({ value: l.id, label: l.name })),
      designations: desigs.map((d) => ({ value: d.id, label: d.title })),
      legalEntities: les.map((l) => ({ value: l.id, label: l.name })),
      costCenters: ccs.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
      positions: pos.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })),
      employees: emps.map((e) => ({ value: e.id, label: e.name, hint: e.code })),
    };
  });
}

/** Referenced rows must exist in this tenant (RLS hides others). */
async function assertRefs(tx: Tx, input: PositionInput, selfId?: string) {
  const checks: [keyof PositionInput, string | null, () => Promise<unknown[]>][] = [
    ["departmentId", input.departmentId, () => tx.select({ id: departments.id }).from(departments).where(eq(departments.id, input.departmentId!))],
    ["locationId", input.locationId, () => tx.select({ id: locations.id }).from(locations).where(eq(locations.id, input.locationId!))],
    ["designationId", input.designationId, () => tx.select({ id: designations.id }).from(designations).where(eq(designations.id, input.designationId!))],
    ["legalEntityId", input.legalEntityId, () => tx.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.id, input.legalEntityId!))],
    ["costCenterId", input.costCenterId, () => tx.select({ id: costCenters.id }).from(costCenters).where(eq(costCenters.id, input.costCenterId!))],
    ["reportsToPositionId", input.reportsToPositionId, () => tx.select({ id: positions.id }).from(positions).where(eq(positions.id, input.reportsToPositionId!))],
    [
      "employeeId",
      input.employeeId,
      () =>
        tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, input.employeeId!), isNull(employees.deletedAt), sql`${employees.status} <> 'exited'`)),
    ],
  ];
  const fieldErrors: Record<string, string[]> = {};
  for (const [field, id, query] of checks) {
    if (id && (await query()).length === 0) fieldErrors[field] = ["Not found"];
  }
  if (Object.keys(fieldErrors).length) throw validation("Some selected records no longer exist.", fieldErrors);

  if (input.reportsToPositionId && selfId) {
    if (input.reportsToPositionId === selfId) {
      throw validation("A position cannot report to itself.", { reportsToPositionId: ["Choose a different position"] });
    }
    // Walk up from the proposed parent; reaching this position means a loop.
    const [hit] = await tx.execute<{ loop: boolean }>(sql`
      with recursive chain(id, depth) as (
        select ${input.reportsToPositionId}::uuid, 1
        union all
        select p.reports_to_position_id, c.depth + 1 from positions p join chain c on p.id = c.id
        where p.reports_to_position_id is not null and c.depth < 100
      )
      select exists (select 1 from chain where id = ${selfId}::uuid) as loop`);
    if (hit?.loop) {
      throw validation("This would create a reporting loop between positions.", { reportsToPositionId: ["Creates a loop"] });
    }
  }
  if (input.employeeId) {
    const [taken] = await tx
      .select({ code: positions.code })
      .from(positions)
      .where(and(eq(positions.employeeId, input.employeeId), selfId ? sql`${positions.id} <> ${selfId}` : undefined));
    if (taken) throw validation(`This employee already fills position ${taken.code}.`, { employeeId: [`Already in ${taken.code}`] });
  }
}

function values(input: PositionInput) {
  return {
    code: input.code.trim().toUpperCase(),
    title: input.title,
    status: input.status,
    departmentId: input.departmentId,
    locationId: input.locationId,
    designationId: input.designationId,
    legalEntityId: input.legalEntityId,
    costCenterId: input.costCenterId,
    reportsToPositionId: input.reportsToPositionId,
    employeeId: input.employeeId,
    budgetedAnnualCtc: input.budgetedAnnualCtc == null ? null : toPaise(input.budgetedAnnualCtc),
  };
}

async function assertCodeFree(tx: Tx, code: string, selfId?: string) {
  const [dup] = await tx
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.code, code), selfId ? sql`${positions.id} <> ${selfId}` : undefined));
  if (dup) throw validation("Another position already uses this code.", { code: ["Code already in use"] });
}

export async function createPosition(ctx: RequestContext, input: PositionInput) {
  authorize(ctx, "org.manage", "all");
  return ctx.db(async (tx) => {
    const v = values(input);
    await assertCodeFree(tx, v.code);
    await assertRefs(tx, input);
    const [row] = await tx
      .insert(positions)
      .values({ tenantId: ctx.tenantId, ...v })
      .returning({ id: positions.id });
    if (!row) throw conflict("The position could not be created.");
    await audit(tx, ctx, {
      action: "position.created",
      entityType: "position",
      entityId: row.id,
      changes: diff(null, v),
    });
    return { id: row.id };
  });
}

export async function updatePosition(ctx: RequestContext, input: PositionInput & { id: string }) {
  authorize(ctx, "org.manage", "all");
  return ctx.db(async (tx) => {
    const [before] = await tx.select().from(positions).where(eq(positions.id, input.id)).for("update");
    if (!before) throw notFound("Position");
    const v = values(input);
    await assertCodeFree(tx, v.code, input.id);
    await assertRefs(tx, input, input.id);
    await tx.update(positions).set(v).where(eq(positions.id, input.id));
    await audit(tx, ctx, {
      action: "position.updated",
      entityType: "position",
      entityId: input.id,
      changes: diff(
        {
          code: before.code,
          title: before.title,
          status: before.status,
          departmentId: before.departmentId,
          locationId: before.locationId,
          designationId: before.designationId,
          legalEntityId: before.legalEntityId,
          costCenterId: before.costCenterId,
          reportsToPositionId: before.reportsToPositionId,
          employeeId: before.employeeId,
          budgetedAnnualCtc: before.budgetedAnnualCtc,
        },
        v,
      ),
    });
    return { id: input.id };
  });
}

export type WorkforcePlanRow = {
  departmentId: string | null;
  department: string;
  approved: number;
  filled: number;
  open: number;
  planned: number;
  frozen: number;
  headcount: number;
  /** Paise; null when hidden from the caller. */
  budgetTotal: number | null;
};

/** Per department: approved positions (planned + open + filled), filled, open vacancies and budget. */
export async function workforcePlan(ctx: RequestContext): Promise<WorkforcePlanRow[]> {
  authorize(ctx, "org.view");
  const showBudget = canSeeBudgets(ctx);
  const rows = await ctx.db((tx) =>
    tx.execute<{
      department_id: string | null;
      department: string | null;
      approved: number;
      filled: number;
      open: number;
      planned: number;
      frozen: number;
      headcount: number;
      budget: string | null;
    }>(sql`
      with pos as (
        select department_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) as k,
               count(*) filter (where status in ('planned', 'open', 'filled'))::int as approved,
               count(*) filter (where status = 'filled')::int as filled,
               count(*) filter (where status = 'open')::int as open,
               count(*) filter (where status = 'planned')::int as planned,
               count(*) filter (where status = 'frozen')::int as frozen,
               sum(budgeted_annual_ctc) filter (where status in ('planned', 'open', 'filled')) as budget
        from positions
        group by department_id
      ),
      hc as (
        select department_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) as k, count(*)::int as n
        from employees
        where deleted_at is null and status in ('active', 'on_notice')
        group by department_id
      )
      select coalesce(pos.department_id, hc.department_id) as department_id, d.name as department,
             coalesce(pos.approved, 0) as approved, coalesce(pos.filled, 0) as filled, coalesce(pos.open, 0) as open,
             coalesce(pos.planned, 0) as planned, coalesce(pos.frozen, 0) as frozen,
             coalesce(hc.n, 0) as headcount, pos.budget::text as budget
      from pos
      full outer join hc on hc.k = pos.k
      left join departments d on d.id = coalesce(pos.department_id, hc.department_id)
      order by d.name nulls last
    `),
  );
  return rows.map((r) => ({
    departmentId: r.department_id,
    department: r.department ?? "No department",
    approved: Number(r.approved),
    filled: Number(r.filled),
    open: Number(r.open),
    planned: Number(r.planned),
    frozen: Number(r.frozen),
    headcount: Number(r.headcount),
    budgetTotal: showBudget && r.budget != null ? Number(r.budget) : null,
  }));
}

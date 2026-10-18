import { asc, eq, sql, type Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { authorize } from "../../auth/context";
import type { Tx } from "../../db/client";
import {
  businessUnits,
  costCenters,
  departments,
  designations,
  employees,
  employmentRecords,
  grades,
  jobFamilies,
  legalEntities,
  positions,
  teams,
} from "../../db/schema";
import { diff } from "../../lib/audit";
import { invalidState, notFound, validation } from "../../lib/errors";
import {
  businessUnitSchema,
  costCenterSchema,
  departmentSchema,
  designationSchema,
  gradeSchema,
  jobFamilySchema,
  STRUCTURE_LABELS,
  teamSchema,
  type BusinessUnitInput,
  type CostCenterInput,
  type DepartmentInput,
  type DesignationInput,
  type GradeInput,
  type JobFamilyInput,
  type StructureKind,
  type TeamInput,
} from "@/lib/validation/settings";
import { auditAs, friendlyDbError, recordSetupSteps, referenceCount, snapshot, type SettingsCtx } from "./shared";
import { employeeNamesById, employeeOptions, legalEntityOptions, type Option } from "./lookups";

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

async function countBy(tx: Tx, column: Column, table: PgTable, where = sql`true`) {
  const rows = await tx.execute<{ id: string; n: number }>(
    sql`select ${column} as id, count(*)::int as n from ${table} where ${column} is not null and ${where} group by 1`,
  );
  return new Map([...rows].map((r) => [r.id, Number(r.n)]));
}

const liveEmployees = sql`${employees.deletedAt} is null and ${employees.status} <> 'exited'`;

export type StructureData = Awaited<ReturnType<typeof getStructure>>;

/** All structure lists for the settings page (small, tenant-scoped tables). */
export async function getStructure(ctx: SettingsCtx) {
  authorize(ctx, "org.manage", "all");
  return ctx.db(async (tx) => {
    const [deps, desigs, grs, fams, ccs, bus, tms, entities, people] = await Promise.all([
      tx.select().from(departments).orderBy(sql`${departments.isActive} desc`, asc(departments.name)),
      tx.select().from(designations).orderBy(sql`${designations.isActive} desc`, asc(designations.title)),
      tx.select().from(grades).orderBy(asc(grades.rank), asc(grades.code)),
      tx.select().from(jobFamilies).orderBy(asc(jobFamilies.name)),
      tx.select().from(costCenters).orderBy(sql`${costCenters.isActive} desc`, asc(costCenters.code)),
      tx.select().from(businessUnits).orderBy(sql`${businessUnits.isActive} desc`, asc(businessUnits.name)),
      tx.select().from(teams).orderBy(sql`${teams.isActive} desc`, asc(teams.name)),
      legalEntityOptions(tx),
      employeeOptions(tx),
    ]);
    const [empByDept, empByDesig, empByGrade, empByCc, empByBu, empByTeam, desigByFamily, desigByGrade, childDepts] = await Promise.all([
      countBy(tx, employees.departmentId, employees, liveEmployees),
      countBy(tx, employees.designationId, employees, liveEmployees),
      countBy(tx, employees.gradeId, employees, liveEmployees),
      countBy(tx, employees.costCenterId, employees, liveEmployees),
      countBy(tx, employees.businessUnitId, employees, liveEmployees),
      countBy(tx, employees.teamId, employees, liveEmployees),
      countBy(tx, designations.jobFamilyId, designations),
      countBy(tx, designations.gradeId, designations),
      countBy(tx, departments.parentId, departments),
    ]);
    const names = await employeeNamesById(tx, [
      ...deps.map((d) => d.headEmployeeId),
      ...bus.map((b) => b.headEmployeeId),
      ...tms.map((t) => t.leadEmployeeId),
    ]);
    const nameOf = <T extends { id: string }>(rows: T[], label: (r: T) => string) => new Map(rows.map((r) => [r.id, label(r)]));
    const depName = nameOf(deps, (d) => d.name);
    const famName = nameOf(fams, (f) => f.name);
    const gradeName = nameOf(grs, (g) => `${g.code} · ${g.name}`);
    const ccName = nameOf(ccs, (c) => `${c.code} · ${c.name}`);
    const buName = nameOf(bus, (b) => b.name);
    const leName = new Map(entities.map((e) => [e.value, e.label]));

    return {
      departments: deps.map((d) => ({
        ...d,
        parentName: d.parentId ? (depName.get(d.parentId) ?? null) : null,
        headName: d.headEmployeeId ? (names.get(d.headEmployeeId) ?? null) : null,
        businessUnitName: d.businessUnitId ? (buName.get(d.businessUnitId) ?? null) : null,
        costCenterName: d.costCenterId ? (ccName.get(d.costCenterId) ?? null) : null,
        employeeCount: empByDept.get(d.id) ?? 0,
        childCount: childDepts.get(d.id) ?? 0,
      })),
      designations: desigs.map((d) => ({
        ...d,
        jobFamilyName: d.jobFamilyId ? (famName.get(d.jobFamilyId) ?? null) : null,
        gradeName: d.gradeId ? (gradeName.get(d.gradeId) ?? null) : null,
        employeeCount: empByDesig.get(d.id) ?? 0,
      })),
      grades: grs.map((g) => ({ ...g, employeeCount: empByGrade.get(g.id) ?? 0, designationCount: desigByGrade.get(g.id) ?? 0 })),
      jobFamilies: fams.map((f) => ({ ...f, designationCount: desigByFamily.get(f.id) ?? 0 })),
      costCenters: ccs.map((c) => ({
        ...c,
        legalEntityName: c.legalEntityId ? (leName.get(c.legalEntityId) ?? null) : null,
        employeeCount: empByCc.get(c.id) ?? 0,
      })),
      businessUnits: bus.map((b) => ({
        ...b,
        headName: b.headEmployeeId ? (names.get(b.headEmployeeId) ?? null) : null,
        employeeCount: empByBu.get(b.id) ?? 0,
      })),
      teams: tms.map((t) => ({
        ...t,
        departmentName: t.departmentId ? (depName.get(t.departmentId) ?? null) : null,
        leadName: t.leadEmployeeId ? (names.get(t.leadEmployeeId) ?? null) : null,
        employeeCount: empByTeam.get(t.id) ?? 0,
      })),
      options: {
        departments: deps.filter((d) => d.isActive).map<Option>((d) => ({ value: d.id, label: d.name })),
        jobFamilies: fams.map<Option>((f) => ({ value: f.id, label: f.name })),
        grades: grs.map<Option>((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
        costCenters: ccs.filter((c) => c.isActive).map<Option>((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
        businessUnits: bus.filter((b) => b.isActive).map<Option>((b) => ({ value: b.id, label: b.name })),
        legalEntities: entities,
        employees: people,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

async function assertExists(tx: Tx, table: PgTable & { id: Column }, id: string | null | undefined, field: string, label: string) {
  if (!id) return;
  const rows = await tx.execute(sql`select 1 from ${table} where ${table.id} = ${id} limit 1`);
  if (!rows.length) throw validation(`Choose a valid ${label}.`, { [field]: [`${label[0].toUpperCase()}${label.slice(1)} not found`] });
}

const UNIQUE_MESSAGES: Record<string, string> = {
  departments_tenant_name_key: "Another department already uses this name.",
  designations_tenant_title_key: "Another designation already uses this title.",
  grades_tenant_code_key: "Another grade already uses this code.",
  job_families_tenant_name_key: "Another job family already uses this name.",
  cost_centers_tenant_code_key: "Another cost center already uses this code.",
  business_units_tenant_name_key: "Another business unit already uses this name.",
  teams_tenant_name_key: "Another team already uses this name.",
};

type Saved = { id: string };

/** Shared create/update + audit flow. `load` must return the current row (or nothing). */
async function upsert<Row extends Record<string, unknown> & { id: string }>(
  ctx: SettingsCtx,
  kind: StructureKind,
  id: string | undefined,
  load: (tx: Tx, id: string) => Promise<Row | undefined>,
  write: (tx: Tx, before: Row | null) => Promise<Row>,
): Promise<Saved> {
  authorize(ctx, "org.manage", "all");
  try {
    return await ctx.db(async (tx) => {
      const before = id ? ((await load(tx, id)) ?? null) : null;
      if (id && !before) throw notFound(titleOf(kind));
      const row = await write(tx, before);
      await auditAs(tx, ctx, {
        action: `${entityType(kind)}.${before ? "updated" : "created"}`,
        entityType: entityType(kind),
        entityId: row.id,
        changes: diff(snapshot(before), snapshot(row)!),
      });
      if (kind === "departments" || kind === "designations") {
        const [{ d, g }] = await tx.execute<{ d: boolean; g: boolean }>(
          sql`select exists(select 1 from ${departments} where ${departments.isActive}) as d,
                     exists(select 1 from ${designations} where ${designations.isActive}) as g`,
        );
        if (d && g) await recordSetupSteps(tx, ctx.tenantId, ["structure"]);
      }
      return { id: row.id };
    });
  } catch (err) {
    friendlyDbError(err, UNIQUE_MESSAGES);
  }
}

const titleOf = (kind: StructureKind) => {
  const s = STRUCTURE_LABELS[kind].singular;
  return s[0].toUpperCase() + s.slice(1);
};
const entityType = (kind: StructureKind) =>
  ({
    departments: "department",
    designations: "designation",
    grades: "grade",
    job_families: "job_family",
    cost_centers: "cost_center",
    business_units: "business_unit",
    teams: "team",
  })[kind];

export async function saveDepartment(ctx: SettingsCtx, raw: DepartmentInput) {
  const input = departmentSchema.parse(raw);
  return upsert(
    ctx,
    "departments",
    input.id,
    async (tx, id) => (await tx.select().from(departments).where(eq(departments.id, id)).for("update"))[0],
    async (tx, before) => {
      if (input.parentId && input.parentId === before?.id) {
        throw validation("A department cannot be its own parent.", { parentId: ["Choose a different parent"] });
      }
      await assertExists(tx, departments, input.parentId, "parentId", "parent department");
      await assertExists(tx, employees, input.headEmployeeId, "headEmployeeId", "department head");
      await assertExists(tx, businessUnits, input.businessUnitId, "businessUnitId", "business unit");
      await assertExists(tx, costCenters, input.costCenterId, "costCenterId", "cost center");
      const values = {
        name: input.name,
        code: input.code ?? null,
        parentId: input.parentId,
        headEmployeeId: input.headEmployeeId,
        businessUnitId: input.businessUnitId,
        costCenterId: input.costCenterId,
        isActive: input.isActive,
      };
      const [row] = before
        ? await tx.update(departments).set(values).where(eq(departments.id, before.id)).returning()
        : await tx.insert(departments).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

export async function saveDesignation(ctx: SettingsCtx, raw: DesignationInput) {
  const input = designationSchema.parse(raw);
  return upsert(
    ctx,
    "designations",
    input.id,
    async (tx, id) => (await tx.select().from(designations).where(eq(designations.id, id)))[0],
    async (tx, before) => {
      await assertExists(tx, jobFamilies, input.jobFamilyId, "jobFamilyId", "job family");
      await assertExists(tx, grades, input.gradeId, "gradeId", "grade");
      const values = {
        title: input.title,
        jobFamilyId: input.jobFamilyId,
        gradeId: input.gradeId,
        description: input.description ?? null,
        isActive: input.isActive,
      };
      const [row] = before
        ? await tx.update(designations).set(values).where(eq(designations.id, before.id)).returning()
        : await tx.insert(designations).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

export async function saveGrade(ctx: SettingsCtx, raw: GradeInput) {
  const input = gradeSchema.parse(raw);
  return upsert(
    ctx,
    "grades",
    input.id,
    async (tx, id) => (await tx.select().from(grades).where(eq(grades.id, id)))[0],
    async (tx, before) => {
      const values = {
        code: input.code,
        name: input.name,
        rank: input.rank,
        // Rupees from the form, paise in the database.
        minAnnualCtc: input.minAnnualCtcRupees == null ? null : input.minAnnualCtcRupees * 100,
        maxAnnualCtc: input.maxAnnualCtcRupees == null ? null : input.maxAnnualCtcRupees * 100,
        currency: "INR",
      };
      const [row] = before
        ? await tx.update(grades).set(values).where(eq(grades.id, before.id)).returning()
        : await tx.insert(grades).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

export async function saveJobFamily(ctx: SettingsCtx, raw: JobFamilyInput) {
  const input = jobFamilySchema.parse(raw);
  return upsert(
    ctx,
    "job_families",
    input.id,
    async (tx, id) => (await tx.select().from(jobFamilies).where(eq(jobFamilies.id, id)))[0],
    async (tx, before) => {
      const values = { name: input.name, description: input.description ?? null };
      const [row] = before
        ? await tx.update(jobFamilies).set(values).where(eq(jobFamilies.id, before.id)).returning()
        : await tx.insert(jobFamilies).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

export async function saveCostCenter(ctx: SettingsCtx, raw: CostCenterInput) {
  const input = costCenterSchema.parse(raw);
  return upsert(
    ctx,
    "cost_centers",
    input.id,
    async (tx, id) => (await tx.select().from(costCenters).where(eq(costCenters.id, id)))[0],
    async (tx, before) => {
      await assertExists(tx, legalEntities, input.legalEntityId, "legalEntityId", "legal entity");
      const values = { code: input.code, name: input.name, legalEntityId: input.legalEntityId, isActive: input.isActive };
      const [row] = before
        ? await tx.update(costCenters).set(values).where(eq(costCenters.id, before.id)).returning()
        : await tx.insert(costCenters).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

export async function saveBusinessUnit(ctx: SettingsCtx, raw: BusinessUnitInput) {
  const input = businessUnitSchema.parse(raw);
  return upsert(
    ctx,
    "business_units",
    input.id,
    async (tx, id) => (await tx.select().from(businessUnits).where(eq(businessUnits.id, id)))[0],
    async (tx, before) => {
      await assertExists(tx, employees, input.headEmployeeId, "headEmployeeId", "head");
      const values = { name: input.name, code: input.code ?? null, headEmployeeId: input.headEmployeeId, isActive: input.isActive };
      const [row] = before
        ? await tx.update(businessUnits).set(values).where(eq(businessUnits.id, before.id)).returning()
        : await tx.insert(businessUnits).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

export async function saveTeam(ctx: SettingsCtx, raw: TeamInput) {
  const input = teamSchema.parse(raw);
  return upsert(
    ctx,
    "teams",
    input.id,
    async (tx, id) => (await tx.select().from(teams).where(eq(teams.id, id)))[0],
    async (tx, before) => {
      await assertExists(tx, departments, input.departmentId, "departmentId", "department");
      await assertExists(tx, employees, input.leadEmployeeId, "leadEmployeeId", "team lead");
      const values = { name: input.name, departmentId: input.departmentId, leadEmployeeId: input.leadEmployeeId, isActive: input.isActive };
      const [row] = before
        ? await tx.update(teams).set(values).where(eq(teams.id, before.id)).returning()
        : await tx.insert(teams).values({ tenantId: ctx.tenantId, ...values }).returning();
      return row;
    },
  );
}

/* ------------------------------------------------------------------ */
/* Removing: delete when unreferenced, otherwise deactivate            */
/* ------------------------------------------------------------------ */

type RemovalConfig = {
  table: PgTable & { id: Column };
  activeColumn: Column | null;
  refs: { table: PgTable; column: Column }[];
};

const REMOVAL: Record<StructureKind, RemovalConfig> = {
  departments: {
    table: departments,
    activeColumn: departments.isActive,
    refs: [
      { table: employees, column: employees.departmentId },
      { table: positions, column: positions.departmentId },
      { table: teams, column: teams.departmentId },
      { table: departments, column: departments.parentId },
      { table: employmentRecords, column: employmentRecords.departmentId },
    ],
  },
  designations: {
    table: designations,
    activeColumn: designations.isActive,
    refs: [
      { table: employees, column: employees.designationId },
      { table: positions, column: positions.designationId },
      { table: employmentRecords, column: employmentRecords.designationId },
    ],
  },
  grades: {
    table: grades,
    activeColumn: null,
    refs: [
      { table: employees, column: employees.gradeId },
      { table: designations, column: designations.gradeId },
      { table: employmentRecords, column: employmentRecords.gradeId },
    ],
  },
  job_families: { table: jobFamilies, activeColumn: null, refs: [{ table: designations, column: designations.jobFamilyId }] },
  cost_centers: {
    table: costCenters,
    activeColumn: costCenters.isActive,
    refs: [
      { table: employees, column: employees.costCenterId },
      { table: departments, column: departments.costCenterId },
      { table: positions, column: positions.costCenterId },
      { table: employmentRecords, column: employmentRecords.costCenterId },
    ],
  },
  business_units: {
    table: businessUnits,
    activeColumn: businessUnits.isActive,
    refs: [
      { table: employees, column: employees.businessUnitId },
      { table: departments, column: departments.businessUnitId },
    ],
  },
  teams: { table: teams, activeColumn: teams.isActive, refs: [{ table: employees, column: employees.teamId }] },
};

export async function removeStructureItem(
  ctx: SettingsCtx,
  kind: StructureKind,
  id: string,
): Promise<{ outcome: "deleted" | "deactivated" }> {
  authorize(ctx, "org.manage", "all");
  const cfg = REMOVAL[kind];
  return ctx.db(async (tx) => {
    const found = await tx.execute(sql`select 1 from ${cfg.table} where ${cfg.table.id} = ${id} for update`);
    if (!found.length) throw notFound(titleOf(kind));
    const refs = await referenceCount(tx, cfg.refs, id);
    if (refs > 0) {
      if (!cfg.activeColumn) {
        throw invalidState(`This ${STRUCTURE_LABELS[kind].singular} is in use by ${refs} record${refs === 1 ? "" : "s"} and cannot be deleted.`);
      }
      await tx.execute(sql`update ${cfg.table} set is_active = false, updated_at = now() where ${cfg.table.id} = ${id}`);
      await auditAs(tx, ctx, {
        action: `${entityType(kind)}.deactivated`,
        entityType: entityType(kind),
        entityId: id,
        changes: { isActive: { from: true, to: false } },
        metadata: { references: refs },
      });
      return { outcome: "deactivated" as const };
    }
    await tx.execute(sql`delete from ${cfg.table} where ${cfg.table.id} = ${id}`);
    await auditAs(tx, ctx, { action: `${entityType(kind)}.deleted`, entityType: entityType(kind), entityId: id });
    return { outcome: "deleted" as const };
  });
}

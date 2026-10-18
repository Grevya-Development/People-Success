import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { format, startOfMonth, subDays } from "date-fns";
import { can, canAccessEmployee, getTeamEmployeeIds, scopeOf, type RequestContext } from "../../auth/context";
import {
  assetAssignments,
  assets,
  compensationRecords,
  costCenters,
  departments,
  dependents,
  designations,
  emergencyContacts,
  employeeAddresses,
  employeeSensitive,
  employeeSkills,
  employees,
  employmentRecords,
  grades,
  legalEntities,
  locations,
  qualifications,
  skills,
  auditLogs,
  dataChangeRequests,
  users,
} from "../../db/schema";
import { forbidden, notFound } from "../../lib/errors";
import { alias } from "drizzle-orm/pg-core";
import { mask } from "../../lib/crypto";
import type { EmployeeListQuery } from "@/lib/validation/employees";

export const PAGE_SIZE = 50;

const manager = alias(employees, "manager");

export type EmployeeRow = {
  id: string;
  code: string;
  name: string;
  workEmail: string | null;
  status: string;
  employmentType: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  managerId: string | null;
  managerName: string | null;
  joiningDate: string;
};

/**
 * Directory / employee list. Visibility:
 * - employees.view:all  → everyone, any status
 * - directory.view      → current (non-exited) employees, basic fields
 * - employees.view:team → reporting subtree + self
 * - otherwise           → self only
 */
export async function listEmployees(ctx: RequestContext, q: EmployeeListQuery) {
  const fullView = can(ctx, "employees.view", "all");
  const directory = can(ctx, "directory.view", "all");
  const viewScope = scopeOf(ctx, "employees.view");
  if (!fullView && !directory && !viewScope) throw forbidden();

  const where: (SQL | undefined)[] = [isNull(employees.deletedAt)];
  if (!fullView && !directory) {
    const ids = viewScope === "team" ? [...(await getTeamEmployeeIds(ctx)), ctx.employeeId] : [ctx.employeeId];
    const visible = ids.filter(Boolean) as string[];
    where.push(visible.length ? inArray(employees.id, visible) : sql`false`);
  }

  if (q.status === "current") where.push(inArray(employees.status, ["pending", "active", "on_notice"]));
  else if (q.status !== "all") {
    if (q.status === "exited" && !fullView) throw forbidden("Only HR can browse former employees.");
    where.push(eq(employees.status, q.status));
  } else if (!fullView) where.push(inArray(employees.status, ["pending", "active", "on_notice"]));
  if (q.departmentId) where.push(eq(employees.departmentId, q.departmentId));
  if (q.locationId) where.push(eq(employees.locationId, q.locationId));
  if (q.employmentType) where.push(eq(employees.employmentType, q.employmentType));
  if (q.joined === "this-month") where.push(gte(employees.joiningDate, format(startOfMonth(new Date()), "yyyy-MM-dd")));
  if (q.joined === "last-30-days") where.push(gte(employees.joiningDate, format(subDays(new Date(), 30), "yyyy-MM-dd")));
  if (q.q) {
    const term = `%${q.q.replace(/[%_\\]/g, "")}%`;
    where.push(
      or(
        ilike(employees.displayName, term),
        ilike(employees.employeeCode, term),
        ilike(employees.workEmail, term),
        ilike(designations.title, term),
      ),
    );
  }

  const order = {
    name: employees.displayName,
    code: employees.employeeCode,
    joining: employees.joiningDate,
    department: departments.name,
  }[q.sort];

  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: employees.id,
        code: employees.employeeCode,
        name: employees.displayName,
        workEmail: employees.workEmail,
        status: employees.status,
        employmentType: employees.employmentType,
        designation: designations.title,
        department: departments.name,
        location: locations.name,
        managerId: employees.managerId,
        managerName: manager.displayName,
        joiningDate: employees.joiningDate,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(locations, eq(locations.id, employees.locationId))
      .leftJoin(manager, eq(manager.id, employees.managerId))
      .where(and(...where))
      .orderBy(q.dir === "desc" ? sql`${order} desc nulls last` : sql`${order} asc nulls last`, asc(employees.id))
      .limit(PAGE_SIZE)
      .offset((q.page - 1) * PAGE_SIZE);
    const total = rows[0]?.total ?? 0;
    return {
      rows: rows.map((r) => {
        const { total, ...row } = r;
        void total;
        return row as EmployeeRow;
      }),
      total,
      page: q.page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export type ProfileAccess = {
  isSelf: boolean;
  full: boolean;
  canEdit: boolean;
  canEditAll: boolean;
  canViewCompensation: boolean;
  canEditCompensation: boolean;
  canViewSensitive: boolean;
  canEditSensitive: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
  canManageAssets: boolean;
};

export async function profileAccess(ctx: RequestContext, employeeId: string): Promise<ProfileAccess | null> {
  const isSelf = ctx.employeeId === employeeId;
  const full = await canAccessEmployee(ctx, "employees.view", employeeId);
  if (!full && !can(ctx, "directory.view", "all")) return null;
  return {
    isSelf,
    full,
    canEdit: await canAccessEmployee(ctx, "employees.edit", employeeId),
    canEditAll: can(ctx, "employees.edit", "all"),
    canViewCompensation: await canAccessEmployee(ctx, "compensation.view", employeeId),
    canEditCompensation: can(ctx, "compensation.edit", "all"),
    canViewSensitive: isSelf || can(ctx, "employees.sensitive.view", "all"),
    canEditSensitive: can(ctx, "employees.sensitive.edit", "all"),
    canViewDocuments: await canAccessEmployee(ctx, "documents.view", employeeId),
    canViewActivity: can(ctx, "audit.view", "all"),
    canManageAssets: can(ctx, "assets.manage", "all"),
  };
}

export async function getEmployeeHeader(ctx: RequestContext, employeeId: string) {
  const access = await profileAccess(ctx, employeeId);
  if (!access) throw forbidden();
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        e: employees,
        designation: designations.title,
        department: departments.name,
        location: locations.name,
        legalEntity: legalEntities.name,
        grade: grades.name,
        costCenter: costCenters.name,
        managerName: manager.displayName,
      })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(locations, eq(locations.id, employees.locationId))
      .leftJoin(legalEntities, eq(legalEntities.id, employees.legalEntityId))
      .leftJoin(grades, eq(grades.id, employees.gradeId))
      .leftJoin(costCenters, eq(costCenters.id, employees.costCenterId))
      .leftJoin(manager, eq(manager.id, employees.managerId))
      .where(and(eq(employees.id, employeeId), isNull(employees.deletedAt)));
    if (!r) return null;
    const [reports] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(employees)
      .where(and(eq(employees.managerId, employeeId), isNull(employees.deletedAt), inArray(employees.status, ["active", "on_notice", "pending"])));
    return { ...r, directReports: reports?.n ?? 0 };
  });
  if (!row) throw notFound("Employee");
  // Directory-only viewers never see exited employees or personal fields.
  if (!access.full && row.e.status === "exited") throw notFound("Employee");
  const e = row.e;
  return {
    access,
    employee: {
      id: e.id,
      code: e.employeeCode,
      name: e.displayName,
      firstName: e.firstName,
      middleName: e.middleName,
      lastName: e.lastName,
      workEmail: e.workEmail,
      status: e.status,
      employmentType: e.employmentType,
      workerType: e.workerType,
      workMode: e.workMode,
      joiningDate: e.joiningDate,
      probationEndDate: e.probationEndDate,
      confirmationDate: e.confirmationDate,
      exitDate: e.exitDate,
      noticePeriodDays: e.noticePeriodDays,
      hasLogin: !!e.userId,
      legalEntityId: e.legalEntityId,
      departmentId: e.departmentId,
      designationId: e.designationId,
      locationId: e.locationId,
      managerId: e.managerId,
      gradeId: e.gradeId,
      costCenterId: e.costCenterId,
      designation: row.designation,
      department: row.department,
      location: row.location,
      legalEntity: row.legalEntity,
      grade: row.grade,
      costCenter: row.costCenter,
      managerName: row.managerName,
      directReports: row.directReports,
      // Personal fields only for full viewers.
      personalEmail: access.full ? e.personalEmail : null,
      phone: access.full ? e.phone : null,
      dateOfBirth: access.full ? e.dateOfBirth : null,
      gender: access.full ? e.gender : null,
      maritalStatus: access.full ? e.maritalStatus : null,
      nationality: access.full ? e.nationality : null,
      bloodGroup: access.full ? e.bloodGroup : null,
    },
  };
}

export type EmployeeHeader = Awaited<ReturnType<typeof getEmployeeHeader>>;

export async function getJobHistory(ctx: RequestContext, employeeId: string) {
  if (!(await canAccessEmployee(ctx, "employees.view", employeeId))) throw forbidden();
  return ctx.db((tx) =>
    tx
      .select({
        id: employmentRecords.id,
        effectiveFrom: employmentRecords.effectiveFrom,
        effectiveTo: employmentRecords.effectiveTo,
        changeType: employmentRecords.changeType,
        reason: employmentRecords.reason,
        designation: designations.title,
        department: departments.name,
        location: locations.name,
        managerName: manager.displayName,
        employmentType: employmentRecords.employmentType,
      })
      .from(employmentRecords)
      .leftJoin(designations, eq(designations.id, employmentRecords.designationId))
      .leftJoin(departments, eq(departments.id, employmentRecords.departmentId))
      .leftJoin(locations, eq(locations.id, employmentRecords.locationId))
      .leftJoin(manager, eq(manager.id, employmentRecords.managerId))
      .where(eq(employmentRecords.employeeId, employeeId))
      .orderBy(desc(employmentRecords.effectiveFrom)),
  );
}

export async function getCompensationHistory(ctx: RequestContext, employeeId: string) {
  if (!(await canAccessEmployee(ctx, "compensation.view", employeeId))) throw forbidden();
  // RLS (compensation_read policy) independently enforces the same rule.
  return ctx.db((tx) =>
    tx
      .select({
        id: compensationRecords.id,
        effectiveFrom: compensationRecords.effectiveFrom,
        effectiveTo: compensationRecords.effectiveTo,
        annualCtc: compensationRecords.annualCtc,
        currency: compensationRecords.currency,
        reason: compensationRecords.reason,
        notes: compensationRecords.notes,
      })
      .from(compensationRecords)
      .where(eq(compensationRecords.employeeId, employeeId))
      .orderBy(desc(compensationRecords.effectiveFrom)),
  );
}

/** Statutory & bank details, masked. Decrypted values never leave the server. */
export async function getSensitive(ctx: RequestContext, employeeId: string) {
  const isSelf = ctx.employeeId === employeeId;
  if (!isSelf && !can(ctx, "employees.sensitive.view", "all")) throw forbidden();
  const [row] = await ctx.db((tx) => tx.select().from(employeeSensitive).where(eq(employeeSensitive.employeeId, employeeId)));
  if (!row) return null;
  return {
    pan: mask(row.panLast4, 6),
    aadhaar: mask(row.aadhaarLast4, 8),
    passport: mask(row.passportLast4, 4),
    uan: row.uan,
    esicNumber: row.esicNumber,
    bankAccount: mask(row.bankAccountLast4, 8),
    bankIfsc: row.bankIfsc,
    bankName: row.bankName,
    accountHolderName: row.accountHolderName,
    taxRegime: row.taxRegime,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getPersonalSections(ctx: RequestContext, employeeId: string) {
  if (!(await canAccessEmployee(ctx, "employees.view", employeeId))) throw forbidden();
  return ctx.db(async (tx) => {
    const [addresses, contacts, deps] = await Promise.all([
      tx.select().from(employeeAddresses).where(eq(employeeAddresses.employeeId, employeeId)),
      tx.select().from(emergencyContacts).where(eq(emergencyContacts.employeeId, employeeId)).orderBy(desc(emergencyContacts.isPrimary)),
      tx.select().from(dependents).where(eq(dependents.employeeId, employeeId)).orderBy(asc(dependents.name)),
    ]);
    return { addresses, contacts, dependents: deps };
  });
}

export async function getSkillsAndQualifications(ctx: RequestContext, employeeId: string) {
  if (!(await canAccessEmployee(ctx, "employees.view", employeeId)) && !can(ctx, "directory.view", "all")) throw forbidden();
  return ctx.db(async (tx) => {
    const [quals, sk] = await Promise.all([
      tx.select().from(qualifications).where(eq(qualifications.employeeId, employeeId)).orderBy(desc(qualifications.endYear)),
      tx
        .select({ skillId: skills.id, name: skills.name, category: skills.category, proficiency: employeeSkills.proficiency, source: employeeSkills.source })
        .from(employeeSkills)
        .innerJoin(skills, eq(skills.id, employeeSkills.skillId))
        .where(eq(employeeSkills.employeeId, employeeId))
        .orderBy(desc(employeeSkills.proficiency), asc(skills.name)),
    ]);
    return { qualifications: quals, skills: sk };
  });
}

export async function getAssets(ctx: RequestContext, employeeId: string) {
  if (!(await canAccessEmployee(ctx, "employees.view", employeeId))) throw forbidden();
  return ctx.db((tx) =>
    tx
      .select({
        assignmentId: assetAssignments.id,
        assetId: assets.id,
        tag: assets.tag,
        name: assets.name,
        category: assets.category,
        serialNumber: assets.serialNumber,
        assignedOn: assetAssignments.assignedOn,
        dueBackOn: assetAssignments.dueBackOn,
        returnedOn: assetAssignments.returnedOn,
        conditionOut: assetAssignments.conditionOut,
        conditionIn: assetAssignments.conditionIn,
      })
      .from(assetAssignments)
      .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
      .where(eq(assetAssignments.employeeId, employeeId))
      .orderBy(sql`${assetAssignments.returnedOn} is not null`, desc(assetAssignments.assignedOn)),
  );
}

export async function getActivity(ctx: RequestContext, employeeId: string) {
  if (!can(ctx, "audit.view", "all")) throw forbidden();
  return ctx.db((tx) =>
    tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        actorName: users.fullName,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.entityType, "employee"), eq(auditLogs.entityId, employeeId)))
      .orderBy(desc(auditLogs.id))
      .limit(100),
  );
}

export async function getChangeRequests(ctx: RequestContext, employeeId: string) {
  const isSelf = ctx.employeeId === employeeId;
  if (!isSelf && !can(ctx, "employees.edit", "all")) return [];
  return ctx.db((tx) =>
    tx
      .select({
        id: dataChangeRequests.id,
        status: dataChangeRequests.status,
        reason: dataChangeRequests.reason,
        changes: dataChangeRequests.changes,
        createdAt: dataChangeRequests.createdAt,
        reviewComment: dataChangeRequests.reviewComment,
      })
      .from(dataChangeRequests)
      .where(eq(dataChangeRequests.employeeId, employeeId))
      .orderBy(desc(dataChangeRequests.createdAt))
      .limit(20),
  );
}

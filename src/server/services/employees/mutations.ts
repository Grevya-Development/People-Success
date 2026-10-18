import { and, desc, eq, isNull, lte, or, gt } from "drizzle-orm";
import { addMonths, format, parseISO, subDays } from "date-fns";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { authorize, authorizeEmployee, can, type RequestContext } from "../../auth/context";
import { compensationRecords, employees, employmentRecords, positions } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { AppError, forbidden, invalidState, notFound } from "../../lib/errors";
import { todayIn } from "@/lib/format";
import type {
  compensationSchema,
  createEmployeeSchema,
  jobChangeSchema,
  selfUpdateSchema,
  updatePersonalSchema,
} from "@/lib/validation/employees";
import { generateEmployeeCode } from "./codes";
import { assertOrgRefs } from "./lookups";
import { emitDomainEvent } from "../events";

const toPaise = (rupees: number) => Math.round(rupees * 100);

export function displayNameOf(e: { firstName: string; middleName?: string | null; lastName?: string | null }) {
  return [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");
}

async function lockEmployee(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), isNull(employees.deletedAt)))
    .for("update");
  if (!row) throw notFound("Employee");
  return row;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export type NewEmployeeRecord = Omit<z.output<typeof createEmployeeSchema>, "annualCtc"> & {
  /** Annual CTC in paise (already converted). */
  annualCtcPaise?: number | null;
  /** Compensation components snapshot (e.g. from an offer). */
  components?: { code: string; name: string; annualAmount: number }[];
  source?: "manual" | "offer" | "import";
  sourceId?: string | null;
};

/**
 * Transaction-level hire: employee row, hire employment record, optional
 * starting compensation, audit and domain event. Callers authorize first;
 * used by HR creation (ctx) and by offer acceptance (system context).
 */
export async function insertEmployeeRecord(tx: Tx, tenantId: string, actorUserId: string | null, input: NewEmployeeRecord) {
  const today = todayIn();
  await assertOrgRefs(tx, input);
  const code = input.employeeCode?.trim() || (await generateEmployeeCode(tx, tenantId));
  const status = input.joiningDate <= today ? "active" : "pending";
  const probationEndDate =
    input.probationMonths > 0 ? format(subDays(addMonths(parseISO(input.joiningDate), input.probationMonths), 1), "yyyy-MM-dd") : null;

  const [employee] = await tx
    .insert(employees)
    .values({
      tenantId,
      legalEntityId: input.legalEntityId,
      employeeCode: code,
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      displayName: displayNameOf(input),
      workEmail: input.workEmail,
      personalEmail: input.personalEmail,
      phone: input.phone,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender ?? null,
      status,
      workerType: input.workerType,
      employmentType: input.employmentType,
      workMode: input.workMode,
      joiningDate: input.joiningDate,
      probationEndDate,
      confirmationDate: probationEndDate ? null : input.joiningDate,
      noticePeriodDays: input.noticePeriodDays,
      departmentId: input.departmentId,
      designationId: input.designationId,
      locationId: input.locationId,
      managerId: input.managerId,
      gradeId: input.gradeId,
      costCenterId: input.costCenterId,
    })
    .returning();

  await tx.insert(employmentRecords).values({
    tenantId,
    employeeId: employee.id,
    effectiveFrom: input.joiningDate,
    changeType: "hire",
    status: "active",
    employmentType: input.employmentType,
    legalEntityId: input.legalEntityId,
    departmentId: input.departmentId,
    designationId: input.designationId,
    locationId: input.locationId,
    managerId: input.managerId,
    gradeId: input.gradeId,
    costCenterId: input.costCenterId,
    reason: input.source === "offer" ? "Hired via accepted offer" : "New hire",
    createdBy: actorUserId,
  });

  if (input.annualCtcPaise) {
    await tx.insert(compensationRecords).values({
      tenantId,
      employeeId: employee.id,
      effectiveFrom: input.joiningDate,
      annualCtc: input.annualCtcPaise,
      components: input.components ?? [],
      reason: "hire",
      createdBy: actorUserId,
      approvedBy: actorUserId,
    });
  }

  await audit(tx, { tenantId, userId: actorUserId }, {
    action: "employee.created",
    entityType: "employee",
    entityId: employee.id,
    metadata: { employeeCode: code, status, source: input.source ?? "manual", sourceId: input.sourceId ?? undefined },
  });
  await emitDomainEvent(tx, tenantId, "employee.created", { employeeId: employee.id, status, source: input.source ?? "manual", sourceId: input.sourceId ?? null });
  return employee;
}

export async function createEmployee(ctx: RequestContext, input: z.output<typeof createEmployeeSchema>) {
  authorize(ctx, "employees.create", "all");
  if (input.annualCtc && !can(ctx, "compensation.edit", "all")) {
    throw forbidden("You can create the employee, but setting compensation needs the compensation permission.");
  }
  const { annualCtc, ...rest } = input;
  return ctx.db((tx) => insertEmployeeRecord(tx, ctx.tenantId, ctx.userId, { ...rest, annualCtcPaise: annualCtc ? toPaise(annualCtc) : null }));
}

/* ------------------------------------------------------------------ */
/* Personal / contact details                                          */
/* ------------------------------------------------------------------ */

export async function updatePersonal(ctx: RequestContext, input: z.output<typeof updatePersonalSchema>) {
  await authorizeEmployee(ctx, "employees.edit", input.employeeId);
  // Only HR-level editors change other people's core identity fields directly.
  if (input.employeeId === ctx.employeeId && !can(ctx, "employees.edit", "all")) {
    throw forbidden("Use a correction request to change your own name or date of birth.");
  }
  return ctx.db(async (tx) => {
    const before = await lockEmployee(tx, input.employeeId);
    const patch = {
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      displayName: displayNameOf(input),
      workEmail: input.workEmail,
      personalEmail: input.personalEmail,
      phone: input.phone,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender ?? null,
      maritalStatus: input.maritalStatus,
      nationality: input.nationality,
      bloodGroup: input.bloodGroup,
      workMode: input.workMode,
      noticePeriodDays: input.noticePeriodDays,
    };
    const [after] = await tx.update(employees).set(patch).where(eq(employees.id, input.employeeId)).returning();
    await audit(tx, ctx, {
      action: "employee.updated",
      entityType: "employee",
      entityId: input.employeeId,
      changes: diff(before as Record<string, unknown>, patch),
    });
    return after;
  });
}

/** Self-service edits to low-risk contact fields. */
export async function selfUpdate(ctx: RequestContext, input: z.output<typeof selfUpdateSchema>) {
  if (input.employeeId !== ctx.employeeId) throw forbidden();
  authorize(ctx, "employees.edit", "self");
  return ctx.db(async (tx) => {
    const before = await lockEmployee(tx, input.employeeId);
    const patch = {
      phone: input.phone,
      personalEmail: input.personalEmail,
      bloodGroup: input.bloodGroup,
      maritalStatus: input.maritalStatus,
    };
    await tx.update(employees).set(patch).where(eq(employees.id, input.employeeId));
    await audit(tx, ctx, {
      action: "employee.self_updated",
      entityType: "employee",
      entityId: input.employeeId,
      changes: diff(before as Record<string, unknown>, patch),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Effective-dated job changes                                         */
/* ------------------------------------------------------------------ */

/**
 * Copy the employment record in force on `onDate` onto the employee row
 * (denormalized current assignment). Called after job changes and daily for
 * future-dated changes that become effective.
 */
export async function syncCurrentAssignment(tx: Tx, employeeId: string, onDate: string) {
  const [current] = await tx
    .select()
    .from(employmentRecords)
    .where(
      and(
        eq(employmentRecords.employeeId, employeeId),
        lte(employmentRecords.effectiveFrom, onDate),
        or(isNull(employmentRecords.effectiveTo), gt(employmentRecords.effectiveTo, onDate)),
      ),
    )
    .orderBy(desc(employmentRecords.effectiveFrom))
    .limit(1);
  if (!current) return null;
  await tx
    .update(employees)
    .set({
      legalEntityId: current.legalEntityId,
      departmentId: current.departmentId,
      designationId: current.designationId,
      locationId: current.locationId,
      managerId: current.managerId,
      gradeId: current.gradeId,
      costCenterId: current.costCenterId,
      positionId: current.positionId,
      employmentType: current.employmentType,
    })
    .where(eq(employees.id, employeeId));
  return current;
}

export async function changeJob(ctx: RequestContext, input: z.output<typeof jobChangeSchema>) {
  authorize(ctx, "employees.edit", "all");
  if (input.managerId === input.employeeId) throw new AppError("VALIDATION", "An employee cannot report to themselves.", { fieldErrors: { managerId: ["Choose someone else"] } });
  const today = todayIn();
  return ctx.db(async (tx) => {
    const employee = await lockEmployee(tx, input.employeeId);
    if (employee.status === "exited") throw invalidState("Rehire this employee before changing their job.");
    await assertOrgRefs(tx, input);

    const [open] = await tx
      .select()
      .from(employmentRecords)
      .where(and(eq(employmentRecords.employeeId, input.employeeId), isNull(employmentRecords.effectiveTo)))
      .for("update");
    if (!open) throw invalidState("This employee has no open employment record.");
    if (input.effectiveFrom <= open.effectiveFrom) {
      throw new AppError("VALIDATION", `The change must take effect after ${open.effectiveFrom}, when the current assignment started.`, {
        fieldErrors: { effectiveFrom: ["Must be after the current assignment start"] },
      });
    }

    await tx.update(employmentRecords).set({ effectiveTo: input.effectiveFrom }).where(eq(employmentRecords.id, open.id));
    const [record] = await tx
      .insert(employmentRecords)
      .values({
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        effectiveFrom: input.effectiveFrom,
        changeType: input.changeType,
        status: open.status,
        employmentType: input.employmentType,
        legalEntityId: input.legalEntityId,
        departmentId: input.departmentId,
        designationId: input.designationId,
        locationId: input.locationId,
        managerId: input.managerId,
        gradeId: input.gradeId,
        costCenterId: input.costCenterId,
        positionId: open.positionId,
        reason: input.reason,
        createdBy: ctx.userId,
        approvedBy: ctx.userId,
      })
      .returning();

    if (input.effectiveFrom <= today) await syncCurrentAssignment(tx, input.employeeId, today);

    const fields = ["legalEntityId", "departmentId", "designationId", "locationId", "managerId", "gradeId", "costCenterId", "employmentType"] as const;
    await audit(tx, ctx, {
      action: `employee.${input.changeType}`,
      entityType: "employee",
      entityId: input.employeeId,
      changes: diff(
        Object.fromEntries(fields.map((f) => [f, open[f]])),
        Object.fromEntries(fields.map((f) => [f, input[f]])),
      ),
      metadata: { effectiveFrom: input.effectiveFrom, reason: input.reason, scheduled: input.effectiveFrom > today },
    });
    await emitDomainEvent(tx, ctx.tenantId, "employee.job_changed", {
      employeeId: input.employeeId,
      changeType: input.changeType,
      effectiveFrom: input.effectiveFrom,
    });
    return record;
  });
}

/** Daily job: apply future-dated job changes that become effective today. */
export async function applyScheduledAssignments(tx: Tx, tenantId: string, onDate: string) {
  const due = await tx
    .select({ employeeId: employmentRecords.employeeId })
    .from(employmentRecords)
    .where(and(eq(employmentRecords.tenantId, tenantId), eq(employmentRecords.effectiveFrom, onDate)));
  for (const { employeeId } of due) await syncCurrentAssignment(tx, employeeId, onDate);
  return due.length;
}

/* ------------------------------------------------------------------ */
/* Status transitions                                                  */
/* ------------------------------------------------------------------ */

export async function markJoined(ctx: RequestContext, employeeId: string, joinedOn: string) {
  authorize(ctx, "employees.edit", "all");
  return ctx.db(async (tx) => {
    const e = await lockEmployee(tx, employeeId);
    if (e.status !== "pending") throw invalidState("Only pre-joining employees can be marked as joined.");
    if (joinedOn > todayIn()) throw new AppError("VALIDATION", "The joining date cannot be in the future.");
    await tx.update(employees).set({ status: "active", joiningDate: joinedOn }).where(eq(employees.id, employeeId));
    await tx
      .update(employmentRecords)
      .set({ effectiveFrom: joinedOn })
      .where(and(eq(employmentRecords.employeeId, employeeId), eq(employmentRecords.changeType, "hire"), isNull(employmentRecords.effectiveTo)));
    await audit(tx, ctx, { action: "employee.joined", entityType: "employee", entityId: employeeId, metadata: { joinedOn } });
    await emitDomainEvent(tx, ctx.tenantId, "employee.joined", { employeeId, joinedOn });
  });
}

export async function confirmProbation(ctx: RequestContext, employeeId: string, confirmedOn: string) {
  authorize(ctx, "employees.edit", "all");
  return ctx.db(async (tx) => {
    const e = await lockEmployee(tx, employeeId);
    if (e.status !== "active") throw invalidState("Only active employees can be confirmed.");
    if (e.confirmationDate) throw invalidState("This employee is already confirmed.");
    if (confirmedOn < e.joiningDate) throw new AppError("VALIDATION", "Confirmation cannot be before the joining date.");
    await tx.update(employees).set({ confirmationDate: confirmedOn }).where(eq(employees.id, employeeId));
    await audit(tx, ctx, { action: "employee.confirmed", entityType: "employee", entityId: employeeId, metadata: { confirmedOn } });
    await emitDomainEvent(tx, ctx.tenantId, "employee.probation_confirmed", { employeeId, confirmedOn });
  });
}

/** Rehire an exited employee on the same profile, opening a new employment period. */
export async function rehire(ctx: RequestContext, employeeId: string, joiningDate: string, reason: string) {
  authorize(ctx, "employees.create", "all");
  return ctx.db(async (tx) => {
    const e = await lockEmployee(tx, employeeId);
    if (e.status !== "exited") throw invalidState("Only exited employees can be rehired.");
    const [last] = await tx
      .select()
      .from(employmentRecords)
      .where(eq(employmentRecords.employeeId, employeeId))
      .orderBy(desc(employmentRecords.effectiveFrom))
      .limit(1);
    if (last && !last.effectiveTo) {
      await tx.update(employmentRecords).set({ effectiveTo: joiningDate }).where(eq(employmentRecords.id, last.id));
    }
    if (last && joiningDate <= last.effectiveFrom) throw new AppError("VALIDATION", "The rehire date must be after the previous employment.");
    await tx.insert(employmentRecords).values({
      tenantId: ctx.tenantId,
      employeeId,
      effectiveFrom: joiningDate,
      changeType: "rehire",
      status: "active",
      employmentType: e.employmentType,
      legalEntityId: e.legalEntityId,
      departmentId: e.departmentId,
      designationId: e.designationId,
      locationId: e.locationId,
      managerId: null,
      gradeId: e.gradeId,
      costCenterId: e.costCenterId,
      reason,
      createdBy: ctx.userId,
    });
    await tx
      .update(employees)
      .set({
        status: joiningDate <= todayIn() ? "active" : "pending",
        joiningDate,
        exitDate: null,
        exitReason: null,
        resignationDate: null,
        lastWorkingDate: null,
        managerId: null,
        confirmationDate: null,
      })
      .where(eq(employees.id, employeeId));
    await audit(tx, ctx, { action: "employee.rehired", entityType: "employee", entityId: employeeId, metadata: { joiningDate, reason } });
  });
}

/** Remove a draft (pre-joining) record created by mistake. Joined employees are never deleted. */
export async function deleteDraftEmployee(ctx: RequestContext, employeeId: string) {
  authorize(ctx, "employees.delete", "all");
  return ctx.db(async (tx) => {
    const e = await lockEmployee(tx, employeeId);
    if (e.status !== "pending") throw invalidState("Only pre-joining records can be deleted. Use the exit process for others.");
    await tx.update(employees).set({ deletedAt: new Date(), userId: null }).where(eq(employees.id, employeeId));
    await tx.update(positions).set({ employeeId: null, status: "open" }).where(eq(positions.employeeId, employeeId));
    await audit(tx, ctx, { action: "employee.deleted", entityType: "employee", entityId: employeeId, metadata: { employeeCode: e.employeeCode } });
  });
}

/* ------------------------------------------------------------------ */
/* Compensation                                                        */
/* ------------------------------------------------------------------ */

export async function addCompensation(ctx: RequestContext, input: z.output<typeof compensationSchema>) {
  authorize(ctx, "compensation.edit", "all");
  return ctx.db(async (tx) => {
    const e = await lockEmployee(tx, input.employeeId);
    if (e.status === "exited") throw invalidState("Compensation cannot change after exit.");
    if (input.effectiveFrom < e.joiningDate) throw new AppError("VALIDATION", "Compensation cannot start before the joining date.");
    const [open] = await tx
      .select()
      .from(compensationRecords)
      .where(and(eq(compensationRecords.employeeId, input.employeeId), isNull(compensationRecords.effectiveTo)))
      .for("update");
    if (open) {
      if (input.effectiveFrom <= open.effectiveFrom) {
        throw new AppError("VALIDATION", `Must take effect after ${open.effectiveFrom}, when the current salary started.`, {
          fieldErrors: { effectiveFrom: ["Must be after the current salary start"] },
        });
      }
      await tx.update(compensationRecords).set({ effectiveTo: input.effectiveFrom }).where(eq(compensationRecords.id, open.id));
    }
    const [record] = await tx
      .insert(compensationRecords)
      .values({
        tenantId: ctx.tenantId,
        employeeId: input.employeeId,
        effectiveFrom: input.effectiveFrom,
        annualCtc: toPaise(input.annualCtc),
        reason: input.reason,
        notes: input.notes,
        createdBy: ctx.userId,
        approvedBy: ctx.userId,
      })
      .returning();
    // Amounts are deliberately not written to the audit log.
    await audit(tx, ctx, {
      action: "compensation.changed",
      entityType: "employee",
      entityId: input.employeeId,
      metadata: { effectiveFrom: input.effectiveFrom, reason: input.reason },
    });
    await emitDomainEvent(tx, ctx.tenantId, "employee.compensation_changed", { employeeId: input.employeeId, effectiveFrom: input.effectiveFrom });
    return record;
  });
}


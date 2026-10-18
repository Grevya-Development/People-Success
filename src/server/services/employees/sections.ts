import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { authorizeEmployee, authorize, type RequestContext } from "../../auth/context";
import {
  assetAssignments,
  assets,
  dependents,
  emergencyContacts,
  employeeAddresses,
  employeeSkills,
  qualifications,
  skills,
} from "../../db/schema";
import { audit } from "../../lib/audit";
import { invalidState, notFound } from "../../lib/errors";
import type {
  addressSchema,
  dependentSchema,
  emergencyContactSchema,
  qualificationSchema,
  skillSchema,
} from "@/lib/validation/employees";
import { todayIn } from "@/lib/format";

/**
 * Profile sub-records. Employees maintain their own (employees.edit:self);
 * managers/HR per their scope. Every change is audited.
 */

export async function upsertAddress(ctx: RequestContext, input: z.output<typeof addressSchema>) {
  await authorizeEmployee(ctx, "employees.edit", input.employeeId);
  return ctx.db(async (tx) => {
    const { employeeId, type, ...fields } = input;
    await tx
      .insert(employeeAddresses)
      .values({ tenantId: ctx.tenantId, employeeId, type, ...fields })
      .onConflictDoUpdate({ target: [employeeAddresses.employeeId, employeeAddresses.type], set: fields });
    await audit(tx, ctx, { action: "employee.address_saved", entityType: "employee", entityId: employeeId, metadata: { type } });
  });
}

export async function saveEmergencyContact(ctx: RequestContext, input: z.output<typeof emergencyContactSchema>) {
  await authorizeEmployee(ctx, "employees.edit", input.employeeId);
  return ctx.db(async (tx) => {
    const { id, employeeId, ...fields } = input;
    if (fields.isPrimary) {
      await tx.update(emergencyContacts).set({ isPrimary: false }).where(eq(emergencyContacts.employeeId, employeeId));
    }
    if (id) {
      const res = await tx
        .update(emergencyContacts)
        .set(fields)
        .where(and(eq(emergencyContacts.id, id), eq(emergencyContacts.employeeId, employeeId)))
        .returning({ id: emergencyContacts.id });
      if (!res.length) throw notFound("Contact");
    } else {
      await tx.insert(emergencyContacts).values({ tenantId: ctx.tenantId, employeeId, ...fields });
    }
    await audit(tx, ctx, { action: "employee.emergency_contact_saved", entityType: "employee", entityId: employeeId });
  });
}

export async function deleteEmergencyContact(ctx: RequestContext, employeeId: string, id: string) {
  await authorizeEmployee(ctx, "employees.edit", employeeId);
  return ctx.db(async (tx) => {
    await tx.delete(emergencyContacts).where(and(eq(emergencyContacts.id, id), eq(emergencyContacts.employeeId, employeeId)));
    await audit(tx, ctx, { action: "employee.emergency_contact_deleted", entityType: "employee", entityId: employeeId });
  });
}

export async function saveDependent(ctx: RequestContext, input: z.output<typeof dependentSchema>) {
  await authorizeEmployee(ctx, "employees.edit", input.employeeId);
  return ctx.db(async (tx) => {
    const { id, employeeId, ...fields } = input;
    const values = { ...fields, nominationPercent: fields.isNominee ? (fields.nominationPercent ?? null) : null };
    // Nomination shares across dependents cannot exceed 100%.
    const [{ total }] = await tx
      .select({ total: sql<number>`coalesce(sum(${dependents.nominationPercent}), 0)`.mapWith(Number) })
      .from(dependents)
      .where(and(eq(dependents.employeeId, employeeId), id ? sql`${dependents.id} <> ${id}` : undefined));
    if (total + (values.nominationPercent ?? 0) > 100) {
      throw invalidState(`Nomination shares would total ${total + (values.nominationPercent ?? 0)}%. They cannot exceed 100%.`);
    }
    if (id) {
      const res = await tx.update(dependents).set(values).where(and(eq(dependents.id, id), eq(dependents.employeeId, employeeId))).returning();
      if (!res.length) throw notFound("Dependent");
    } else {
      await tx.insert(dependents).values({ tenantId: ctx.tenantId, employeeId, ...values });
    }
    await audit(tx, ctx, { action: "employee.dependent_saved", entityType: "employee", entityId: employeeId });
  });
}

export async function deleteDependent(ctx: RequestContext, employeeId: string, id: string) {
  await authorizeEmployee(ctx, "employees.edit", employeeId);
  return ctx.db(async (tx) => {
    await tx.delete(dependents).where(and(eq(dependents.id, id), eq(dependents.employeeId, employeeId)));
    await audit(tx, ctx, { action: "employee.dependent_deleted", entityType: "employee", entityId: employeeId });
  });
}

export async function saveQualification(ctx: RequestContext, input: z.output<typeof qualificationSchema>) {
  await authorizeEmployee(ctx, "employees.edit", input.employeeId);
  if (input.startYear && input.endYear && input.endYear < input.startYear) throw invalidState("End year must be after start year.");
  return ctx.db(async (tx) => {
    const { id, employeeId, ...fields } = input;
    if (id) {
      const res = await tx.update(qualifications).set(fields).where(and(eq(qualifications.id, id), eq(qualifications.employeeId, employeeId))).returning();
      if (!res.length) throw notFound("Qualification");
    } else {
      await tx.insert(qualifications).values({ tenantId: ctx.tenantId, employeeId, ...fields });
    }
    await audit(tx, ctx, { action: "employee.qualification_saved", entityType: "employee", entityId: employeeId });
  });
}

export async function deleteQualification(ctx: RequestContext, employeeId: string, id: string) {
  await authorizeEmployee(ctx, "employees.edit", employeeId);
  return ctx.db(async (tx) => {
    await tx.delete(qualifications).where(and(eq(qualifications.id, id), eq(qualifications.employeeId, employeeId)));
    await audit(tx, ctx, { action: "employee.qualification_deleted", entityType: "employee", entityId: employeeId });
  });
}

export async function saveSkill(ctx: RequestContext, input: z.output<typeof skillSchema>) {
  await authorizeEmployee(ctx, "employees.edit", input.employeeId);
  const isSelf = ctx.employeeId === input.employeeId;
  return ctx.db(async (tx) => {
    const name = input.name.trim();
    const [existing] = await tx.select({ id: skills.id }).from(skills).where(sql`lower(${skills.name}) = lower(${name})`);
    const skillId =
      existing?.id ??
      (await tx.insert(skills).values({ tenantId: ctx.tenantId, name }).returning({ id: skills.id }))[0].id;
    await tx
      .insert(employeeSkills)
      .values({ tenantId: ctx.tenantId, employeeId: input.employeeId, skillId, proficiency: input.proficiency, source: isSelf ? "self" : "manager" })
      .onConflictDoUpdate({
        target: [employeeSkills.employeeId, employeeSkills.skillId],
        set: { proficiency: input.proficiency, source: isSelf ? "self" : "manager", verifiedBy: isSelf ? null : ctx.userId },
      });
    await audit(tx, ctx, { action: "employee.skill_saved", entityType: "employee", entityId: input.employeeId, metadata: { skill: name, proficiency: input.proficiency } });
  });
}

export async function removeSkill(ctx: RequestContext, employeeId: string, skillId: string) {
  await authorizeEmployee(ctx, "employees.edit", employeeId);
  return ctx.db(async (tx) => {
    await tx.delete(employeeSkills).where(and(eq(employeeSkills.employeeId, employeeId), eq(employeeSkills.skillId, skillId)));
    await audit(tx, ctx, { action: "employee.skill_removed", entityType: "employee", entityId: employeeId });
  });
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export async function assignAsset(
  ctx: RequestContext,
  input: { employeeId: string; tag: string; category: string; name: string; serialNumber?: string | null; dueBackOn?: string | null; condition?: string | null },
) {
  authorize(ctx, "assets.manage", "all");
  return ctx.db(async (tx) => {
    const [existing] = await tx.select().from(assets).where(eq(assets.tag, input.tag)).for("update");
    let asset = existing;
    if (!asset) {
      [asset] = await tx
        .insert(assets)
        .values({ tenantId: ctx.tenantId, tag: input.tag, category: input.category, name: input.name, serialNumber: input.serialNumber ?? null })
        .returning();
    } else if (asset.status === "assigned") {
      throw invalidState(`Asset ${input.tag} is already assigned. Record its return first.`);
    } else if (asset.status === "retired" || asset.status === "lost") {
      throw invalidState(`Asset ${input.tag} is ${asset.status}.`);
    }
    await tx.insert(assetAssignments).values({
      tenantId: ctx.tenantId,
      assetId: asset.id,
      employeeId: input.employeeId,
      assignedOn: todayIn(),
      dueBackOn: input.dueBackOn ?? null,
      conditionOut: input.condition ?? null,
      assignedBy: ctx.userId,
    });
    await tx.update(assets).set({ status: "assigned" }).where(eq(assets.id, asset.id));
    await audit(tx, ctx, { action: "asset.assigned", entityType: "employee", entityId: input.employeeId, metadata: { tag: input.tag } });
  });
}

export async function returnAsset(ctx: RequestContext, assignmentId: string, condition: string | null) {
  authorize(ctx, "assets.manage", "all");
  return ctx.db(async (tx) => {
    const [a] = await tx.select().from(assetAssignments).where(eq(assetAssignments.id, assignmentId)).for("update");
    if (!a) throw notFound("Asset assignment");
    if (a.returnedOn) throw invalidState("This asset was already returned.");
    await tx.update(assetAssignments).set({ returnedOn: todayIn(), conditionIn: condition, receivedBy: ctx.userId }).where(eq(assetAssignments.id, a.id));
    await tx.update(assets).set({ status: "available" }).where(eq(assets.id, a.assetId));
    await audit(tx, ctx, { action: "asset.returned", entityType: "employee", entityId: a.employeeId, metadata: { assignmentId } });
  });
}

import { and, eq, ne, sql } from "drizzle-orm";
import { authorize, can } from "../../auth/context";
import { departments, designations, employees, invitations, legalEntities, locations, memberships, tenants } from "../../db/schema";
import { invalidState, notFound } from "../../lib/errors";
import { NAVIGATION } from "@/lib/navigation";
import { SETUP_STEPS, type SetupStepKey } from "@/lib/setup-steps";
import { previewEmployeeCode } from "@/lib/validation/settings";
import { auditAs, lockTenant, recordSetupSteps, type SettingsCtx } from "./shared";

const moduleReady = (...keys: string[]) =>
  NAVIGATION.some((g) => g.items.some((i) => keys.includes(i.key) && i.ready));

type StepLink = { href: string; label: string } | null;

/** Where each step is configured. Null link = the module is not available yet. */
function stepLink(key: SetupStepKey): StepLink {
  switch (key) {
    case "organization":
      return { href: "/settings/general", label: "Review company settings" };
    case "legal_entity":
      return { href: "/settings/legal-entities", label: "Add registrations" };
    case "locations":
      return { href: "/settings/locations", label: "Add locations" };
    case "structure":
      return { href: "/settings/structure", label: "Set up structure" };
    case "time":
      return moduleReady("leave") ? { href: "/leave", label: "Configure leave" } : moduleReady("attendance") ? { href: "/attendance", label: "Configure attendance" } : null;
    case "payroll":
      return moduleReady("payroll") ? { href: "/payroll", label: "Configure payroll" } : null;
    case "admins":
      return { href: "/settings/users", label: "Invite people" };
    case "import":
      return moduleReady("employees") ? { href: "/employees/import", label: "Import employees" } : null;
    case "integrations":
      return moduleReady("integrations") ? { href: "/integrations", label: "Connect apps" } : null;
    case "review":
      return null;
  }
}

export type ReadinessItem = { key: string; label: string; detail: string; status: "pass" | "warn"; href?: string };

export type SetupStatus = {
  tenantName: string;
  tenantStatus: string;
  completedAt: string | null;
  canManage: boolean;
  steps: {
    key: SetupStepKey;
    title: string;
    description: string;
    done: boolean;
    /** Completed because the underlying data exists. */
    auto: boolean;
    marked: boolean;
    link: StepLink;
    available: boolean;
  }[];
  readiness: ReadinessItem[];
};

export async function getSetupStatus(ctx: SettingsCtx): Promise<SetupStatus> {
  return ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ name: tenants.name, status: tenants.status, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    if (!tenant) throw notFound("Organization");

    const [counts] = await tx.execute<{
      entity_ready: boolean;
      statutory_extra: boolean;
      locations: number;
      departments: number;
      designations: number;
      others: number;
      invites: number;
      employees: number;
    }>(sql`select
      exists(select 1 from ${legalEntities} where ${legalEntities.isActive}
        and coalesce(${legalEntities.registrations} ->> 'pan', '') <> '' and coalesce(${legalEntities.registrations} ->> 'tan', '') <> '') as entity_ready,
      exists(select 1 from ${legalEntities} where ${legalEntities.isDefault}
        and coalesce(${legalEntities.registrations} ->> 'pfEstablishmentCode', '') <> '') as statutory_extra,
      (select count(*)::int from ${locations} where ${locations.isActive}) as locations,
      (select count(*)::int from ${departments} where ${departments.isActive}) as departments,
      (select count(*)::int from ${designations} where ${designations.isActive}) as designations,
      (select count(*)::int from ${memberships} where ${memberships.status} = 'active' and ${memberships.userId} <> ${ctx.userId}) as others,
      (select count(*)::int from ${invitations} where ${invitations.status} = 'pending' and ${invitations.expiresAt} > now()) as invites,
      (select count(*)::int from ${employees} where ${employees.deletedAt} is null) as employees`);

    const marked = new Set(tenant.settings.setup?.completedSteps ?? []);
    const auto: Partial<Record<SetupStepKey, boolean>> = {
      organization: true,
      legal_entity: counts.entity_ready,
      locations: Number(counts.locations) > 0,
      structure: Number(counts.departments) > 0 && Number(counts.designations) > 0,
      admins: Number(counts.others) + Number(counts.invites) > 0,
      import: Number(counts.employees) > 0,
      review: !!tenant.settings.setup?.completedAt,
    };

    const steps = SETUP_STEPS.map((s) => {
      const link = stepLink(s.key);
      const isAuto = !!auto[s.key];
      return {
        key: s.key,
        title: s.title,
        description: s.description,
        auto: isAuto,
        marked: marked.has(s.key),
        done: isAuto || marked.has(s.key),
        link,
        available: s.key === "review" || link !== null,
      };
    });

    const fmt = tenant.settings.employeeIdFormat;
    const readiness: ReadinessItem[] = [
      {
        key: "legal_entity",
        label: "Statutory registrations",
        detail: counts.entity_ready ? "A legal entity has PAN and TAN recorded." : "Add PAN and TAN to your legal entity before running payroll.",
        status: counts.entity_ready ? "pass" : "warn",
        href: "/settings/legal-entities",
      },
      {
        key: "pf",
        label: "Provident fund establishment",
        detail: counts.statutory_extra ? "PF establishment code recorded on the default entity." : "Add the PF establishment code if you have 20 or more employees.",
        status: counts.statutory_extra ? "pass" : "warn",
        href: "/settings/legal-entities",
      },
      {
        key: "locations",
        label: "Work locations",
        detail: Number(counts.locations) ? `${counts.locations} active location${Number(counts.locations) === 1 ? "" : "s"}.` : "Add at least one office or work location.",
        status: Number(counts.locations) ? "pass" : "warn",
        href: "/settings/locations",
      },
      {
        key: "structure",
        label: "Departments and designations",
        detail: `${counts.departments} department${Number(counts.departments) === 1 ? "" : "s"}, ${counts.designations} designation${Number(counts.designations) === 1 ? "" : "s"}.`,
        status: auto.structure ? "pass" : "warn",
        href: "/settings/structure",
      },
      {
        key: "employee_id",
        label: "Employee ID format",
        detail: `New employees are numbered like ${previewEmployeeCode(fmt?.prefix ?? "EMP", fmt?.padding ?? 4)}.`,
        status: "pass",
        href: "/settings/general",
      },
      {
        key: "admins",
        label: "Other administrators",
        detail: auto.admins ? "At least one colleague has access or a pending invitation." : "Invite at least one colleague so you are not the only administrator.",
        status: auto.admins ? "pass" : "warn",
        href: "/settings/users",
      },
      {
        key: "employees",
        label: "Employee records",
        detail: Number(counts.employees) ? `${counts.employees} employee record${Number(counts.employees) === 1 ? "" : "s"}.` : "No employees yet. Add or import them before going live.",
        status: Number(counts.employees) ? "pass" : "warn",
      },
    ];

    return {
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      completedAt: tenant.settings.setup?.completedAt ?? null,
      canManage: can(ctx, "settings.manage", "all"),
      steps,
      readiness,
    };
  });
}

export async function markSetupStep(ctx: SettingsCtx, step: SetupStepKey) {
  authorize(ctx, "settings.manage", "all");
  if (step === "review") throw invalidState("Use “Complete setup” to finish the review step.");
  return ctx.db(async (tx) => {
    const tenant = await lockTenant(tx, ctx.tenantId);
    if (!tenant) throw notFound("Organization");
    if (tenant.settings.setup?.completedSteps?.includes(step)) return { changed: false };
    await recordSetupSteps(tx, ctx.tenantId, [step]);
    await auditAs(tx, ctx, { action: "setup.step_completed", entityType: "tenant", entityId: ctx.tenantId, metadata: { step } });
    return { changed: true };
  });
}

/**
 * Finish onboarding: records every step that is ready, stamps completedAt and
 * moves the tenant to `active`. Idempotent.
 */
export async function completeSetup(ctx: SettingsCtx): Promise<{ statusChanged: boolean }> {
  authorize(ctx, "settings.manage", "all");
  const status = await getSetupStatus(ctx);
  return ctx.db(async (tx) => {
    const tenant = await lockTenant(tx, ctx.tenantId);
    if (!tenant) throw notFound("Organization");
    if (tenant.settings.setup?.completedAt && tenant.status === "active") return { statusChanged: false };
    if (tenant.status === "suspended" || tenant.status === "closed") throw invalidState("This organization is not active.");
    const done = status.steps.filter((s) => s.done).map((s) => s.key);
    const steps = [...new Set([...(tenant.settings.setup?.completedSteps ?? []), ...done, "review"])];
    const completedAt = tenant.settings.setup?.completedAt ?? new Date().toISOString();
    await tx
      .update(tenants)
      .set({
        status: "active",
        settings: sql`jsonb_set(${tenants.settings}, '{setup}', ${JSON.stringify({ completedSteps: steps, completedAt })}::jsonb, true)`,
      })
      .where(and(eq(tenants.id, ctx.tenantId), ne(tenants.status, "closed")));
    await auditAs(tx, ctx, {
      action: "setup.completed",
      entityType: "tenant",
      entityId: ctx.tenantId,
      changes: { status: { from: tenant.status, to: "active" } },
      metadata: { warnings: status.readiness.filter((r) => r.status === "warn").map((r) => r.key) },
    });
    return { statusChanged: tenant.status !== "active" };
  });
}

import { eq, sql } from "drizzle-orm";
import { createOrganizationInput, type CreateOrganizationInput } from "@/lib/validation/tenancy";
import type { Tx } from "../../db/client";
import { withSystem } from "../../db/tx";
import {
  approvalPolicies,
  legalEntities,
  membershipRoles,
  memberships,
  roles,
  tenants,
  users,
  type TenantSettings,
} from "../../db/schema";
import { ROLE_TEMPLATES } from "@/lib/permissions";
import { audit } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import type { ApprovalStepDefinition } from "../../db/schema/platform";

export { createOrganizationInput, type CreateOrganizationInput };

export const defaultTenantSettings = (input: Partial<TenantSettings> = {}): TenantSettings => ({
  timezone: "Asia/Kolkata",
  currency: "INR",
  locale: "en-IN",
  dateFormat: "dd MMM yyyy",
  fiscalYearStartMonth: 4,
  employeeIdFormat: { prefix: "EMP", padding: 4 },
  weekStartsOn: 1,
  setup: { completedSteps: ["organization"], completedAt: null },
  ...input,
});

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

/** Default approval chains; tenants edit these in Settings → Approvals. */
export const DEFAULT_APPROVAL_POLICIES: { subjectType: string; name: string; steps: ApprovalStepDefinition[] }[] = [
  { subjectType: "leave_request", name: "Leave: reporting manager", steps: [{ name: "Manager approval", approver: { kind: "manager" }, escalateAfterHours: 48 }] },
  { subjectType: "attendance_regularization", name: "Regularization: reporting manager", steps: [{ name: "Manager approval", approver: { kind: "manager" }, escalateAfterHours: 72 }] },
  { subjectType: "timesheet", name: "Timesheet: reporting manager", steps: [{ name: "Manager approval", approver: { kind: "manager" } }] },
  {
    subjectType: "job_requisition",
    name: "Requisition: department head, then finance",
    steps: [
      { name: "Department head", approver: { kind: "department_head" } },
      { name: "Finance", approver: { kind: "role", roleKey: "finance_manager" } },
    ],
  },
  {
    subjectType: "offer",
    name: "Offer: HR, then finance",
    steps: [
      { name: "HR review", approver: { kind: "role", roleKey: "hr_admin" } },
      { name: "Finance", approver: { kind: "role", roleKey: "finance_manager" } },
    ],
  },
  {
    subjectType: "expense_claim",
    name: "Expense: manager, then finance",
    steps: [
      { name: "Manager approval", approver: { kind: "manager" } },
      { name: "Finance", approver: { kind: "role", roleKey: "finance_manager" } },
    ],
  },
  {
    subjectType: "payroll_run",
    name: "Payroll: HR, then finance",
    steps: [
      { name: "HR review", approver: { kind: "role", roleKey: "hr_admin" } },
      { name: "Finance approval", approver: { kind: "role", roleKey: "finance_manager" } },
    ],
  },
  { subjectType: "resignation", name: "Resignation: reporting manager, then HR", steps: [
    { name: "Manager review", approver: { kind: "manager" } },
    { name: "HR acceptance", approver: { kind: "role", roleKey: "hr_admin" } },
  ] },
  { subjectType: "data_change_request", name: "Profile correction: HR", steps: [{ name: "HR review", approver: { kind: "role", roleKey: "hr_admin" } }] },
  { subjectType: "workflow_approval", name: "Workflow step: HR", steps: [{ name: "HR approval", approver: { kind: "role", roleKey: "hr_admin" } }] },
];

/** Seeds roles and approval policies for a tenant. Idempotent per role key. */
export async function seedTenantDefaults(tx: Tx, tenantId: string) {
  const inserted = await tx
    .insert(roles)
    .values(
      ROLE_TEMPLATES.map((r) => ({
        tenantId,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: true,
        permissions: r.permissions,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: roles.id, key: roles.key });

  const existingPolicies = await tx
    .select({ subjectType: approvalPolicies.subjectType })
    .from(approvalPolicies)
    .where(eq(approvalPolicies.tenantId, tenantId));
  const have = new Set(existingPolicies.map((p) => p.subjectType));
  const missing = DEFAULT_APPROVAL_POLICIES.filter((p) => !have.has(p.subjectType));
  if (missing.length) {
    await tx.insert(approvalPolicies).values(missing.map((p) => ({ tenantId, ...p })));
  }
  return inserted;
}

/**
 * Create a new organization owned by `userId`. Runs in system context because
 * the user has no membership yet; every insert is explicitly scoped to the
 * new tenant id.
 */
export async function createOrganization(userId: string, input: CreateOrganizationInput, opts: { isDemo?: boolean } = {}) {
  return withSystem(async (tx) => {
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!owner) throw new AppError("UNAUTHENTICATED", "User profile not found.");

    const base = slugify(input.name);
    const [{ n }] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants where slug = ${base} or slug like ${base + "-%"}`,
    );
    const slug = n === 0 ? base : `${base}-${n + 1}`;

    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: input.name,
        slug,
        status: "onboarding",
        isDemo: opts.isDemo ?? false,
        settings: defaultTenantSettings({
          fiscalYearStartMonth: input.fiscalYearStartMonth,
          timezone: input.timezone,
        }),
      })
      .returning();

    await tx.insert(legalEntities).values({
      tenantId: tenant.id,
      name: input.name,
      legalName: input.legalName,
      stateCode: input.stateCode,
      isDefault: true,
    });

    const seeded = await seedTenantDefaults(tx, tenant.id);
    const ownerRole = seeded.find((r) => r.key === "tenant_owner");
    if (!ownerRole) throw new Error("Owner role was not created");

    const [membership] = await tx
      .insert(memberships)
      .values({ tenantId: tenant.id, userId, status: "active" })
      .returning({ id: memberships.id });
    await tx.insert(membershipRoles).values({ tenantId: tenant.id, membershipId: membership.id, roleId: ownerRole.id, grantedBy: userId });
    await tx.update(users).set({ lastActiveTenantId: tenant.id }).where(eq(users.id, userId));

    await audit(tx, { tenantId: tenant.id, userId }, {
      action: "tenant.created",
      entityType: "tenant",
      entityId: tenant.id,
      metadata: { name: input.name },
    });
    return tenant;
  });
}

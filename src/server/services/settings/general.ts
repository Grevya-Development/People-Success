import { eq } from "drizzle-orm";
import { authorize } from "../../auth/context";
import { tenants, type TenantSettings } from "../../db/schema";
import { notFound } from "../../lib/errors";
import { diff } from "../../lib/audit";
import { generalSettingsSchema, type GeneralSettingsInput } from "@/lib/validation/settings";
import { auditAs, lockTenant, type SettingsCtx } from "./shared";

const auditable = (name: string, s: TenantSettings) => ({
  name,
  timezone: s.timezone,
  dateFormat: s.dateFormat,
  fiscalYearStartMonth: s.fiscalYearStartMonth,
  employeeIdFormat: s.employeeIdFormat,
  weekStartsOn: s.weekStartsOn,
});

export type GeneralSettings = {
  name: string;
  slug: string;
  status: string;
  settings: TenantSettings;
};

export async function getGeneralSettings(ctx: SettingsCtx): Promise<GeneralSettings> {
  authorize(ctx, "settings.manage", "all");
  const [row] = await ctx.db((tx) =>
    tx
      .select({ name: tenants.name, slug: tenants.slug, status: tenants.status, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId)),
  );
  if (!row) throw notFound("Organization");
  return row;
}

/**
 * Update company-wide settings. The `setup` sub-document is owned by the
 * setup wizard and preserved untouched. Returns whether the display name
 * changed (callers must refresh cached access for every member).
 */
export async function updateGeneralSettings(ctx: SettingsCtx, raw: GeneralSettingsInput) {
  authorize(ctx, "settings.manage", "all");
  const input = generalSettingsSchema.parse(raw);
  return ctx.db(async (tx) => {
    const tenant = await lockTenant(tx, ctx.tenantId);
    if (!tenant) throw notFound("Organization");
    const before = tenant.settings;
    const next: TenantSettings = {
      ...before,
      timezone: input.timezone,
      currency: before.currency ?? "INR",
      dateFormat: input.dateFormat,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      employeeIdFormat: { prefix: input.employeeIdPrefix, padding: input.employeeIdPadding },
      weekStartsOn: input.weekStartsOn === 0 ? 0 : 1,
      setup: before.setup,
    };
    await tx.update(tenants).set({ name: input.name, settings: next }).where(eq(tenants.id, ctx.tenantId));
    await auditAs(tx, ctx, {
      action: "settings.general_updated",
      entityType: "tenant",
      entityId: ctx.tenantId,
      changes: diff(auditable(tenant.name, before), auditable(input.name, next)),
    });
    return { nameChanged: tenant.name !== input.name };
  });
}

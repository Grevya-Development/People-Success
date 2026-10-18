import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { pk, tenantRef, timestamps } from "./_helpers";

export const tenantStatus = pgEnum("tenant_status", [
  "onboarding",
  "active",
  "suspended",
  "closed",
]);

export type TenantSettings = {
  timezone: string;
  currency: string;
  locale: string;
  dateFormat: string;
  /** 1-12. India default: April. */
  fiscalYearStartMonth: number;
  employeeIdFormat: { prefix: string; padding: number };
  weekStartsOn: 0 | 1;
  setup: { completedSteps: string[]; completedAt?: string | null };
};

export const tenants = pgTable(
  "tenants",
  {
    id: pk(),
    name: text().notNull(),
    slug: text().notNull(),
    status: tenantStatus().notNull().default("onboarding"),
    countryCode: text().notNull().default("IN"),
    settings: jsonb().$type<TenantSettings>().notNull(),
    isDemo: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("tenants_slug_key").on(t.slug)],
);

/** Public profile mirror of auth.users, populated by trigger on signup. */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey(),
    email: text().notNull(),
    fullName: text(),
    avatarPath: text(),
    isPlatformAdmin: boolean().notNull().default(false),
    lastActiveTenantId: uuid(),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
  "deactivated",
]);

export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: membershipStatus().notNull().default("active"),
    invitedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_key").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId, t.status),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** Stable key for built-in roles (e.g. "hr_admin"); null for custom roles. */
    key: text(),
    name: text().notNull(),
    description: text(),
    isSystem: boolean().notNull().default(false),
    /** Permission grants such as "employees.view:all" or "leave.approve:team". */
    permissions: text().array().notNull().default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("roles_tenant_key_key")
      .on(t.tenantId, t.key)
      .where(sql`${t.key} is not null`),
    uniqueIndex("roles_tenant_name_key").on(t.tenantId, t.name),
  ],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    tenantId: tenantRef().references(() => tenants.id),
    membershipId: uuid()
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    /** Optional legal entity scope. Null means all entities in the tenant. */
    legalEntityId: uuid(),
    grantedBy: uuid(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    index("membership_roles_role_idx").on(t.roleId),
  ],
);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const invitations = pgTable(
  "invitations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    email: text().notNull(),
    roleIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    employeeId: uuid(),
    /** SHA-256 of the invitation token; the raw token only ever lives in the email. */
    tokenHash: text().notNull(),
    status: invitationStatus().notNull().default("pending"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    invitedBy: uuid().notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    index("invitations_tenant_email_idx").on(t.tenantId, sql`lower(${t.email})`),
  ],
);

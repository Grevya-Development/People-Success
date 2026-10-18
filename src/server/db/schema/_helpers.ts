import { sql } from "drizzle-orm";
import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";

/** Primary key. UUIDs keep ids non-enumerable across tenants. */
export const pk = () => uuid().primaryKey().defaultRandom();

/** Every tenant-owned row carries tenant_id. RLS policies key off this column. */
export const tenantRef = () => uuid().notNull();

export const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};

/** Soft deletion. Never used on payroll, financial or audit records. */
export const deletedAt = () => timestamp({ withTimezone: true });

/**
 * Money is stored as integer minor units (paise for INR) next to an explicit
 * currency column. JS numbers are exact up to 2^53, i.e. ~90 trillion rupees.
 */
export const money = () => bigint({ mode: "number" });

export const nowSql = sql`now()`;

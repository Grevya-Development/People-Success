import { and, asc, count, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Tx } from "../../db/client";
import { can, type RequestContext } from "../../auth/context";
import { holidayCalendars, holidays, locations } from "../../db/schema";
import { audit, diff } from "../../lib/audit";
import { forbidden, notFound, validation } from "../../lib/errors";
import type { assignCalendarSchema, copyCalendarSchema, holidayCalendarSchema, holidaySchema } from "@/lib/validation/time";

/** Holidays are managed by attendance or leave administrators. */
export function canManageHolidays(ctx: Pick<RequestContext, "grants">) {
  return can(ctx, "attendance.manage", "all") || can(ctx, "leave.manage", "all");
}

function assertManage(ctx: RequestContext) {
  if (!canManageHolidays(ctx)) throw forbidden();
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/**
 * Public holiday dates in [from, to] for a location. For each year in the
 * range the calendar is: the location's assigned calendar if it is for that
 * year, else a calendar of the same name for that year, else the tenant's
 * default calendar for that year. Restricted (optional) holidays are not
 * days off unless taken as leave, so they are excluded.
 */
export async function publicHolidaysFor(tx: Tx, tenantId: string, locationId: string | null, from: string, to: string): Promise<Set<string>> {
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const calendars = await tx
    .select({ id: holidayCalendars.id, name: holidayCalendars.name, year: holidayCalendars.year, isDefault: holidayCalendars.isDefault })
    .from(holidayCalendars)
    .where(and(eq(holidayCalendars.tenantId, tenantId), inArray(holidayCalendars.year, years)));
  if (!calendars.length) return new Set();
  let assigned: { id: string; name: string; year: number } | null = null;
  if (locationId) {
    const [loc] = await tx
      .select({ calendarId: locations.holidayCalendarId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)));
    if (loc?.calendarId) {
      assigned =
        calendars.find((c) => c.id === loc.calendarId) ??
        (
          await tx
            .select({ id: holidayCalendars.id, name: holidayCalendars.name, year: holidayCalendars.year })
            .from(holidayCalendars)
            .where(and(eq(holidayCalendars.tenantId, tenantId), eq(holidayCalendars.id, loc.calendarId)))
        )[0] ??
        null;
    }
  }
  const ids = years
    .map((y) => {
      if (assigned) {
        if (assigned.year === y) return assigned.id;
        const same = calendars.find((c) => c.year === y && c.name === assigned!.name);
        if (same) return same.id;
      }
      return calendars.find((c) => c.year === y && c.isDefault)?.id ?? null;
    })
    .filter((x): x is string => !!x);
  if (!ids.length) return new Set();
  const rows = await tx
    .select({ date: holidays.date })
    .from(holidays)
    .where(and(eq(holidays.tenantId, tenantId), inArray(holidays.calendarId, ids), eq(holidays.type, "public"), gte(holidays.date, from), lte(holidays.date, to)));
  return new Set(rows.map((r) => r.date));
}

/** Holidays (public and restricted) with names, for calendars and the leave form. */
export async function holidaysInRange(ctx: RequestContext, locationId: string | null, from: string, to: string) {
  return ctx.db(async (tx) => {
    const publicDates = await publicHolidaysFor(tx, ctx.tenantId, locationId, from, to);
    if (!publicDates.size) return [] as { date: string; name: string }[];
    const rows = await tx
      .select({ date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.tenantId, ctx.tenantId), inArray(holidays.date, [...publicDates]), eq(holidays.type, "public")));
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.date)) seen.set(r.date, r.name);
    return [...seen.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
  });
}

/* ------------------------------------------------------------------ */
/* Calendars                                                           */
/* ------------------------------------------------------------------ */

export async function listHolidayCalendars(ctx: RequestContext) {
  return ctx.db(async (tx) => {
    const cals = await tx
      .select()
      .from(holidayCalendars)
      .where(eq(holidayCalendars.tenantId, ctx.tenantId))
      .orderBy(desc(holidayCalendars.year), asc(holidayCalendars.name));
    const counts = cals.length
      ? await tx
          .select({ calendarId: holidays.calendarId, n: count() })
          .from(holidays)
          .where(inArray(holidays.calendarId, cals.map((c) => c.id)))
          .groupBy(holidays.calendarId)
      : [];
    const locs = await tx
      .select({ id: locations.id, name: locations.name, calendarId: locations.holidayCalendarId, isActive: locations.isActive })
      .from(locations)
      .where(eq(locations.tenantId, ctx.tenantId))
      .orderBy(asc(locations.name));
    return {
      calendars: cals.map((c) => ({
        ...c,
        holidayCount: counts.find((x) => x.calendarId === c.id)?.n ?? 0,
        locations: locs.filter((l) => l.calendarId === c.id).map((l) => l.name),
      })),
      locations: locs,
    };
  });
}

export async function getHolidayCalendar(ctx: RequestContext, id: string) {
  return ctx.db(async (tx) => {
    const [cal] = await tx.select().from(holidayCalendars).where(and(eq(holidayCalendars.tenantId, ctx.tenantId), eq(holidayCalendars.id, id)));
    if (!cal) throw notFound("Holiday calendar");
    const rows = await tx.select().from(holidays).where(eq(holidays.calendarId, id)).orderBy(asc(holidays.date));
    return { calendar: cal, holidays: rows };
  });
}

async function clearOtherDefaults(tx: Tx, tenantId: string, year: number, keepId: string) {
  await tx
    .update(holidayCalendars)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(holidayCalendars.tenantId, tenantId), eq(holidayCalendars.year, year), ne(holidayCalendars.id, keepId), eq(holidayCalendars.isDefault, true)));
}

export async function saveHolidayCalendar(ctx: RequestContext, input: z.output<typeof holidayCalendarSchema>) {
  assertManage(ctx);
  return ctx.db(async (tx) => {
    if (input.id) {
      const [before] = await tx
        .select()
        .from(holidayCalendars)
        .where(and(eq(holidayCalendars.tenantId, ctx.tenantId), eq(holidayCalendars.id, input.id)))
        .for("update");
      if (!before) throw notFound("Holiday calendar");
      if (before.year !== input.year) {
        const [{ n }] = await tx.select({ n: count() }).from(holidays).where(eq(holidays.calendarId, before.id));
        if (n > 0) throw validation("Remove the holidays before changing the year, or copy the calendar to a new year.", { year: ["Calendar has holidays"] });
      }
      const [row] = await tx
        .update(holidayCalendars)
        .set({ name: input.name, year: input.year, isDefault: input.isDefault, updatedAt: new Date() })
        .where(eq(holidayCalendars.id, before.id))
        .returning();
      if (row.isDefault) await clearOtherDefaults(tx, ctx.tenantId, row.year, row.id);
      await audit(tx, ctx, { action: "holiday_calendar.updated", entityType: "holiday_calendar", entityId: row.id, changes: diff(before, row) });
      return row;
    }
    const [row] = await tx
      .insert(holidayCalendars)
      .values({ tenantId: ctx.tenantId, name: input.name, year: input.year, isDefault: input.isDefault })
      .returning();
    if (row.isDefault) await clearOtherDefaults(tx, ctx.tenantId, row.year, row.id);
    await audit(tx, ctx, { action: "holiday_calendar.created", entityType: "holiday_calendar", entityId: row.id, metadata: { name: row.name, year: row.year } });
    return row;
  });
}

export async function deleteHolidayCalendar(ctx: RequestContext, id: string) {
  assertManage(ctx);
  return ctx.db(async (tx) => {
    const [cal] = await tx.select().from(holidayCalendars).where(and(eq(holidayCalendars.tenantId, ctx.tenantId), eq(holidayCalendars.id, id)));
    if (!cal) throw notFound("Holiday calendar");
    await tx
      .update(locations)
      .set({ holidayCalendarId: null, updatedAt: new Date() })
      .where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.holidayCalendarId, id)));
    await tx.delete(holidayCalendars).where(eq(holidayCalendars.id, id));
    await audit(tx, ctx, { action: "holiday_calendar.deleted", entityType: "holiday_calendar", entityId: id, metadata: { name: cal.name, year: cal.year } });
    return { outcome: "deleted" as const };
  });
}

/** Copy a calendar's holiday names to another year (dates are kept for fixed-date holidays only after review). */
export async function copyHolidayCalendar(ctx: RequestContext, input: z.output<typeof copyCalendarSchema>) {
  assertManage(ctx);
  return ctx.db(async (tx) => {
    const [src] = await tx.select().from(holidayCalendars).where(and(eq(holidayCalendars.tenantId, ctx.tenantId), eq(holidayCalendars.id, input.calendarId)));
    if (!src) throw notFound("Holiday calendar");
    if (src.year === input.year) throw validation("Choose a different year.", { year: ["Same as the source"] });
    const [row] = await tx
      .insert(holidayCalendars)
      .values({ tenantId: ctx.tenantId, name: src.name, year: input.year, isDefault: src.isDefault })
      .returning();
    if (row.isDefault) await clearOtherDefaults(tx, ctx.tenantId, row.year, row.id);
    const items = await tx.select().from(holidays).where(eq(holidays.calendarId, src.id));
    const shifted = items
      .map((h) => ({ ...h, date: `${input.year}${h.date.slice(4)}` }))
      // 29 Feb does not exist in every year.
      .filter((h) => !Number.isNaN(Date.parse(h.date)) && new Date(h.date).toISOString().slice(0, 10) === h.date);
    if (shifted.length) {
      await tx.insert(holidays).values(shifted.map((h) => ({ tenantId: ctx.tenantId, calendarId: row.id, date: h.date, name: h.name, type: h.type })));
    }
    await audit(tx, ctx, { action: "holiday_calendar.copied", entityType: "holiday_calendar", entityId: row.id, metadata: { from: src.id, year: input.year, holidays: shifted.length } });
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

export async function saveHoliday(ctx: RequestContext, input: z.output<typeof holidaySchema>) {
  assertManage(ctx);
  return ctx.db(async (tx) => {
    const [cal] = await tx.select().from(holidayCalendars).where(and(eq(holidayCalendars.tenantId, ctx.tenantId), eq(holidayCalendars.id, input.calendarId)));
    if (!cal) throw notFound("Holiday calendar");
    if (Number(input.date.slice(0, 4)) !== cal.year) throw validation(`Choose a date in ${cal.year}.`, { date: [`Must be in ${cal.year}`] });
    if (input.id) {
      const [before] = await tx.select().from(holidays).where(and(eq(holidays.tenantId, ctx.tenantId), eq(holidays.id, input.id)));
      if (!before) throw notFound("Holiday");
      const [row] = await tx
        .update(holidays)
        .set({ date: input.date, name: input.name, type: input.type, updatedAt: new Date() })
        .where(eq(holidays.id, before.id))
        .returning();
      await audit(tx, ctx, { action: "holiday.updated", entityType: "holiday", entityId: row.id, changes: diff(before, row) });
      return row;
    }
    const [row] = await tx
      .insert(holidays)
      .values({ tenantId: ctx.tenantId, calendarId: cal.id, date: input.date, name: input.name, type: input.type })
      .returning();
    await audit(tx, ctx, { action: "holiday.created", entityType: "holiday", entityId: row.id, metadata: { calendarId: cal.id, date: row.date, name: row.name } });
    return row;
  });
}

export async function deleteHoliday(ctx: RequestContext, id: string) {
  assertManage(ctx);
  return ctx.db(async (tx) => {
    const [row] = await tx.select().from(holidays).where(and(eq(holidays.tenantId, ctx.tenantId), eq(holidays.id, id)));
    if (!row) throw notFound("Holiday");
    await tx.delete(holidays).where(eq(holidays.id, id));
    await audit(tx, ctx, { action: "holiday.deleted", entityType: "holiday", entityId: id, metadata: { date: row.date, name: row.name } });
    return { outcome: "deleted" as const };
  });
}

/** Assign (or clear) a location's holiday calendar. */
export async function assignCalendarToLocation(ctx: RequestContext, input: z.output<typeof assignCalendarSchema>) {
  assertManage(ctx);
  return ctx.db(async (tx) => {
    const [loc] = await tx.select().from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, input.locationId)));
    if (!loc) throw notFound("Location");
    if (input.calendarId) {
      const [cal] = await tx.select({ id: holidayCalendars.id }).from(holidayCalendars).where(and(eq(holidayCalendars.tenantId, ctx.tenantId), eq(holidayCalendars.id, input.calendarId)));
      if (!cal) throw notFound("Holiday calendar");
    }
    await tx.update(locations).set({ holidayCalendarId: input.calendarId, updatedAt: new Date() }).where(eq(locations.id, loc.id));
    await audit(tx, ctx, {
      action: "location.holiday_calendar_assigned",
      entityType: "location",
      entityId: loc.id,
      changes: { holidayCalendarId: { from: loc.holidayCalendarId, to: input.calendarId } },
    });
    return null;
  });
}

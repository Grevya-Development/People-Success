import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { leaveBalances, leaveTransactions } from "../../db/schema";
import { audit } from "../../lib/audit";
import { accrualAmount, accrualPeriod, addDaysIso, capCredit, carryForward, expiredLots } from "@/lib/leave-math";
import { postLeaveTxn, type Posting } from "./leave-ledger";
import { leaveYearStart, loadLeaveSetup, pickLeavePolicy, rulesFor, tracksBalance } from "./leave-types";
import { employeesActiveBetween, systemActor } from "./shared";

/**
 * Leave jobs. All run in system context with an explicit tenant filter and
 * are idempotent through ledger source keys, so running them twice (or
 * daily) never double-posts:
 *   accrual:<period>   monthly "2026-10", quarterly "2026-10" (quarter start), annual "2026"
 *   yearend:<year>     closing of the previous leave year (lapse)
 *   cf:<year>          carry forward into the new year
 *   expiry:<txnId>     unused days of an expiring lot (comp off, carry forward)
 */

async function existingKeys(tx: Tx, tenantId: string, keys: string[]) {
  if (!keys.length) return new Set<string>();
  const rows = await tx
    .select({ e: leaveTransactions.employeeId, t: leaveTransactions.leaveTypeId, k: leaveTransactions.sourceKey })
    .from(leaveTransactions)
    .where(and(eq(leaveTransactions.tenantId, tenantId), inArray(leaveTransactions.sourceKey, [...new Set(keys)])));
  return new Set(rows.map((r) => `${r.e}:${r.t}:${r.k}`));
}

async function balanceMap(tx: Tx, tenantId: string) {
  const rows = await tx.select().from(leaveBalances).where(eq(leaveBalances.tenantId, tenantId));
  return new Map(rows.map((r) => [`${r.employeeId}:${r.leaveTypeId}`, r.balance]));
}

/**
 * Credit the accrual period containing `today` to every eligible employee.
 * Runs daily: the 1st of a month credits everyone, later days pick up
 * employees who joined since (prorated from their joining date).
 */
export async function runLeaveAccruals(tx: Tx, tenantId: string, today: string) {
  const { types, policies } = await loadLeaveSetup(tx, tenantId);
  const tracked = types.filter((t) => t.isActive && tracksBalance(t));
  if (!tracked.length) return { posted: 0, skipped: 0 };
  const emps = (await employeesActiveBetween(tx, tenantId, today, today)).filter((e) => e.status === "active" || e.status === "on_notice");
  const yearStart = leaveYearStart(today);
  const candidates: (Posting & { maxBalance: number | null })[] = [];
  for (const type of tracked) {
    for (const emp of emps) {
      const policy = pickLeavePolicy(policies, emp, type.id, today);
      if (!policy) continue;
      const rules = rulesFor(policy);
      const period = accrualPeriod(rules.accrual.method, yearStart, today);
      if (!period) continue;
      const amount = accrualAmount({
        method: rules.accrual.method,
        daysPerYear: rules.accrual.daysPerYear,
        prorateOnJoining: rules.accrual.prorateOnJoining,
        leaveYearStart: yearStart,
        periodDate: today,
        joiningDate: emp.joiningDate,
      });
      if (amount <= 0) continue;
      candidates.push({
        employeeId: emp.id,
        leaveTypeId: type.id,
        kind: "accrual",
        days: amount,
        effectiveOn: emp.joiningDate > period.start ? emp.joiningDate : period.start,
        sourceKey: `accrual:${period.key}`,
        note: `${rules.accrual.method.replace("_", " ")} accrual (${policy.name} v${policy.version})`,
        maxBalance: rules.maxBalance,
      });
    }
  }
  const done = await existingKeys(tx, tenantId, candidates.map((c) => c.sourceKey));
  const balances = await balanceMap(tx, tenantId);
  let posted = 0;
  let skipped = 0;
  for (const c of candidates) {
    const key = `${c.employeeId}:${c.leaveTypeId}`;
    if (done.has(`${key}:${c.sourceKey}`)) {
      skipped++;
      continue;
    }
    const current = balances.get(key) ?? 0;
    const days = capCredit(c.days, current, c.maxBalance);
    if (days <= 0) {
      skipped++;
      continue;
    }
    const { maxBalance, ...posting } = c;
    void maxBalance;
    const row = await postLeaveTxn(tx, tenantId, { ...posting, days, note: days < c.days ? `${c.note}; capped at max balance` : c.note });
    if (row) {
      posted++;
      balances.set(key, current + days);
    } else skipped++;
  }
  if (posted) await audit(tx, systemActor(tenantId), { action: "leave.accrued", entityType: "leave_transaction", metadata: { date: today, posted } });
  return { posted, skipped };
}

/**
 * Close the previous leave year (calendar year) in January: the closing
 * balance (postings effective before 1 January) lapses except what the
 * policy carries forward, optionally with an expiry date. Comp off is
 * excluded: each grant expires on its own date.
 */
export async function runYearEnd(tx: Tx, tenantId: string, today: string) {
  const year = Number(today.slice(0, 4));
  const newYearStart = `${year}-01-01`;
  const closingDate = addDaysIso(newYearStart, -1);
  const { types, policies } = await loadLeaveSetup(tx, tenantId);
  const tracked = types.filter((t) => tracksBalance(t) && t.category !== "comp_off");
  if (!tracked.length) return { closed: 0 };
  const closing = await tx.execute<{ employee_id: string; leave_type_id: string; closing: number }>(sql`
    select employee_id, leave_type_id, sum(days)::float8 as closing
    from leave_transactions
    where tenant_id = ${tenantId} and effective_on < ${newYearStart}
      and leave_type_id in (${sql.join(tracked.map((t) => sql`${t.id}::uuid`), sql`, `)})
    group by employee_id, leave_type_id
    having sum(days) <> 0`);
  if (!closing.length) return { closed: 0 };
  const emps = await employeesActiveBetween(tx, tenantId, closingDate, today, [...new Set(closing.map((c) => c.employee_id))]);
  const empById = new Map(emps.map((e) => [e.id, e]));
  const done = await existingKeys(tx, tenantId, [`yearend:${year - 1}`]);
  let closed = 0;
  for (const c of closing) {
    const emp = empById.get(c.employee_id);
    if (!emp || done.has(`${c.employee_id}:${c.leave_type_id}:yearend:${year - 1}`)) continue;
    const bal = Math.round(Number(c.closing) * 100) / 100;
    if (bal <= 0) continue; // negative balances carry over as they are
    const rules = rulesFor(pickLeavePolicy(policies, emp, c.leave_type_id, closingDate));
    const cf = carryForward(bal, rules.carryForward, newYearStart);
    const close = await postLeaveTxn(tx, tenantId, {
      employeeId: emp.id,
      leaveTypeId: c.leave_type_id,
      kind: "expiry",
      days: -bal,
      effectiveOn: closingDate,
      sourceKey: `yearend:${year - 1}`,
      note: `Year-end closing ${year - 1}: ${bal} day(s), ${cf.lapse} lapsed`,
    });
    if (!close) continue;
    if (cf.carry > 0) {
      await postLeaveTxn(tx, tenantId, {
        employeeId: emp.id,
        leaveTypeId: c.leave_type_id,
        kind: "carry_forward",
        days: cf.carry,
        effectiveOn: newYearStart,
        expiresOn: cf.expiresOn,
        sourceKey: `cf:${year}`,
        note: `Carried forward from ${year - 1}${cf.expiresOn ? `, usable until ${cf.expiresOn}` : ""}`,
      });
    }
    closed++;
  }
  if (closed) await audit(tx, systemActor(tenantId), { action: "leave.year_closed", entityType: "leave_transaction", metadata: { year: year - 1, closed } });
  return { closed };
}

/** Post expiry for unused days of lots (comp-off grants, carried-forward days) whose date has passed. */
export async function runLeaveExpiries(tx: Tx, tenantId: string, today: string) {
  const pairs = await tx.execute<{ employee_id: string; leave_type_id: string }>(sql`
    select distinct t.employee_id, t.leave_type_id
    from leave_transactions t
    where t.tenant_id = ${tenantId} and t.expires_on is not null and t.expires_on < ${today} and t.days > 0
      and not exists (
        select 1 from leave_transactions x
        where x.employee_id = t.employee_id and x.leave_type_id = t.leave_type_id and x.source_key = 'expiry:' || t.id::text
      )`);
  let expired = 0;
  for (const p of pairs) {
    const entries = await tx
      .select()
      .from(leaveTransactions)
      .where(and(eq(leaveTransactions.tenantId, tenantId), eq(leaveTransactions.employeeId, p.employee_id), eq(leaveTransactions.leaveTypeId, p.leave_type_id)));
    const [bal] = await tx
      .select({ balance: leaveBalances.balance })
      .from(leaveBalances)
      .where(and(eq(leaveBalances.employeeId, p.employee_id), eq(leaveBalances.leaveTypeId, p.leave_type_id)));
    let available = Math.max(0, bal?.balance ?? 0);
    for (const lot of expiredLots(entries, today)) {
      const days = Math.min(lot.remaining, available);
      if (days <= 0) continue;
      const row = await postLeaveTxn(tx, tenantId, {
        employeeId: p.employee_id,
        leaveTypeId: p.leave_type_id,
        kind: "expiry",
        days: -days,
        effectiveOn: addDaysIso(lot.expiresOn, 1),
        sourceKey: `expiry:${lot.lotId}`,
        note: `Unused days expired on ${lot.expiresOn}`,
      });
      if (row) {
        expired++;
        available -= days;
      }
    }
  }
  if (expired) await audit(tx, systemActor(tenantId), { action: "leave.expired", entityType: "leave_transaction", metadata: { date: today, lots: expired } });
  return { expired };
}

/** Daily leave run: year-end close (January), accrual for the current period, expiries. */
export async function runDailyLeave(tx: Tx, tenantId: string, today: string) {
  const yearEnd = today.slice(5, 7) === "01" ? await runYearEnd(tx, tenantId, today) : { closed: 0 };
  const accrual = await runLeaveAccruals(tx, tenantId, today);
  const expiry = await runLeaveExpiries(tx, tenantId, today);
  return { ...yearEnd, ...accrual, ...expiry };
}

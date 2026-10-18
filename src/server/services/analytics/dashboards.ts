import { sql } from "drizzle-orm";
import { addDays, format } from "date-fns";
import { can, getTeamEmployeeIds, type RequestContext } from "../../auth/context";
import { todayIn } from "@/lib/format";

/**
 * Operational panels for the Overview page: HR operations, manager and
 * employee views. Each item is a live count with a link to the list behind it.
 */

export type PanelItem = { key: string; label: string; value: number | null; href: string; tone?: "neutral" | "warning" | "danger"; hint?: string };

const toInt = (v: unknown) => (v == null ? 0 : Number(v));

export async function hrOperationsPanel(ctx: RequestContext): Promise<PanelItem[] | null> {
  if (!can(ctx, "employees.view", "all")) return null;
  const today = todayIn();
  const in30 = format(addDays(new Date(`${today}T00:00:00`), 30), "yyyy-MM-dd");
  const in14 = format(addDays(new Date(`${today}T00:00:00`), 14), "yyyy-MM-dd");
  return ctx.db(async (tx) => {
    const [r] = await tx.execute<Record<string, number>>(sql`
      select
        (select count(*) from approval_requests where status = 'pending') as pending_approvals,
        (select count(*) from employees where deleted_at is null and status = 'pending' and joining_date between ${today} and ${in30}) as joiners,
        (select count(*) from employees where deleted_at is null and status = 'active' and confirmation_date is null
           and probation_end_date between ${today} and ${in14}) as probation,
        (select count(*) from employees e where e.deleted_at is null and e.status in ('active','on_notice','pending')
           and not exists (select 1 from documents d where d.employee_id = e.id and d.category = 'identity' and d.deleted_at is null)) as missing_identity,
        (select count(*) from attendance_days where date = (${today}::date - 1) and status = 'missing_punch') as missing_punches,
        (select count(*) from job_openings where status = 'published') as open_vacancies,
        (select count(*) from tasks where status in ('open','in_progress','blocked') and due_on < ${today}) as overdue_tasks,
        (select count(*) from workflow_runs where status = 'failed') as failed_workflows,
        (select count(*) from review_cycles where status = 'active') as active_cycles`);
    const payroll = can(ctx, "payroll.view", "all")
      ? (
          await tx.execute<{ status: string | null; runs: number }>(sql`
            select p.status, (select count(*) from payroll_runs r where r.period_id = p.id and r.status <> 'cancelled')::int as runs
            from payroll_periods p where p.start_date <= ${today} order by p.start_date desc limit 1`)
        )[0]
      : null;
    const items: PanelItem[] = [
      { key: "approvals", label: "Pending approvals", value: toInt(r.pending_approvals), href: can(ctx, "approvals.view", "all") ? "/inbox?tab=all&status=pending" : "/inbox" },
      { key: "joiners", label: "Joining in 30 days", value: toInt(r.joiners), href: "/employees?status=pending&sort=joining" },
      { key: "probation", label: "Probation ending in 14 days", value: toInt(r.probation), href: "/employees?status=active", tone: toInt(r.probation) ? "warning" : "neutral" },
      { key: "documents", label: "Missing identity documents", value: toInt(r.missing_identity), href: "/documents", tone: toInt(r.missing_identity) ? "warning" : "neutral" },
      { key: "attendance", label: "Missing punches yesterday", value: toInt(r.missing_punches), href: "/attendance", tone: toInt(r.missing_punches) ? "warning" : "neutral" },
      { key: "vacancies", label: "Open vacancies", value: toInt(r.open_vacancies), href: "/recruitment" },
      { key: "tasks", label: "Overdue tasks", value: toInt(r.overdue_tasks), href: "/onboarding", tone: toInt(r.overdue_tasks) ? "danger" : "neutral" },
      { key: "workflows", label: "Failed workflow runs", value: toInt(r.failed_workflows), href: "/workflows?tab=runs&status=failed", tone: toInt(r.failed_workflows) ? "danger" : "neutral" },
      { key: "cycles", label: "Active review cycles", value: toInt(r.active_cycles), href: "/performance" },
    ];
    if (payroll !== null) {
      items.push({
        key: "payroll",
        label: "Payroll: current period",
        value: null,
        href: "/payroll",
        hint: payroll ? `${payroll.status ?? "not opened"}${payroll.runs ? "" : " · no run yet"}` : "No period opened",
        tone: payroll ? "neutral" : "warning",
      });
    }
    return items;
  });
}

export async function managerPanel(ctx: RequestContext): Promise<PanelItem[] | null> {
  if (!ctx.employeeId || !can(ctx, "employees.view", "team")) return null;
  const team = await getTeamEmployeeIds(ctx);
  if (!team.length) return null;
  const today = todayIn();
  const in30 = format(addDays(new Date(`${today}T00:00:00`), 30), "yyyy-MM-dd");
  const ids = sql.join(team.map((id) => sql`${id}::uuid`), sql`, `);
  return ctx.db(async (tx) => {
    const [r] = await tx.execute<Record<string, number>>(sql`
      select
        (select count(*) from employees where id in (${ids}) and status in ('active','on_notice')) as members,
        (select count(*) from leave_requests where employee_id in (${ids}) and status = 'approved' and ${today} between start_date and end_date) as on_leave,
        (select count(*) from attendance_days where employee_id in (${ids}) and date = (${today}::date - 1) and status in ('missing_punch','absent')) as exceptions,
        (select count(*) from employees where id in (${ids}) and status = 'active'
           and to_char(joining_date, 'MM-DD') between to_char(${today}::date, 'MM-DD') and to_char(${in30}::date, 'MM-DD')
           and joining_date < ${today}) as anniversaries,
        (select count(*) from reviews where reviewer_employee_id = ${ctx.employeeId} and status in ('not_started','in_progress')) as reviews_due,
        (select count(*) from goals where employee_id in (${ids}) and status = 'active' and due_on < ${today} and progress_percent < 100) as goals_overdue`);
    return [
      { key: "members", label: "Team members", value: toInt(r.members), href: "/employees" },
      { key: "on_leave", label: "On leave today", value: toInt(r.on_leave), href: "/leave?tab=calendar" },
      { key: "exceptions", label: "Attendance exceptions yesterday", value: toInt(r.exceptions), href: "/attendance?tab=team", tone: toInt(r.exceptions) ? "warning" : "neutral" },
      { key: "reviews", label: "Reviews for you to write", value: toInt(r.reviews_due), href: "/performance", tone: toInt(r.reviews_due) ? "warning" : "neutral" },
      { key: "goals", label: "Overdue team goals", value: toInt(r.goals_overdue), href: "/performance" },
      { key: "anniversaries", label: "Work anniversaries in 30 days", value: toInt(r.anniversaries), href: "/engagement" },
    ];
  });
}

export type EmployeePanel = {
  profileCompletion: number;
  missing: string[];
  leave: { name: string; balance: number }[];
  latestPayslip: { documentId: string | null; period: string } | null;
  attendanceThisMonth: { present: number; absent: number; leave: number } | null;
  learningDue: number;
  goalsActive: number;
};

/** Self-service summary for the signed-in employee. */
export async function employeePanel(ctx: RequestContext): Promise<EmployeePanel | null> {
  if (!ctx.employeeId) return null;
  const me = ctx.employeeId;
  const monthStart = `${todayIn().slice(0, 7)}-01`;
  return ctx.db(async (tx) => {
    const [profile] = await tx.execute<Record<string, unknown>>(sql`
      select e.phone, e.personal_email, e.date_of_birth, e.blood_group,
        exists (select 1 from employee_addresses a where a.employee_id = e.id) as has_address,
        exists (select 1 from emergency_contacts c where c.employee_id = e.id) as has_contact,
        exists (select 1 from employee_sensitive s where s.employee_id = e.id and s.bank_account_last4 is not null) as has_bank,
        exists (select 1 from employee_sensitive s where s.employee_id = e.id and s.pan_last4 is not null) as has_pan
      from employees e where e.id = ${me}`);
    const checks: [string, boolean][] = profile
      ? [
          ["Mobile number", !!profile.phone],
          ["Personal email", !!profile.personal_email],
          ["Date of birth", !!profile.date_of_birth],
          ["Address", !!profile.has_address],
          ["Emergency contact", !!profile.has_contact],
          ["Bank details", !!profile.has_bank],
          ["PAN", !!profile.has_pan],
        ]
      : [];
    const done = checks.filter(([, ok]) => ok).length;
    const [leave, payslip, att, counts] = await Promise.all([
      tx.execute<{ name: string; balance: number }>(sql`
        select lt.name, lb.balance from leave_balances lb join leave_types lt on lt.id = lb.leave_type_id
        where lb.employee_id = ${me} and lt.is_active order by lt.sort_order, lt.name limit 6`),
      tx.execute<{ document_id: string | null; year: number; month: number }>(sql`
        select ps.document_id, p.year, p.month from payslips ps join payroll_periods p on p.id = ps.period_id
        where ps.employee_id = ${me} and ps.published_at is not null order by p.year desc, p.month desc limit 1`),
      tx.execute<{ present: number; absent: number; leave: number; n: number }>(sql`
        select count(*) filter (where status in ('present','half_day'))::int as present,
               count(*) filter (where status = 'absent')::int as absent,
               count(*) filter (where status = 'on_leave')::int as leave, count(*)::int as n
        from attendance_days where employee_id = ${me} and date >= ${monthStart}`),
      tx.execute<{ learning: number; goals: number }>(sql`
        select (select count(*) from learning_enrollments where employee_id = ${me} and status in ('assigned','in_progress'))::int as learning,
               (select count(*) from goals where employee_id = ${me} and status = 'active')::int as goals`),
    ]);
    const p = payslip[0];
    const a = att[0];
    return {
      profileCompletion: checks.length ? done / checks.length : 0,
      missing: checks.filter(([, ok]) => !ok).map(([k]) => k),
      leave: [...leave].map((l) => ({ name: l.name, balance: Number(l.balance) })),
      latestPayslip: p ? { documentId: p.document_id, period: format(new Date(p.year, p.month - 1, 1), "MMMM yyyy") } : null,
      attendanceThisMonth: a && a.n ? { present: a.present, absent: a.absent, leave: a.leave } : null,
      learningDue: counts[0]?.learning ?? 0,
      goalsActive: counts[0]?.goals ?? 0,
    };
  });
}

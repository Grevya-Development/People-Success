import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../../db/client";
import type { Permission } from "@/lib/permissions";

export type ReportParams = {
  from: string;
  to: string;
  departmentId?: string | null;
  locationId?: string | null;
};

export type ReportColumn = { key: string; label: string; type: "text" | "number" | "date" | "money" | "percent" };

export type ReportDefinition = {
  key: string;
  title: string;
  category: "People" | "Time" | "Pay" | "Hiring" | "Talent" | "Service";
  description: string;
  /** Viewer needs ALL of these (scope all). Exports additionally need reports.export. */
  permissions: Permission[];
  usesDateRange: boolean;
  sensitive: boolean;
  columns: ReportColumn[];
  query: (tx: Tx, p: ReportParams, limit: number) => Promise<Record<string, unknown>[]>;
};

function empWhere(p: ReportParams, alias = "e"): SQL {
  const parts: SQL[] = [sql.raw(`${alias}.deleted_at is null`)];
  if (p.departmentId) parts.push(sql`${sql.raw(alias)}.department_id = ${p.departmentId}`);
  if (p.locationId) parts.push(sql`${sql.raw(alias)}.location_id = ${p.locationId}`);
  return sql.join(parts, sql` and `);
}

const rows = async (tx: Tx, q: SQL) => [...(await tx.execute<Record<string, unknown>>(q))];

export const REPORTS: ReportDefinition[] = [
  {
    key: "employee_directory",
    title: "Employee directory",
    category: "People",
    description: "Current employees with role, department, location and manager.",
    permissions: ["employees.view"],
    usesDateRange: false,
    sensitive: false,
    columns: [
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "work_email", label: "Work email", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "employment_type", label: "Type", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "manager", label: "Manager", type: "text" },
      { key: "joining_date", label: "Joined", type: "date" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select e.employee_code as code, e.display_name as name, e.work_email, e.status, e.employment_type,
              dg.title as designation, d.name as department, l.name as location, m.display_name as manager, e.joining_date
            from employees e
            left join designations dg on dg.id = e.designation_id
            left join departments d on d.id = e.department_id
            left join locations l on l.id = e.location_id
            left join employees m on m.id = e.manager_id
            where ${empWhere(p)} and e.status in ('pending','active','on_notice')
            order by e.display_name limit ${limit}`,
      ),
  },
  {
    key: "headcount_by_department",
    title: "Headcount by department",
    category: "People",
    description: "Active, on-notice and pre-joining counts per department and location.",
    permissions: ["employees.view"],
    usesDateRange: false,
    sensitive: false,
    columns: [
      { key: "department", label: "Department", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "active", label: "Active", type: "number" },
      { key: "on_notice", label: "On notice", type: "number" },
      { key: "pending", label: "Pre-joining", type: "number" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select coalesce(d.name, 'Unassigned') as department, coalesce(l.name, 'Unassigned') as location,
              count(*) filter (where e.status = 'active')::int as active,
              count(*) filter (where e.status = 'on_notice')::int as on_notice,
              count(*) filter (where e.status = 'pending')::int as pending
            from employees e left join departments d on d.id = e.department_id left join locations l on l.id = e.location_id
            where ${empWhere(p)} and e.status <> 'exited'
            group by 1, 2 order by 3 desc limit ${limit}`,
      ),
  },
  {
    key: "joiners_and_leavers",
    title: "Joiners and leavers",
    category: "People",
    description: "Everyone who joined or exited within the period.",
    permissions: ["employees.view"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "event", label: "Event", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "reason", label: "Exit reason", type: "text" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select * from (
              select 'Joined' as event, e.joining_date as date, e.employee_code as code, e.display_name as name, d.name as department, null as reason
              from employees e left join departments d on d.id = e.department_id
              where ${empWhere(p)} and e.status <> 'pending' and e.joining_date between ${p.from} and ${p.to}
              union all
              select 'Exited', e.exit_date, e.employee_code, e.display_name, d.name, e.exit_reason
              from employees e left join departments d on d.id = e.department_id
              where ${empWhere(p)} and e.exit_date between ${p.from} and ${p.to}
            ) x order by date desc limit ${limit}`,
      ),
  },
  {
    key: "attrition_by_department",
    title: "Attrition by department",
    category: "People",
    description: "Exits ÷ average of start and end headcount per department for the period.",
    permissions: ["employees.view"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "department", label: "Department", type: "text" },
      { key: "start_headcount", label: "Start", type: "number" },
      { key: "end_headcount", label: "End", type: "number" },
      { key: "exits", label: "Exits", type: "number" },
      { key: "turnover", label: "Turnover", type: "percent" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select coalesce(d.name, 'Unassigned') as department,
              count(*) filter (where e.status <> 'pending' and e.joining_date <= ${p.from} and (e.exit_date is null or e.exit_date > ${p.from}))::int as start_headcount,
              count(*) filter (where e.status <> 'pending' and e.joining_date <= ${p.to} and (e.exit_date is null or e.exit_date > ${p.to}))::int as end_headcount,
              count(*) filter (where e.exit_date between ${p.from} and ${p.to})::int as exits,
              case when (count(*) filter (where e.status <> 'pending' and e.joining_date <= ${p.from} and (e.exit_date is null or e.exit_date > ${p.from}))
                        + count(*) filter (where e.status <> 'pending' and e.joining_date <= ${p.to} and (e.exit_date is null or e.exit_date > ${p.to}))) = 0 then null
                   else 2.0 * count(*) filter (where e.exit_date between ${p.from} and ${p.to})
                        / (count(*) filter (where e.status <> 'pending' and e.joining_date <= ${p.from} and (e.exit_date is null or e.exit_date > ${p.from}))
                         + count(*) filter (where e.status <> 'pending' and e.joining_date <= ${p.to} and (e.exit_date is null or e.exit_date > ${p.to}))) end as turnover
            from employees e left join departments d on d.id = e.department_id
            where ${empWhere(p)} group by 1 order by 4 desc limit ${limit}`,
      ),
  },
  {
    key: "attendance_summary",
    title: "Attendance summary",
    category: "Time",
    description: "Per-employee day counts, late minutes and overtime from processed attendance.",
    permissions: ["attendance.view"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "present", label: "Present", type: "number" },
      { key: "half_day", label: "Half days", type: "number" },
      { key: "absent", label: "Absent", type: "number" },
      { key: "on_leave", label: "On leave", type: "number" },
      { key: "missing_punch", label: "Missing punch", type: "number" },
      { key: "late_minutes", label: "Late (min)", type: "number" },
      { key: "overtime_hours", label: "Overtime (h)", type: "number" },
      { key: "lop_days", label: "LOP days", type: "number" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select e.employee_code as code, e.display_name as name,
              count(*) filter (where ad.status = 'present')::int as present,
              count(*) filter (where ad.status = 'half_day')::int as half_day,
              count(*) filter (where ad.status = 'absent')::int as absent,
              count(*) filter (where ad.status = 'on_leave')::int as on_leave,
              count(*) filter (where ad.status = 'missing_punch')::int as missing_punch,
              coalesce(sum(ad.late_minutes), 0)::int as late_minutes,
              round(coalesce(sum(ad.overtime_minutes), 0) / 60.0, 1) as overtime_hours,
              round(sum(1 - ad.payable_fraction) filter (where ad.status not in ('not_joined')), 1) as lop_days
            from attendance_days ad join employees e on e.id = ad.employee_id
            where ${empWhere(p)} and ad.date between ${p.from} and ${p.to}
            group by e.id order by e.display_name limit ${limit}`,
      ),
  },
  {
    key: "leave_balances",
    title: "Leave balances",
    category: "Time",
    description: "Current balance and pending days per employee and leave type.",
    permissions: ["leave.view"],
    usesDateRange: false,
    sensitive: false,
    columns: [
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "leave_type", label: "Leave type", type: "text" },
      { key: "balance", label: "Balance", type: "number" },
      { key: "pending", label: "Pending", type: "number" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select e.employee_code as code, e.display_name as name, lt.name as leave_type, lb.balance, lb.pending
            from leave_balances lb join employees e on e.id = lb.employee_id join leave_types lt on lt.id = lb.leave_type_id
            where ${empWhere(p)} and e.status in ('active','on_notice')
            order by e.display_name, lt.sort_order limit ${limit}`,
      ),
  },
  {
    key: "leave_taken",
    title: "Leave taken",
    category: "Time",
    description: "Leave requests starting in the period with their status.",
    permissions: ["leave.view"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "leave_type", label: "Type", type: "text" },
      { key: "start_date", label: "From", type: "date" },
      { key: "end_date", label: "To", type: "date" },
      { key: "days", label: "Days", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select e.employee_code as code, e.display_name as name, lt.name as leave_type, lr.start_date, lr.end_date, lr.days, lr.status
            from leave_requests lr join employees e on e.id = lr.employee_id join leave_types lt on lt.id = lr.leave_type_id
            where ${empWhere(p)} and lr.start_date between ${p.from} and ${p.to}
            order by lr.start_date desc limit ${limit}`,
      ),
  },
  {
    key: "payroll_register",
    title: "Payroll register",
    category: "Pay",
    description: "Per-employee results of locked and published runs for periods ending in the date range.",
    permissions: ["payroll.view"],
    usesDateRange: true,
    sensitive: true,
    columns: [
      { key: "period", label: "Period", type: "text" },
      { key: "run_kind", label: "Run", type: "text" },
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "payable_days", label: "Payable days", type: "number" },
      { key: "lop_days", label: "LOP", type: "number" },
      { key: "gross", label: "Gross", type: "money" },
      { key: "deductions", label: "Deductions", type: "money" },
      { key: "employer_contributions", label: "Employer contributions", type: "money" },
      { key: "net", label: "Net pay", type: "money" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select to_char(pp.end_date, 'Mon YYYY') as period, r.kind as run_kind, e.employee_code as code, e.display_name as name,
              re.payable_days, re.lop_days, re.gross_earnings as gross, re.total_deductions as deductions,
              re.employer_contributions, re.net_pay as net
            from payroll_run_employees re
            join payroll_runs r on r.id = re.run_id
            join payroll_periods pp on pp.id = r.period_id
            join employees e on e.id = re.employee_id
            where ${empWhere(p)} and r.status in ('locked','disbursed','published') and pp.end_date between ${p.from} and ${p.to}
            order by pp.end_date desc, e.display_name limit ${limit}`,
      ),
  },
  {
    key: "recruitment_pipeline",
    title: "Recruitment pipeline",
    category: "Hiring",
    description: "Applications per opening and stage, received in the period.",
    permissions: ["recruitment.view"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "opening", label: "Opening", type: "text" },
      { key: "status", label: "Opening status", type: "text" },
      { key: "stage", label: "Stage", type: "text" },
      { key: "applications", label: "Applications", type: "number" },
      { key: "rejected", label: "Rejected", type: "number" },
      { key: "hired", label: "Hired", type: "number" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select o.title as opening, o.status, s.name as stage,
              count(a.id)::int as applications,
              count(a.id) filter (where a.status = 'rejected')::int as rejected,
              count(a.id) filter (where a.status = 'hired')::int as hired
            from applications a join job_openings o on o.id = a.opening_id join recruitment_stages s on s.id = a.stage_id
            where a.applied_at::date between ${p.from} and ${p.to}
            group by o.id, s.id order by o.title, s.sort_order limit ${limit}`,
      ),
  },
  {
    key: "performance_completion",
    title: "Review completion",
    category: "Talent",
    description: "Review status per employee for cycles overlapping the period.",
    permissions: ["performance.manage"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "cycle", label: "Cycle", type: "text" },
      { key: "code", label: "Employee ID", type: "text" },
      { key: "name", label: "Employee", type: "text" },
      { key: "self_status", label: "Self review", type: "text" },
      { key: "manager_status", label: "Manager review", type: "text" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select c.name as cycle, e.employee_code as code, e.display_name as name,
              max(r.status::text) filter (where r.kind = 'self') as self_status,
              max(r.status::text) filter (where r.kind = 'manager') as manager_status
            from reviews r join review_cycles c on c.id = r.cycle_id join employees e on e.id = r.employee_id
            where ${empWhere(p)} and c.period_end >= ${p.from} and c.period_start <= ${p.to}
            group by c.id, e.id order by c.name, e.display_name limit ${limit}`,
      ),
  },
  {
    key: "learning_completion",
    title: "Learning completion",
    category: "Talent",
    description: "Assigned, completed and overdue enrollments per course.",
    permissions: ["learning.manage"],
    usesDateRange: false,
    sensitive: false,
    columns: [
      { key: "course", label: "Course", type: "text" },
      { key: "mandatory", label: "Mandatory", type: "text" },
      { key: "assigned", label: "Assigned", type: "number" },
      { key: "completed", label: "Completed", type: "number" },
      { key: "overdue", label: "Overdue", type: "number" },
      { key: "completion", label: "Completion", type: "percent" },
    ],
    query: (tx, _p, limit) =>
      rows(
        tx,
        sql`select c.title as course, case when c.is_mandatory then 'Yes' else 'No' end as mandatory,
              count(le.id)::int as assigned,
              count(le.id) filter (where le.status = 'completed')::int as completed,
              count(le.id) filter (where le.status in ('assigned','in_progress') and le.due_on < current_date)::int as overdue,
              case when count(le.id) = 0 then null else (count(le.id) filter (where le.status = 'completed'))::numeric / count(le.id) end as completion
            from courses c left join learning_enrollments le on le.course_id = c.id
            group by c.id order by c.title limit ${limit}`,
      ),
  },
  {
    key: "helpdesk_sla",
    title: "Service desk SLA",
    category: "Service",
    description: "Ticket volume, median response and resolution, and SLA breaches per category.",
    permissions: ["helpdesk.manage"],
    usesDateRange: true,
    sensitive: false,
    columns: [
      { key: "category", label: "Category", type: "text" },
      { key: "opened", label: "Opened", type: "number" },
      { key: "resolved", label: "Resolved", type: "number" },
      { key: "median_first_response_h", label: "Median first response (h)", type: "number" },
      { key: "median_resolution_h", label: "Median resolution (h)", type: "number" },
      { key: "breaches", label: "SLA breaches", type: "number" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select coalesce(c.name, 'Uncategorized') as category,
              count(t.id)::int as opened,
              count(t.id) filter (where t.resolved_at is not null)::int as resolved,
              round((percentile_cont(0.5) within group (order by extract(epoch from (t.first_responded_at - t.created_at)) / 3600.0))::numeric, 1) as median_first_response_h,
              round((percentile_cont(0.5) within group (order by extract(epoch from (t.resolved_at - t.created_at)) / 3600.0))::numeric, 1) as median_resolution_h,
              count(t.id) filter (where (t.first_responded_at is null and t.first_response_due_at < now()) or t.first_responded_at > t.first_response_due_at
                                     or (t.resolved_at is null and t.resolution_due_at < now()) or t.resolved_at > t.resolution_due_at)::int as breaches
            from tickets t left join ticket_categories c on c.id = t.category_id
            where t.created_at::date between ${p.from} and ${p.to}
            group by 1 order by 2 desc limit ${limit}`,
      ),
  },
  {
    key: "audit_trail",
    title: "Audit trail",
    category: "Service",
    description: "Recorded changes in the period (redacted).",
    permissions: ["audit.view"],
    usesDateRange: true,
    sensitive: true,
    columns: [
      { key: "created_at", label: "When", type: "text" },
      { key: "actor", label: "Actor", type: "text" },
      { key: "action", label: "Action", type: "text" },
      { key: "entity_type", label: "Entity", type: "text" },
      { key: "entity_id", label: "Entity ID", type: "text" },
    ],
    query: (tx, p, limit) =>
      rows(
        tx,
        sql`select to_char(a.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as created_at, coalesce(u.full_name, u.email, a.actor_type) as actor,
              a.action, a.entity_type, a.entity_id
            from audit_logs a left join users u on u.id = a.actor_user_id
            where a.created_at::date between ${p.from} and ${p.to}
            order by a.id desc limit ${limit}`,
      ),
  },
];

export const reportDefinition = (key: string) => REPORTS.find((r) => r.key === key);

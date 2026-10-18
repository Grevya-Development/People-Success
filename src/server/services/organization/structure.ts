import "server-only";
import { sql } from "drizzle-orm";
import { authorize, can, type RequestContext } from "../../auth/context";

/* ------------------------------------------------------------------ */
/* Org chart                                                           */
/* ------------------------------------------------------------------ */

export type OrgChartNode = {
  id: string;
  displayName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  managerId: string | null;
  status: "pending" | "active" | "on_notice" | "exited";
  directReports: number;
};

/**
 * Every non-exited, non-deleted employee with their solid-line manager, in a
 * single query. Direct report counts come from a grouped CTE, not N+1.
 * A manager id pointing outside the set (exited / deleted manager) is
 * returned as null so the client treats the person as a root.
 */
export async function orgChart(ctx: RequestContext): Promise<OrgChartNode[]> {
  authorize(ctx, "org.view");
  const rows = await ctx.db((tx) =>
    tx.execute<{
      id: string;
      display_name: string;
      employee_code: string;
      designation: string | null;
      department: string | null;
      manager_id: string | null;
      status: OrgChartNode["status"];
      direct_reports: number;
    }>(sql`
      with people as (
        select e.id, e.display_name, e.employee_code, e.manager_id, e.status, e.designation_id, e.department_id
        from employees e
        where e.deleted_at is null and e.status <> 'exited'
      ),
      report_counts as (
        select manager_id, count(*)::int as n from people where manager_id is not null group by manager_id
      )
      select p.id, p.display_name, p.employee_code, d.title as designation, dep.name as department,
             case when exists (select 1 from people m where m.id = p.manager_id) then p.manager_id end as manager_id,
             p.status, coalesce(rc.n, 0) as direct_reports
      from people p
      left join designations d on d.id = p.designation_id
      left join departments dep on dep.id = p.department_id
      left join report_counts rc on rc.manager_id = p.id
      order by p.display_name
    `),
  );
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    employeeCode: r.employee_code,
    designation: r.designation,
    department: r.department,
    managerId: r.manager_id,
    status: r.status,
    directReports: Number(r.direct_reports),
  }));
}

/* ------------------------------------------------------------------ */
/* Departments                                                         */
/* ------------------------------------------------------------------ */

export type DepartmentRow = {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  parentName: string | null;
  headId: string | null;
  headName: string | null;
  headcount: number;
  isActive: boolean;
};

/** Departments with active headcount (active + on notice) and head. */
export async function listDepartments(ctx: RequestContext): Promise<DepartmentRow[]> {
  authorize(ctx, "org.view");
  const rows = await ctx.db((tx) =>
    tx.execute<{
      id: string;
      name: string;
      code: string | null;
      parent_id: string | null;
      parent_name: string | null;
      head_id: string | null;
      head_name: string | null;
      headcount: number;
      is_active: boolean;
    }>(sql`
      with counts as (
        select department_id, count(*)::int as n
        from employees
        where deleted_at is null and status in ('active', 'on_notice') and department_id is not null
        group by department_id
      )
      select d.id, d.name, d.code, d.parent_id, p.name as parent_name,
             h.id as head_id, h.display_name as head_name,
             coalesce(c.n, 0) as headcount, d.is_active
      from departments d
      left join departments p on p.id = d.parent_id
      left join employees h on h.id = d.head_employee_id and h.deleted_at is null
      left join counts c on c.department_id = d.id
      order by d.is_active desc, d.name
    `),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    parentId: r.parent_id,
    parentName: r.parent_name,
    headId: r.head_id,
    headName: r.head_name,
    headcount: Number(r.headcount),
    isActive: r.is_active,
  }));
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

export const SPAN_WIDE = 12;

export type SpanOfControlRow = {
  managerId: string;
  name: string;
  designation: string | null;
  department: string | null;
  directReports: number;
  flag: "wide" | "narrow" | null;
};

/** Managers with their direct report counts; flags spans above 12 and of exactly 1. */
export async function spanOfControl(ctx: RequestContext): Promise<SpanOfControlRow[]> {
  authorize(ctx, "org.view");
  const rows = await ctx.db((tx) =>
    tx.execute<{ id: string; name: string; designation: string | null; department: string | null; n: number }>(sql`
      select m.id, m.display_name as name, d.title as designation, dep.name as department, count(r.id)::int as n
      from employees r
      join employees m on m.id = r.manager_id and m.deleted_at is null and m.status <> 'exited'
      left join designations d on d.id = m.designation_id
      left join departments dep on dep.id = m.department_id
      where r.deleted_at is null and r.status <> 'exited'
      group by m.id, m.display_name, d.title, dep.name
      order by n desc, m.display_name
      limit 1000
    `),
  );
  return rows.map((r) => {
    const n = Number(r.n);
    return {
      managerId: r.id,
      name: r.name,
      designation: r.designation,
      department: r.department,
      directReports: n,
      flag: n > SPAN_WIDE ? "wide" : n === 1 ? "narrow" : null,
    };
  });
}

export const canSeeOrgChanges = (ctx: RequestContext) => can(ctx, "org.manage", "all") || can(ctx, "employees.view", "all");

export type OrgChangeRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  changeType: "transfer" | "promotion" | "manager_change" | "designation_change";
  effectiveFrom: string;
  fromDepartment: string | null;
  toDepartment: string | null;
  fromDesignation: string | null;
  toDesignation: string | null;
  fromManager: string | null;
  toManager: string | null;
};

/** Latest 50 structural changes with before/after values from the previous record. */
export async function recentOrgChanges(ctx: RequestContext): Promise<OrgChangeRow[]> {
  authorize(ctx, "org.view");
  if (!canSeeOrgChanges(ctx)) return [];
  const rows = await ctx.db((tx) =>
    tx.execute<{
      id: string;
      employee_id: string;
      employee_name: string;
      change_type: OrgChangeRow["changeType"];
      effective_from: string;
      from_department: string | null;
      to_department: string | null;
      from_designation: string | null;
      to_designation: string | null;
      from_manager: string | null;
      to_manager: string | null;
    }>(sql`
      with changes as (
        select er.*
        from employment_records er
        where er.change_type in ('transfer', 'promotion', 'manager_change', 'designation_change')
        order by er.effective_from desc, er.created_at desc
        limit 50
      )
      select c.id, c.employee_id, e.display_name as employee_name, c.change_type, c.effective_from::text as effective_from,
             pd.name as from_department, nd.name as to_department,
             pg.title as from_designation, ng.title as to_designation,
             pm.display_name as from_manager, nm.display_name as to_manager
      from changes c
      join employees e on e.id = c.employee_id and e.deleted_at is null
      left join lateral (
        select prev.department_id, prev.designation_id, prev.manager_id
        from employment_records prev
        where prev.employee_id = c.employee_id and prev.effective_from < c.effective_from
        order by prev.effective_from desc
        limit 1
      ) p on true
      left join departments pd on pd.id = p.department_id
      left join departments nd on nd.id = c.department_id
      left join designations pg on pg.id = p.designation_id
      left join designations ng on ng.id = c.designation_id
      left join employees pm on pm.id = p.manager_id
      left join employees nm on nm.id = c.manager_id
      order by c.effective_from desc, c.created_at desc
    `),
  );
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    changeType: r.change_type,
    effectiveFrom: r.effective_from,
    fromDepartment: r.from_department,
    toDepartment: r.to_department,
    fromDesignation: r.from_designation,
    toDesignation: r.to_designation,
    fromManager: r.from_manager,
    toManager: r.to_manager,
  }));
}

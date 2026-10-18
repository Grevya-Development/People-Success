import { authorize, type RequestContext } from "../../auth/context";
import { audit } from "../../lib/audit";
import { listEmployees, PAGE_SIZE } from "./queries";
import type { EmployeeListQuery } from "@/lib/validation/employees";
import { toCsv } from "@/lib/csv";

const MAX_EXPORT = 20_000;

/**
 * Directory export (no compensation, identity or bank data). Requires
 * employees.export; applies the same visibility rules as the list; logged.
 */
export async function exportEmployeesCsv(ctx: RequestContext, query: EmployeeListQuery) {
  authorize(ctx, "employees.export", "all");
  const rows = [];
  for (let page = 1; page <= Math.ceil(MAX_EXPORT / PAGE_SIZE); page++) {
    const res = await listEmployees(ctx, { ...query, page });
    rows.push(...res.rows);
    if (page >= res.pageCount) break;
  }
  await ctx.db((tx) =>
    audit(tx, ctx, {
      action: "employees.exported",
      entityType: "employee",
      metadata: { count: rows.length, filters: { ...query, page: undefined } },
    }),
  );
  return toCsv([
    ["employee_code", "name", "work_email", "status", "employment_type", "designation", "department", "location", "manager", "joining_date"],
    ...rows.map((r) => [r.code, r.name, r.workEmail, r.status, r.employmentType, r.designation, r.department, r.location, r.managerName, r.joiningDate]),
  ]);
}

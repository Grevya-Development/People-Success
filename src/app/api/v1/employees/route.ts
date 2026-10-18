import { apiHandler, parseBody, withIdempotency } from "@/server/api/http";
import { createEmployee } from "@/server/services/employees/mutations";
import { listEmployees } from "@/server/services/employees/queries";
import { createEmployeeSchema, employeeListSchema } from "@/lib/validation/employees";

/** GET /api/v1/employees — paginated directory with the same visibility rules as the app. */
export const GET = apiHandler(async ({ request, ctx }) => {
  const query = parseBody(employeeListSchema, Object.fromEntries(request.nextUrl.searchParams));
  const result = await listEmployees(ctx, query);
  return { items: result.rows, page: result.page, pageCount: result.pageCount, total: result.total };
});

/** POST /api/v1/employees — create an employee. Supports Idempotency-Key. */
export const POST = apiHandler(
  async ({ request, ctx }) => {
    const raw = await request.json().catch(() => null);
    const input = parseBody(createEmployeeSchema, raw);
    return withIdempotency(ctx, request, "employees.create", raw, async () => {
      const e = await createEmployee(ctx, input);
      return { id: e.id, employeeCode: e.employeeCode, status: e.status };
    });
  },
  { status: 201 },
);

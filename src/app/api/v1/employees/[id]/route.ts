import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, parseBody } from "@/server/api/http";
import { getEmployeeHeader } from "@/server/services/employees/queries";

/** GET /api/v1/employees/{id} — profile fields the caller may see. */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/v1/employees/[id]">) {
  const { id } = await params;
  return apiHandler(async ({ ctx }) => {
    const employeeId = parseBody(z.uuid(), id);
    const { employee, access } = await getEmployeeHeader(ctx, employeeId);
    return { ...employee, access: { full: access.full } };
  })(request);
}

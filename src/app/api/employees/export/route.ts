import { NextResponse, type NextRequest } from "next/server";
import { requireActionContext } from "@/server/auth/context";
import { exportEmployeesCsv } from "@/server/services/employees/export";
import { employeeListSchema } from "@/lib/validation/employees";
import { toAppError } from "@/server/lib/errors";
import { todayIn } from "@/lib/format";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireActionContext();
    const query = employeeListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const csv = await exportEmployeesCsv(ctx, { ...query, page: 1 });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="employees-${todayIn()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const e = toAppError(err);
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
}

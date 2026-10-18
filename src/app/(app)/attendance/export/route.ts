import { NextResponse, type NextRequest } from "next/server";
import { requireActionContext } from "@/server/auth/context";
import { exportMonthlySummaryCsv } from "@/server/services/time/attendance";
import { monthSchema } from "@/lib/validation/time";
import { toAppError, validation } from "@/server/lib/errors";

/** Monthly attendance summary CSV (payroll-ready). Permission-checked and audited in the service. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireActionContext();
    const parsed = monthSchema.safeParse(request.nextUrl.searchParams.get("month"));
    if (!parsed.success) throw validation("Choose a month (yyyy-MM).");
    const csv = await exportMonthlySummaryCsv(ctx, parsed.data);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${parsed.data}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const e = toAppError(err);
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
}

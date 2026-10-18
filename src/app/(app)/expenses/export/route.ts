import { NextResponse, type NextRequest } from "next/server";
import { requireActionContext } from "@/server/auth/context";
import { exportClaimsCsv, exportExpenseAuditCsv } from "@/server/services/expenses/reports";
import { toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { claimFilterSchema } from "@/lib/validation/expenses";
import { todayIn } from "@/lib/format";

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

/** CSV exports for finance: claim lines (?type=claims&status&q&month) or the expense audit trail (?type=audit). */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  try {
    const ctx = await requireActionContext();
    const type = sp.get("type") === "audit" ? "audit" : "claims";
    let csv: string;
    if (type === "audit") {
      csv = await exportExpenseAuditCsv(ctx);
    } else {
      const parsed = claimFilterSchema.safeParse({
        status: sp.get("status") || undefined,
        q: sp.get("q") || undefined,
        month: sp.get("month") || undefined,
      });
      csv = await exportClaimsCsv(ctx, parsed.success ? parsed.data : {});
    }
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="expense-${type}-${todayIn()}.csv"`,
      },
    });
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "INTERNAL") logger.error("expenses.export_failed", { err });
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: NO_STORE });
  }
}

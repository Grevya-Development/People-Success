import { NextResponse } from "next/server";
import { requireActionContext, can } from "@/server/auth/context";
import { toCsv } from "@/lib/csv";
import { INPUT_CSV_HEADERS } from "@/server/services/payroll/inputs";

/** Blank CSV template for one-off payroll inputs. */
export async function GET() {
  try {
    const ctx = await requireActionContext();
    if (!can(ctx, "payroll.run", "all")) return NextResponse.json({ error: { code: "FORBIDDEN", message: "You do not have permission to do that." } }, { status: 403 });
  } catch {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in." } }, { status: 401 });
  }
  const csv = toCsv([[...INPUT_CSV_HEADERS], ["EMP0001", "bonus", "BONUS", "5000", "yes", "Festival bonus", "FEST-2026"]]);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="payroll-inputs-template.csv"', "Cache-Control": "no-store" } });
}

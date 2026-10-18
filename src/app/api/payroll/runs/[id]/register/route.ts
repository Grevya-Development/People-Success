import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActionContext } from "@/server/auth/context";
import { payrollRegisterCsv } from "@/server/services/payroll/reports";
import { toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

const NO_STORE = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

/** Payroll register CSV (payroll.view + reports.export). Every export is audited. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/payroll/runs/[id]/register">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Run not found." } }, { status: 404, headers: NO_STORE });
  try {
    const ctx = await requireActionContext();
    const { csv, fileName } = await payrollRegisterCsv(ctx, id);
    return new NextResponse(csv, { headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"` } });
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "INTERNAL") logger.error("payroll.register_failed", { err });
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: NO_STORE });
  }
}

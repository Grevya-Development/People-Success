import { NextResponse, type NextRequest } from "next/server";
import { requireActionContext } from "@/server/auth/context";
import { exportReport, reportParamsSchema } from "@/server/services/reports/service";
import { toAppError } from "@/server/lib/errors";

export async function GET(request: NextRequest, { params }: RouteContext<"/api/reports/[key]/export">) {
  try {
    const ctx = await requireActionContext();
    const { key } = await params;
    const sp = request.nextUrl.searchParams;
    const parsed = reportParamsSchema.parse({
      from: sp.get("from"),
      to: sp.get("to"),
      departmentId: sp.get("departmentId") || null,
      locationId: sp.get("locationId") || null,
    });
    const fmt = sp.get("format") === "pdf" ? "pdf" : "csv";
    const file = await exportReport(ctx, key, parsed, fmt);
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const e = toAppError(err);
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
}

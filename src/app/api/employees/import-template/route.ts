import { NextResponse } from "next/server";
import { IMPORT_COLUMNS } from "@/server/services/employees/import";
import { toCsv } from "@/lib/csv";

/** Static CSV template with the expected headers and one example row. */
export function GET() {
  const csv = toCsv([IMPORT_COLUMNS.map((c) => c.key), IMPORT_COLUMNS.map((c) => c.example)]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="peoplesuccess-employee-import-template.csv"',
    },
  });
}

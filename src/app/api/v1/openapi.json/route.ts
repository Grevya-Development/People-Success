import { NextResponse } from "next/server";
import { openApiDocument } from "@/server/api/openapi";
import { env } from "@/server/env";

/** Public API description (contains no tenant data). */
export function GET() {
  return NextResponse.json(openApiDocument(env().NEXT_PUBLIC_APP_URL), { headers: { "cache-control": "public, max-age=300" } });
}

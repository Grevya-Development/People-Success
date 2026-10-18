import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/server/auth/supabase";

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}

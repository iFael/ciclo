import { NextResponse } from "next/server";
import { LAST_SEEN_COOKIE } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?erro=link", url.origin));
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/login?erro=config", url.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?erro=link", url.origin));
  const response = NextResponse.redirect(new URL("/", url.origin));
  response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { e2eBypass, publicSupabase } from "@/lib/env";
import { endAllSessions, LAST_SEEN_COOKIE, sessionExpired } from "@/lib/security";

const PUBLIC_PREFIXES = ["/login", "/auth", "/api/webhooks/pluggy", "/api/cron/sync", "/api/health"];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/logos/") || pathname === "/favicon.ico" || pathname === "/icon.svg") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || isPublic(pathname)) return NextResponse.next();
  if (e2eBypass() && (pathname === "/" || pathname.startsWith("/api/plans") || pathname.startsWith("/api/auth") || pathname.startsWith("/api/account"))) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const pub = publicSupabase();
  if (!pub) {
    if (pathname.startsWith("/login")) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(pub.url, pub.key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  const signedIn = Boolean(email && allowed && email === allowed);
  const secure = process.env.NODE_ENV === "production";

  if (signedIn) {
    const lastRaw = request.cookies.get(LAST_SEEN_COOKIE)?.value;
    const now = Date.now();
    if (lastRaw && sessionExpired(Number(lastRaw), now)) {
      await endAllSessions(supabase);
      const redirect = NextResponse.redirect(new URL("/login", request.url));
      redirect.cookies.set(LAST_SEEN_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
      redirect.headers.set("Cache-Control", "no-store");
      return redirect;
    }
    response.cookies.set(LAST_SEEN_COOKIE, String(now), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  if (!signedIn) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  }
  if (pathname.startsWith("/login")) return NextResponse.redirect(new URL("/", request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

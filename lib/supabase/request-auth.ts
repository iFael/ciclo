import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabase } from "@/lib/env";
import type { PendingCookie } from "@/lib/http/cookies";

export function createRequestAuth(request: NextRequest): {
  supabase: SupabaseClient | null;
  cookies: () => PendingCookie[];
  secure: boolean;
} {
  const jar: PendingCookie[] = [];
  const secure = process.env.NODE_ENV === "production";
  const pub = publicSupabase();
  if (!pub) return { supabase: null, cookies: () => jar, secure };

  const supabase = createServerClient(pub.url, pub.key, {
    cookieOptions: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        jar.splice(
          0,
          jar.length,
          ...cookiesToSet.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            options: {
              ...(typeof cookie.options?.maxAge === "number" ? { maxAge: cookie.options.maxAge } : {}),
              ...(cookie.options?.expires instanceof Date ? { expires: cookie.options.expires } : {}),
            },
          })),
        );
      },
    },
  });

  return { supabase, cookies: () => jar, secure };
}

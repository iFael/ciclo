import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabase } from "@/lib/env";

export async function createClient() {
  const pub = publicSupabase();
  if (!pub) return null;
  const cookieStore = await cookies();
  return createServerClient(pub.url, pub.key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // The proxy refreshes the session on the next request.
        }
      },
    },
  });
}

export async function getSessionUser(): Promise<{ email: string } | null> {
  try {
    const supabase = await createClient();
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    const allowed = process.env.ALLOWED_EMAIL;
    if (!email || !allowed || email.toLowerCase() !== allowed.toLowerCase()) return null;
    return { email };
  } catch {
    return null;
  }
}

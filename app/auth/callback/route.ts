import type { NextRequest } from "next/server";
import { handleAuthCallback } from "@/lib/http/auth-callback";
import { createRequestAuth } from "@/lib/supabase/request-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function complete(request: NextRequest) {
  const { supabase, cookies, secure } = createRequestAuth(request);
  return handleAuthCallback({
    requestUrl: request.url,
    allowedEmail: process.env.ALLOWED_EMAIL,
    secure,
    sessionCookies: cookies,
    verifyTokenHash: async ({ token_hash, type }) => {
      if (!supabase) return { email: null, error: "config" };
      const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });
      return { email: data?.user?.email ?? null, error: error ? "invalid" : null };
    },
    exchangeCode: async (code) => {
      if (!supabase) return { email: null, error: "config" };
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      return { email: data?.user?.email ?? null, error: error ? "invalid" : null };
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut({ scope: "global" });
    },
  });
}

export function GET(request: NextRequest) {
  return complete(request);
}

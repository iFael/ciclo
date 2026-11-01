import type { NextRequest } from "next/server";
import { handleVerifyCode } from "@/lib/http/verify-code";
import { createRequestAuth } from "@/lib/supabase/request-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: NextRequest) {
  const { supabase, cookies, secure } = createRequestAuth(request);
  return handleVerifyCode(request, {
    allowedEmail: process.env.ALLOWED_EMAIL,
    secure,
    sessionCookies: cookies,
    verifyCode: async ({ email, token }) => {
      if (!supabase) return { email: null, error: "config" };
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
      return { email: data?.user?.email ?? null, error: error ? "invalid" : null, status };
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut({ scope: "global" });
    },
  });
}

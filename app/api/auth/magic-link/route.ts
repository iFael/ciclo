import { magicLinkRedirect } from "@/lib/env";
import { HttpFailure } from "@/lib/http/failure";
import { handleMagicLink } from "@/lib/http/magic-link";
import { ConfigError } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  return handleMagicLink(request, {
    allowedEmail: process.env.ALLOWED_EMAIL,
    redirectTo: magicLinkRedirect(origin),
    send: async (email, redirectTo) => {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      if (!supabase) throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL");
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 0;
        if (status === 429) throw new HttpFailure(429);
        throw new Error("magic_link_failed");
      }
    },
  });
}

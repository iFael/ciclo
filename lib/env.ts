export function publicSupabase(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function e2eBypass(): boolean {
  return process.env.CICLO_E2E === "1" && process.env.NODE_ENV !== "production";
}

export function magicLinkRedirect(origin: string): string {
  if (process.env.NODE_ENV === "production") return "https://ciclo-peach.vercel.app/auth/callback";
  return `${origin}/auth/callback`;
}

export function canSendMagicLink(email: string, allowed: string | undefined): "ok" | "missing-config" | "denied" {
  if (!allowed?.trim()) return "missing-config";
  if (email.trim().toLowerCase() !== allowed.trim().toLowerCase()) return "denied";
  return "ok";
}

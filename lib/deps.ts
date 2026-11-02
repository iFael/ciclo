import { createPluggyFromEnv, type PluggySource } from "@/lib/pluggy/client";
import { ConfigError } from "@/lib/security";
import type { Store } from "@/lib/store";

export type AppDeps = {
  store: Store;
  pluggy: PluggySource | null;
  now: () => Date;
  seedItemId?: string;
  userEmail?: string | null;
  sendEmail: (message: { subject: string; text: string; html?: string }) => Promise<void>;
  signOut?: () => Promise<void>;
  sendMagicLink?: (email: string, redirectTo: string) => Promise<void>;
};

let override: AppDeps | null = null;

export function setDepsForTests(deps: AppDeps | null): void {
  if (!process.env.VITEST && deps) throw new Error("only tests");
  override = deps;
}

export async function resolveDeps(): Promise<AppDeps> {
  if (override) return override;
  const { createSupabaseStore } = await import("@/lib/supabase-store");
  const { sendMail } = await import("@/lib/email");
  return {
    store: createSupabaseStore(),
    pluggy: createPluggyFromEnv(),
    now: () => new Date(),
    seedItemId: process.env.PLUGGY_ITEM_ID,
    sendEmail: async (message) => {
      const result = await sendMail(message);
      if (!result.sent) throw new ConfigError(result.missing ?? "RESEND_API_KEY");
    },
  };
}

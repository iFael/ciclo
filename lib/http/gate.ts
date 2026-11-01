import { resolveDeps } from "@/lib/deps";

export async function isAuthorized(): Promise<boolean> {
  const deps = await resolveDeps();
  if (deps.userEmail !== undefined) return deps.userEmail !== null;
  const { getSessionUser } = await import("@/lib/supabase/server");
  return Boolean(await getSessionUser());
}

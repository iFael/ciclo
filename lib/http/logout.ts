import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { clearLastSeenCookie, endAllSessions, LEGACY_LAST_SEEN_COOKIE } from "@/lib/security";

export async function handleLogout(): Promise<Response> {
  if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const deps = await resolveDeps();
  if (deps.signOut) await deps.signOut();
  else {
    const { createClient } = await import("@/lib/supabase/server");
    const client = await createClient();
    if (client) await endAllSessions(client);
  }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", clearLastSeenCookie(process.env.NODE_ENV === "production"));
  response.headers.append("Set-Cookie", clearLastSeenCookie(process.env.NODE_ENV === "production", LEGACY_LAST_SEEN_COOKIE));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function handleDelete(): Promise<Response> {
  if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const deps = await resolveDeps();
  await deps.store.wipe();
  if (deps.signOut) await deps.signOut();
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", clearLastSeenCookie(process.env.NODE_ENV === "production"));
  response.headers.append("Set-Cookie", clearLastSeenCookie(process.env.NODE_ENV === "production", LEGACY_LAST_SEEN_COOKIE));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

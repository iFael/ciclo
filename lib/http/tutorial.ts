import { e2eBypass } from "@/lib/env";
import { isAuthorized } from "@/lib/http/gate";

/** Where "already saw the welcome tour" is kept: the account, so it follows the user across devices. */
export type TutorialAccount = {
  read: () => Promise<boolean>;
  write: (seen: boolean) => Promise<void>;
};

async function supabaseAccount(): Promise<TutorialAccount | null> {
  const { createClient } = await import("@/lib/supabase/server");
  const client = await createClient();
  if (!client) return null;
  return {
    read: async () => {
      const { data } = await client.auth.getUser();
      return data.user?.user_metadata?.tutorial_seen === true;
    },
    write: async (seen) => {
      const { error } = await client.auth.updateUser({ data: { tutorial_seen: seen } });
      if (error) throw error;
    },
  };
}

export async function handleTutorial(request: Request, account?: TutorialAccount | null): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    // The local test server has no account: the tour stays out of the way unless a test asks for it.
    if (account === undefined && e2eBypass()) {
      return Response.json({ seen: true }, { headers });
    }
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const store = account === undefined ? await supabaseAccount() : account;
    if (!store) return Response.json({ error: "unavailable" }, { status: 503, headers });
    if (request.method === "GET") return Response.json({ seen: await store.read() }, { headers });
    const body = (await request.json().catch(() => null)) as { seen?: unknown } | null;
    if (typeof body?.seen !== "boolean") return Response.json({ error: "invalid" }, { status: 400, headers });
    await store.write(body.seen);
    return Response.json({ seen: body.seen }, { headers });
  } catch {
    return Response.json({ error: "failed" }, { status: 500, headers });
  }
}

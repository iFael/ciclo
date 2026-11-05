import { safeEqual, safeLog } from "@/lib/security";

const DEFAULT_FACTS_BANK_SYNC_URL = "https://gpbsjmagjxpnoooldgtk.supabase.co/functions/v1/bank-sync";

export function factsBridgeAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  return safeEqual(authorization, `Bearer ${secret}`);
}

export async function triggerFactsBankSync(event: string, transactionIds: string[]): Promise<void> {
  const secret = process.env.FACTS_FEED_TOKEN;
  if (!secret) return;
  const url = process.env.FACTS_BANK_SYNC_URL || DEFAULT_FACTS_BANK_SYNC_URL;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        trigger: "pluggy-webhook",
        event,
        transactionIds: transactionIds.slice(0, 100),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      console.info(JSON.stringify(safeLog({ count: transactionIds.length, status: "facts", errorCode: `facts_sync_${response.status}` })));
    }
  } catch {
    console.info(JSON.stringify(safeLog({ count: transactionIds.length, status: "facts", errorCode: "facts_sync_failed" })));
  }
}

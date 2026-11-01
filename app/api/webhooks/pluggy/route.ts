import { handleWebhook } from "@/lib/http/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleWebhook(request);
}

import { handleFactsNotification } from "@/lib/http/facts-notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleFactsNotification(request);
}

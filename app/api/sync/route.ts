import { handleManualSync } from "@/lib/http/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleManualSync(request);
}

import { handleHealth } from "@/lib/http/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleHealth(request);
}

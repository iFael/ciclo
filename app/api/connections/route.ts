import { handleConnections } from "@/lib/http/connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleConnections(request);
}

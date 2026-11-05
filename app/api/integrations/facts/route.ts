import { handleFactsFeed } from "@/lib/http/facts-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleFactsFeed(request);
}

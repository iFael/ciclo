import { handleSummaryEmail } from "@/lib/http/summary-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleSummaryEmail(request);
}

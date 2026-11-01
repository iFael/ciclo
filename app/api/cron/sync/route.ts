import { handleCron } from "@/lib/http/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleCron(request);
}

export function POST(request: Request) {
  return handleCron(request);
}

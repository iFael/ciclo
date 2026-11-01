import { handlePlans } from "@/lib/http/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handlePlans(request);
}

export function POST(request: Request) {
  return handlePlans(request);
}

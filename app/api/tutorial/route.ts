import { handleTutorial } from "@/lib/http/tutorial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleTutorial(request);
}

export function POST(request: Request) {
  return handleTutorial(request);
}

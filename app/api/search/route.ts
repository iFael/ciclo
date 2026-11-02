import { handleSearch } from "@/lib/http/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleSearch(request);
}

export function POST(request: Request) {
  return handleSearch(request);
}

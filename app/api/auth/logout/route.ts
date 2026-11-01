import { handleLogout } from "@/lib/http/logout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST() {
  return handleLogout();
}

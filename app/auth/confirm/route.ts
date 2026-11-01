import type { NextRequest } from "next/server";
import { GET as callback } from "@/app/auth/callback/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// token_hash lands here and is confirmed with verifyOtp, which does not read a PKCE code verifier.
export function GET(request: NextRequest) {
  return callback(request);
}

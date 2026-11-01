import { NextResponse } from "next/server";
import { applyAuthCookies, forgetSession, rememberSession, type PendingCookie } from "@/lib/http/cookies";

export type OtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

const OTP_TYPES = new Set<OtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export type AuthResult = { email: string | null; error: "invalid" | "config" | null };

function otpType(value: string | null): OtpType {
  if (value && OTP_TYPES.has(value as OtpType)) return value as OtpType;
  return "email";
}

function safeNext(origin: string, next: string | null): URL {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.includes("://")) {
    return new URL("/", origin);
  }
  const url = new URL(next, origin);
  if (url.origin !== origin) return new URL("/", origin);
  return url;
}

function redirect(url: string): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function handleAuthCallback(input: {
  requestUrl: string;
  allowedEmail: string | undefined;
  secure: boolean;
  sessionCookies: () => PendingCookie[];
  verifyTokenHash: (args: { token_hash: string; type: OtpType }) => Promise<AuthResult>;
  exchangeCode: (code: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}): Promise<NextResponse> {
  const url = new URL(input.requestUrl);
  const origin = url.origin;
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");

  let result: AuthResult;
  if (tokenHash) {
    result = await input.verifyTokenHash({ token_hash: tokenHash, type: otpType(url.searchParams.get("type")) });
  } else if (code) {
    result = await input.exchangeCode(code);
  } else {
    return redirect(new URL("/login?erro=link", origin).toString());
  }

  if (result.error === "config") return redirect(new URL("/login?erro=config", origin).toString());
  if (result.error || !result.email) return redirect(new URL("/login?erro=link", origin).toString());

  const allowed = input.allowedEmail?.trim().toLowerCase();
  if (!allowed || result.email.toLowerCase() !== allowed) {
    await input.signOut();
    const response = redirect(new URL("/login?erro=negado", origin).toString());
    applyAuthCookies(response, input.sessionCookies(), input.secure);
    forgetSession(response, input.secure);
    return response;
  }

  const response = redirect(safeNext(origin, url.searchParams.get("next")).toString());
  applyAuthCookies(response, input.sessionCookies(), input.secure);
  rememberSession(response, input.secure);
  return response;
}

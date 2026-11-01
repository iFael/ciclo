import { NextResponse } from "next/server";
import { LAST_SEEN_COOKIE } from "@/lib/security";

const MONTH = 30 * 24 * 60 * 60;

export type PendingCookie = {
  name: string;
  value: string;
  options?: {
    maxAge?: number;
    expires?: Date;
  };
};

export function applyAuthCookies(response: NextResponse, cookies: PendingCookie[], secure: boolean): void {
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      ...(typeof cookie.options?.maxAge === "number" ? { maxAge: cookie.options.maxAge } : {}),
      ...(cookie.options?.expires instanceof Date ? { expires: cookie.options.expires } : {}),
    });
  }
}

export function rememberSession(response: NextResponse, secure: boolean): void {
  response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: MONTH,
  });
}

export function forgetSession(response: NextResponse, secure: boolean): void {
  response.cookies.set(LAST_SEEN_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

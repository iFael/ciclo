import { describe, expect, it } from "vitest";
import { handleAuthCallback } from "@/lib/http/auth-callback";
import { handleVerifyCode } from "@/lib/http/verify-code";
import { LOGIN_COPY, loginErrorFromQuery, readMagicLinkResponse, readVerifyResponse } from "@/lib/login-feedback";
import type { PendingCookie } from "@/lib/http/cookies";

const ORIGIN = "https://ciclo-peach.vercel.app";

function cookiesOf(response: Response): string[] {
  return typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
}

describe("auth callback", () => {
  it("confirms token_hash without a code verifier and sets a host-only lax cookie", async () => {
    let exchanged = false;
    const response = await handleAuthCallback({
      requestUrl: `${ORIGIN}/auth/confirm?token_hash=abc&type=email&next=/`,
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [{ name: "sb-access-token", value: "session", options: { maxAge: 3600 } }],
      verifyTokenHash: async ({ token_hash, type }) => {
        expect(token_hash).toBe("abc");
        expect(type).toBe("email");
        return { email: "owner@example.com", error: null };
      },
      exchangeCode: async () => {
        exchanged = true;
        return { email: null, error: "invalid" };
      },
      signOut: async () => undefined,
    });
    expect(exchanged).toBe(false);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    const cookies = cookiesOf(response).join("\n");
    expect(cookies).toMatch(/ciclo_last_seen=/);
    expect(cookies.toLowerCase()).toContain("samesite=lax");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("Path=/");
    expect(cookies).toContain("HttpOnly");
    expect(cookies.toLowerCase()).not.toContain("domain=");
    expect(cookies).toContain("sb-access-token=session");
  });

  it("prefers token_hash over a pkce code when both are present", async () => {
    let exchanged = false;
    await handleAuthCallback({
      requestUrl: `${ORIGIN}/auth/callback?token_hash=abc&code=legacy&type=magiclink`,
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyTokenHash: async ({ type }) => {
        expect(type).toBe("magiclink");
        return { email: "owner@example.com", error: null };
      },
      exchangeCode: async () => {
        exchanged = true;
        return { email: "owner@example.com", error: null };
      },
      signOut: async () => undefined,
    });
    expect(exchanged).toBe(false);
  });

  it("falls back to the code exchange for the default email template", async () => {
    let verified = false;
    const response = await handleAuthCallback({
      requestUrl: `${ORIGIN}/auth/callback?code=legacy-code`,
      allowedEmail: "owner@example.com",
      secure: false,
      sessionCookies: () => [],
      verifyTokenHash: async () => {
        verified = true;
        return { email: null, error: "invalid" };
      },
      exchangeCode: async (code) => {
        expect(code).toBe("legacy-code");
        return { email: "owner@example.com", error: null };
      },
      signOut: async () => undefined,
    });
    expect(verified).toBe(false);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(cookiesOf(response).join("\n")).not.toContain("Secure");
    const external = await handleAuthCallback({
      requestUrl: `${ORIGIN}/auth/confirm?token_hash=abc&type=email&next=https://evil.example/phish`,
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyTokenHash: async () => ({ email: "owner@example.com", error: null }),
      exchangeCode: async () => ({ email: null, error: "invalid" }),
      signOut: async () => undefined,
    });
    expect(external.headers.get("location")).toBe(`${ORIGIN}/`);
  });

  it("signs out any other email and ignores an open redirect", async () => {
    let signedOut = false;
    const denied = await handleAuthCallback({
      requestUrl: `${ORIGIN}/auth/confirm?token_hash=abc&type=email&next=https://evil.example/phish`,
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyTokenHash: async () => ({ email: "other@example.com", error: null }),
      exchangeCode: async () => ({ email: null, error: "invalid" }),
      signOut: async () => {
        signedOut = true;
      },
    });
    expect(signedOut).toBe(true);
    expect(denied.headers.get("location")).toBe(`${ORIGIN}/login?erro=negado`);
    const missing = await handleAuthCallback({
      requestUrl: `${ORIGIN}/auth/confirm`,
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyTokenHash: async () => ({ email: null, error: "invalid" }),
      exchangeCode: async () => ({ email: null, error: "invalid" }),
      signOut: async () => undefined,
    });
    expect(missing.headers.get("location")).toBe(`${ORIGIN}/login?erro=link`);
  });
});

describe("verify code", () => {
  it("accepts the 6-digit code for the allowed email and rejects the rest", async () => {
    const calls: string[] = [];
    const ok = await handleVerifyCode(new Request("http://localhost/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email: "Owner@Example.com", token: "123 456" }) }), {
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: (): PendingCookie[] => [{ name: "sb-access-token", value: "session" }],
      verifyCode: async ({ email, token }) => {
        calls.push(`${email}:${token}`);
        return { email: "owner@example.com", error: null };
      },
      signOut: async () => undefined,
    });
    expect(ok.status).toBe(200);
    expect(calls).toEqual(["Owner@Example.com:123456"]);
    expect(cookiesOf(ok).join("\n")).toContain("ciclo_last_seen=");

    const denied = await handleVerifyCode(new Request("http://localhost/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email: "other@example.com", token: "123456" }) }), {
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyCode: async () => {
        throw new Error("should not verify");
      },
      signOut: async () => undefined,
    });
    expect(denied.status).toBe(403);

    const bad = await handleVerifyCode(new Request("http://localhost/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email: "owner@example.com", token: "000000" }) }), {
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyCode: async () => ({ email: null, error: "invalid", status: 403 }),
      signOut: async () => undefined,
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe(LOGIN_COPY.badCode);

    const limited = await handleVerifyCode(new Request("http://localhost/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email: "owner@example.com", token: "000000" }) }), {
      allowedEmail: "owner@example.com",
      secure: true,
      sessionCookies: () => [],
      verifyCode: async () => ({ email: null, error: "invalid", status: 429 }),
      signOut: async () => undefined,
    });
    expect(limited.status).toBe(429);
  });

  it("accepts a 6 to 10 digit email code, including the 8-digit supabase otp", async () => {
    const seen: string[] = [];
    const run = (token: string) =>
      handleVerifyCode(new Request("http://localhost/api/auth/verify-code", { method: "POST", body: JSON.stringify({ email: "owner@example.com", token }) }), {
        allowedEmail: "owner@example.com",
        secure: true,
        sessionCookies: () => [],
        verifyCode: async ({ token: code }) => {
          seen.push(code);
          return { email: "owner@example.com", error: null };
        },
        signOut: async () => undefined,
      });

    expect((await run("91355226")).status).toBe(200);
    expect((await run("123456")).status).toBe(200);
    expect((await run("1234567890")).status).toBe(200);
    expect((await run("9135 5226")).status).toBe(200);
    expect(seen).toEqual(["91355226", "123456", "1234567890", "91355226"]);

    const short = await run("12345");
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toBe(LOGIN_COPY.needCode);
    const long = await run("12345678901");
    expect(long.status).toBe(400);
    expect(((await long.json()) as { error: string }).error).toBe(LOGIN_COPY.needCode);
    expect(seen).toHaveLength(4);
  });
});

describe("login feedback", () => {
  it("turns denied, rate-limit, html and network-shaped responses into messages", async () => {
    expect(loginErrorFromQuery("negado")).toBe(LOGIN_COPY.denied);
    expect(loginErrorFromQuery("link")).toBe(LOGIN_COPY.linkExpired);
    const denied = await readMagicLinkResponse(Response.json({ error: LOGIN_COPY.denied }, { status: 403 }));
    const limited = await readMagicLinkResponse(Response.json({ error: LOGIN_COPY.rate }, { status: 429 }));
    const html = await readMagicLinkResponse(new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const ok = await readMagicLinkResponse(Response.json({ ok: true }));
    expect(denied).toEqual({ ok: false, message: LOGIN_COPY.denied });
    expect(limited).toEqual({ ok: false, message: LOGIN_COPY.rate });
    expect(html).toEqual({ ok: false, message: LOGIN_COPY.failed });
    expect(ok).toEqual({ ok: true });
    const badCode = await readVerifyResponse(Response.json({ error: LOGIN_COPY.badCode }, { status: 400 }));
    expect(badCode).toEqual({ ok: false, message: LOGIN_COPY.badCode });
  });
});

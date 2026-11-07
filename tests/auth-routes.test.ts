import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyOtp, exchangeCodeForSession, signOut } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { verifyOtp, exchangeCodeForSession, signOut },
  }),
}));

import { GET as callback } from "@/app/auth/callback/route";
import { GET as confirm } from "@/app/auth/confirm/route";
import { POST as verifyCode } from "@/app/api/auth/verify-code/route";

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  allowed: process.env.ALLOWED_EMAIL,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.ALLOWED_EMAIL = "owner@example.com";
  verifyOtp.mockReset();
  exchangeCodeForSession.mockReset();
  signOut.mockReset();
});

afterEach(() => {
  restore("NEXT_PUBLIC_SUPABASE_URL", saved.url);
  restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", saved.key);
  restore("ALLOWED_EMAIL", saved.allowed);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("confirm and callback routes", () => {
  it("verifies the email hash on /auth/confirm without a session cookie", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "owner@example.com" }, session: { access_token: "t" } }, error: null });
    const request = new NextRequest("https://ciclo-peach.vercel.app/auth/confirm?token_hash=hash-1&type=email");
    expect(request.cookies.getAll()).toEqual([]);
    const response = await confirm(request);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "email" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://ciclo-peach.vercel.app/");
    expect(response.headers.get("set-cookie") ?? "").toContain("recontei_last_seen");
  });

  it("keeps the code exchange on /auth/callback for the default template", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { email: "owner@example.com" } }, error: null });
    const response = await callback(new NextRequest("https://ciclo-peach.vercel.app/auth/callback?code=pkce-code"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://ciclo-peach.vercel.app/");
  });

  it("signs out a confirmed session that is not the allowed address", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "other@example.com" } }, error: null });
    const response = await confirm(new NextRequest("https://ciclo-peach.vercel.app/auth/confirm?token_hash=hash-2&type=email"));
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(response.headers.get("location")).toContain("/login?erro=negado");
  });
});

describe("verify-code route", () => {
  it("calls verifyOtp with type email", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "owner@example.com" }, session: {} }, error: null });
    const response = await verifyCode(
      new NextRequest("https://ciclo-peach.vercel.app/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email: "owner@example.com", token: "654321" }),
      }),
    );
    expect(verifyOtp).toHaveBeenCalledWith({ email: "owner@example.com", token: "654321", type: "email" });
    expect(response.status).toBe(200);
  });

  it("forwards an 8-digit code and rejects a 5-digit code before verifyOtp", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { email: "owner@example.com" }, session: {} }, error: null });
    const ok = await verifyCode(
      new NextRequest("https://ciclo-peach.vercel.app/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email: "owner@example.com", token: "91355226" }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(verifyOtp).toHaveBeenCalledWith({ email: "owner@example.com", token: "91355226", type: "email" });

    verifyOtp.mockClear();
    const bad = await verifyCode(
      new NextRequest("https://ciclo-peach.vercel.app/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email: "owner@example.com", token: "12345" }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("Digite o código do e-mail.");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

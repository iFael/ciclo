import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isPublicPath, proxy } from "@/proxy";

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  e2e: process.env.CICLO_E2E,
};

afterEach(() => {
  restore("NEXT_PUBLIC_SUPABASE_URL", saved.url);
  restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", saved.key);
  restore("NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.anon);
  restore("CICLO_E2E", saved.e2e);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function unsigned() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.CICLO_E2E;
}

async function statusOf(url: string, method = "GET") {
  const response = await proxy(new NextRequest(url, { method }));
  return { status: response.status, location: response.headers.get("location") };
}

describe("proxy", () => {
  it("lets an unsigned session request a magic link and a code", async () => {
    unsigned();
    expect(isPublicPath("/api/auth/magic-link")).toBe(true);
    expect(isPublicPath("/api/auth/verify-code")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    const link = await statusOf("http://localhost:3000/api/auth/magic-link", "POST");
    const code = await statusOf("http://localhost:3000/api/auth/verify-code", "POST");
    expect(link.status).not.toBe(307);
    expect(link.location).toBeNull();
    expect(code.status).not.toBe(307);
    expect(code.location).toBeNull();
  });

  it("still sends signed-out visitors from / to /login and keeps health public", async () => {
    unsigned();
    const home = await statusOf("http://localhost:3000/");
    const plans = await statusOf("http://localhost:3000/api/plans");
    const logout = await statusOf("http://localhost:3000/api/auth/logout", "POST");
    const health = await statusOf("http://localhost:3000/api/health");
    const login = await statusOf("http://localhost:3000/login");
    expect(home.status).toBe(307);
    expect(home.location).toBe("http://localhost:3000/login");
    expect(plans.status).toBe(307);
    expect(logout.status).toBe(307);
    expect(health.status).not.toBe(307);
    expect(login.status).not.toBe(307);
  });

  it("serves the install assets without a session", async () => {
    unsigned();
    for (const path of ["/manifest.webmanifest", "/sw.js", "/offline.html", "/apple-touch-icon.png", "/icons/icon-192.png"]) {
      const response = await statusOf(`http://localhost:3000${path}`);
      expect(response.status, path).not.toBe(307);
      expect(response.location, path).toBeNull();
    }
  });
});

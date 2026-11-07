import { NextResponse } from "next/server";
import { canSendMagicLink } from "@/lib/env";
import { applyAuthCookies, forgetSession, rememberSession, type PendingCookie } from "@/lib/http/cookies";
import { EMAIL_CODE_PATTERN, LOGIN_COPY } from "@/lib/login-feedback";

export type CodeResult = { email: string | null; error: "invalid" | "config" | null; status?: number };

function json(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function handleVerifyCode(
  request: Request,
  input: {
    allowedEmail: string | undefined;
    secure: boolean;
    sessionCookies: () => PendingCookie[];
    verifyCode: (args: { email: string; token: string }) => Promise<CodeResult>;
    signOut: () => Promise<void>;
  },
): Promise<NextResponse> {
  let email = "";
  let token = "";
  try {
    const body = (await request.json()) as { email?: string; token?: string };
    email = (body.email ?? "").trim();
    token = (body.token ?? "").replace(/\s+/g, "");
  } catch {
    return json({ error: "Informe o código." }, 400);
  }
  if (!EMAIL_CODE_PATTERN.test(token)) return json({ error: LOGIN_COPY.needCode }, 400);

  const decision = canSendMagicLink(email, input.allowedEmail);
  if (decision === "missing-config") return json({ error: "Configuração incompleta: ALLOWED_EMAIL" }, 503);
  if (decision === "denied") return json({ error: "Este e-mail não pode entrar no Recontei." }, 403);

  const result = await input.verifyCode({ email, token });
  if (result.status === 429) return json({ error: "Muitas tentativas. Espere um pouco e tente de novo." }, 429);
  if (result.error === "config") return json({ error: "Configuração incompleta no servidor." }, 503);
  if (result.error || !result.email) return json({ error: "Código inválido ou expirado." }, 400);

  const allowed = input.allowedEmail?.trim().toLowerCase();
  if (!allowed || result.email.toLowerCase() !== allowed) {
    await input.signOut();
    const response = json({ error: "Este e-mail não pode entrar no Recontei." }, 403);
    applyAuthCookies(response, input.sessionCookies(), input.secure);
    forgetSession(response, input.secure);
    return response;
  }

  const response = json({ ok: true }, 200);
  applyAuthCookies(response, input.sessionCookies(), input.secure);
  rememberSession(response, input.secure);
  return response;
}

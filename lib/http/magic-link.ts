import { canSendMagicLink } from "@/lib/env";
import { ConfigError } from "@/lib/security";

export async function handleMagicLink(
  request: Request,
  input: { allowedEmail: string | undefined; redirectTo: string; send: (email: string, redirectTo: string) => Promise<void> },
): Promise<Response> {
  let email = "";
  try {
    const body = (await request.json()) as { email?: string };
    email = body.email ?? "";
  } catch {
    return Response.json({ error: "Informe um e-mail." }, { status: 400 });
  }
  const decision = canSendMagicLink(email, input.allowedEmail);
  if (decision === "missing-config") {
    return Response.json({ error: "Configuração incompleta: ALLOWED_EMAIL" }, { status: 503 });
  }
  if (decision === "denied") {
    return Response.json({ error: "Este e-mail não pode entrar no Ciclo." }, { status: 403 });
  }
  try {
    await input.send(email.trim(), input.redirectTo);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : "Não foi possível enviar o link.";
    return Response.json({ error: message }, { status: 503 });
  }
}

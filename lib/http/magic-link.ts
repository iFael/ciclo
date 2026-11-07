import { canSendMagicLink } from "@/lib/env";
import { HttpFailure } from "@/lib/http/failure";
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
    return Response.json({ error: "Este e-mail não pode entrar no Recontei." }, { status: 403 });
  }
  try {
    await input.send(email.trim(), input.redirectTo);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    if (error instanceof HttpFailure && error.status === 429) {
      return Response.json({ error: "Muitas tentativas. Espere um pouco e tente de novo." }, { status: 429 });
    }
    return Response.json({ error: "Não foi possível enviar o link." }, { status: 503 });
  }
}

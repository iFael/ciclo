export const LOGIN_COPY = {
  sent: "Enviamos um link de acesso.",
  checkEmail: "Confira seu e-mail",
  denied: "Este e-mail não pode entrar no Recontei.",
  rate: "Muitas tentativas. Espere um pouco e tente de novo.",
  failed: "Não foi possível enviar o link.",
  offline: "Sem conexão. Tente de novo.",
  badCode: "Código inválido ou expirado.",
  needCode: "Digite o código do e-mail.",
  codeFailed: "Não foi possível confirmar o código.",
  linkExpired: "Esse link expirou ou não é válido. Peça outro.",
  config: "Configuração incompleta no servidor.",
} as const;

/** Supabase email OTPs are 8 digits today and have also been 6. Accept the whole range. */
export const EMAIL_CODE_PATTERN = /^\d{6,10}$/;

const QUERY_ERRORS: Record<string, string> = {
  link: LOGIN_COPY.linkExpired,
  negado: LOGIN_COPY.denied,
  config: LOGIN_COPY.config,
};

export function loginErrorFromQuery(code: string | undefined): string {
  if (!code) return "";
  return QUERY_ERRORS[code] ?? "";
}

async function readBody(response: Response): Promise<{ error?: string } | null> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return null;
  }
}

export async function readMagicLinkResponse(response: Response): Promise<{ ok: true } | { ok: false; message: string }> {
  const body = await readBody(response);
  if (body === null) return { ok: false, message: LOGIN_COPY.failed };
  if (response.ok) return { ok: true };
  if (response.status === 429) return { ok: false, message: body.error || LOGIN_COPY.rate };
  if (body.error) return { ok: false, message: body.error };
  return { ok: false, message: LOGIN_COPY.failed };
}

export async function readVerifyResponse(response: Response): Promise<{ ok: true } | { ok: false; message: string }> {
  const body = await readBody(response);
  if (body === null) return { ok: false, message: LOGIN_COPY.codeFailed };
  if (response.ok) return { ok: true };
  if (response.status === 429) return { ok: false, message: body.error || LOGIN_COPY.rate };
  if (body.error) return { ok: false, message: body.error };
  return { ok: false, message: LOGIN_COPY.badCode };
}

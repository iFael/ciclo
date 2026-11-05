import { z } from "zod";
import { sendMail } from "@/lib/email";
import { factsBridgeAuthorized } from "@/lib/facts-bridge";
import { safeLog } from "@/lib/security";

const notificationSchema = z.object({
  kind: z.enum(["bank_event", "bank_review", "bank_insight"]),
  amountCents: z.number().int().positive(),
  previousCents: z.number().int().nonnegative().optional(),
  categoryLabel: z.string().trim().min(1).max(80).optional(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(["outgoing", "incoming"]),
  counterparty: z.string().trim().min(1).max(200).nullable(),
  description: z.string().trim().min(1).max(1000),
  institution: z.string().trim().min(1).max(160).nullable().optional(),
  classification: z.enum(["pensao", "adicional", "reembolso", "noah_expense"]).nullable().optional(),
  reason: z.string().trim().min(1).max(300).nullable().optional(),
  reviewUrl: z.string().url().nullable().optional(),
});

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export async function handleFactsNotification(request: Request): Promise<Response> {
  const secret = process.env.FACTS_FEED_TOKEN;
  if (!secret) return Response.json({ error: "notify_unconfigured" }, { status: 503 });
  if (!factsBridgeAuthorized(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = notificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_notification" }, { status: 400 });

  const value = parsed.data;
  if (value.kind === "bank_insight") {
    if (value.previousCents === undefined || !value.categoryLabel || !value.periodMonth) {
      return Response.json({ error: "invalid_insight" }, { status: 400 });
    }
    const percent = value.previousCents > 0
      ? Math.round((value.amountCents - value.previousCents) / value.previousCents * 100) : 0;
    const text = [
      "Facts — alerta de gastos relacionados ao Noah",
      "",
      "Categoria: " + value.categoryLabel,
      "Mês: " + value.periodMonth,
      "Mês anterior: " + money(value.previousCents),
      "Mês analisado: " + money(value.amountCents),
      "Aumento: " + String(percent) + "%",
      "",
      "O alerta considera apenas despesas confirmadas, nunca compras bancárias ainda não classificadas.",
      "Veja os detalhes em: https://facts-app-nu.vercel.app/?bank=1",
    ].join("\n");
    try {
      const sent = await sendMail({
        subject: "Facts — alerta de aumento em " + value.categoryLabel,
        text,
      });
      if (!sent.sent) return Response.json({ error: "email_unconfigured" }, { status: 503 });
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: "email_failed" }, { status: 502 });
    }
  }
  const direction = value.direction === "outgoing" ? "enviada" : "recebida";
  const counterparty = value.counterparty ?? "Contraparte não identificada";
  const classification = value.classification
    ? ({ pensao: "Pensão", adicional: "Adicional", reembolso: "Reembolso", noah_expense: "Gasto do Noah" } as const)[value.classification]
    : null;

  const lines = [
    `Uma movimentação bancária relacionada ao Facts foi detectada.`,
    "",
    `Valor: ${money(value.amountCents)}`,
    `Data: ${value.occurredAt.split("-").reverse().join("/")}`,
    `Movimentação: ${direction}`,
    `Contraparte: ${counterparty}`,
    value.institution ? `Instituição: ${value.institution}` : null,
    classification ? `Classificação: ${classification}` : null,
    `Descrição: ${value.description}`,
    value.reason ? `Atenção: ${value.reason}` : null,
    value.reviewUrl ? "" : null,
    value.reviewUrl ? `Revisar no Facts: ${value.reviewUrl}` : null,
  ].filter((line): line is string => line !== null);

  const subject = value.kind === "bank_review"
    ? `Facts — confirmação necessária: ${money(value.amountCents)}`
    : `Facts — movimentação detectada: ${money(value.amountCents)}`;

  try {
    const result = await sendMail({ subject, text: lines.join("\n") });
    if (!result.sent) return Response.json({ error: "email_unconfigured" }, { status: 503 });
    return Response.json({ ok: true });
  } catch {
    console.info(JSON.stringify(safeLog({ count: 1, status: "facts-email", errorCode: "facts_email_failed" })));
    return Response.json({ error: "email_failed" }, { status: 502 });
  }
}

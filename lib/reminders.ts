import { diffDays, isoWeekKey, monthKey, todayInSaoPaulo } from "@/lib/dates";
import { formatBrl, formatDayMonth } from "@/lib/format";
import { renderSummaryHtml } from "@/lib/email-layout";
import { buildScreen } from "@/lib/screen";
import type { AppState } from "@/lib/types";

export type OutboundMail = {
  key: string;
  kind: string;
  subject: string;
  text: string;
  html?: string;
};

const RENEW = "Renove no Dashboard da Pluggy: https://dashboard.pluggy.ai";

type Model = ReturnType<typeof buildScreen>;

function summaryFrom(model: Model): { subject: string; text: string; html: string } {
  const lines = ["Resumo semanal do Ciclo", ""];
  if (model.cards.length === 0) lines.push("Nenhuma assinatura confirmada.");
  for (const card of model.cards) lines.push(`${card.planName} — ${card.priceLabel} — ${card.nextChargeLabel}`);
  lines.push("", `Total: ${formatBrl(model.monthlyTotal)}/mês (${model.annualLabel})`);
  const html = renderSummaryHtml({
    title: "Seu resumo semanal",
    intro: "Aqui estão as assinaturas que o Ciclo acompanha e quanto elas somam por mês.",
    rows: model.cards,
    monthlyTotal: model.monthlyTotal,
    annualLabel: model.annualLabel,
  });
  return { subject: "Ciclo — resumo semanal", text: lines.join("\n"), html };
}

/** The weekly summary as it is now, for the "Enviar resumo por e-mail" menu item. */
export function weeklySummary(state: AppState, now = new Date()): { subject: string; text: string; html: string } {
  return summaryFrom(buildScreen(state, now));
}

export function planReminders(state: AppState, sent: Set<string>, now = new Date()): OutboundMail[] {
  const today = todayInSaoPaulo(now);
  const model = buildScreen(state, now);
  const messages: OutboundMail[] = [];

  const weekKey = `weekly:${isoWeekKey(today)}`;
  if (!sent.has(weekKey)) messages.push({ key: weekKey, kind: "weekly", ...summaryFrom(model) });

  const month = `monthly:${monthKey(today)}`;
  if (!sent.has(month)) {
    const lines = ["Resumo mensal do Ciclo", ""];
    if (model.cards.length === 0) lines.push("Nenhuma assinatura confirmada.");
    for (const card of model.cards) lines.push(`${card.planName} — ${card.priceLabel} — ${card.nextChargeLabel}`);
    lines.push("", `Total: ${formatBrl(model.monthlyTotal)}/mês (${model.annualLabel})`);
    const html = renderSummaryHtml({
      title: "Seu resumo do mês",
      intro: "Aqui estão as assinaturas que o Ciclo acompanha e quanto elas somam por mês.",
      rows: model.cards,
      monthlyTotal: model.monthlyTotal,
      annualLabel: model.annualLabel,
    });
    messages.push({ key: month, kind: "monthly", subject: "Ciclo — resumo mensal", text: lines.join("\n"), html });
  }

  for (const subscription of state.subscriptions) {
    if (subscription.status !== "confirmed" || !subscription.expectedChargeDate) continue;
    if (diffDays(today, subscription.expectedChargeDate) !== 3) continue;
    const key = `charge:${subscription.id}:${subscription.expectedChargeDate}`;
    if (sent.has(key)) continue;
    messages.push({
      key,
      kind: "charge",
      subject: "Ciclo — cobrança em 3 dias",
      text: `Sua cobrança de ${subscription.planName} está prevista para ${formatDayMonth(subscription.expectedChargeDate)}.`,
    });
  }

  for (const connection of state.connections) {
    if (connection.status === "active" && connection.consentExpiresAt) {
      const days = diffDays(today, connection.consentExpiresAt.slice(0, 10));
      if (days >= 0 && days <= 30 && days > 7) {
        const key = `renew30:${connection.id}`;
        if (!sent.has(key)) {
          messages.push({
            key,
            kind: "renew30",
            subject: "Ciclo — conexão vence em 30 dias",
            text: `A conexão com o banco vence em ${days} dias. ${RENEW}`,
          });
        }
      }
      if (days >= 0 && days <= 7) {
        const key = `renew7:${connection.id}`;
        if (!sent.has(key)) {
          messages.push({
            key,
            kind: "renew7",
            subject: "Ciclo — conexão vence em 7 dias",
            text: `A conexão com o banco vence em ${days} dias. ${RENEW}`,
          });
        }
      }
    }
    if (connection.status === "error" && connection.lastErrorCode === "LOGIN_ERROR") {
      const key = `login:${connection.id}`;
      if (!sent.has(key)) {
        messages.push({
          key,
          kind: "login_error",
          subject: "Ciclo — não foi possível atualizar",
          text: `Não conseguimos atualizar suas assinaturas (LOGIN_ERROR). ${RENEW}`,
        });
      }
    }
    if (connection.status === "expired") {
      const replaced = state.connections.some(
        (other) =>
          other.itemId !== connection.itemId &&
          other.connectorId &&
          other.connectorId === connection.connectorId &&
          other.status === "active",
      );
      if (!replaced) {
        const key = `expired:${connection.id}`;
        if (!sent.has(key)) {
          messages.push({
            key,
            kind: "expired",
            subject: "Ciclo — conexão vencida",
            text: `Conexão vencida e nenhum item novo. Seus planos continuam como estavam. ${RENEW}`,
          });
        }
      }
    }
  }
  return messages;
}

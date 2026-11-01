import { APPLE_CHOICES, serviceInfo } from "@/lib/catalog";
import { diffDays, todayInSaoPaulo } from "@/lib/dates";
import { daysPhrase, formatBrl, formatDayMonth, formatDayMonthYear, lastSyncAgeHours, round2 } from "@/lib/format";
import type { AppState, Connection, ScreenBanner, ScreenModel, Subscription } from "@/lib/types";

const STATUS_LABEL: Record<Connection["status"], string> = {
  active: "Ativa",
  expired: "Vencida",
  replaced: "Substituída",
  error: "Com erro",
};

function newestSync(connections: Connection[]): string | null {
  const times = connections.map((connection) => connection.lastSyncedAt).filter((value): value is string => !!value);
  times.sort();
  return times.at(-1) ?? null;
}

function priceLabel(amount: number, approximate: boolean): string {
  return `${approximate ? "≈ " : ""}${formatBrl(amount)}/mês`;
}

function nextChargeLabel(date: string, today: string): string {
  return `Próxima cobrança: ${formatDayMonth(date)}, ${daysPhrase(diffDays(today, date))}`;
}

function companyOf(subscription: Subscription): string {
  return serviceInfo(subscription.service)?.company ?? "o provedor";
}

export function confirmedMonthlyTotal(state: AppState): number {
  const total = state.subscriptions
    .filter((subscription) => subscription.status === "confirmed")
    .reduce((sum, subscription) => sum + subscription.amount, 0);
  return round2(total);
}

function cancelBanner(subscription: Subscription, state: AppState, today: string): ScreenBanner | null {
  if (subscription.status !== "confirmed" || !subscription.expectedChargeDate) return null;
  if (subscription.cancelPromptSnoozeDate === subscription.expectedChargeDate) return null;
  if (diffDays(subscription.expectedChargeDate, today) < 7) return null;
  const paid = state.charges.some(
    (charge) => charge.subscriptionId === subscription.id && charge.chargeDate >= subscription.expectedChargeDate!,
  );
  if (paid) return null;
  const active = state.connections.some(
    (connection) =>
      connection.status === "active" &&
      connection.lastSyncHadData &&
      connection.lastDataThrough !== null &&
      connection.lastDataThrough > subscription.expectedChargeDate!,
  );
  if (!active) return null;
  return {
    id: `cancel:${subscription.id}`,
    tone: "neutral",
    text: `Parece cancelada? ${subscription.planName}`,
    actions: [
      { id: "yes", label: "Sim", action: "cancelled", targetId: subscription.id },
      { id: "still", label: "Ainda pago", action: "still-paying", targetId: subscription.id },
    ],
  };
}

export function buildScreen(state: AppState, now = new Date()): ScreenModel {
  const today = todayInSaoPaulo(now);
  const syncedAt = newestSync(state.connections);
  const age = lastSyncAgeHours(syncedAt, now);
  const firstRead = state.connections.every((connection) => !connection.lastSyncedAt);
  const cards = state.subscriptions
    .filter((subscription) => subscription.status === "confirmed")
    .map((subscription) => {
      const info = serviceInfo(subscription.service);
      const company = companyOf(subscription);
      return {
        id: subscription.id,
        service: subscription.service,
        planName: subscription.planName,
        company,
        priceLabel: priceLabel(subscription.amount, subscription.approximate),
        nextChargeLabel: subscription.expectedChargeDate
          ? nextChargeLabel(subscription.expectedChargeDate, today)
          : "Próxima cobrança: sem data",
        manageUrl: info?.manageUrl ?? null,
        manageLabel: info ? `Gerenciar ${subscription.planName} no site da ${company}, abre em nova aba` : "",
        removeConfirm: `Isso não cancela sua assinatura na ${company}. Para parar de pagar, use Gerenciar.`,
        autoConfirmed: subscription.autoConfirmed,
        notice: subscription.planChangeNotice,
        sortDate: subscription.expectedChargeDate ?? "9999-99-99",
      };
    })
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .map(({ sortDate: _sortDate, ...card }) => card);

  const suggestions = state.subscriptions
    .filter((subscription) => subscription.status === "suggested")
    .map((subscription) => ({
      id: subscription.id,
      planName: subscription.planName,
      label: subscription.suggestionLabel,
      checked: subscription.checked,
      priceLabel: priceLabel(subscription.amount, subscription.approximate),
      apple: subscription.service === "apple",
    }));

  const banners: ScreenBanner[] = [];
  for (const connection of state.connections) {
    if (connection.status !== "expired" && connection.status !== "error") continue;
    const until = connection.lastDataThrough ? ` Dados até ${formatDayMonth(connection.lastDataThrough)}.` : "";
    banners.push({
      id: `conn:${connection.id}`,
      tone: "red",
      text: connection.status === "expired" ? `Conexão vencida.${until}` : `Conexão com erro.${until}`,
      actions: [
        {
          id: "renew",
          label: "Renovar no Dashboard da Pluggy",
          href: "https://dashboard.pluggy.ai",
        },
      ],
    });
  }
  for (const connection of state.connections) {
    if (connection.status !== "active" || !connection.consentExpiresAt) continue;
    const expiresOn = connection.consentExpiresAt.slice(0, 10);
    const days = diffDays(today, expiresOn);
    if (days >= 0 && days <= 30) {
      banners.push({
        id: `renew:${connection.id}`,
        tone: "yellow",
        text: `A conexão vence em ${days} dias.`,
        actions: [
          {
            id: "renew",
            label: "Renovar no Dashboard da Pluggy",
            href: "https://dashboard.pluggy.ai",
          },
        ],
      });
    }
  }
  if (!firstRead && age !== null && age > 48) {
    banners.push({ id: "stale", tone: "yellow", text: "Atualizado há mais de 48 h", actions: [] });
  }
  if (suggestions.length > 0) {
    const noun = suggestions.length === 1 ? "possível assinatura" : "possíveis assinaturas";
    banners.push({
      id: "suggestions",
      tone: "neutral",
      text: `Encontramos ${suggestions.length} ${noun}`,
      actions: [],
    });
  }
  for (const subscription of state.subscriptions) {
    const banner = cancelBanner(subscription, state, today);
    if (banner) banners.push(banner);
    if (subscription.status !== "dismissed" || !subscription.dismissedAt) continue;
    const dismissedOn = subscription.dismissedAt.slice(0, 10);
    for (const charge of state.charges) {
      if (charge.subscriptionId !== subscription.id || charge.resolved || charge.chargeDate <= dismissedOn) continue;
      banners.push({
        id: `still:${subscription.id}:${charge.chargeDate}`,
        tone: "neutral",
        text: `Ainda cobrando: ${subscription.planName} em ${formatDayMonth(charge.chargeDate)}`,
        actions: [
          { id: "back", label: "Voltar a acompanhar", action: "restore-charging", targetId: subscription.id },
          { id: "ignore", label: "Ignorar", action: "ignore-charging", targetId: subscription.id },
        ],
      });
    }
  }

  const toneRank = { red: 0, yellow: 1, neutral: 2 };
  banners.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  const monthlyTotal = confirmedMonthlyTotal(state);
  const annualApprox = round2(monthlyTotal * 12);
  return {
    monthlyLabel: `${formatBrl(monthlyTotal)}/mês`,
    annualLabel: `≈ ${formatBrl(annualApprox)}/ano`,
    monthlyTotal,
    annualApprox,
    cards,
    suggestions,
    banners,
    footer: firstRead || age === null ? "Ainda sem leitura" : age < 1 ? "Atualizado há menos de 1 h" : `Atualizado há ${Math.floor(age)} h`,
    firstRead,
    empty: !firstRead && cards.length === 0 && suggestions.length === 0,
    connections: state.connections.map((connection) => ({
      institution: connection.institution ?? "Conexão",
      statusLabel: STATUS_LABEL[connection.status],
      expiresLabel: connection.consentExpiresAt
        ? formatDayMonthYear(connection.consentExpiresAt.slice(0, 10))
        : "Sem data de vencimento",
    })),
    appleChoices: APPLE_CHOICES,
  };
}

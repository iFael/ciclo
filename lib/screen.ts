import { isShadowed } from "@/lib/actions";
import { cadenceOf, chargeDates, isStaleCharge, lastChargeLabel } from "@/lib/charges";
import { appleChoices, serviceInfo } from "@/lib/catalog";
import { diffDays, todayInSaoPaulo } from "@/lib/dates";
import { formatBrl, formatDayMonth, formatDayMonthYear, lastSyncAgeHours, round2 } from "@/lib/format";
import { withLearned } from "@/lib/confidence";
import { feedbackFrom, learnedAdjustment } from "@/lib/learning";
import { classifyDescriptor, scoreStoredCharges } from "@/lib/matching";
import { newestSyncedAt } from "@/lib/sync-policy";
import type { AppState, Connection, ScreenBanner, ScreenModel, ServiceLogo, Subscription } from "@/lib/types";

const STATUS_LABEL: Record<Connection["status"], string> = {
  active: "Ativa",
  expired: "Vencida",
  replaced: "Substituída",
  error: "Com erro",
};

function priceLabel(amount: number, approximate: boolean): string {
  return `${approximate ? "≈ " : ""}${formatBrl(amount)}/mês`;
}

/** The plan's service, or the catalog service its statement text now matches. */
function serviceOf(subscription: Subscription): string {
  if (subscription.service !== "unknown") return subscription.service;
  for (const descriptor of subscription.descriptors) {
    const found = classifyDescriptor(descriptor);
    if (found) return found;
  }
  return "unknown";
}

function companyOf(subscription: Subscription): string {
  return serviceInfo(serviceOf(subscription))?.company ?? "o provedor";
}

export function confirmedMonthlyTotal(state: AppState): number {
  const total = state.subscriptions
    .filter((subscription) => subscription.status === "confirmed")
    .reduce((sum, subscription) => sum + subscription.amount, 0);
  return round2(total);
}

function anchorDate(subscription: Subscription, state: AppState, today: string): string | null {
  // An installment the bank lists ahead of time is not a charge yet.
  const last = chargeDates(state, subscription.id).filter((date) => date <= today).at(-1) ?? null;
  if (last) return last;
  if (subscription.expectedChargeDate && diffDays(subscription.expectedChargeDate, today) >= 0) return subscription.expectedChargeDate;
  return null;
}

function logoOf(subscription: Subscription, logos?: Map<string, ServiceLogo>): { logoUrl: string | null; logoFallback: boolean } {
  const hit = logos?.get(subscription.merchantKey);
  if (hit) {
    if (hit.status === "ok" && hit.logoUrl) return { logoUrl: hit.logoUrl, logoFallback: false };
    return { logoUrl: null, logoFallback: true };
  }
  const service = serviceOf(subscription);
  const info = serviceInfo(service);
  if (info?.logo && service !== "unknown") return { logoUrl: info.logo, logoFallback: false };
  return { logoUrl: null, logoFallback: true };
}

/**
 * A confirmed plan is inactive when its last charge is past the grace window
 * and the bank kept sending newer data, so the missing charge is real.
 * "Ainda pago" snoozes this for that last charge. A new charge makes it
 * active again with no action from the user.
 */
export function isInactive(subscription: Subscription, state: AppState, today: string): boolean {
  if (subscription.status !== "confirmed") return false;
  const last = anchorDate(subscription, state, today);
  if (!last) return false;
  if (subscription.cancelPromptSnoozeDate === last) return false;
  const dates = chargeDates(state, subscription.id);
  const cadence = cadenceOf(dates.length ? dates : [last]);
  if (!isStaleCharge(last, today, cadence)) return false;
  return state.connections.some(
    (connection) =>
      connection.status === "active" &&
      connection.lastSyncHadData &&
      connection.lastDataThrough !== null &&
      connection.lastDataThrough > last,
  );
}

export function activeMonthlyTotal(state: AppState, today: string): number {
  const total = state.subscriptions
    .filter((subscription) => subscription.status === "confirmed" && !isInactive(subscription, state, today))
    .reduce((sum, subscription) => sum + subscription.amount, 0);
  return round2(total);
}

export function buildScreen(state: AppState, now = new Date(), logos?: Map<string, ServiceLogo>): ScreenModel {
  const today = todayInSaoPaulo(now);
  const syncedAt = newestSyncedAt(state.connections);
  const age = lastSyncAgeHours(syncedAt, now);
  const firstRead = state.connections.every((connection) => !connection.lastSyncedAt);
  const allCards = state.subscriptions
    .filter((subscription) => subscription.status === "confirmed")
    .map((subscription) => {
      const inactive = isInactive(subscription, state, today);
      const info = serviceInfo(serviceOf(subscription));
      const company = companyOf(subscription);
      const dates = chargeDates(state, subscription.id);
      const last = anchorDate(subscription, state, today);
      const cadence = cadenceOf(dates.length ? dates : last ? [last] : []);
      const logo = logoOf(subscription, logos);
      return {
        id: subscription.id,
        service: subscription.service,
        planName: subscription.planName,
        company,
        priceLabel: priceLabel(subscription.amount, subscription.approximate),
        nextChargeLabel: lastChargeLabel(last, today, cadence),
        manageUrl: info?.manageUrl ?? null,
        manageLabel: info ? `Gerenciar ${subscription.planName} no site da ${company}, abre em nova aba` : "",
        removeConfirm: `Isso não cancela sua assinatura na ${company}. Para parar de pagar, use Gerenciar.`,
        autoConfirmed: subscription.autoConfirmed,
        notice: subscription.planChangeNotice,
        logoUrl: logo.logoUrl,
        logoFallback: logo.logoFallback,
        inactiveLabel: inactive && last ? `Sem cobrança desde ${formatDayMonth(last)}` : null,
        sortDate: last ?? "9999-99-99",
      };
    })
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate))
    .map(({ sortDate: _sortDate, ...card }) => card);
  const cards = allCards.filter((card) => !card.inactiveLabel);
  const inactiveCards = allCards.filter((card) => card.inactiveLabel);
  const feedback = feedbackFrom(state);

  const suggestions = state.subscriptions
    .filter((subscription) => subscription.status === "suggested" && !isShadowed(subscription, state.subscriptions))
    .map((subscription) => {
      const charges = state.charges
        .filter((charge) => charge.subscriptionId === subscription.id)
        .map((charge) => ({ chargeDate: charge.chargeDate, amount: charge.amount }));
      const confidence = withLearned(
        scoreStoredCharges({
          charges,
          today,
          service: subscription.service,
          planName: subscription.planName,
        }),
        learnedAdjustment(subscription.descriptors.length ? subscription.descriptors : [subscription.planName], feedback),
      );
      const logo = logoOf(subscription, logos);
      return {
        id: subscription.id,
        planName: subscription.planName,
        label: subscription.suggestionLabel,
        checked: subscription.checked,
        priceLabel: priceLabel(subscription.amount, subscription.approximate),
        apple: subscription.service === "apple",
        logoUrl: logo.logoUrl,
        logoFallback: logo.logoFallback,
        confidence: {
          score: confidence.score,
          label: confidence.label,
          checks: confidence.checks.map((check) => ({
            id: check.id,
            label: check.label,
            detail: check.detail,
            passed: check.passed,
          })),
        },
        sortScore: confidence.score,
      };
    })
    .sort((a, b) => b.sortScore - a.sortScore || a.planName.localeCompare(b.planName, "pt-BR"))
    .map(({ sortScore: _sortScore, ...suggestion }) => suggestion);

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

  const monthlyTotal = activeMonthlyTotal(state, today);
  const annualApprox = round2(monthlyTotal * 12);
  return {
    monthlyLabel: `${formatBrl(monthlyTotal)}/mês`,
    annualLabel: `≈ ${formatBrl(annualApprox)}/ano`,
    monthlyTotal,
    annualApprox,
    cards,
    inactiveCards,
    suggestions,
    banners,
    footer: firstRead || age === null ? "Ainda sem leitura" : age < 1 ? "Atualizado há menos de 1 h" : `Atualizado há ${Math.floor(age)} h`,
    syncedAt,
    firstRead,
    empty: !firstRead && cards.length === 0 && inactiveCards.length === 0 && suggestions.length === 0,
    connections: state.connections.map((connection) => ({
      institution: connection.institution ?? "Conexão",
      statusLabel: STATUS_LABEL[connection.status],
      expiresLabel: connection.consentExpiresAt
        ? formatDayMonthYear(connection.consentExpiresAt.slice(0, 10))
        : "Sem data de vencimento",
    })),
    appleChoices: appleChoices(),
  };
}

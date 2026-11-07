"use client";

import { Bell, CalendarDays, ChartNoAxesColumn, Layers3, Sparkles, RefreshCcw } from "lucide-react";
import { formatBrl, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpendingMonth, SpendingTrend } from "@/lib/insights";

export type ReconteiCard = {
  id: string;
  planName: string;
  priceLabel: string;
  nextChargeLabel: string;
  monthlyAmount?: number;
  upcomingChargeDate?: string | null;
  logoUrl?: string | null;
};

export type ReconteiModel = {
  monthlyLabel: string;
  annualLabel: string;
  cards: ReconteiCard[];
  suggestions: { id: string; priceLabel: string }[];
  spendingHistory?: SpendingMonth[];
  spendingTrend?: SpendingTrend | null;
};

export type ReconteiSection = "assinaturas" | "gastos" | "cobrancas" | "economia";

const NAV = [
  { id: "assinaturas", label: "Assinaturas", icon: RefreshCcw },
  { id: "gastos", label: "Gastos", icon: ChartNoAxesColumn },
  { id: "cobrancas", label: "Cobranças", icon: Bell },
  { id: "economia", label: "Economia", icon: Sparkles },
] as const;

export function ReconteiNavigation({
  section, onChange, mobile = false,
}: { section: ReconteiSection; onChange: (section: ReconteiSection) => void; mobile?: boolean }) {
  return (
    <nav aria-label="Navegação principal" data-testid={mobile ? "recontei-bottom-nav" : "recontei-nav"}
      className={cn(
        "grid grid-cols-4 border border-[#a48453]/25 bg-[#141314]/95 p-1.5 backdrop-blur-xl",
        mobile
          ? "fixed inset-x-3 bottom-[calc(0.65rem+env(safe-area-inset-bottom))] z-40 rounded-[22px] shadow-[0_14px_50px_#000a] lg:hidden"
          : "mt-6 hidden rounded-[22px] lg:grid",
      )}>
      {NAV.map(({ id, label, icon: Icon }) => (
        <button type="button" key={id} onClick={() => onChange(id)}
          aria-current={section === id ? "page" : undefined} data-testid={mobile ? "nav-mobile-" + id : "nav-" + id}
          className={cn(
            "flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[17px] px-1 py-3 text-[11px] font-medium transition-colors sm:text-[13px]",
            section === id ? "bg-[#dfbc86] text-[#12100d] shadow-[0_3px_20px_#d4a76335]" : "text-[#bab4ab] hover:bg-white/5 hover:text-[#f1dbba]",
          )}>
          <Icon className="size-5" strokeWidth={section === id ? 2.5 : 1.8} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** A single soft volumetric horizon, not several moving strokes. */
export function GoldenWave() {
  return (
    <div className="recontei-wave pointer-events-none absolute inset-x-0 top-0 -z-0 h-44 overflow-hidden sm:h-56" aria-hidden="true">
      <svg viewBox="0 0 800 220" preserveAspectRatio="none" className="size-full">
        <defs>
          <linearGradient id="recontei-wave-gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a86e30" stopOpacity=".04" />
            <stop offset="26%" stopColor="#d89b4a" stopOpacity=".55" />
            <stop offset="53%" stopColor="#ffe5a6" stopOpacity="1" />
            <stop offset="78%" stopColor="#de9f4e" stopOpacity=".8" />
            <stop offset="100%" stopColor="#a86e30" stopOpacity=".08" />
          </linearGradient>
          <filter id="recontei-wave-blur" x="-25%" y="-180%" width="150%" height="460%">
            <feGaussianBlur stdDeviation="15" />
          </filter>
        </defs>
        <path d="M-30 130 C 138 35, 205 182, 362 115 S 615 52, 830 105" fill="none"
          stroke="#f2a64b" strokeWidth="35" opacity=".43" filter="url(#recontei-wave-blur)" />
        <path d="M-30 130 C 138 35, 205 182, 362 115 S 615 52, 830 105"
          fill="none" stroke="url(#recontei-wave-gold)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function amount(card: ReconteiCard): number {
  if (typeof card.monthlyAmount === "number") return card.monthlyAmount;
  const match = card.priceLabel.match(/R\$\s*([\d.]+,\d{2})/);
  return match ? Number(match[1].replace(/\./g, "").replace(",", ".")) : 0;
}

function TrendChart({ history = [], trend }: { history?: SpendingMonth[]; trend?: SpendingTrend | null }) {
  const color = trend === null || trend === undefined ? "#d8c4a8" : trend.percent > 0 ? "#ff746d" : trend.percent < 0 ? "#23bfff" : "#d8c4a8";
  if (history.length < 2) {
    return <div data-testid="spending-chart-empty" className="flex h-24 items-center justify-center text-xs text-[#a6a09a]">
      Histórico de cobranças insuficiente para comparar os meses.
    </div>;
  }
  const max = Math.max(...history.map((month) => month.total), 1);
  const min = Math.min(...history.map((month) => month.total), 0);
  const points = history.map((month, index) => ({
    x: 16 + index * (368 / Math.max(history.length - 1, 1)),
    y: 100 - ((month.total - min) / Math.max(max - min, 1)) * 75,
  }));
  const curved = points.slice(1).reduce((d, point, index) => {
    const prev = points[index];
    const mid = (prev.x + point.x) / 2;
    return d + " C " + mid + " " + prev.y + " " + mid + " " + point.y + " " + point.x + " " + point.y;
  }, "M " + points[0].x + " " + points[0].y);
  const area = curved + " L " + points.at(-1)!.x + " 120 L " + points[0].x + " 120 Z";
  return (
    <div className="mt-3" data-testid="spending-chart">
      <svg viewBox="0 0 400 126" role="img" aria-label={"Cobranças registradas: " + history.map((item) => item.month + ": " + formatBrl(item.total)).join("; ")} className="h-28 w-full">
        <defs>
          <linearGradient id="spending-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".35" />
            <stop offset="100%" stopColor={color} stopOpacity=".01" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spending-area)" />
        <path d={curved} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        {points.map((point, index) => <circle key={history[index].month} cx={point.x} cy={point.y} r="2" fill={color} />)}
      </svg>
      <div className="flex justify-between text-[11px] text-[#a49f98]">
        <span>{history[0].month.slice(5) + "/" + history[0].month.slice(2, 4)}</span>
        <span>Histórico de cobranças registradas</span>
        <span>{history.at(-1)!.month.slice(5) + "/" + history.at(-1)!.month.slice(2, 4)}</span>
      </div>
    </div>
  );
}

export function SpendingOverview({ model, onNavigate }: { model: ReconteiModel; onNavigate: (section: ReconteiSection) => void }) {
  const trend = model.spendingTrend;
  return (
    <div data-testid="recontei-overview" className="space-y-5">
      <div>
        <h2 className="text-[26px] font-bold tracking-[-.045em] sm:text-[32px]">Suas assinaturas sob controle</h2>
        <p className="mt-1 text-sm text-[#bdb4a8]">Acompanhe seus gastos, renovações e possíveis cobranças recorrentes.</p>
      </div>
      <section className="relative overflow-hidden rounded-[22px] border border-[#8c6b4a]/35 bg-[linear-gradient(135deg,#1b1b1e,#11171d)] p-5 text-[#f8f5ef] shadow-[0_20px_50px_#0005] sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-[#c5bfb6]">Gasto mensal atual</p>
            <p data-testid="monthly-total" className="mt-2 text-[34px] font-bold tracking-[-.04em] sm:text-[44px]">{model.monthlyLabel}</p>
          </div>
          {trend && <span data-testid="spending-trend" className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-bold", trend.percent > 0 ? "bg-[#3a2021] text-[#ff8f8a]" : trend.percent < 0 ? "bg-[#163047] text-[#58c9ff]" : "bg-white/10 text-[#e6d7c4]")}>
            {trend.percent > 0 ? "↑ +" : trend.percent < 0 ? "↓ " : ""}{trend.percent}%</span>}
        </div>
        <TrendChart history={model.spendingHistory} trend={trend} />
        {trend && <p className="mt-2 text-xs text-[#b8b1a6]">Comparação entre os dois últimos meses completos com registros consecutivos.</p>}
      </section>
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: "Assinaturas", value: String(model.cards.length), icon: Layers3 },
          { label: "Gasto anual", value: model.annualLabel.replace("/ano", ""), icon: ChartNoAxesColumn },
          { label: "Para revisar", value: String(model.suggestions.length), icon: Sparkles },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-[18px] border border-white/10 bg-card px-2.5 py-4 text-center sm:px-4">
            <Icon className="mx-auto mb-2 size-5 text-[#e5bd82]" aria-hidden="true" />
            <p data-testid={label === "Gasto anual" ? "annual-total" : undefined} className="text-[clamp(13px,2vw,18px)] font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Próximas cobranças</h2>
        <button type="button" onClick={() => onNavigate("cobrancas")} className="cursor-pointer text-sm font-medium text-[#e6bb7f]">Ver todas</button>
      </div>
      <UpcomingCharges cards={model.cards} compact />
    </div>
  );
}

export function UpcomingCharges({ cards, compact = false }: { cards: ReconteiCard[]; compact?: boolean }) {
  const upcoming = cards.filter((card) => card.upcomingChargeDate)
    .sort((a, b) => a.upcomingChargeDate!.localeCompare(b.upcomingChargeDate!));
  const items = compact ? upcoming.slice(0, 3) : upcoming;
  return (
    <div data-testid="upcoming-charges" className="overflow-hidden rounded-[20px] border border-white/10 bg-card">
      {items.length ? items.map((card) => (
        <div key={card.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-3.5 last:border-b-0">
          <ServiceThumbnail card={card} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{card.planName}</p>
            <p className="text-xs text-muted-foreground">Prevista para {formatDayMonth(card.upcomingChargeDate!)}</p>
          </div>
          <p className="shrink-0 text-sm font-semibold">{formatBrl(amount(card))}</p>
        </div>
      )) : <p className="p-6 text-sm text-muted-foreground">Ainda não há datas futuras de cobrança confirmadas para exibir.</p>}
    </div>
  );
}

function ServiceThumbnail({ card }: { card: ReconteiCard }) {
  return <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#f9f6ef] text-sm font-semibold text-[#25211e]">
    {card.logoUrl ? <img src={card.logoUrl} alt="" className="size-7 object-contain" /> : card.planName.slice(0, 1).toUpperCase()}
  </span>;
}

export function SpendingInsights({ model }: { model: ReconteiModel }) {
  const top = [...model.cards].sort((a, b) => amount(b) - amount(a));
  const total = top.reduce((sum, card) => sum + amount(card), 0);
  const colors = ["#2cb6f5", "#46b5a4", "#c3a9e8", "#e6b570", "#798598"];
  const stops = top.slice(0, 4).reduce<{ name: string; value: number; color: string; start: number; end: number }[]>((acc, card, index) => {
    const start = acc.at(-1)?.end ?? 0;
    const end = start + (total > 0 ? (amount(card) / total) * 100 : 0);
    return [...acc, { name: card.planName, value: amount(card), color: colors[index], start, end }];
  }, []);
  const cumulative = stops.at(-1)?.end ?? 0;
  const other = Math.max(0, total - stops.reduce((sum, stop) => sum + stop.value, 0));
  const gradient = stops.map((stop) => stop.color + " " + stop.start + "% " + stop.end + "%")
    .concat(other > 0 ? [colors[4] + " " + cumulative + "% 100%"] : []).join(", ");
  return (
    <section data-testid="recontei-insights" className="mt-6 space-y-4">
      <h2 className="text-xl font-bold tracking-tight">Distribuição dos gastos</h2>
      {total ? <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-5 rounded-[22px] border bg-card p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:p-6">
        <div role="img" aria-label="Distribuição das assinaturas por valor" className="grid aspect-square place-items-center rounded-full p-[20px] sm:p-[26px]" style={{ background: "conic-gradient(" + gradient + ")" }}>
          <div className="grid size-full place-content-center rounded-full bg-[#141314] text-center text-[#f8f5ef]">
            <strong className="text-base sm:text-lg">{formatBrl(total)}</strong><span className="text-[11px] text-[#a6a19a]">por mês</span>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          {stops.map((stop) => <div key={stop.name} className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stop.color }} />
            <span className="min-w-0 flex-1 truncate">{stop.name}</span>
            <span className="tabular-nums text-foreground">{Math.round((stop.value / total) * 100)}%</span>
          </div>)}
          {other > 0 && <div className="flex items-center gap-2 text-xs"><span className="size-2.5 rounded-full bg-[#798598]" />Outras assinaturas</div>}
        </div>
      </div> : <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Confirme assinaturas para visualizar a distribuição.</p>}
      <h3 className="pt-2 text-lg font-semibold">Assinaturas que mais pesam</h3>
      <div className="overflow-hidden rounded-[20px] border bg-card">
        {top.slice(0, 5).map((card) => <div key={card.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0">
          <ServiceThumbnail card={card} />
          <p className="min-w-0 flex-1 truncate text-sm">{card.planName}</p>
          <p className="text-sm font-semibold">{formatBrl(amount(card))}</p>
        </div>)}
      </div>
    </section>
  );
}

export function BillingSection({ model }: { model: ReconteiModel }) {
  return (
    <section data-testid="recontei-billing" className="space-y-4">
      <div className="flex items-center gap-3"><CalendarDays className="size-6 text-[#e6bc7f]" /><div>
        <h2 className="text-2xl font-bold">Próximas cobranças</h2>
        <p className="text-sm text-muted-foreground">Datas previstas registradas nas suas assinaturas.</p>
      </div></div>
      <UpcomingCharges cards={model.cards} />
    </section>
  );
}

export function SavingsIntro({ model }: { model: ReconteiModel }) {
  return (
    <div data-testid="recontei-savings" className="rounded-[22px] border border-[#b98d52]/30 bg-[linear-gradient(120deg,#30251c,#171515)] p-5 text-[#f8f5ef]">
      <div className="flex items-center gap-3">
        <Sparkles className="size-7 text-[#efd0a1]" />
        <div><p className="text-xs font-medium uppercase tracking-widest text-[#c7b5a0]">Oportunidades de economia</p>
          <h2 className="mt-1 text-xl font-semibold">{model.suggestions.length} {model.suggestions.length === 1 ? "cobrança para revisar" : "cobranças para revisar"}</h2>
        </div>
      </div>
      <p className="mt-3 text-sm text-[#c4b7a8]">Verifique as possíveis assinaturas identificadas no extrato. Revisar não significa que seja possível economizar esse valor.</p>
    </div>
  );
}

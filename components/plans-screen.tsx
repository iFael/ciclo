"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ExternalLink, LogOut, Minus, MoreHorizontal, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Brand, CycleMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { bannerPlacement, isPlansTab, resolvePlansTab, tabLabelParts, type PlansTab } from "@/lib/plans-tabs";
import { shouldStartAutoSync, suggestionSummary, syncErrorMessage, SYNC_COOLDOWN_MS } from "@/lib/sync-policy";

type Action = { id: string; label: string; href?: string; action?: string; targetId?: string };
type Banner = { id: string; tone: "red" | "yellow" | "neutral"; text: string; actions: Action[] };
type Check = { id: string; label: string; detail: string; passed: boolean };
type Confidence = { score: number; label: string; checks: Check[] };
type Card = {
  id: string;
  service: string;
  planName: string;
  priceLabel: string;
  nextChargeLabel: string;
  manageUrl: string | null;
  manageLabel: string;
  removeConfirm: string;
  autoConfirmed: boolean;
  notice: string | null;
  logoUrl?: string | null;
  logoFallback?: boolean;
};
type Suggestion = {
  id: string;
  planName: string;
  label: string | null;
  checked: boolean;
  priceLabel: string;
  apple: boolean;
  logoUrl?: string | null;
  logoFallback?: boolean;
  confidence?: Confidence | null;
};

const UNDO_TOAST_MS = 5000;
const TABS: PlansTab[] = ["assinaturas", "sugestoes"];

type SyncMode = "manual" | "auto";
type SyncTrigger = { reason: "load" | "foreground"; hiddenForMs?: number };
type SyncResult =
  | { kind: "ok"; newSuggestions: number; message: string; plans: Model | null }
  | { kind: "limited"; message: string; retryAfterSeconds: number }
  | { kind: "error"; message: string };

let syncInflight: Promise<SyncResult> | null = null;

function shareSync(run: () => Promise<SyncResult>): Promise<SyncResult> {
  if (syncInflight) return syncInflight;
  const job = run().finally(() => {
    if (syncInflight === job) syncInflight = null;
  });
  syncInflight = job;
  return job;
}

async function readPlans(): Promise<Model> {
  const response = await fetch("/api/plans", { cache: "no-store" });
  if (!response.ok) throw new Error("load");
  return (await response.json()) as Model;
}

function applySyncResult(
  mode: SyncMode,
  result: SyncResult,
  syncedAtRef: { current: string | null },
  setModel: (model: Model) => void,
  setSyncToast: (toast: { title: string; detail?: string } | null) => void,
  setSyncError: (message: string | null) => void,
) {
  if (result.kind === "limited") {
    const remainMs = result.retryAfterSeconds * 1000;
    syncedAtRef.current = new Date(Date.now() - (SYNC_COOLDOWN_MS - remainMs)).toISOString();
    if (mode === "manual") setSyncToast({ title: result.message });
    return;
  }
  if (result.kind === "error") {
    setSyncError(result.message);
    return;
  }
  if (result.plans) {
    syncedAtRef.current = new Date().toISOString();
    setModel(result.plans);
  }
  if (mode === "manual" || result.newSuggestions > 0) {
    setSyncToast({ title: "Sincronizado agora", detail: result.message });
  }
}

function startSync(
  mode: SyncMode,
  trigger: SyncTrigger | undefined,
  syncedAtRef: { current: string | null },
  setModel: (model: Model) => void,
  setSyncing: (syncing: boolean) => void,
  setSyncToast: (toast: { title: string; detail?: string } | null) => void,
  setSyncError: (message: string | null) => void,
) {
  const reason = trigger?.reason ?? "load";
  const apply = (result: SyncResult) => applySyncResult(mode, result, syncedAtRef, setModel, setSyncToast, setSyncError);
  if (mode === "auto" && syncInflight) {
    void syncInflight.then(apply);
    return;
  }
  if (
    mode === "auto" &&
    !shouldStartAutoSync({
      inFlight: false,
      lastSyncedAt: syncedAtRef.current,
      now: Date.now(),
      reason,
      hiddenForMs: trigger?.hiddenForMs,
    })
  ) {
    return;
  }
  const job = shareSync(async () => {
    setSyncing(true);
    setSyncToast(null);
    setSyncError(null);
    try {
      const response = await fetch("/api/sync", { method: "POST", cache: "no-store" });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        newSuggestions?: number;
        message?: string;
        error?: string;
        code?: string;
        retryAfterSeconds?: number;
        screen?: Model;
      } | null;
      if (response.status === 429) {
        return {
          kind: "limited" as const,
          message: body?.error || "Aguarde um pouco para sincronizar de novo.",
          retryAfterSeconds: body?.retryAfterSeconds ?? Math.round(SYNC_COOLDOWN_MS / 1000),
        };
      }
      if (!response.ok || !body?.ok) return { kind: "error" as const, message: syncErrorMessage(body?.code) };
      const count = body.newSuggestions ?? 0;
      const plans = body.screen ?? (await readPlans());
      return { kind: "ok" as const, newSuggestions: count, message: body.message || suggestionSummary(count), plans };
    } catch {
      return { kind: "error" as const, message: syncErrorMessage() };
    } finally {
      setSyncing(false);
    }
  });
  void job.then(apply);
}

type Model = {
  monthlyLabel: string;
  annualLabel: string;
  cards: Card[];
  suggestions: Suggestion[];
  banners: Banner[];
  footer: string;
  syncedAt?: string | null;
  firstRead: boolean;
  empty: boolean;
  connections: { institution: string; statusLabel: string; expiresLabel: string }[];
  appleChoices: { id: string; label: string }[];
};

export function PlansScreen({ initialAba = null }: { initialAba?: string | null }) {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState(false);
  const [tabParam, setTabParam] = useState<string | null>(isPlansTab(initialAba) ? initialAba : null);
  const [planBannerIndex, setPlanBannerIndex] = useState(0);
  const [connectionBannerIndex, setConnectionBannerIndex] = useState(0);
  const [connections, setConnections] = useState(false);
  const [pending, setPending] = useState<Card | null>(null);
  const [toastId, setToastId] = useState<string | null>(null);
  const [addedToast, setAddedToast] = useState(0);
  const [erase, setErase] = useState(false);
  const [appleService, setAppleService] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<{ title: string; detail?: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<PlansTab, HTMLButtonElement | null>>>({});
  const syncedAtRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    readPlans()
      .then((data) => {
        if (!active) return;
        syncedAtRef.current = data.syncedAt ?? null;
        setModel(data);
        setTabParam((current) => {
          if (isPlansTab(current)) return current;
          const fromUrl = new URLSearchParams(window.location.search).get("aba");
          return resolvePlansTab(fromUrl, data.cards.length);
        });
        startSync("auto", { reason: "load" }, syncedAtRef, setModel, setSyncing, setSyncToast, setSyncError);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState !== "visible" || hiddenAt === null) return;
      const hiddenForMs = Date.now() - hiddenAt;
      hiddenAt = null;
      startSync("auto", { reason: "foreground", hiddenForMs }, syncedAtRef, setModel, setSyncing, setSyncToast, setSyncError);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const value = new URLSearchParams(window.location.search).get("aba");
      if (isPlansTab(value)) setTabParam(value);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!isPlansTab(tabParam)) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("aba") === tabParam) return;
    params.set("aba", tabParam);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [tabParam]);

  useEffect(() => {
    if (!toastId) return;
    const timer = window.setTimeout(() => {
      setToastId((current) => (current === toastId ? null : current));
    }, UNDO_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastId]);

  useEffect(() => {
    if (addedToast === 0) return;
    const token = addedToast;
    const timer = window.setTimeout(() => {
      setAddedToast((current) => (current === token ? 0 : current));
    }, UNDO_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [addedToast]);

  useEffect(() => {
    if (!syncToast && !syncError) return;
    const timer = window.setTimeout(() => {
      setSyncToast(null);
      setSyncError(null);
    }, UNDO_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [syncToast, syncError]);

  async function act(action: string, id: string, service?: string, domain?: string): Promise<boolean> {
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, service, domain }),
    });
    if (!response.ok) {
      setError(true);
      return false;
    }
    setModel((await response.json()) as Model);
    return true;
  }

  const tab = model ? resolvePlansTab(tabParam, model.cards.length) : null;
  const connectionBanners = model?.banners.filter((banner) => bannerPlacement(banner.id) === "connection") ?? [];
  const planBanners = model?.banners.filter((banner) => bannerPlacement(banner.id) === "plan") ?? [];
  const suggestionBanner = model?.banners.find((banner) => bannerPlacement(banner.id) === "suggestions");
  const connectionBanner = connectionBanners.length > 0 ? connectionBanners[connectionBannerIndex % connectionBanners.length] : undefined;
  const planBanner = planBanners.length > 0 ? planBanners[planBannerIndex % planBanners.length] : undefined;
  const ready = Boolean(model && !error && tab);

  function writeTab(next: PlansTab, mode: "push" | "replace") {
    const params = new URLSearchParams(window.location.search);
    params.set("aba", next);
    const href = `${window.location.pathname}?${params.toString()}`;
    if (mode === "push") window.history.pushState(null, "", href);
    else window.history.replaceState(null, "", href);
    setTabParam(next);
  }

  function selectTab(next: PlansTab, focus = false) {
    setAddedToast(0);
    if (next !== tab) writeTab(next, "push");
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabsKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!tab) return;
    const index = TABS.indexOf(tab);
    let next: PlansTab | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = TABS[(index + 1) % TABS.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = TABS[(index - 1 + TABS.length) % TABS.length];
    else if (event.key === "Home") next = TABS[0];
    else if (event.key === "End") next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  }

  async function confirmSuggestion(suggestion: Suggestion) {
    const picked = suggestion.apple ? appleService[suggestion.id] : undefined;
    const ok = picked ? await act("pick-apple", suggestion.id, picked) : await act("confirm", suggestion.id);
    if (ok) setAddedToast((current) => current + 1);
  }

  const manualSync = () => startSync("manual", undefined, syncedAtRef, setModel, setSyncing, setSyncToast, setSyncError);

  return (
    <main data-testid="screen" id="planos" className="min-h-dvh w-full bg-background text-foreground">
      <a
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-[calc(12px+env(safe-area-inset-top))]"
        href="#conteudo"
      >
        Ir para os planos
      </a>

      <header className="top sticky top-0 z-40 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:relative md:border-b-0 md:bg-transparent md:backdrop-blur-none">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 md:h-20 lg:px-8">
          <Brand />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-10 bg-card" data-testid="menu" aria-label="Abrir menu">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="menu-sync" disabled={syncing} onSelect={manualSync}>
                <RefreshCw />
                Sincronizar agora
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="menu-connections" onSelect={() => setConnections(true)}>
                <Plug />
                Conexões
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="menu-logout"
                onSelect={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.replace("/login");
                }}
              >
                <LogOut />
                Sair
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" data-testid="menu-delete" onSelect={() => setErase(true)}>
                <Trash2 />
                Apagar meus dados
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div id="conteudo" className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <section className="grid gap-5 pt-5 md:pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)] lg:gap-10">
          <div className="flex min-w-0 flex-col lg:justify-between lg:py-2">
            <div>
            <h1 data-testid="page-title" className="text-3xl font-bold tracking-[-0.035em] md:text-4xl">
              Meus planos
            </h1>
            <p data-testid="page-subtitle" className="mt-2 max-w-md text-[15px] text-muted-foreground">
              Suas assinaturas, encontradas automaticamente no seu cartão.
            </p>
            </div>
            {ready && model && (
              <div className="mt-5 flex items-center gap-2">
                <span className="inline-flex h-9 min-w-0 items-center gap-2 rounded-full border bg-card pl-3 pr-3.5 text-sm text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_20%,transparent)]", syncing && "animate-pulse")}
                  />
                  <span data-testid="footer-sync" aria-live="polite" className="truncate">
                    {syncing ? "Sincronizando…" : model.footer}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 rounded-full bg-card max-sm:w-9 max-sm:px-0"
                  data-testid="sync-now"
                  aria-label="Sincronizar agora"
                  aria-busy={syncing}
                  disabled={syncing}
                  onClick={manualSync}
                >
                  <RefreshCw className={cn(syncing && "animate-spin")} />
                  <span aria-hidden="true" className="hidden sm:inline">Sincronizar</span>
                </Button>
              </div>
            )}
          </div>

          {ready && model && tab === "assinaturas" && (
            <Summary eyebrow="Gasto mensal">
              <p data-testid="monthly-total" className="mt-3 text-[2.6rem] font-bold leading-none tracking-[-0.045em] md:text-5xl">
                <PerMonth label={model.monthlyLabel} />
              </p>
              <p data-testid="annual-total" className="mt-2.5 text-sm text-hero-muted">
                {model.annualLabel}
              </p>
              <SummaryStats
                items={[
                  { label: "Ativas", value: plural(model.cards.length, "assinatura", "assinaturas") },
                  { label: "Para revisar", value: plural(model.suggestions.length, "sugestão", "sugestões") },
                ]}
              />
            </Summary>
          )}
          {ready && model && tab === "sugestoes" && (
            <Summary eyebrow="Para revisar">
              <p className="mt-3 text-[2.6rem] font-bold leading-none tracking-[-0.045em] md:text-5xl">
                {model.suggestions.length}
                <span className="ml-2 text-lg font-medium tracking-normal text-hero-muted">
                  {model.suggestions.length === 1 ? "possível plano" : "possíveis planos"}
                </span>
              </p>
              <p className="mt-2.5 text-sm text-hero-muted">Confirme o que é assinatura para entrar no total do mês.</p>
              <SummaryStats
                items={[
                  { label: "Ativas", value: plural(model.cards.length, "assinatura", "assinaturas") },
                  { label: "No total", value: model.cards.length > 0 ? model.monthlyLabel : "—" },
                ]}
              />
            </Summary>
          )}
        </section>

        <div className="mt-6 space-y-3 empty:hidden">
          {!model && !error && (
            <p data-testid="loading" className="text-sm text-muted-foreground">
              Carregando planos…
            </p>
          )}
          {error && (
            <p data-testid="load-error" role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              Não foi possível carregar seus planos.
            </p>
          )}
          {ready && connectionBanner && (
            <BannerView
              banner={connectionBanner}
              testId="connection-banner"
              extra={Math.max(connectionBanners.length - 1, 0)}
              moreTestId="connection-banner-more"
              onMore={() => setConnectionBannerIndex((index) => (index + 1) % connectionBanners.length)}
              onAction={(action, id) => act(action, id)}
            />
          )}
          {ready && model?.firstRead && (
            <p data-testid="first-read" className="text-sm text-muted-foreground">
              Primeira leitura em até 24 horas.
            </p>
          )}
        </div>

        {ready && model && tab && (
          <>
            <div
              role="tablist"
              aria-label="Meus planos"
              data-testid="plan-tabs"
              onKeyDown={onTabsKey}
              className="mt-6 grid w-full grid-cols-2 rounded-xl border bg-card p-1 sm:inline-grid sm:w-auto"
            >
              {TABS.map((item) => {
                const selected = tab === item;
                const count = item === "assinaturas" ? model.cards.length : model.suggestions.length;
                const parts = tabLabelParts(item, count);
                return (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    id={`tab-${item}`}
                    data-testid={`tab-${item}`}
                    aria-selected={selected}
                    aria-controls={`panel-${item}`}
                    tabIndex={selected ? 0 : -1}
                    ref={(node) => {
                      tabRefs.current[item] = node;
                    }}
                    onClick={() => selectTab(item)}
                    className={cn(
                      "flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:min-w-40",
                      selected && "bg-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
                    )}
                  >
                    <span>{parts.name}</span>
                    <span className="font-medium tabular-nums text-muted-foreground"> {parts.count}</span>
                  </button>
                );
              })}
            </div>

            {tab === "assinaturas" ? (
              <div role="tabpanel" id="panel-assinaturas" aria-labelledby="tab-assinaturas" data-testid="panel-assinaturas" className="mt-5 space-y-4">
                {planBanner && (
                  <BannerView
                    banner={planBanner}
                    testId="banner"
                    extra={Math.max(planBanners.length - 1, 0)}
                    moreTestId="banner-more"
                    onMore={() => setPlanBannerIndex((index) => (index + 1) % planBanners.length)}
                    onAction={(action, id) => act(action, id)}
                  />
                )}
                {model.cards.length === 0 ? (
                  <EmptyState
                    testId="empty-assinaturas"
                    legacy={model.empty}
                    title="Nenhuma assinatura confirmada"
                    hint={
                      model.empty
                        ? "Assim que uma cobrança recorrente aparecer no cartão, confirme para ela entrar no total."
                        : model.suggestions.length > 0
                          ? "Confirme uma sugestão para acompanhar o plano, o total e a última cobrança."
                          : "Os planos confirmados aparecem aqui, com o total do mês."
                    }
                    action={
                      model.suggestions.length > 0 ? (
                        <Button data-testid="empty-goto-suggestions" onClick={() => selectTab("sugestoes")}>
                          Ver sugestões
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {model.cards.map((card) => (
                      <Card asArticle key={card.id} data-testid="plan-card" className="flex min-w-0 flex-col p-5">
                        <div className="flex items-start gap-3.5">
                          <ServiceMark
                            src={card.logoUrl === undefined ? `/logos/${card.service}.svg` : card.logoUrl}
                            name={card.planName}
                            fallback={card.logoFallback === true}
                          />
                          <div className="min-w-0 flex-1">
                            <h2 data-testid="plan-name" className="truncate text-base font-semibold leading-snug">
                              {card.planName}
                            </h2>
                            <p data-testid="next-charge" className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                              {card.nextChargeLabel}
                            </p>
                          </div>
                        </div>
                        <p data-testid="plan-price" className="mt-4 text-2xl font-bold tracking-[-0.03em]">
                          <PerMonth label={card.priceLabel} />
                        </p>
                        {card.logoFallback && (
                          <form
                            className="mt-3"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const domain = String(new FormData(event.currentTarget).get("domain") ?? "");
                              void act("set-domain", card.id, undefined, domain);
                            }}
                          >
                            <Input name="domain" className="h-10 text-sm" aria-label="Site do serviço" placeholder="Site do serviço" />
                          </form>
                        )}
                        {card.notice && <p className="mt-3 text-[13px] text-muted-foreground">{card.notice}</p>}
                        <div className="mt-auto flex gap-2 pt-5">
                          {card.manageUrl && (
                            <Button asChild className="flex-1">
                              <a data-testid="manage" href={card.manageUrl} target="_blank" rel="noopener noreferrer" aria-label={card.manageLabel}>
                                Gerenciar
                                <ExternalLink />
                              </a>
                            </Button>
                          )}
                          <Button variant="outline" className="flex-1" data-testid="remove" onClick={() => setPending(card)}>
                            Remover
                          </Button>
                          {card.autoConfirmed && (
                            <Button variant="ghost" data-testid="undo-auto" onClick={() => act("undo", card.id)}>
                              Desfazer
                            </Button>
                          )}
                        </div>
                      </Card>
                    ))}
                  </section>
                )}
              </div>
            ) : (
              <div role="tabpanel" id="panel-sugestoes" aria-labelledby="tab-sugestoes" data-testid="panel-sugestoes" className="mt-5 space-y-4">
                {model.suggestions.length === 0 ? (
                  <EmptyState
                    testId="empty-sugestoes"
                    legacy={model.empty}
                    title={model.firstRead ? "Nenhuma sugestão ainda" : "Nenhuma sugestão no momento"}
                    hint={
                      model.empty
                        ? "Assim que uma cobrança recorrente aparecer no cartão, confirme para ela entrar no total."
                        : model.firstRead
                          ? "As possíveis assinaturas entram aqui quando a leitura do cartão terminar."
                          : "Novas cobranças recorrentes do cartão aparecem aqui."
                    }
                    action={
                      model.cards.length > 0 ? (
                        <Button data-testid="empty-goto-assinaturas" onClick={() => selectTab("assinaturas")}>
                          Ver assinaturas
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <>
                    {suggestionBanner && (
                      <p data-testid="suggestion-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {suggestionBanner.text}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {model.suggestions.map((suggestion) => (
                        <Card asArticle key={suggestion.id} data-testid="suggestion" className="flex min-w-0 flex-col p-5">
                          <div className="flex items-start gap-3.5">
                            <ServiceMark src={suggestion.logoUrl} name={suggestion.planName} fallback={suggestion.logoFallback === true || !suggestion.logoUrl} />
                            <div className="min-w-0 flex-1">
                              <h2 className="truncate text-base font-semibold leading-snug">{suggestion.planName}</h2>
                              {!suggestion.confidence && suggestion.label && <p className="mt-0.5 text-[13px] text-muted-foreground">{suggestion.label}</p>}
                              {!suggestion.confidence && suggestion.checked && <p className="mt-0.5 text-[13px] text-muted-foreground">Sugestão marcada</p>}
                            </div>
                          </div>
                          <p className="mt-4 text-2xl font-bold tracking-[-0.03em]">
                            <PerMonth label={suggestion.priceLabel} />
                          </p>
                          {suggestion.confidence && <ConfidenceBar confidence={suggestion.confidence} />}
                          {suggestion.apple && (
                            <label className="mt-4 grid gap-1.5 text-sm font-medium">
                              Serviço
                              <select
                                data-testid="apple-picker"
                                aria-label="Escolher o serviço desta assinatura da Apple"
                                className="h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
                                value={appleService[suggestion.id] ?? ""}
                                onChange={(event) => setAppleService((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                              >
                                <option value="">Escolher serviço</option>
                                {model.appleChoices.map((choice) => (
                                  <option key={choice.id} value={choice.id}>
                                    {choice.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <div className="mt-auto flex gap-2 pt-5">
                            <Button className="flex-1" data-testid="suggestion-yes" onClick={() => confirmSuggestion(suggestion)}>
                              É assinatura
                            </Button>
                            <Button variant="outline" className="flex-1" data-testid="suggestion-no" onClick={() => act("ignore", suggestion.id)}>
                              Não é
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent data-testid="remove-dialog">
          <DialogTitle>Remover do Ciclo</DialogTitle>
          <DialogDescription>{pending?.removeConfirm}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Voltar</Button>
            </DialogClose>
            <Button
              data-testid="remove-confirm"
              onClick={async () => {
                if (!pending) return;
                const id = pending.id;
                const removed = await act("remove", id);
                setPending(null);
                if (removed) {
                  setAddedToast(0);
                  setToastId(id);
                }
              }}
            >
              Remover do Ciclo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={connections && model !== null} onOpenChange={setConnections}>
        <DialogContent>
          <DialogTitle>Conexões</DialogTitle>
          <DialogDescription>Os cartões que o Ciclo lê pela Pluggy.</DialogDescription>
          <div className="grid gap-2">
            {model?.connections.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conexão ainda.</p>}
            {model?.connections.map((connection) => (
              <div key={`${connection.institution}-${connection.expiresLabel}`} className="rounded-xl border bg-background/40 px-4 py-3 text-sm">
                <p className="font-semibold">{connection.institution}</p>
                <p className="text-muted-foreground">
                  {connection.statusLabel}. Vencimento {connection.expiresLabel}.
                </p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Fechar</Button>
            </DialogClose>
            <Button asChild>
              <a href="https://dashboard.pluggy.ai" target="_blank" rel="noopener noreferrer">
                Renovar
                <ExternalLink />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={erase} onOpenChange={setErase}>
        <DialogContent>
          <DialogTitle>Apagar meus dados</DialogTitle>
          <DialogDescription>Isso apaga os dados do Ciclo. Não cancela suas assinaturas no banco nem nos serviços.</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Voltar</Button>
            </DialogClose>
            <Button
              variant="destructive"
              data-testid="delete-confirm"
              onClick={async () => {
                await fetch("/api/account/delete", { method: "POST" });
                window.location.replace("/login");
              }}
            >
              Apagar meus dados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {toastId && (
          <Toast testId="undo-toast">
            <span>Plano removido do Ciclo.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const id = toastId;
                setToastId(null);
                if (id) void act("undo", id);
              }}
            >
              Desfazer
            </Button>
          </Toast>
        )}
        {addedToast > 0 && (
          <Toast testId="added-toast">
            <span className="flex items-center gap-2">
              <Check className="size-4 text-success" aria-hidden="true" />
              Adicionado às assinaturas
            </span>
            <Button size="sm" variant="secondary" data-testid="added-toast-open" aria-label="Ver assinaturas" onClick={() => selectTab("assinaturas", true)}>
              Ver
            </Button>
          </Toast>
        )}
        {syncToast && (
          <Toast testId="sync-toast">
            <span className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span className="grid">
                <strong className="font-semibold">{syncToast.title}</strong>
                {syncToast.detail ? <span className="text-muted-foreground">{syncToast.detail}</span> : null}
              </span>
            </span>
          </Toast>
        )}
        {syncError && (
          <Toast testId="sync-error" tone="error">
            <span>{syncError}</span>
          </Toast>
        )}
      </div>
    </main>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "R$ 113,85/mês" keeps its text, with "/mês" set smaller. */
function PerMonth({ label }: { label: string }) {
  const cut = label.lastIndexOf("/");
  if (cut <= 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, cut)}
      <span className="ml-0.5 text-[0.45em] font-medium tracking-normal opacity-70">{label.slice(cut)}</span>
    </>
  );
}

function Summary({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-hero-border bg-hero p-5 text-hero-foreground md:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-brand/10 blur-2xl" />
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-hero-muted">{eyebrow}</p>
      {children}
    </div>
  );
}

function SummaryStats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-hero-border pt-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-hero-muted">{item.label}</dt>
          <dd className="mt-1 text-base font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Toast({ testId, tone = "default", children }: { testId: string; tone?: "default" | "error"; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-2xl animate-in fade-in-0 slide-in-from-bottom-2",
        tone === "error" && "border-destructive/50 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

function EmptyState({
  testId,
  legacy,
  title,
  hint,
  action,
}: {
  testId: string;
  legacy: boolean;
  title: string;
  hint: string;
  action: ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <span aria-hidden="true" className="grid size-12 place-items-center rounded-xl bg-brand text-brand-foreground">
        <CycleMark className="size-6" />
      </span>
      {legacy ? (
        <p data-testid="empty" className="mt-4 text-base font-semibold">
          Nenhuma assinatura encontrada
        </p>
      ) : (
        <p className="mt-4 text-base font-semibold">{title}</p>
      )}
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{hint}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const BANNER_TONES: Record<Banner["tone"], string> = {
  red: "border-destructive/40 bg-destructive/10",
  yellow: "border-amber-500/40 bg-amber-500/10",
  neutral: "bg-card",
};

function BannerView({
  banner,
  testId,
  extra,
  moreTestId,
  onMore,
  onAction,
}: {
  banner: Banner;
  testId: string;
  extra: number;
  moreTestId: string;
  onMore: () => void;
  onAction: (action: string, id: string) => void;
}) {
  return (
    <section data-testid={testId} role="status" className={cn("rounded-xl border px-4 py-3.5 text-sm", BANNER_TONES[banner.tone])}>
      <p className="font-medium">{banner.text}</p>
      {(banner.actions.length > 0 || extra > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {banner.actions.map((action) =>
            action.href ? (
              <Button key={action.id} asChild size="sm">
                <a href={action.href} target="_blank" rel="noopener noreferrer">
                  {action.label}
                </a>
              </Button>
            ) : (
              <Button key={action.id} size="sm" onClick={() => onAction(action.action ?? "", action.targetId ?? "")}>
                {action.label}
              </Button>
            ),
          )}
          {extra > 0 && (
            <Button size="sm" variant="ghost" data-testid={moreTestId} onClick={onMore}>
              +{extra} aviso(s)
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function ServiceMark({ src, name, fallback }: { src?: string | null; name: string; fallback?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (fallback || !src || failed) {
    return (
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-base font-semibold text-foreground">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f7f4ee] ring-1 ring-black/5">
      <img className="logo size-6 object-contain" src={src} alt="" onError={() => setFailed(true)} />
    </span>
  );
}

function ConfidenceBar({ confidence }: { confidence: Confidence }) {
  return (
    <div data-testid="confidence" className="mt-4">
      <div className="mb-2 flex justify-between text-[13px] text-muted-foreground">
        <span>{confidence.label}</span>
        <span className="font-semibold tabular-nums text-foreground">{confidence.score}%</span>
      </div>
      <Progress value={confidence.score} aria-label={`${confidence.label}, ${confidence.score}%`} />
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {confidence.checks.map((check) => (
          <li key={check.id} title={check.label}>
            <Badge className={cn("rounded-md py-1 font-medium", !check.passed && "opacity-70")}>
              {check.passed ? <Check className="size-3 text-success" aria-hidden="true" /> : <Minus className="size-3" aria-hidden="true" />}
              <span>{check.detail}</span>
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

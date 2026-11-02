"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Check, CircleHelp, ExternalLink, Link2, LogOut, Mail, Minus, MoreHorizontal, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Brand, CycleMark, LoadingScreen } from "@/components/brand";
import { ConnectionsDialog } from "@/components/connections-dialog";
import { StatementSearch } from "@/components/statement-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { haptic, RollingAmount, Tilt } from "@/components/vivid";
import { SamplePlan, WelcomeTour, type TourStep } from "@/components/welcome-tour";
import type { ScreenConnection } from "@/lib/types";
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
  channel?: "apple" | "google-play" | "direct";
  manageUrl: string | null;
  manageButton?: string;
  manageLabel: string;
  customManageUrl?: boolean;
  removeConfirm: string;
  autoConfirmed: boolean;
  notice: string | null;
  logoUrl?: string | null;
  logoFallback?: boolean;
  inactiveLabel?: string | null;
};
type Suggestion = {
  id: string;
  planName: string;
  label: string | null;
  checked: boolean;
  priceLabel: string;
  apple: boolean;
  appleGuess?: { service: string; serviceName: string; planName: string; reason: string; replaces: string | null } | null;
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
  inactiveCards?: Card[];
  suggestions: Suggestion[];
  banners: Banner[];
  footer: string;
  syncedAt?: string | null;
  firstRead: boolean;
  empty: boolean;
  connections: ScreenConnection[];
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
  const [sendingSummary, setSendingSummary] = useState(false);
  const sendSummary = async () => {
    setSendingSummary(true);
    setSyncError(null);
    try {
      const response = await fetch("/api/summary", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) setSyncToast({ title: "Resumo enviado", detail: "Confira no seu e-mail." });
      else setSyncError(body.error ?? "Não foi possível enviar o e-mail agora.");
    } catch {
      setSyncError("Não foi possível enviar o e-mail agora.");
    } finally {
      setSendingSummary(false);
    }
  };
  const [syncError, setSyncError] = useState<string | null>(null);
  const [editingLogo, setEditingLogo] = useState<string | null>(null);
  const [touring, setTouring] = useState(false);
  const tourChecked = useRef(false);
  const desktop = useDesktop();
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

  // A new account sees the welcome tour once. The flag lives on the account, so it follows the user to other devices.
  useEffect(() => {
    if (!model || error || tourChecked.current) return;
    tourChecked.current = true;
    let active = true;
    fetch("/api/tutorial", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ seen?: boolean }>) : null))
      .then((body) => {
        if (active && body && body.seen === false) setTouring(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [model, error]);

  function closeTour() {
    setTouring(false);
    void fetch("/api/tutorial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen: true }),
    }).catch(() => {});
  }

  async function act(action: string, id: string, service?: string, domain?: string, replaces?: string, url?: string): Promise<boolean> {
    haptic();
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, service, domain, replaces, url }),
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
    if (next !== tab) {
      haptic(6);
      writeTab(next, "push");
    }
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
    const picked = suggestion.apple ? (appleService[suggestion.id] ?? suggestion.appleGuess?.service) : undefined;
    const replaces = picked && picked === suggestion.appleGuess?.service ? (suggestion.appleGuess?.replaces ?? undefined) : undefined;
    const ok = picked ? await act("pick-apple", suggestion.id, picked, undefined, replaces) : await act("confirm", suggestion.id);
    if (ok) {
      haptic([10, 40, 16]);
      setAddedToast((current) => current + 1);
    }
  }

  const tourSteps: TourStep[] = [];
  if (model) {
    const openAssinaturas = () => {
      if (!desktop && tab !== "assinaturas") writeTab("assinaturas", "replace");
    };
    tourSteps.push({
      id: "welcome",
      title: "Boas-vindas ao Ciclo",
      body: "O Ciclo lê o seu cartão e encontra as assinaturas sozinho. Em poucos passos eu te mostro o essencial.",
    });
    tourSteps.push({
      id: "suggestions",
      title: "Sugestões do cartão",
      body: "Cobranças que parecem assinatura chegam aqui. Toque em “É assinatura” para somar ao total, ou em “Não é” para descartar.",
      target: desktop ? '[data-testid="panel-sugestoes"] [data-testid="suggestion"], [data-testid="empty-sugestoes"]' : "#tab-sugestoes",
    });
    if (model.cards.length > 0) {
      tourSteps.push({
        id: "logo",
        title: "Toque no ícone",
        body: "Abre o campo Link do Gerenciar. Cole ali a página onde você cancela ou muda o plano, e o logo passa a vir do mesmo site.",
        target: '[data-testid="change-logo"]',
        prepare: openAssinaturas,
      });
      if (model.cards.some((card) => card.manageUrl)) {
        tourSteps.push({
          id: "manage",
          title: "Gerenciar",
          body: "Leva direto para onde você paga: App Store, Google Play ou o site do serviço. É por ali que se cancela de verdade.",
          target: '[data-testid="manage"]',
          prepare: openAssinaturas,
        });
      }
    } else {
      tourSteps.push({
        id: "sample",
        title: "Cada assinatura vira um cartão",
        body: "Toque no ícone para colar o Link do Gerenciar. O botão Gerenciar leva direto para a App Store, o Google Play ou o site do serviço.",
        visual: <SamplePlan />,
      });
    }
    tourSteps.push({
      id: "menu",
      title: "Mais opções",
      body: "Aqui você sincroniza o cartão, recebe o resumo por e-mail, vê as conexões e pode rever este tutorial quando quiser.",
      target: '[data-testid="menu"]',
    });
  }

  const manualSync = () => startSync("manual", undefined, syncedAtRef, setModel, setSyncing, setSyncToast, setSyncError);
  const showAssinaturas = Boolean(ready && model && (desktop || tab === "assinaturas"));
  const showSugestoes = Boolean(ready && model && (desktop || tab === "sugestoes"));

  const removeDialogs = (
    <>
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

      <ConnectionsDialog<Model>
        open={connections && model !== null}
        onOpenChange={setConnections}
        connections={model?.connections ?? []}
        onScreen={(screen) => {
          syncedAtRef.current = screen.syncedAt ?? null;
          setModel(screen);
        }}
        onNotice={(title, detail) => setSyncToast({ title, detail })}
      />

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
    </>
  );

  return (
    <main data-testid="screen" id="planos" className="min-h-dvh w-full bg-background text-foreground">
      <a
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-[calc(12px+env(safe-area-inset-top))]"
        href="#conteudo"
      >
        Ir para os planos
      </a>

      <header className="top sticky top-0 z-40 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:relative lg:bg-transparent lg:backdrop-blur-none">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6 lg:h-auto lg:border-b lg:px-0 lg:pb-7 lg:pt-7">
          <Brand />
          <div className="flex min-w-0 items-center gap-2.5">
            {ready && model && (
              <span data-testid="footer-sync" aria-live="polite" className="sr-only">
                {syncing ? "Sincronizando…" : model.footer}
              </span>
            )}
            {ready && <StatementSearch<Model> onConfirmed={(next) => setModel(next)} />}
            <ThemeToggle />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-9 shrink-0 rounded-[10px] bg-card" data-testid="menu" aria-label="Abrir menu">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem data-testid="menu-sync" disabled={syncing} onSelect={manualSync}>
                  <RefreshCw />
                  Sincronizar agora
                </DropdownMenuItem>
                {model && (
                  <p data-testid="menu-sync-status" className="px-2 pb-1.5 pl-8 text-xs text-muted-foreground">
                    {syncing ? "Sincronizando…" : model.footer}
                  </p>
                )}
                <DropdownMenuItem data-testid="menu-summary" disabled={sendingSummary} onSelect={sendSummary}>
                  <Mail />
                  Enviar resumo por e-mail
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="menu-connections" onSelect={() => setConnections(true)}>
                  <Plug />
                  Conexões
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="menu-tutorial" disabled={!ready} onSelect={() => window.setTimeout(() => setTouring(true), 120)}>
                  <CircleHelp />
                  Ver tutorial
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
        </div>
      </header>

      <div id="conteudo" className="mx-auto max-w-[1120px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-0 lg:pb-14">
        <h1 data-testid="page-title" className="sr-only">
          Meus planos
        </h1>
        <p data-testid="page-subtitle" className="sr-only">
          Suas assinaturas, encontradas automaticamente no seu cartão.
        </p>

        {!model && !error && <LoadingScreen />}
        {error && (
          <p data-testid="load-error" role="alert" className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            Não foi possível carregar seus planos.
          </p>
        )}

        {ready && model && desktop && (
          <section aria-label="Resumo" className="mt-8 grid grid-cols-[1.35fr_1fr_1fr] gap-4">
            <Tilt className="rise overflow-hidden rounded-[18px] border border-hero-border bg-hero px-6 py-[22px] text-hero-foreground">
              <HeroGlow />
              <Eyebrow className="text-hero-muted">Gasto mensal</Eyebrow>
              <p data-testid="monthly-total" className="mt-3 text-[52px] font-bold leading-none tracking-[-0.04em]">
                <PerMonth label={model.monthlyLabel} roll />
              </p>
              <p className="mt-2.5 text-sm text-hero-muted">
                <span data-testid="annual-total">{model.annualLabel}</span> · {plural(model.cards.length, "assinatura ativa", "assinaturas ativas")}
              </p>
            </Tilt>
            <StatCard index={1} label="Ativas" value={plural(model.cards.length, "assinatura", "assinaturas")} hint="Confirmadas no seu cartão" />
            <StatCard index={2} label="Para revisar" value={plural(model.suggestions.length, "sugestão", "sugestões")} hint="Encontradas no seu cartão" />
          </section>
        )}

        {ready && model && !desktop && (
          <section aria-label="Resumo" className="rise relative mt-4 overflow-hidden rounded-[20px] border border-hero-border bg-hero p-5 text-hero-foreground">
            <HeroGlow />
            <Eyebrow className="text-hero-muted">Gasto mensal</Eyebrow>
            <p data-testid="monthly-total" className="mt-2.5 text-[40px] font-bold leading-none tracking-[-0.04em]">
              <PerMonth label={model.monthlyLabel} roll />
            </p>
            <p data-testid="annual-total" className="mt-2 text-[13.5px] text-hero-muted">
              {model.annualLabel}
            </p>
            <MiniStats
              items={[
                { label: "Ativas", value: plural(model.cards.length, "assinatura", "assinaturas") },
                { label: "Para revisar", value: plural(model.suggestions.length, "sugestão", "sugestões") },
              ]}
            />
          </section>
        )}
        {ready && (connectionBanner || model?.firstRead) && (
          <div className="mt-5 space-y-3">
            {connectionBanner && (
              <BannerView
                banner={connectionBanner}
                testId="connection-banner"
                extra={Math.max(connectionBanners.length - 1, 0)}
                moreTestId="connection-banner-more"
                onMore={() => setConnectionBannerIndex((index) => (index + 1) % connectionBanners.length)}
                onAction={(action, id) => act(action, id)}
              />
            )}
            {model?.firstRead && (
              <p data-testid="first-read" className="text-sm text-muted-foreground">
                Primeira leitura em até 24 horas.
              </p>
            )}
          </div>
        )}

        {ready && model && tab && !desktop && (
          <div
            role="tablist"
            aria-label="Meus planos"
            data-testid="plan-tabs"
            onKeyDown={onTabsKey}
            className="mt-5 grid w-full grid-cols-2 rounded-xl border bg-card p-1 md:inline-grid md:w-auto"
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
                    "flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] px-5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground md:min-w-44",
                    selected && "bg-secondary text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
                  )}
                >
                  <span>{parts.name}</span>
                  <span className="font-medium tabular-nums text-muted-foreground"> {parts.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {ready && model && (
          <div className={cn(desktop && "mt-9 grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6")}>
            {showAssinaturas && (
              <section
                {...(desktop
                  ? { "aria-labelledby": "heading-assinaturas" }
                  : { role: "tabpanel", id: "panel-assinaturas", "aria-labelledby": "tab-assinaturas" })}
                data-testid="panel-assinaturas"
                className={cn("min-w-0", !desktop && "mt-4 space-y-4")}
              >
                {desktop && (
                  <SectionHeading id="heading-assinaturas" title="Assinaturas" count={model.cards.length} />
                )}
                {planBanner && (
                  <BannerView
                    banner={planBanner}
                    testId="banner"
                    extra={Math.max(planBanners.length - 1, 0)}
                    moreTestId="banner-more"
                    onMore={() => setPlanBannerIndex((index) => (index + 1) % planBanners.length)}
                    onAction={(action, id) => act(action, id)}
                    className={desktop ? "mb-3" : undefined}
                  />
                )}
                {model.cards.length === 0 ? (
                  <EmptyState
                    testId="empty-assinaturas"
                    legacy={model.empty}
                    title={(model.inactiveCards?.length ?? 0) > 0 ? "Nenhuma assinatura ativa" : "Nenhuma assinatura confirmada"}
                    hint={
                      model.empty
                        ? "Assim que uma cobrança recorrente aparecer no cartão, confirme para ela entrar no total."
                        : model.suggestions.length > 0
                          ? "Confirme uma sugestão para acompanhar o plano, o total e a última cobrança."
                          : "Os planos confirmados aparecem aqui, com o total do mês."
                    }
                    action={
                      model.suggestions.length > 0 && !desktop ? (
                        <Button data-testid="empty-goto-suggestions" onClick={() => selectTab("sugestoes")}>
                          Ver sugestões
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <div className={cn(desktop ? "overflow-hidden rounded-[18px] border bg-card" : "grid grid-cols-1 gap-3 md:grid-cols-2")}>
                    {model.cards.map((card, index) => (
                      <article
                        key={card.id}
                        data-testid="plan-card"
                        style={{ "--i": index } as CSSProperties}
                        className={cn(
                          "rise",
                          desktop
                            ? "grid grid-cols-[44px_minmax(0,1fr)_120px_106px_36px] items-center gap-x-2 border-b px-4 py-[18px] transition-colors last:border-b-0 hover:bg-accent/30 xl:grid-cols-[44px_minmax(0,1fr)_160px_116px_36px] 2xl:grid-cols-[44px_minmax(0,1fr)_176px_132px_36px] 2xl:gap-x-3"
                            : "pressable lift min-w-0 rounded-[18px] border bg-card p-4",
                        )}
                      >
                        <div className={cn(desktop ? "contents" : "flex items-center gap-3")}>
                          <button
                            type="button"
                            data-testid="change-logo"
                            className="pressable shrink-0 cursor-pointer rounded-xl"
                            title="Editar logo e link"
                            aria-label={`Editar logo e link de ${card.planName}`}
                            aria-expanded={editingLogo === card.id}
                            onClick={() => {
                              haptic(6);
                              setEditingLogo((current) => (current === card.id ? null : card.id));
                            }}
                          >
                            <ServiceMark
                              key={card.logoUrl ?? "none"}
                              src={card.logoUrl === undefined ? `/logos/${card.service}.svg` : card.logoUrl}
                              name={card.planName}
                              fallback={card.logoFallback === true}
                            />
                          </button>
                          <div className="min-w-0 flex-1">
                            <h2 data-testid="plan-name" className="truncate text-base font-semibold leading-snug">
                              {card.planName}
                            </h2>
                            <p data-testid="next-charge" className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                              {card.nextChargeLabel}
                            </p>
                          </div>
                          <p data-testid="plan-price" className={cn("shrink-0 text-right text-base font-semibold lg:text-[17px]", desktop && "col-start-4 row-start-1 min-w-0 border-l border-border/70 pl-2 tabular-nums xl:pl-3")}>
                            <PerMonth label={card.priceLabel} stacked />
                          </p>
                        </div>
                        <div className={cn("flex gap-2", desktop ? "col-start-3 row-start-1 min-w-0 flex-col items-stretch gap-1" : "mt-4")}>
                          {card.manageUrl ? (
                            <Button asChild className={desktop ? "h-[38px] w-full min-w-0 gap-1.5 px-2 text-xs" : "h-[42px] flex-1"}>
                              <a data-testid="manage" href={card.manageUrl} target="_blank" rel="noopener noreferrer" aria-label={card.manageLabel}>
                                <span className="truncate">{card.manageButton ?? "Gerenciar"}</span>
                                <ExternalLink className="size-3.5" />
                              </a>
                            </Button>
                          ) : (
                            <Button variant="outline" data-testid="add-manage-link" className={desktop ? "h-[38px] w-full min-w-0 gap-1.5 border-border/70 px-2 text-xs text-muted-foreground hover:text-foreground" : "h-[42px] flex-1"} onClick={() => setEditingLogo(card.id)}>
                              <Link2 className="size-3.5" aria-hidden="true" />
                              <span className="truncate">Adicionar link</span>
                            </Button>
                          )}
                          {!desktop && (
                            <Button variant="outline" className="h-[42px] flex-1" data-testid="remove" onClick={() => setPending(card)}>
                              Remover
                            </Button>
                          )}
                          {card.autoConfirmed && (
                            <Button variant="ghost" className={desktop ? "h-7 text-xs" : "h-[42px]"} data-testid="undo-auto" onClick={() => act("undo", card.id)}>
                              Desfazer
                            </Button>
                          )}
                        </div>
                        {desktop && (
                          <Button variant="ghost" size="icon-sm" className="col-start-5 row-start-1" data-testid="remove" title="Remover do Ciclo" onClick={() => setPending(card)}>
                            <Trash2 aria-hidden="true" />
                            <span className="sr-only">Remover</span>
                          </Button>
                        )}
                        {(card.logoFallback || card.notice || editingLogo === card.id) && (
                          <div className={cn("space-y-2", desktop ? "col-span-4 col-start-2 mt-3" : "mt-3")}>
                            {editingLogo === card.id ? (
                              <form
                                data-testid="plan-edit-form"
                                className="rise grid gap-3 rounded-xl border bg-background/40 p-3"
                                onSubmit={async (event) => {
                                  event.preventDefault();
                                  const data = new FormData(event.currentTarget);
                                  const url = String(data.get("manage-url") ?? "").trim();
                                  const currentUrl = card.customManageUrl ? (card.manageUrl ?? "") : "";
                                  const ok = url === currentUrl || (await act("set-manage-url", card.id, undefined, undefined, undefined, url));
                                  if (ok) setEditingLogo(null);
                                }}
                              >
                                <label className="grid gap-1 text-sm font-medium">
                                  Link do Gerenciar
                                  <Input
                                    name="manage-url"
                                    data-testid="manage-url-input"
                                    autoFocus
                                    className="h-10 text-sm font-normal"
                                    aria-label="Link do botão Gerenciar"
                                    defaultValue={card.customManageUrl ? (card.manageUrl ?? "") : ""}
                                    placeholder={card.manageUrl ?? "Ex.: https://chatgpt.com/settings/billing"}
                                  />
                                  <span className="text-[12px] font-normal text-muted-foreground">
                                    A página que o botão Gerenciar abre. O logo vem do mesmo site. Deixe vazio para usar o link padrão.
                                  </span>
                                </label>
                                <div className="flex gap-2">
                                  <Button type="submit" className="h-9 flex-1 sm:flex-none" data-testid="plan-edit-save">
                                    Salvar
                                  </Button>
                                  <Button type="button" variant="ghost" className="h-9 flex-1 sm:flex-none" onClick={() => setEditingLogo(null)}>
                                    Cancelar
                                  </Button>
                                </div>
                              </form>
                            ) : (
                              card.logoFallback && (
                                <form
                                  data-testid="logo-form"
                                  onSubmit={async (event) => {
                                    event.preventDefault();
                                    const domain = String(new FormData(event.currentTarget).get("domain") ?? "");
                                    await act("set-domain", card.id, undefined, domain);
                                  }}
                                >
                                  <Input name="domain" className="h-10 text-sm" aria-label="Site do serviço" placeholder="Site do serviço, para buscar o logo" />
                                </form>
                              )
                            )}
                            {card.notice && <p className="text-[13px] text-muted-foreground">{card.notice}</p>}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}

                {(model.inactiveCards?.length ?? 0) > 0 && (
                  <div data-testid="inactive-list" className={cn(desktop ? "mt-5" : "pt-3")}>
                    <Eyebrow className="mb-1 text-muted-foreground">Pararam de cobrar</Eyebrow>
                    <p className="mb-2.5 text-[13px] text-muted-foreground">
                      Sem cobrança no último ciclo. Saíram do total e voltam sozinhas se cobrarem de novo.
                    </p>
                    <div className="overflow-hidden rounded-[18px] border border-dashed bg-card/60">
                      {model.inactiveCards?.map((card) => (
                        <article
                          key={card.id}
                          data-testid="inactive-card"
                          className="flex min-w-0 flex-wrap items-center gap-3 border-b px-4 py-3.5 last:border-b-0 sm:flex-nowrap"
                        >
                          <div className="opacity-60">
                            <ServiceMark
                              src={card.logoUrl === undefined ? `/logos/${card.service}.svg` : card.logoUrl}
                              name={card.planName}
                              fallback={card.logoFallback === true}
                              small
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-[15px] font-semibold text-muted-foreground">{card.planName}</h3>
                            <p data-testid="inactive-label" className="truncate text-[13px] text-muted-foreground">
                              {card.inactiveLabel} · {card.priceLabel}
                            </p>
                          </div>
                          <div className="flex w-full gap-2 sm:w-auto">
                            <Button variant="outline" className="h-9 flex-1 sm:flex-none" data-testid="still-paying" onClick={() => act("still-paying", card.id)}>
                              Ainda pago
                            </Button>
                            <Button variant="ghost" className="h-9 flex-1 sm:flex-none" data-testid="remove-inactive" onClick={() => setPending(card)}>
                              Remover
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {!desktop && model.suggestions.length > 0 && (
                  <div className="pt-3">
                    <Eyebrow className="mb-2.5 text-muted-foreground">{plural(model.suggestions.length, "sugestão para revisar", "sugestões para revisar")}</Eyebrow>
                    <div className="grid gap-2 md:grid-cols-2">
                      {model.suggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          data-testid="suggestion-peek"
                          onClick={() => selectTab("sugestoes")}
                          className="pressable flex min-w-0 cursor-pointer items-center gap-3 rounded-[14px] border bg-card px-3.5 py-3 text-left hover:bg-accent"
                        >
                          <ServiceMark src={suggestion.logoUrl} name={suggestion.planName} fallback={suggestion.logoFallback === true || !suggestion.logoUrl} small />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{suggestion.planName}</span>
                            <span className="block truncate text-[13px] text-muted-foreground">
                              {suggestion.priceLabel}
                              {suggestion.confidence ? ` · confiança ${suggestion.confidence.score}%` : ""}
                            </span>
                          </span>
                          <span className="whitespace-nowrap text-xs font-semibold text-brand">Revisar ›</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {showSugestoes && (
              <section
                {...(desktop
                  ? { "aria-labelledby": "heading-sugestoes" }
                  : { role: "tabpanel", id: "panel-sugestoes", "aria-labelledby": "tab-sugestoes" })}
                data-testid="panel-sugestoes"
                className={cn("min-w-0", !desktop && "mt-4 space-y-4")}
              >
                {desktop && <SectionHeading id="heading-sugestoes" title="Sugestões" count={model.suggestions.length} />}
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
                      model.cards.length > 0 && !desktop ? (
                        <Button data-testid="empty-goto-assinaturas" onClick={() => selectTab("assinaturas")}>
                          Ver assinaturas
                        </Button>
                      ) : null
                    }
                  />
                ) : (
                  <>
                    {suggestionBanner && !desktop && (
                      <p data-testid="suggestion-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {suggestionBanner.text}
                      </p>
                    )}
                    <div className={cn("grid grid-cols-1 gap-3", !desktop && "md:grid-cols-2")}>
                      {model.suggestions.map((suggestion, index) => (
                        <Card
                          asArticle
                          key={suggestion.id}
                          data-testid="suggestion"
                          style={{ "--i": index } as CSSProperties}
                          className="rise lift flex min-w-0 flex-col rounded-[18px] p-[18px] transition-[transform,box-shadow] duration-300"
                        >
                          <div className="flex items-center gap-3">
                            <ServiceMark src={suggestion.logoUrl} name={suggestion.planName} fallback={suggestion.logoFallback === true || !suggestion.logoUrl} />
                            <div className="min-w-0 flex-1">
                              <h2 className="truncate text-base font-semibold leading-snug">{suggestion.planName}</h2>
                              {!suggestion.confidence && suggestion.label && <p className="mt-0.5 text-[13px] text-muted-foreground">{suggestion.label}</p>}
                              {!suggestion.confidence && suggestion.checked && <p className="mt-0.5 text-[13px] text-muted-foreground">Sugestão marcada</p>}
                            </div>
                            <p className="shrink-0 text-right text-base font-semibold lg:text-[17px]">
                              <PerMonth label={suggestion.priceLabel} stacked />
                            </p>
                          </div>
                          {suggestion.confidence && <ConfidenceBar confidence={suggestion.confidence} />}
                          {suggestion.apple && (
                            <label className="mt-4 grid gap-1.5 text-sm font-medium">
                              Serviço
                              <select
                                data-testid="apple-picker"
                                aria-label="Escolher o serviço desta assinatura da Apple"
                                className="h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
                                value={appleService[suggestion.id] ?? suggestion.appleGuess?.service ?? ""}
                                onChange={(event) => setAppleService((current) => ({ ...current, [suggestion.id]: event.target.value }))}
                              >
                                <option value="">Escolher serviço</option>
                                {suggestion.appleGuess && !model.appleChoices.some((choice) => choice.id === suggestion.appleGuess?.service) && (
                                  <option value={suggestion.appleGuess.service}>{suggestion.appleGuess.serviceName}</option>
                                )}
                                {model.appleChoices.map((choice) => (
                                  <option key={choice.id} value={choice.id}>
                                    {choice.label}
                                  </option>
                                ))}
                              </select>
                              {suggestion.appleGuess && (
                                <span data-testid="apple-guess" className="text-[13px] font-normal leading-snug text-muted-foreground">
                                  {suggestion.appleGuess.reason}
                                </span>
                              )}
                            </label>
                          )}
                          <div className="mt-auto flex gap-2 pt-4">
                            <Button className="h-[42px] flex-1" data-testid="suggestion-yes" onClick={() => confirmSuggestion(suggestion)}>
                              É assinatura
                            </Button>
                            <Button variant="outline" className="h-[42px] flex-1" data-testid="suggestion-no" onClick={() => act("ignore", suggestion.id)}>
                              Não é
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {removeDialogs}

      {touring && ready && tourSteps.length > 0 && <WelcomeTour steps={tourSteps} onClose={closeTour} />}

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

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Desktop shows both lists side by side. Phones and tablets use the tabs. */
function useDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "R$ 113,85/mês" keeps its text, with "/mês" set smaller (or on its own line). */
function PerMonth({ label, stacked = false, roll = false }: { label: string; stacked?: boolean; roll?: boolean }) {
  const cut = label.lastIndexOf("/");
  if (cut <= 0) return <>{label}</>;
  if (roll) {
    return (
      <>
        <RollingAmount text={label.slice(0, cut)} />
        <span className="ml-1 text-[0.38em] font-medium tracking-normal opacity-70">{label.slice(cut)}</span>
      </>
    );
  }
  if (stacked) {
    return (
      <>
        {label.slice(0, cut)}
        <span className="block text-xs font-medium text-muted-foreground">{label.slice(cut)}</span>
      </>
    );
  }
  return (
    <>
      {label.slice(0, cut)}
      <span className="ml-1 text-[0.38em] font-medium tracking-normal opacity-70">{label.slice(cut)}</span>
    </>
  );
}

function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn("text-xs font-semibold uppercase tracking-[0.08em]", className)}>{children}</p>;
}

function HeroGlow() {
  return <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-brand/10 blur-2xl" />;
}

function StatCard({ label, value, hint, index = 0 }: { label: string; value: string; hint: string; index?: number }) {
  return (
    <Tilt style={{ "--i": index } as CSSProperties} className="rise rounded-[18px] border bg-card px-6 py-[22px]">
      <Eyebrow className="text-muted-foreground">{label}</Eyebrow>
      <p className="mt-3.5 text-[30px] font-semibold leading-tight tracking-[-0.03em]">{value}</p>
      <p className="mt-2.5 text-sm text-muted-foreground">{hint}</p>
    </Tilt>
  );
}

function MiniStats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="mt-[18px] grid grid-cols-2 gap-2.5 border-t border-hero-border pt-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-hero-muted">{item.label}</dt>
          <dd className="mt-1 text-[17px] font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHeading({ id, title, count, note }: { id: string; title: string; count: number; note?: string }) {
  return (
    <div className="mb-3.5 flex items-baseline justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.02em]">
        {title}
        <Badge>{count}</Badge>
      </h2>
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
    </div>
  );
}

function Toast({ testId, tone = "default", children }: { testId: string; tone?: "default" | "error"; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-300",
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
        <CycleMark className="size-7" animated />
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
  className,
}: {
  banner: Banner;
  className?: string;
  testId: string;
  extra: number;
  moreTestId: string;
  onMore: () => void;
  onAction: (action: string, id: string) => void;
}) {
  return (
    <section data-testid={testId} role="status" className={cn("rounded-xl border px-4 py-3.5 text-sm", BANNER_TONES[banner.tone], className)}>
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

function ServiceMark({ src, name, fallback, small = false }: { src?: string | null; name: string; fallback?: boolean; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const box = small ? "size-9 rounded-[10px]" : "size-11 rounded-xl";
  if (fallback || !src || failed) {
    return (
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center bg-secondary text-base font-semibold text-foreground", box)}>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={cn("grid shrink-0 place-items-center bg-[#f7f4ee] ring-1 ring-black/5", box)}>
      <img className={cn("logo object-contain", small ? "size-5" : "size-6")} src={src} alt="" onError={() => setFailed(true)} />
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

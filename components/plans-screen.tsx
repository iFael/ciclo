"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Brand, CycleMark } from "@/components/brand";
import { bannerPlacement, isPlansTab, resolvePlansTab, tabLabelParts, type PlansTab } from "@/lib/plans-tabs";
import { shouldStartAutoSync, suggestionSummary, SYNC_COOLDOWN_MS } from "@/lib/sync-policy";

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
      if (!response.ok || !body?.ok) return { kind: "error" as const, message: "Não foi possível sincronizar agora." };
      const count = body.newSuggestions ?? 0;
      const plans = body.screen ?? (await readPlans());
      return { kind: "ok" as const, newSuggestions: count, message: body.message || suggestionSummary(count), plans };
    } catch {
      return { kind: "error" as const, message: "Não foi possível sincronizar agora." };
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
  const [menu, setMenu] = useState(false);
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
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  return (
    <main className="sheet" data-testid="screen" id="planos">
      <a className="skip" href="#planos">
        Ir para os planos
      </a>
      <header className="top">
        <div className="top-inner">
          <div className="brand-row">
            <Brand />
            <div className="menu">
              <button type="button" className="menu-button" data-testid="menu" aria-label="Abrir menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
                <MenuIcon />
              </button>
              {menu && (
                <>
                  <button className="menu-backdrop" type="button" aria-label="Fechar menu" onClick={() => setMenu(false)} />
                  <div className="menu-panel" role="menu">
                    <button
                      className="quiet"
                      role="menuitem"
                      data-testid="menu-sync"
                      disabled={syncing}
                      onClick={() => {
                        setMenu(false);
                        startSync("manual", undefined, syncedAtRef, setModel, setSyncing, setSyncToast, setSyncError);
                      }}
                    >
                      Sincronizar agora
                    </button>
                    <button className="quiet" role="menuitem" data-testid="menu-connections" onClick={() => setConnections(true)}>
                      Conexões
                    </button>
                    <button
                      className="quiet"
                      role="menuitem"
                      data-testid="menu-logout"
                      onClick={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        window.location.replace("/login");
                      }}
                    >
                      Sair
                    </button>
                    <button className="quiet" role="menuitem" data-testid="menu-delete" onClick={() => setErase(true)}>
                      Apagar meus dados
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="top-lead">
            <h1 data-testid="page-title">Meus planos</h1>
            <p className="subtitle" data-testid="page-subtitle">
              Suas assinaturas, encontradas automaticamente no seu cartão.
            </p>
            {ready && model && (
              <div className="sync-line">
                <p data-testid="footer-sync" aria-live="polite">
                  {syncing ? "Sincronizando…" : model.footer}
                </p>
                <button
                  type="button"
                  className="sync-button"
                  data-testid="sync-now"
                  aria-label="Sincronizar agora"
                  aria-busy={syncing}
                  disabled={syncing}
                  onClick={() => startSync("manual", undefined, syncedAtRef, setModel, setSyncing, setSyncToast, setSyncError)}
                >
                  <RefreshIcon />
                </button>
              </div>
            )}
          </div>
          {ready && model && tab === "assinaturas" && (
            <div className="summary">
              <p className="total" data-testid="monthly-total">
                {model.monthlyLabel}
              </p>
              <p className="annual" data-testid="annual-total">
                {model.annualLabel}
              </p>
            </div>
          )}
          {ready && model && tab && (
            <div className="tabs-bar">
              <div role="tablist" aria-label="Meus planos" className="tabs" data-testid="plan-tabs" onKeyDown={onTabsKey}>
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
                    >
                      <span>{parts.name}</span>
                      <span className="tab-count"> {parts.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="sheet-body">
        <div className="content">
          {!model && !error && <p data-testid="loading">Carregando planos…</p>}
          {error && (
            <p className="status status-error" data-testid="load-error">
              Não foi possível carregar seus planos.
            </p>
          )}

          {ready && model && tab && (
            <>
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
              {model.firstRead && <p data-testid="first-read">Primeira leitura em até 24 horas.</p>}

              {tab === "assinaturas" ? (
                <div role="tabpanel" id="panel-assinaturas" aria-labelledby="tab-assinaturas" data-testid="panel-assinaturas">
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
                          <button type="button" data-testid="empty-goto-suggestions" onClick={() => selectTab("sugestoes")}>
                            Ver sugestões
                          </button>
                        ) : null
                      }
                    />
                  ) : (
                    <section className="cards">
                      {model.cards.map((card) => (
                        <article key={card.id} className="card" data-testid="plan-card">
                          <div className="card-head">
                            <ServiceMark
                              src={card.logoUrl === undefined ? `/logos/${card.service}.svg` : card.logoUrl}
                              name={card.planName}
                              fallback={card.logoFallback === true}
                            />
                            <h2 className="plan-name" data-testid="plan-name">
                              {card.planName}
                            </h2>
                          </div>
                          <p className="price" data-testid="plan-price">
                            {card.priceLabel}
                          </p>
                          <p className="when" data-testid="next-charge">
                            {card.nextChargeLabel}
                          </p>
                          {card.logoFallback && (
                            <form
                              className="site-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                const domain = String(new FormData(event.currentTarget).get("domain") ?? "");
                                void act("set-domain", card.id, undefined, domain);
                              }}
                            >
                              <input name="domain" aria-label="Site do serviço" placeholder="Site do serviço" />
                            </form>
                          )}
                          {card.notice && <p className="hint">{card.notice}</p>}
                          <div className="row">
                            {card.manageUrl && (
                              <a data-testid="manage" className="button" href={card.manageUrl} target="_blank" rel="noopener noreferrer" aria-label={card.manageLabel}>
                                Gerenciar
                                <ExternalIcon />
                              </a>
                            )}
                            <button type="button" className="quiet" data-testid="remove" onClick={() => setPending(card)}>
                              Remover do Ciclo
                            </button>
                            {card.autoConfirmed && (
                              <button type="button" className="quiet" data-testid="undo-auto" onClick={() => act("undo", card.id)}>
                                Desfazer
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </section>
                  )}
                </div>
              ) : (
                <div role="tabpanel" id="panel-sugestoes" aria-labelledby="tab-sugestoes" data-testid="panel-sugestoes">
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
                          <button type="button" data-testid="empty-goto-assinaturas" onClick={() => selectTab("assinaturas")}>
                            Ver assinaturas
                          </button>
                        ) : null
                      }
                    />
                  ) : (
                    <>
                      {suggestionBanner && (
                        <p className="section-label" data-testid="suggestion-heading">
                          {suggestionBanner.text}
                        </p>
                      )}
                      <div className="suggestion-list">
                        {model.suggestions.map((suggestion) => (
                          <article key={suggestion.id} className="suggestion" data-testid="suggestion">
                            <div className="card-head">
                              <ServiceMark src={suggestion.logoUrl} name={suggestion.planName} fallback={suggestion.logoFallback === true || !suggestion.logoUrl} />
                              <div>
                                <h2 className="plan-name">{suggestion.planName}</h2>
                                {!suggestion.confidence && suggestion.label && <p className="hint">{suggestion.label}</p>}
                              </div>
                            </div>
                            <p className="price">{suggestion.priceLabel}</p>
                            {!suggestion.confidence && suggestion.checked && <p className="hint">Sugestão marcada</p>}
                            {suggestion.confidence && <ConfidenceBar confidence={suggestion.confidence} />}
                            {suggestion.apple && (
                              <label className="field">
                                Serviço
                                <select
                                  data-testid="apple-picker"
                                  aria-label="Escolher o serviço desta assinatura da Apple"
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
                            <div className="suggestion-actions">
                              <button type="button" data-testid="suggestion-yes" onClick={() => confirmSuggestion(suggestion)}>
                                É assinatura
                              </button>
                              <button type="button" className="quiet" data-testid="suggestion-no" onClick={() => act("ignore", suggestion.id)}>
                                Não é
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {pending && (
        <>
          <div className="backdrop" />
          <dialog open aria-modal="true" aria-labelledby="remove-title" data-testid="remove-dialog">
            <span className="grab" aria-hidden="true" />
            <h2 id="remove-title">Remover do Ciclo</h2>
            <p>{pending.removeConfirm}</p>
            <div className="row">
              <button
                type="button"
                data-testid="remove-confirm"
                onClick={async () => {
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
              </button>
              <button type="button" className="quiet" onClick={() => setPending(null)}>
                Voltar
              </button>
            </div>
          </dialog>
        </>
      )}

      {toastId && (
        <div className="toast" data-testid="undo-toast" role="status">
          <span>Plano removido do Ciclo.</span>
          <button
            type="button"
            onClick={() => {
              const id = toastId;
              setToastId(null);
              if (id) void act("undo", id);
            }}
          >
            Desfazer
          </button>
        </div>
      )}

      {addedToast > 0 && (
        <div className="toast" data-testid="added-toast" role="status">
          <span>Adicionado às assinaturas</span>
          <button type="button" data-testid="added-toast-open" aria-label="Ver assinaturas" onClick={() => selectTab("assinaturas", true)}>
            Ver
          </button>
        </div>
      )}

      {syncToast && (
        <div className="toast sync-toast" data-testid="sync-toast" role="status">
          <span>
            <strong>{syncToast.title}</strong>
            {syncToast.detail ? <span className="toast-detail">{syncToast.detail}</span> : null}
          </span>
        </div>
      )}

      {syncError && (
        <div className="toast toast-error" data-testid="sync-error" role="alert">
          <span>{syncError}</span>
        </div>
      )}

      {connections && model && (
        <>
          <div className="backdrop" />
          <dialog open aria-modal="true" aria-labelledby="conn-title">
            <span className="grab" aria-hidden="true" />
            <h2 id="conn-title">Conexões</h2>
            {model.connections.length === 0 && <p>Nenhuma conexão ainda.</p>}
            {model.connections.map((connection) => (
              <p key={`${connection.institution}-${connection.expiresLabel}`}>
                {connection.institution}: {connection.statusLabel}. Vencimento {connection.expiresLabel}.
              </p>
            ))}
            <a className="button" href="https://dashboard.pluggy.ai" target="_blank" rel="noopener noreferrer">
              Renovar
            </a>
            <button type="button" className="quiet" onClick={() => setConnections(false)}>
              Fechar
            </button>
          </dialog>
        </>
      )}

      {erase && (
        <>
          <div className="backdrop" />
          <dialog open aria-modal="true" aria-labelledby="erase-title">
            <span className="grab" aria-hidden="true" />
            <h2 id="erase-title">Apagar meus dados</h2>
            <p>Isso apaga os dados do Ciclo. Não cancela suas assinaturas no banco nem nos serviços.</p>
            <div className="row">
              <button
                type="button"
                data-testid="delete-confirm"
                onClick={async () => {
                  await fetch("/api/account/delete", { method: "POST" });
                  window.location.replace("/login");
                }}
              >
                Apagar meus dados
              </button>
              <button type="button" className="quiet" onClick={() => setErase(false)}>
                Voltar
              </button>
            </div>
          </dialog>
        </>
      )}
    </main>
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
    <div className="empty" data-testid={testId}>
      <span className="mark-chip" aria-hidden="true">
        <CycleMark />
      </span>
      {legacy ? <p data-testid="empty">Nenhuma assinatura encontrada</p> : <p className="empty-title">{title}</p>}
      <p className="hint">{hint}</p>
      {action}
    </div>
  );
}

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
    <section className={`notice notice-${banner.tone}`} data-testid={testId} role="status">
      <p>{banner.text}</p>
      {(banner.actions.length > 0 || extra > 0) && (
        <div className="banner-actions">
          {banner.actions.map((action) =>
            action.href ? (
              <a key={action.id} className="button" href={action.href} target="_blank" rel="noopener noreferrer">
                {action.label}
              </a>
            ) : (
              <button key={action.id} type="button" onClick={() => onAction(action.action ?? "", action.targetId ?? "")}>
                {action.label}
              </button>
            ),
          )}
          {extra > 0 && (
            <button type="button" className="quiet" data-testid={moreTestId} onClick={onMore}>
              +{extra} aviso(s)
            </button>
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
      <span className="mono" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img className="logo" src={src} alt="" onError={() => setFailed(true)} />;
}


function ConfidenceBar({ confidence }: { confidence: Confidence }) {
  return (
    <div className="confidence" data-testid="confidence">
      <div className="confidence-head">
        <span>{confidence.label}</span>
        <span>{confidence.score}%</span>
      </div>
      <div
        className="confidence-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={confidence.score}
        aria-label={`${confidence.label}, ${confidence.score}%`}
      >
        <div className="confidence-fill" style={{ width: `${confidence.score}%` }} />
      </div>
      <ul className="checks">
        {confidence.checks.map((check) => (
          <li key={check.id} className={check.passed ? "check on" : "check off"} title={check.label}>
            <span className="check-mark" aria-hidden="true">
              {check.passed ? "✓" : "–"}
            </span>
            <span>{check.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M14.4 9a5.4 5.4 0 1 1-1.5-3.7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14.5 3.1v3.3h-3.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="4" cy="9" r="1.4" fill="currentColor" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
      <circle cx="14" cy="9" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4h5M9 4v5M9 4 4 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 7v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

"use client";

import { useEffect, useState } from "react";

type Action = { id: string; label: string; href?: string; action?: string; targetId?: string };
type Banner = { id: string; tone: "red" | "yellow" | "neutral"; text: string; actions: Action[] };
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
};
type Suggestion = { id: string; planName: string; label: string | null; checked: boolean; priceLabel: string; apple: boolean };
type Model = {
  monthlyLabel: string;
  annualLabel: string;
  cards: Card[];
  suggestions: Suggestion[];
  banners: Banner[];
  footer: string;
  firstRead: boolean;
  empty: boolean;
  connections: { institution: string; statusLabel: string; expiresLabel: string }[];
  appleChoices: { id: string; label: string }[];
};

export function PlansScreen() {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState(false);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [menu, setMenu] = useState(false);
  const [connections, setConnections] = useState(false);
  const [pending, setPending] = useState<Card | null>(null);
  const [toastId, setToastId] = useState<string | null>(null);
  const [erase, setErase] = useState(false);
  const [appleService, setAppleService] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancel = false;
    fetch("/api/plans", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        return response.json() as Promise<Model>;
      })
      .then((data) => {
        if (!cancel) setModel(data);
      })
      .catch(() => {
        if (!cancel) setError(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function act(action: string, id: string, service?: string) {
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, service }),
    });
    if (!response.ok) {
      setError(true);
      return;
    }
    setModel((await response.json()) as Model);
  }

  const banner = model?.banners[bannerIndex] ?? model?.banners[0];
  const extra = model ? Math.max(model.banners.length - 1, 0) : 0;

  return (
    <main className="page" data-testid="screen" id="planos">
      <a className="skip" href="#planos">
        Ir para os planos
      </a>
      <header className="top">
        <div>
          <h1 data-testid="page-title">Meus planos</h1>
          <p className="subtitle" data-testid="page-subtitle">
            Suas assinaturas, encontradas automaticamente no seu cartão.
          </p>
        </div>
        <div className="menu">
          <button className="menu-button" data-testid="menu" aria-label="Abrir menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
            ⋯
          </button>
          {menu && (
            <div className="menu-panel card" role="menu">
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
          )}
        </div>
      </header>

      {!model && !error && <p data-testid="loading">Carregando planos…</p>}
      {error && <p data-testid="load-error">Não foi possível carregar seus planos.</p>}

      {model && !error && (
        <>
          <p className="total" data-testid="monthly-total">
            {model.monthlyLabel}
          </p>
          <p className="annual" data-testid="annual-total">
            {model.annualLabel}
          </p>

          {banner && (
            <section className={`banner banner-${banner.tone}`} data-testid="banner" role="status">
              <p>{banner.text}</p>
              <div className="banner-actions">
                {banner.actions.map((action) =>
                  action.href ? (
                    <a key={action.id} className="button" href={action.href} target="_blank" rel="noopener noreferrer">
                      {action.label}
                    </a>
                  ) : (
                    <button key={action.id} type="button" onClick={() => act(action.action ?? "", action.targetId ?? "")}>
                      {action.label}
                    </button>
                  ),
                )}
                {extra > 0 && (
                  <button
                    type="button"
                    className="quiet"
                    data-testid="banner-more"
                    onClick={() => setBannerIndex((index) => (index + 1) % model.banners.length)}
                  >
                    +{extra} aviso(s)
                  </button>
                )}
              </div>
              {banner.id === "suggestions" &&
                model.suggestions.map((suggestion) => (
                  <article key={suggestion.id} className="suggestion" data-testid="suggestion">
                    <h2 className="plan-name">{suggestion.planName}</h2>
                    {suggestion.label && <p>{suggestion.label}</p>}
                    <p>{suggestion.priceLabel}</p>
                    {suggestion.apple && (
                      <label>
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
                      <label>
                        <input type="checkbox" readOnly checked={suggestion.checked} /> sugestão marcada
                      </label>
                      <button
                        type="button"
                        data-testid="suggestion-yes"
                        onClick={() =>
                          suggestion.apple && appleService[suggestion.id]
                            ? act("pick-apple", suggestion.id, appleService[suggestion.id])
                            : act("confirm", suggestion.id)
                        }
                      >
                        É assinatura
                      </button>
                      <button type="button" className="quiet" data-testid="suggestion-no" onClick={() => act("ignore", suggestion.id)}>
                        Não é
                      </button>
                    </div>
                  </article>
                ))}
            </section>
          )}

          {model.firstRead && <p data-testid="first-read">Primeira leitura em até 24 horas.</p>}
          {model.empty && <p data-testid="empty">Nenhuma assinatura encontrada</p>}

          <section className="cards">
            {model.cards.map((card) => (
              <article key={card.id} className="card" data-testid="plan-card">
                <div className="card-head">
                  <Logo service={card.service} name={card.planName} />
                  <h2 className="plan-name" data-testid="plan-name">
                    {card.planName}
                  </h2>
                </div>
                <p className="price" data-testid="plan-price">
                  {card.priceLabel}
                </p>
                <p data-testid="next-charge">{card.nextChargeLabel}</p>
                {card.notice && <p>{card.notice}</p>}
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
          <footer className="footer" data-testid="footer-sync">
            {model.footer}
          </footer>
        </>
      )}

      {pending && (
        <dialog open aria-modal="true" aria-labelledby="remove-title" data-testid="remove-dialog">
          <h2 id="remove-title">Remover do Ciclo</h2>
          <p>{pending.removeConfirm}</p>
          <div className="row">
            <button
              type="button"
              data-testid="remove-confirm"
              onClick={async () => {
                await act("remove", pending.id);
                setToastId(pending.id);
                setPending(null);
              }}
            >
              Remover do Ciclo
            </button>
            <button type="button" className="quiet" onClick={() => setPending(null)}>
              Voltar
            </button>
          </div>
        </dialog>
      )}

      {toastId && (
        <div className="toast" data-testid="undo-toast" role="status">
          <span>Plano removido do Ciclo.</span>
          <button
            type="button"
            onClick={async () => {
              await act("undo", toastId);
              setToastId(null);
            }}
          >
            Desfazer
          </button>
        </div>
      )}

      {connections && model && (
        <dialog open aria-modal="true" aria-labelledby="conn-title">
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
      )}

      {erase && (
        <dialog open aria-modal="true" aria-labelledby="erase-title">
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
      )}
    </main>
  );
}

function Logo({ service, name }: { service: string; name: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <span className="mono" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // Native img so a missing file can fall back to the monogram instead of a broken image.
    <img className="logo" src={`/logos/${service}.svg`} alt="" onError={() => setOk(false)} />
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

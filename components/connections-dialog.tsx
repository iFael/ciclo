"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, ExternalLink, Landmark, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { ScreenConnection } from "@/lib/types";

type Props<M> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: ScreenConnection[];
  onScreen: (screen: M) => void;
  onNotice: (title: string, detail?: string) => void;
};

const TONE: Record<ScreenConnection["status"], string | undefined> = {
  active: undefined,
  expired: "border-transparent bg-destructive/15 text-destructive",
  error: "border-transparent bg-destructive/15 text-destructive",
};

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível falar com a Pluggy agora.");
  return data;
}

function currentTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ConnectionsDialog<M>({ open, onOpenChange, connections, onScreen, onNotice }: Props<M>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ScreenConnection | null>(null);
  // The bank is picked in MeuPluggy (another tab). When the person comes back, the Recontei authorization opens by itself.
  const [waiting, setWaiting] = useState(false);
  const openedAt = useRef(0);

  /** Opens Pluggy Connect. Without `connection` it adds a bank; with it, it renews that one. */
  async function connect(connection?: ScreenConnection) {
    setError(null);
    setBusy(connection?.id ?? "new");
    try {
      const { accessToken, updateItem, selectedConnectorId } = await post<{ accessToken: string; updateItem?: string; selectedConnectorId?: number }>({
        action: "token",
        id: connection?.id,
      });
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      // Pluggy Connect sits above our dialog, so ours steps aside while it is open.
      onOpenChange(false);
      const widget = new PluggyConnect({
        connectToken: accessToken,
        language: "pt",
        theme: currentTheme(),
        countries: ["BR"],
        ...(updateItem ? { updateItem } : {}),
        ...(selectedConnectorId ? { selectedConnectorId } : {}),
        // The widget returns the connection it made. The server reads it now instead of waiting for the webhook.
        onSuccess: async ({ item }: { item: { id: string } }) => {
          const title = connection ? "Conexão renovada" : "Banco conectado";
          onNotice(title, "Lendo os cartões. Isso leva alguns segundos.");
          try {
            const result = await post<{ screen: M }>({ action: "connected", item: item.id, renew: Boolean(connection) });
            onScreen(result.screen);
            onNotice(title, "Os cartões já aparecem em Conexões.");
          } catch (cause) {
            onNotice("Conectado na Pluggy", cause instanceof Error ? cause.message : undefined);
          }
        },
        onError: () => onNotice("A Pluggy não concluiu a conexão", "Tente de novo em alguns minutos."),
      });
      await widget.init();
    } catch (cause) {
      onOpenChange(true);
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir a Pluggy agora.");
    } finally {
      setBusy(null);
    }
  }

  function addBank() {
    setError(null);
    openedAt.current = Date.now();
    window.open("https://meu.pluggy.ai/connections", "_blank", "noopener,noreferrer");
    setWaiting(true);
  }

  function continueAdding() {
    setWaiting(false);
    void connect();
  }

  useEffect(() => {
    if (!waiting || !open) return;
    const back = () => {
      if (document.visibilityState !== "visible" || Date.now() - openedAt.current < 1500) return;
      setWaiting(false);
      void connect();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
    // connect only reads props that are stable while the dialog is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, open]);

  async function remove(connection: ScreenConnection) {
    setError(null);
    setBusy(connection.id);
    try {
      const result = await post<{ screen: M }>({ action: "remove", id: connection.id });
      onScreen(result.screen);
      setRemoving(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível remover agora.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => { if (!value) setWaiting(false); onOpenChange(value); }}>
        <DialogContent data-testid="connections-dialog">
          <DialogTitle>Conexões</DialogTitle>
          <DialogDescription>Os bancos e cartões que o Recontei lê. Ele só lê as compras, nunca mexe no dinheiro.</DialogDescription>
          <div className="grid max-h-[55vh] gap-2 overflow-y-auto">
            {connections.length === 0 && <p className="text-sm text-muted-foreground">Nenhum banco conectado ainda.</p>}
            {connections.map((connection) => (
              <div key={connection.id} data-testid="connection-row" className="grid gap-3 rounded-xl border bg-background/40 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{connection.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {connection.via ? `${connection.via} · ` : ""}Vence {connection.expiresLabel}
                    </p>
                  </div>
                  <Badge className={TONE[connection.status]}>{connection.statusLabel}</Badge>
                </div>
                {connection.accounts.length > 0 ? (
                  <ul className="grid gap-1.5">
                    {connection.accounts.map((account) => (
                      <li key={account.id} className="flex items-center gap-2.5">
                        {account.kind === "card" ? (
                          <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <Landmark className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{account.label}</span>
                          <span className="block text-xs text-muted-foreground">{account.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Os cartões aparecem aqui depois da próxima leitura.</p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={connection.status === "active" ? "outline" : "default"}
                    disabled={busy !== null}
                    onClick={() => void connect(connection)}
                  >
                    <RefreshCw className={busy === connection.id ? "animate-spin" : undefined} />
                    Renovar
                  </Button>
                  {connection.manageHref && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={connection.manageHref} target="_blank" rel="noopener noreferrer">
                        MeuPluggy
                        <ExternalLink />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={busy !== null}
                    onClick={() => setRemoving(connection)}
                    aria-label={`Remover ${connection.title}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {waiting && (
            <div data-testid="add-bank-waiting" className="grid gap-2 rounded-xl border bg-background/40 px-4 py-3 text-sm">
              <p className="font-semibold">Escolha o banco na aba do MeuPluggy</p>
              <p className="text-xs text-muted-foreground">
                Em Nova conexão, escolha a instituição. Quando voltar para o Recontei, a autorização abre sozinha.
              </p>
              <div className="flex gap-2">
                <Button size="sm" data-testid="add-bank-continue" onClick={continueAdding}>
                  Já adicionei
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setWaiting(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Fechar</Button>
            </DialogClose>
            <Button data-testid="connect-bank" disabled={busy !== null} onClick={addBank}>
              <Plus />
              Conectar banco
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(value) => !value && setRemoving(null)}>
        <DialogContent>
          <DialogTitle>Remover {removing?.title}?</DialogTitle>
          <DialogDescription>
            O Recontei para de ler esses cartões e a autorização na Pluggy é encerrada. As assinaturas que você já tem continuam aqui. Para voltar, é só conectar de novo.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" disabled={busy !== null} onClick={() => removing && void remove(removing)}>
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

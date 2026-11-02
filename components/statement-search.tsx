"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Group = {
  key: string;
  name: string;
  count: number;
  months: number;
  amountLabel: string;
  lastLabel: string;
  status: "plan" | "suggested" | "ignored" | null;
  charges: { date: string; label: string; amount: string }[];
};

const STATUS_LABEL: Record<NonNullable<Group["status"]>, string> = {
  plan: "Já é plano",
  suggested: "Nas sugestões",
  ignored: "Você recusou",
};

const EXAMPLES = ["ifood", "gran", "openai", "netflix"];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Subtle statement search: a magnifier in the header opens a sheet. */
export function StatementSearch<M>({ onConfirmed }: { onConfirmed: (model: M) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const id = ++request.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`);
        if (!response.ok) throw new Error("search");
        const data = (await response.json()) as { groups: Group[] };
        if (id === request.current) setGroups(data.groups);
      } catch {
        if (id === request.current) setFailed(true);
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const typed = query.trim().length >= 2;

  async function confirm(group: Group) {
    setSaving(group.key);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: group.key }),
      });
      if (!response.ok) throw new Error("confirm");
      onConfirmed((await response.json()) as M);
      setGroups((list) => list?.map((item) => (item.key === group.key ? { ...item, status: "plan" } : item)) ?? null);
    } catch {
      setFailed(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="size-9 shrink-0 rounded-[10px] bg-card"
        data-testid="search-open"
        aria-label="Buscar no extrato"
        title="Buscar no extrato"
        onClick={() => setOpen(true)}
      >
        <Search />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setGroups(null);
            setExpanded(null);
            setFailed(false);
          }
        }}
      >
        <DialogContent data-testid="search-dialog" className="max-h-[88dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] sm:top-[12%] sm:max-w-lg sm:translate-y-0">
          <div>
            <DialogTitle>Buscar no extrato</DialogTitle>
            <DialogDescription>Os últimos 14 meses do cartão. Marque o que for assinatura e o Ciclo passa a reconhecer sozinho.</DialogDescription>
          </div>
          <label className="flex h-11 items-center gap-2 rounded-xl border bg-background px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              data-testid="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ifood, gran, openai…"
              aria-label="O que buscar"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              maxLength={60}
            />
            {query && (
              <button type="button" aria-label="Limpar busca" className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-accent" onClick={() => setQuery("")}>
                <X className="size-4" />
              </button>
            )}
          </label>
          <div className="-mx-1 min-h-0 overflow-y-auto px-1" aria-live="polite">
            {!typed && (
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setQuery(example)}
                    className="cursor-pointer rounded-full border bg-background px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
            {typed && loading && groups === null && <p className="py-6 text-center text-sm text-muted-foreground">Buscando…</p>}
            {typed && failed && <p className="py-6 text-center text-sm text-destructive">Não foi possível buscar agora. Tente de novo.</p>}
            {typed && !failed && groups !== null && groups.length === 0 && (
              <p data-testid="search-empty" className="py-6 text-center text-sm text-muted-foreground">
                Nada com &quot;{query.trim()}&quot; no extrato.
              </p>
            )}
            {typed && groups && groups.length > 0 && (
              <ul className={cn("grid grid-cols-[minmax(0,1fr)] gap-2 transition-opacity", loading && "opacity-60")}>
                {groups.map((group) => (
                  <li key={group.key} data-testid="search-group" className="rounded-[14px] border bg-background/40">
                    <div className="flex items-center gap-3 px-3.5 py-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        aria-expanded={expanded === group.key}
                        onClick={() => setExpanded((current) => (current === group.key ? null : group.key))}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">{group.name}</span>
                          <span className="block text-[13px] text-muted-foreground">
                            {plural(group.count, "cobrança", "cobranças")} · {plural(group.months, "mês", "meses")}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {group.amountLabel} · {group.lastLabel}
                          </span>
                        </span>
                        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded === group.key && "rotate-180")} aria-hidden="true" />
                      </button>
                      {group.status === "plan" ? (
                        <Badge className="shrink-0 rounded-md py-1">
                          <Check className="size-3 text-success" aria-hidden="true" />
                          {STATUS_LABEL.plan}
                        </Badge>
                      ) : (
                        <Button size="sm" className="h-9 shrink-0" data-testid="search-confirm" disabled={saving === group.key} onClick={() => confirm(group)}>
                          {saving === group.key ? "Salvando…" : "É assinatura"}
                        </Button>
                      )}
                    </div>
                    {group.status && group.status !== "plan" && (
                      <p className="-mt-1 px-3.5 pb-2 text-xs text-muted-foreground">{STATUS_LABEL[group.status]}</p>
                    )}
                    {expanded === group.key && (
                      <ul className="border-t px-3.5 py-2 text-[13px]">
                        {group.charges.map((charge) => (
                          <li key={`${charge.date}-${charge.amount}`} className="flex justify-between py-1 tabular-nums text-muted-foreground">
                            <span>{charge.label}</span>
                            <span className="text-foreground">{charge.amount}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

import type { TransactionQuery } from "@/lib/dates";
import type { PluggyAccount, PluggyItem, PluggyPage, PluggyTransaction } from "@/lib/pluggy/types";

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const API = "https://api.pluggy.ai";

export function appendNext(firstUrl: string, next: string): string {
  if (next.startsWith("http://") || next.startsWith("https://")) return next;
  const base = new URL(firstUrl);
  const originPath = `${base.origin}${base.pathname}`;
  if (next.startsWith("/")) return `${base.origin}${next}`;
  if (next.startsWith("?")) return originPath + next;
  if (next.startsWith("&")) return `${originPath}?${next.slice(1)}`;
  return `${originPath}?${next}`;
}

export type PluggySource = {
  getItem(id: string): Promise<import("@/lib/pluggy/types").PluggyItem>;
  getAccounts(itemId: string): Promise<import("@/lib/pluggy/types").PluggyAccount[]>;
  listTransactions(query: TransactionQuery): Promise<import("@/lib/pluggy/types").PluggyTransaction[]>;
};

export class PluggyClient implements PluggySource {
  private apiKey: string | null = null;

  constructor(
    private readonly options: { clientId: string; clientSecret: string; fetchImpl?: FetchLike },
  ) {}

  private fetchImpl: FetchLike = (input, init) => this.options.fetchImpl?.(input, init) ?? fetch(input, init);

  private async key(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    const response = await this.fetchImpl(`${API}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: this.options.clientId, clientSecret: this.options.clientSecret }),
    });
    if (!response.ok) throw new Error("pluggy_auth_failed");
    const body = (await response.json()) as { apiKey?: string };
    if (!body.apiKey) throw new Error("pluggy_auth_failed");
    this.apiKey = body.apiKey;
    return body.apiKey;
  }

  private async getJson<T>(url: string): Promise<T> {
    const apiKey = await this.key();
    const response = await this.fetchImpl(url, { headers: { "X-API-KEY": apiKey } });
    if (!response.ok) throw new Error(`pluggy_${response.status}`);
    return (await response.json()) as T;
  }

  async getItem(id: string): Promise<PluggyItem> {
    return this.getJson<PluggyItem>(`${API}/items/${id}`);
  }

  async getAccounts(itemId: string): Promise<PluggyAccount[]> {
    const page = await this.getJson<PluggyPage<PluggyAccount>>(`${API}/accounts?itemId=${encodeURIComponent(itemId)}`);
    return (page.results ?? []).filter((account) => account.type === "BANK" || account.type === "CREDIT");
  }

  async listTransactions(query: TransactionQuery): Promise<PluggyTransaction[]> {
    if (query.dateFrom && query.createdAtFrom) {
      throw new Error("dateFrom e createdAtFrom não podem ir juntos");
    }
    const url = new URL(`${API}/v2/transactions`);
    url.searchParams.set("accountId", query.accountId);
    if (query.dateFrom) url.searchParams.set("dateFrom", query.dateFrom);
    if (query.createdAtFrom) url.searchParams.set("createdAtFrom", query.createdAtFrom);
    const rows: PluggyTransaction[] = [];
    let nextUrl: string | null = url.toString();
    const seen = new Set<string>();
    while (nextUrl) {
      if (seen.has(nextUrl)) break;
      seen.add(nextUrl);
      const page: PluggyPage<PluggyTransaction> = await this.getJson(nextUrl);
      rows.push(...(page.results ?? []));
      if (!page.next) break;
      nextUrl = appendNext(url.toString(), page.next);
    }
    return rows;
  }
}

export function createPluggyFromEnv(): PluggyClient | null {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new PluggyClient({ clientId, clientSecret });
}

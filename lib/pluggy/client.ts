import type { TransactionQuery } from "@/lib/dates";
import {
  parseOrThrow,
  parseRows,
  pluggyAccountSchema,
  pluggyAuthSchema,
  pluggyItemSchema,
  pluggyPageSchema,
  pluggyTransactionSchema,
  type PluggyAccount,
  type PluggyItem,
  type PluggyTransaction,
} from "@/lib/pluggy/schemas";
import { safeLog } from "@/lib/security";

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
  getItem(id: string): Promise<PluggyItem>;
  getAccounts(itemId: string): Promise<PluggyAccount[]>;
  listTransactions(query: TransactionQuery): Promise<PluggyTransaction[]>;
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
    const body = pluggyAuthSchema.safeParse(await response.json());
    if (!body.success) throw new Error("pluggy_auth_failed");
    this.apiKey = body.data.apiKey;
    return body.data.apiKey;
  }

  private async getJson(url: string): Promise<unknown> {
    const apiKey = await this.key();
    const response = await this.fetchImpl(url, { headers: { "X-API-KEY": apiKey } });
    if (!response.ok) throw new Error(`pluggy_${response.status}`);
    return response.json();
  }

  /** Reads one page and keeps only the rows that pass `schema`. */
  private async getPage<T extends Parameters<typeof parseRows>[0]>(url: string, schema: T, what: string) {
    const page = parseOrThrow(pluggyPageSchema, await this.getJson(url), `${what}_page`);
    const { rows, dropped } = parseRows(schema, page.results ?? []);
    if (dropped > 0) console.info(JSON.stringify(safeLog({ count: dropped, status: "dropped", errorCode: `pluggy_invalid_${what}` })));
    return { rows, next: page.next ?? null };
  }

  async getItem(id: string): Promise<PluggyItem> {
    return parseOrThrow(pluggyItemSchema, await this.getJson(`${API}/items/${encodeURIComponent(id)}`), "item");
  }

  async getAccounts(itemId: string): Promise<PluggyAccount[]> {
    const page = await this.getPage(`${API}/accounts?itemId=${encodeURIComponent(itemId)}`, pluggyAccountSchema, "account");
    return page.rows.filter((account) => account.type === "BANK" || account.type === "CREDIT");
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
      const page = await this.getPage(nextUrl, pluggyTransactionSchema, "transaction");
      rows.push(...page.rows);
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

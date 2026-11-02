import { z } from "zod";

/**
 * Runtime checks for what Pluggy sends. TypeScript `as` casts only describe the
 * shape; these schemas verify it. Unknown fields are dropped, so raw card
 * metadata never travels further than the two fields we use.
 */

/** Pluggy sends `null` for many absent fields. Treat it like a missing one. */
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? undefined).optional();

const text = z.string();

/** Item ids go into URLs, so only the characters Pluggy ids use. */
export const pluggyIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

const isoDate = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value)), {
  message: "data inválida",
});

/** A number, or a numeric string, that ends up finite. */
const amount = z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().finite());

export const pluggyAuthSchema = z.object({ apiKey: z.string().min(1) });

export const pluggyItemSchema = z.object({
  id: pluggyIdSchema,
  status: optional(text),
  executionStatus: optional(text),
  consentExpiresAt: isoDate.nullish(),
  connector: optional(z.object({ id: optional(z.union([text, z.number()]).transform(String)), name: optional(text) })),
  error: z.object({ code: optional(text) }).nullish(),
  products: optional(z.array(text)),
});

export const pluggyAccountSchema = z.object({
  id: pluggyIdSchema,
  type: optional(text),
  itemId: optional(text),
});

export const pluggyTransactionSchema = z.object({
  id: z.string().min(1),
  description: optional(text),
  amount,
  date: isoDate,
  accountId: optional(text),
  currencyCode: optional(text),
  amountInAccountCurrency: amount.nullish(),
  type: optional(text),
  category: text.nullish(),
  operationType: text.nullish(),
  creditCardMetadata: z
    .object({
      transactionDateTime: optional(isoDate),
      payeeMCC: optional(z.number()),
      installmentNumber: optional(z.number()),
      totalInstallments: optional(z.number()),
    })
    .nullish(),
});

/** Rows stay unknown here so one bad row does not sink the whole page. */
export const pluggyPageSchema = z.object({
  results: optional(z.array(z.unknown())),
  next: text.nullish(),
});

export const pluggyWebhookSchema = z.object({
  event: optional(text),
  itemId: optional(pluggyIdSchema),
  transactionIds: optional(z.array(text)),
});

export type PluggyItem = z.infer<typeof pluggyItemSchema>;
export type PluggyAccount = z.infer<typeof pluggyAccountSchema>;
export type PluggyTransaction = z.infer<typeof pluggyTransactionSchema>;
export type PluggyWebhook = z.infer<typeof pluggyWebhookSchema>;

/** Error raised when Pluggy answers with a shape we do not accept. Carries no payload. */
export class PluggyShapeError extends Error {
  constructor(
    readonly what: string,
    readonly issues: string[],
  ) {
    super(`pluggy_invalid_${what}`);
    this.name = "PluggyShapeError";
  }
}

/** Field paths and messages only, never values, so logs stay free of card data. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`);
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new PluggyShapeError(what, describeIssues(result.error));
  return result.data;
}

/** Keeps the rows that pass and counts the ones dropped. */
export function parseRows<T extends z.ZodType>(schema: T, rows: unknown[]): { rows: z.infer<T>[]; dropped: number } {
  const kept: z.infer<T>[] = [];
  let dropped = 0;
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) kept.push(result.data);
    else dropped += 1;
  }
  return { rows: kept, dropped };
}

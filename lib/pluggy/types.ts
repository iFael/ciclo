export type PluggyItem = {
  id: string;
  status?: string;
  executionStatus?: string;
  consentExpiresAt?: string | null;
  connector?: { id?: string; name?: string };
  error?: { code?: string } | null;
  products?: string[];
};

export type PluggyAccount = {
  id: string;
  type?: string;
  itemId?: string;
};

export type PluggyTransaction = {
  id: string;
  description?: string;
  amount: number;
  date: string;
  accountId?: string;
  currencyCode?: string;
  creditCardMetadata?: { transactionDateTime?: string; payeeMCC?: number } | null;
};

export type PluggyPage<T> = {
  results?: T[];
  next?: string | null;
};

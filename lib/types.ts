export type SubscriptionStatus = "suggested" | "confirmed" | "dismissed" | "ignored" | "cancelled";

export type ConnectionStatus = "active" | "expired" | "replaced" | "error" | "removed";

/** What the Conexões screen shows of one account. No balance, no full number. */
export type ConnectionAccount = {
  id: string;
  kind: "card" | "account";
  name: string | null;
  brand: string | null;
  last4: string | null;
};

export type Connection = {
  id: string;
  itemId: string;
  institution: string | null;
  connectorId: string | null;
  status: ConnectionStatus;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastSyncHadData: boolean;
  lastDataThrough: string | null;
  /** Completed transaction import contract version. */
  importVersion?: number;
  /** Cards and accounts Pluggy listed on the last read. Empty until the first read. */
  accounts?: ConnectionAccount[];
};

export type Subscription = {
  id: string;
  service: string;
  planName: string;
  status: SubscriptionStatus;
  dismissedAt: string | null;
  approximate: boolean;
  merchantKey: string;
  amount: number;
  expectedChargeDate: string | null;
  checked: boolean;
  autoConfirmed: boolean;
  planChangeNotice: string | null;
  undoStatus: SubscriptionStatus | null;
  suppressAutoConfirm: boolean;
  cancelPromptSnoozeDate: string | null;
  descriptors: string[];
  suggestionLabel: string | null;
  /** Link the user set for the Gerenciar button. Wins over the catalog and the store. */
  manageUrl?: string | null;
  /** Explicitly approved merchant + account patterns; never learned from similar prices alone. */
  paymentMatches?: { key: string; accountId: string; amount: number }[];
};

export type Charge = {
  subscriptionId: string;
  chargeDate: string;
  amount: number;
  transactionId: string;
  resolved: boolean;
};

export type AppState = {
  connections: Connection[];
  subscriptions: Subscription[];
  charges: Charge[];
  ignoredDescriptors: string[];
};

export type StoredTx = {
  id: string;
  itemId: string;
  accountId: string;
  amount: number;
  description: string;
  chargeDate: string;
  foreignCharge: boolean;
  type?: string | null;
  category?: string | null;
  operationType?: string | null;
  originalAmount?: number | null;
  status?: string | null;
  descriptionRaw?: string | null;
  merchantName?: string | null;
  counterpartyName?: string | null;
  /** Only business / personal classification; never store document numbers. */
  counterpartyKind?: "business" | "person" | null;
  paymentMethod?: string | null;
};

export type ScreenAction = {
  id: string;
  label: string;
  href?: string;
  action?: string;
  targetId?: string;
};

export type ScreenBanner = {
  id: string;
  tone: "red" | "yellow" | "neutral";
  text: string;
  actions: ScreenAction[];
};

export type ServiceLogo = {
  merchantKey: string;
  domain: string | null;
  logoUrl: string | null;
  sourceUrl: string | null;
  source: "catalog" | "site" | "google" | "duckduckgo" | "fallback";
  resolvedAt: string;
  status: "ok" | "fallback";
  /** Chosen by the user through "Site do serviço"; wins over the catalog. */
  pinned?: boolean;
};

export type ScreenCheck = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
};

export type ScreenCard = {
  id: string;
  service: string;
  planName: string;
  company: string;
  priceLabel: string;
  nextChargeLabel: string;
  /** Who bills the plan: the App Store, Google Play or the service itself. */
  channel: "apple" | "google-play" | "direct";
  manageUrl: string | null;
  /** Visible text: "Gerenciar na Apple", "Gerenciar no Google Play" or "Gerenciar no site". */
  manageButton: string;
  manageLabel: string;
  /** True when the link came from the user, not the catalog. */
  customManageUrl: boolean;
  removeConfirm: string;
  autoConfirmed: boolean;
  notice: string | null;
  logoUrl: string | null;
  logoFallback: boolean;
  /** Set when a confirmed plan stopped being charged. Not counted in the total. */
  inactiveLabel?: string | null;
};

export type ScreenSuggestion = {
  id: string;
  planName: string;
  label: string | null;
  checked: boolean;
  priceLabel: string;
  apple: boolean;
  /** Prefilled pick for an App Store charge, with the reason shown to the user. */
  appleGuess: { service: string; serviceName: string; planName: string; reason: string; replaces: string | null } | null;
  logoUrl: string | null;
  logoFallback: boolean;
  confidence: { score: number; label: string; checks: ScreenCheck[] };
};

export type ScreenModel = {
  monthlyLabel: string;
  annualLabel: string;
  monthlyTotal: number;
  annualApprox: number;
  cards: ScreenCard[];
  /** Confirmed plans with no charge in the last cycle while the bank kept sending data. */
  inactiveCards: ScreenCard[];
  suggestions: ScreenSuggestion[];
  banners: ScreenBanner[];
  footer: string;
  syncedAt: string | null;
  firstRead: boolean;
  empty: boolean;
  connections: ScreenConnection[];
  appleChoices: { id: string; label: string }[];
};

export type ScreenConnection = {
  id: string;
  title: string;
  via: string | null;
  accounts: { id: string; kind: "card" | "account"; label: string; detail: string }[];
  status: Exclude<ConnectionStatus, "removed" | "replaced">;
  statusLabel: string;
  expiresLabel: string;
  manageHref: string | null;
};

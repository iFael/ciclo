export type SubscriptionStatus = "suggested" | "confirmed" | "dismissed" | "ignored" | "cancelled";

export type ConnectionStatus = "active" | "expired" | "replaced" | "error";

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

export type ScreenCard = {
  id: string;
  service: string;
  planName: string;
  company: string;
  priceLabel: string;
  nextChargeLabel: string;
  manageUrl: string | null;
  manageLabel: string;
  removeConfirm: string;
  autoConfirmed: boolean;
  notice: string | null;
};

export type ScreenSuggestion = {
  id: string;
  planName: string;
  label: string | null;
  checked: boolean;
  priceLabel: string;
  apple: boolean;
};

export type ScreenModel = {
  monthlyLabel: string;
  annualLabel: string;
  monthlyTotal: number;
  annualApprox: number;
  cards: ScreenCard[];
  suggestions: ScreenSuggestion[];
  banners: ScreenBanner[];
  footer: string;
  firstRead: boolean;
  empty: boolean;
  connections: { institution: string; statusLabel: string; expiresLabel: string }[];
  appleChoices: { id: string; label: string }[];
};

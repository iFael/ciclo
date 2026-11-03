-- Persist transaction evidence separately from subscription classification.
-- Only minimal payee identity is stored; never payer/receiver account numbers or documents.
alter table public.transactions add column if not exists original_amount numeric;
alter table public.transactions add column if not exists tx_status text;
alter table public.transactions add column if not exists description_raw text;
alter table public.transactions add column if not exists merchant_name text;
alter table public.transactions add column if not exists counterparty_name text;
alter table public.transactions add column if not exists counterparty_kind text;
alter table public.transactions add column if not exists payment_method text;

-- Confirmed payee/account patterns are explicit user choices, not automatic guesses.
alter table public.subscriptions
  add column if not exists payment_matches jsonb not null default '[]'::jsonb;

-- Each connected item replays its full transaction window once after this contract change.
alter table public.connections
  add column if not exists import_version integer not null default 1;

create index if not exists transactions_account_charge_date_idx
  on public.transactions (account_id, charge_date);

-- Existing RLS and service-role-only access remain in force.

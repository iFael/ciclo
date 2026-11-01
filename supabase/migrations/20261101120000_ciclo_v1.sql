-- Ciclo v1. Apply manually in the Supabase SQL editor. Do not run this from the app.
-- The server uses the service role. The browser has no table access.

create extension if not exists pgcrypto;

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,
  institution text,
  connector_id text,
  status text not null check (status in ('active', 'expired', 'replaced', 'error')),
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  last_sync_had_data boolean not null default false,
  last_data_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id text primary key,
  item_id text not null,
  account_id text not null,
  amount numeric not null,
  description text not null,
  charge_date date not null,
  foreign_charge boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  plan_name text not null,
  status text not null check (status in ('suggested', 'confirmed', 'dismissed', 'ignored', 'cancelled')),
  dismissed_at timestamptz,
  approximate boolean not null default false,
  merchant_key text not null unique,
  amount numeric not null,
  expected_charge_date date,
  checked boolean not null default false,
  auto_confirmed boolean not null default false,
  plan_change_notice text,
  undo_status text,
  suppress_auto_confirm boolean not null default false,
  cancel_prompt_snooze_date date,
  descriptors text[] not null default '{}',
  suggestion_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  charge_date date not null,
  amount numeric not null,
  transaction_id text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (subscription_id, charge_date)
);

create table public.ignored_descriptors (
  id uuid primary key default gen_random_uuid(),
  descriptor text not null unique,
  created_at timestamptz not null default now()
);

create table public.reminders_sent (
  id uuid primary key default gen_random_uuid(),
  reminder_key text not null unique,
  kind text not null,
  sent_at timestamptz not null default now()
);

create index transactions_charge_date_idx on public.transactions (charge_date);
create index charges_subscription_idx on public.charges (subscription_id);

alter table public.connections enable row level security;
alter table public.transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.charges enable row level security;
alter table public.ignored_descriptors enable row level security;
alter table public.reminders_sent enable row level security;

alter table public.connections force row level security;
alter table public.transactions force row level security;
alter table public.subscriptions force row level security;
alter table public.charges force row level security;
alter table public.ignored_descriptors force row level security;
alter table public.reminders_sent force row level security;

revoke all on table public.connections from anon, authenticated;
revoke all on table public.transactions from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.charges from anon, authenticated;
revoke all on table public.ignored_descriptors from anon, authenticated;
revoke all on table public.reminders_sent from anon, authenticated;

grant all on table public.connections to service_role;
grant all on table public.transactions to service_role;
grant all on table public.subscriptions to service_role;
grant all on table public.charges to service_role;
grant all on table public.ignored_descriptors to service_role;
grant all on table public.reminders_sent to service_role;

insert into storage.buckets (id, name, public)
values ('ciclo-backups', 'ciclo-backups', false)
on conflict (id) do nothing;

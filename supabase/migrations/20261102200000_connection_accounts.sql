-- The cards and accounts of each connection, for the Conexões screen.
-- Only name, brand and last four digits. No balance, no full number.
alter table public.connections add column if not exists accounts jsonb not null default '[]'::jsonb;

-- A connection the user removed in the app. Kept so the cron does not read it again.
alter table public.connections drop constraint if exists connections_status_check;
alter table public.connections
  add constraint connections_status_check check (status in ('active', 'expired', 'replaced', 'error', 'removed'));

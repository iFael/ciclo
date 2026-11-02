-- A link chosen by the user for the Gerenciar button. Wins over the catalog
-- and the store. Null means: use the catalog or the store link.
alter table public.subscriptions add column if not exists manage_url text;

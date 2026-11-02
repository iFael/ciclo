-- A logo chosen by the user ("Site do serviço") wins over the catalog.
alter table public.service_logos add column if not exists pinned boolean not null default false;

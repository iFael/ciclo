-- Suggestion quality cleanup and logo cache.
-- Idempotent. Apply manually in the Supabase SQL editor. Do not run this from the app.
-- Confirmed plans and ignored rows are not deleted.
-- Suggestions the user sent back to the list (suppress_auto_confirm) are kept.

create table if not exists public.service_logos (
  merchant_key text primary key,
  domain text,
  logo_url text,
  source_url text,
  source text,
  resolved_at timestamptz not null default now(),
  status text not null default 'fallback'
);

alter table public.service_logos enable row level security;
alter table public.service_logos force row level security;
revoke all on table public.service_logos from anon, authenticated;
grant all on table public.service_logos to service_role;

alter table public.transactions add column if not exists tx_type text;
alter table public.transactions add column if not exists category text;
alter table public.transactions add column if not exists operation_type text;

-- Confirmed plans store the last real charge, not a projected next date.
update public.subscriptions as subscription
set expected_charge_date = latest.last_charge,
    updated_at = now()
from (
  select subscription_id, max(charge_date) as last_charge
  from public.charges
  group by subscription_id
) as latest
where subscription.id = latest.subscription_id
  and subscription.status = 'confirmed'
  and subscription.expected_charge_date is distinct from latest.last_charge;

-- Noise, generic descriptors, and suggestions that are not an active monthly streak.
with noisy as (
  select subscription.id
  from public.subscriptions as subscription
  where subscription.status = 'suggested'
    and subscription.suppress_auto_confirm = false
    and (
      exists (
        select 1
        from unnest(subscription.descriptors) as raw(value)
        where trim(regexp_replace(upper(translate(coalesce(raw.value, ''),
          'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
          'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
        )), '[^A-Z0-9]+', ' ', 'g')) ~ '(JUROS|MULTA|IOF|PIX|TED|DOC|ESTORNO|PARCELA|TARIFA|BOLETO|REEMBOLSO|DEVOLUCAO|ANUIDADE|ASSINATURA VIA APPLE|APPLE COM BILL|APPLECOMBILL|GOOGLE PLAY|APP STORE|PLAY STORE|ITUNES)'
      )
      or (
        select count(distinct to_char(charge.charge_date, 'YYYY-MM'))
        from public.charges as charge
        where charge.subscription_id = subscription.id
      ) < 3
      or (
        select max(charge.charge_date)
        from public.charges as charge
        where charge.subscription_id = subscription.id
      ) < (current_date - 45)
      or not exists (
        select 1 from public.charges as charge where charge.subscription_id = subscription.id
      )
    )
)
delete from public.subscriptions as subscription
using noisy
where subscription.id = noisy.id;

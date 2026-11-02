-- Repair plans confirmed from a suggestion and then removed with "Remover do Ciclo".
-- That action used to set status = dismissed and dismissed_at = now for every plan.
-- A user-confirmed suggestion (suppress_auto_confirm, undo_status confirmed) belongs
-- back on the "possíveis assinaturas" list. dismissed + dismissed_at stays the
-- "stop tracking" state: a later charge still raises "Ainda cobrando" for plans
-- that were not in that list. Undo keeps working because undo_status stays confirmed.
--
-- Idempotent: a second run matches nothing, because those rows are no longer dismissed.
-- Apply manually in the Supabase SQL editor. The app does not run this.

update public.subscriptions
set
  status = 'suggested',
  dismissed_at = null,
  suggestion_label = coalesce(suggestion_label, 'Pode ser recorrente'),
  auto_confirmed = false,
  updated_at = now()
where status = 'dismissed'
  and suppress_auto_confirm = true
  and auto_confirmed = false
  and undo_status = 'confirmed';

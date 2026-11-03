-- Narrow iFood Clube recognition: purchases at iFood are not subscriptions.
-- The original bank transactions remain intact and searchable.
update public.catalog_services
set patterns = coalesce(
  (select jsonb_agg(entry)
   from jsonb_array_elements(patterns) as entries(entry)
   where entry <> '["IFOOD"]'::jsonb),
  '[]'::jsonb
), updated_at = now()
where id = 'ifood-clube'
  and patterns @> '[["IFOOD"]]'::jsonb;

-- One verified historical false association in production.
-- Only repair the plan if its old price, false change notice, and payment evidence all match.
do $$
declare
  affected_plan uuid;
  candidates integer;
  original_charges integer;
  erroneous_charges integer;
begin
  select count(*) into candidates
  from public.subscriptions
  where service = 'ifood-clube'
    and status = 'confirmed'
    and amount = 53.30
    and expected_charge_date = '2026-11-01'
    and plan_change_notice = 'O valor passou de R$ 7,95 para R$ 53,30.';

  if candidates > 1 then
    raise exception 'Ambiguous iFood Clube repair; expected at most one plan.';
  end if;

  if candidates = 1 then
    select id into affected_plan
    from public.subscriptions
    where service = 'ifood-clube'
      and status = 'confirmed'
      and amount = 53.30
      and expected_charge_date = '2026-11-01'
      and plan_change_notice = 'O valor passou de R$ 7,95 para R$ 53,30.'
    for update;

    select count(*) into original_charges
    from public.charges
    where subscription_id = affected_plan
      and charge_date = '2026-10-22'
      and amount = 7.95;

    select count(*) into erroneous_charges
    from public.charges c
    join public.transactions t on t.id = c.transaction_id
    where c.subscription_id = affected_plan
      and c.charge_date = '2026-11-01'
      and c.amount = 53.30
      and t.operation_type = 'PIX'
      and t.description ilike '%IFOOD%';

    if original_charges <> 1 or erroneous_charges <> 1 then
      raise exception 'iFood Clube evidence changed; refusing unsafe repair.';
    end if;

    delete from public.charges c
    using public.transactions t
    where c.transaction_id = t.id
      and c.subscription_id = affected_plan
      and c.charge_date = '2026-11-01'
      and c.amount = 53.30
      and t.operation_type = 'PIX'
      and t.description ilike '%IFOOD%';

    update public.subscriptions
    set amount = 7.95,
        plan_change_notice = null,
        expected_charge_date = '2026-10-22',
        descriptors = array['IFOOD CLUB', 'IFD*IFOOD']
    where id = affected_plan;
  end if;
end;
$$;

-- Education services seen on real statements. No stored logo: the app fetches
-- the icon from the first domain, like any site the user types in.
insert into public.catalog_services (id, service_name, company, manage_url, cancel_url, plans, patterns, logo, domains, is_foreign)
values
  ('gran-faculdade', 'Gran Faculdade', 'Gran', 'https://faculdade.grancursosonline.com.br', '', '[]'::jsonb,
   '[["GRAN", "CENTRO", "UNIVE"], ["GRAN", "CENTRO", "UNIVERSITARIO"], ["GRAN", "FACULDADE"]]'::jsonb, '',
   '["faculdade.grancursosonline.com.br", "grancursosonline.com.br"]'::jsonb, false),
  ('quero-educacao', 'Quero Educação', 'Quero Educação', 'https://querobolsa.com.br', '', '[]'::jsonb,
   '[["QUERO", "EDUCACA"], ["QUERO", "EDUCACAO"], ["QUERO", "BOLSA"]]'::jsonb, '',
   '["querobolsa.com.br"]'::jsonb, false)
on conflict (id) do update set
  patterns = excluded.patterns,
  domains = excluded.domains,
  updated_at = now();

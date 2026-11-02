-- Service catalog moves out of the code into this table.
-- Idempotent. Apply manually in the Supabase SQL editor. Do not run this from the app.
-- Edit rows here (Table Editor) to add a service or a new statement spelling; no deploy needed.
--
-- patterns: list of word lists matched against the normalized statement text,
--   e.g. [["OPENAI","CHATGPT"],["OPENAI"]]. A payment intermediary prefix
--   (MERCADOPAGO*, PAYPAL*, EBANX*…) is stripped before matching.
-- plans: [{"name":"ChatGPT Plus","brl":110,"usd":20}]; each name covers ±15% around brl.
-- is_foreign: charged in another currency, so amounts are shown with "≈".
-- active: false hides a row without deleting it.

create table if not exists public.catalog_services (
  id text primary key,
  service_name text not null,
  company text not null,
  manage_url text not null default '',
  cancel_url text not null default '',
  plans jsonb not null default '[]'::jsonb,
  patterns jsonb not null default '[]'::jsonb,
  logo text not null default '',
  domains jsonb not null default '[]'::jsonb,
  is_foreign boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.catalog_services enable row level security;
alter table public.catalog_services force row level security;
revoke all on table public.catalog_services from anon, authenticated;
grant all on table public.catalog_services to service_role;

insert into public.catalog_services (id, service_name, company, manage_url, cancel_url, plans, patterns, logo, domains, is_foreign)
values
  ('chatgpt', 'ChatGPT', 'OpenAI', 'https://chatgpt.com/#settings/Subscription', 'https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription', '[{"name": "ChatGPT Go", "brl": 44, "usd": 8}, {"name": "ChatGPT Plus", "brl": 110, "usd": 20}, {"name": "ChatGPT Pro 100", "brl": 550, "usd": 100}, {"name": "ChatGPT Pro 200", "brl": 1100, "usd": 200}, {"name": "ChatGPT Pro 500", "brl": 2750, "usd": 500}]'::jsonb, '[["OPENAI", "CHATGPT"], ["CHATGPT"], ["OPENAI"]]'::jsonb, '/logos/chatgpt.svg', '["chatgpt.com", "openai.com"]'::jsonb, true),
  ('claude', 'Claude', 'Anthropic', 'https://claude.ai/settings/billing', 'https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription', '[{"name": "Claude Pro", "brl": 110, "usd": 20}, {"name": "Claude Max", "brl": 550, "usd": 100}, {"name": "Claude Ultra", "brl": 1100, "usd": 200}]'::jsonb, '[["ANTHROPIC", "CLAUDE"], ["CLAUDE", "AI"], ["ANTHROPIC"], ["CLAUDEAI"]]'::jsonb, '/logos/claude.svg', '["claude.ai", "anthropic.com"]'::jsonb, true),
  ('grok', 'Grok', 'xAI', 'https://grok.com/dashboard/billing', 'https://grok.com/dashboard/billing', '[{"name": "Grok Plus", "brl": 44, "usd": 8}, {"name": "SuperGrok", "brl": 165, "usd": 30}, {"name": "Grok Super", "brl": 550, "usd": 100}, {"name": "Grok Ultra", "brl": 1100, "usd": 200}]'::jsonb, '[["SUPERGROK"], ["GROK", "XAI"], ["GROK"], ["XAI"]]'::jsonb, '/logos/grok.svg', '["grok.com", "x.ai"]'::jsonb, true),
  ('netflix', 'Netflix', 'Netflix', 'https://www.netflix.com/account', 'https://www.netflix.com/cancelplan', '[{"name": "Netflix Padrão", "brl": 44.9}]'::jsonb, '[["NETFLIX"]]'::jsonb, '/logos/netflix.svg', '["netflix.com"]'::jsonb, false),
  ('spotify', 'Spotify', 'Spotify', 'https://www.spotify.com/account/subscription/', 'https://www.spotify.com/account/subscription/', '[{"name": "Spotify Premium", "brl": 21.9}]'::jsonb, '[["SPOTIFY"]]'::jsonb, '/logos/spotify.svg', '["spotify.com"]'::jsonb, false),
  ('youtube', 'YouTube Premium', 'Google', 'https://www.youtube.com/paid_memberships', 'https://www.youtube.com/paid_memberships', '[{"name": "YouTube Premium", "brl": 28.9}]'::jsonb, '[["YOUTUBE", "PREMIUM"], ["YOUTUBEPREMIUM"], ["YOUTUBE", "MEMBERSHIP"]]'::jsonb, '/logos/youtube.svg', '["youtube.com"]'::jsonb, false),
  ('prime', 'Amazon Prime', 'Amazon', 'https://www.amazon.com.br/gp/primecentral', 'https://www.amazon.com.br/gp/primecentral', '[{"name": "Amazon Prime", "brl": 19.9}]'::jsonb, '[["AMAZON", "PRIME"], ["AMZN", "PRIME"], ["PRIME", "VIDEO"]]'::jsonb, '/logos/prime.svg', '["amazon.com.br", "primevideo.com"]'::jsonb, false),
  ('disney', 'Disney+', 'Disney', 'https://www.disneyplus.com/account/subscription', 'https://www.disneyplus.com/account/subscription', '[{"name": "Disney+", "brl": 46.9}]'::jsonb, '[["DISNEY", "PLUS"], ["DISNEYPLUS"], ["DISNEY"]]'::jsonb, '/logos/disney.png', '["disneyplus.com"]'::jsonb, false),
  ('max', 'Max', 'Warner Bros. Discovery', 'https://www.max.com/account', 'https://www.max.com/account', '[{"name": "Max", "brl": 34.9}]'::jsonb, '[["HBO", "MAX"], ["HBOMAX"], ["MAX", "COM"]]'::jsonb, '/logos/max.svg', '["max.com"]'::jsonb, false),
  ('globoplay', 'Globoplay', 'Globo', 'https://globoplay.globo.com/configuracoes', 'https://globoplay.globo.com/configuracoes', '[{"name": "Globoplay", "brl": 27.9}]'::jsonb, '[["GLOBOPLAY"]]'::jsonb, '/logos/globoplay.png', '["globoplay.globo.com"]'::jsonb, false),
  ('apple-one', 'Apple One', 'Apple', 'https://apps.apple.com/account/subscriptions', 'https://support.apple.com/pt-br/118428', '[{"name": "Apple One", "brl": 34.9}, {"name": "iCloud+", "brl": 9.9}]'::jsonb, '[["APPLE", "ONE"], ["ICLOUD"]]'::jsonb, '/logos/apple-one.svg', '["apple.com"]'::jsonb, true),
  ('claro-flex', 'Claro Flex', 'Claro', 'https://www.claro.com.br/flex', 'https://www.claro.com.br/flex', '[{"name": "Claro Flex", "brl": 39.9}]'::jsonb, '[["CLARO", "FLEX"]]'::jsonb, '/logos/claro-flex.png', '["claro.com.br"]'::jsonb, false),
  ('suno', 'Suno', 'Suno', 'https://suno.com/account', 'https://suno.com/account', '[{"name": "Suno Pro", "brl": 55, "usd": 10}, {"name": "Suno Premier", "brl": 165, "usd": 30}]'::jsonb, '[["SUNO"]]'::jsonb, '/logos/suno.svg', '["suno.com"]'::jsonb, true),
  ('ifood-clube', 'iFood Clube', 'iFood', 'https://www.ifood.com.br/clube', 'https://www.ifood.com.br/clube', '[{"name": "iFood Clube", "brl": 9.9}]'::jsonb, '[["IFOOD", "CLUBE"], ["IFOOD", "CLUB"], ["IFOODCLUBE"], ["CLUBE", "IFOOD"]]'::jsonb, '/logos/ifood-clube.svg', '["ifood.com.br"]'::jsonb, false),
  ('deezer', 'Deezer', 'Deezer', 'https://www.deezer.com/account/subscription', 'https://www.deezer.com/account/subscription', '[{"name": "Deezer Premium", "brl": 24.9}]'::jsonb, '[["DEEZER"]]'::jsonb, '/logos/deezer.svg', '["deezer.com"]'::jsonb, false),
  ('paramount', 'Paramount+', 'Paramount', 'https://www.paramountplus.com/account/', 'https://www.paramountplus.com/account/', '[{"name": "Paramount+", "brl": 24.9}]'::jsonb, '[["PARAMOUNT"]]'::jsonb, '/logos/paramount.svg', '["paramountplus.com"]'::jsonb, false),
  ('crunchyroll', 'Crunchyroll', 'Crunchyroll', 'https://www.crunchyroll.com/account/membership', 'https://www.crunchyroll.com/account/membership', '[{"name": "Crunchyroll Mega Fan", "brl": 19.9}]'::jsonb, '[["CRUNCHYROLL"]]'::jsonb, '/logos/crunchyroll.svg', '["crunchyroll.com"]'::jsonb, false),
  ('microsoft-365', 'Microsoft 365', 'Microsoft', 'https://account.microsoft.com/services', 'https://account.microsoft.com/services', '[{"name": "Microsoft 365 Pessoal", "brl": 45}]'::jsonb, '[["MICROSOFT", "365"], ["MICROSOFT365"], ["OFFICE", "365"]]'::jsonb, '/logos/microsoft-365.svg', '["microsoft.com"]'::jsonb, true),
  ('google-one', 'Google One', 'Google', 'https://one.google.com/settings', 'https://one.google.com/settings', '[{"name": "Google One", "brl": 9.9}, {"name": "Google One", "brl": 34.9}]'::jsonb, '[["GOOGLE", "ONE"], ["GOOGLEONE"]]'::jsonb, '/logos/google-one.svg', '["one.google.com"]'::jsonb, false),
  ('canva', 'Canva', 'Canva', 'https://www.canva.com/settings/billing', 'https://www.canva.com/settings/billing', '[{"name": "Canva Pro", "brl": 82.5, "usd": 15}]'::jsonb, '[["CANVA"]]'::jsonb, '/logos/canva.svg', '["canva.com"]'::jsonb, true),
  ('notion', 'Notion', 'Notion', 'https://www.notion.so/profile', 'https://www.notion.so/profile', '[{"name": "Notion Plus", "brl": 66, "usd": 12}]'::jsonb, '[["NOTION"]]'::jsonb, '/logos/notion.svg', '["notion.so"]'::jsonb, true),
  ('cursor', 'Cursor', 'Cursor', 'https://cursor.com/settings', 'https://cursor.com/settings', '[{"name": "Cursor Pro", "brl": 110, "usd": 20}]'::jsonb, '[["CURSOR"]]'::jsonb, '/logos/cursor.png', '["cursor.com", "cursor.sh"]'::jsonb, true),
  ('apple', 'Assinatura via Apple', 'Apple', 'https://apps.apple.com/account/subscriptions', 'https://support.apple.com/pt-br/118428', '[]'::jsonb, '[]'::jsonb, '/logos/apple.svg', '["apple.com"]'::jsonb, true)
on conflict (id) do update set
  patterns = excluded.patterns,
  updated_at = now();

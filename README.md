# Ciclo

Suas assinaturas, encontradas automaticamente no cartão. O Ciclo mostra o nome de cada plano e um botão **Gerenciar** que abre a página oficial da assinatura. Nenhum desses provedores deixa um app de fora cancelar ou assinar por você.

Produção: https://ciclo-peach.vercel.app

## Stack

- Next.js (App Router) na Vercel Hobby, projeto `ciclo`
- Supabase free, projeto `nhhxrgefwgmvhjvwngiq` (São Paulo)
- Resend free, remetente de teste `onboarding@resend.dev`
- Pluggy, conector MeuPluggy, só para uso pessoal
- Um cron diário (`vercel.json`). A Hobby não aceita cron mais frequente.

## Variáveis

Os nomes estão em `.env.example`. Não grave valores no git.

Na Vercel, para **Production**:

| Variável | Onde |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | pública |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | pública, compatibilidade |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor, ainda falta adicionar |
| `RESEND_API_KEY` | servidor, ainda falta adicionar |
| `ALLOWED_EMAIL` | servidor, o único e-mail que entra e que recebe os lembretes |
| `PLUGGY_CLIENT_ID` | servidor |
| `PLUGGY_CLIENT_SECRET` | servidor |
| `PLUGGY_ITEM_ID` | servidor. Só cria a primeira linha de `connections` se a tabela estiver vazia. O runtime lê os item ids da tabela. |
| `PLUGGY_WEBHOOK_TOKEN` | servidor |
| `CRON_SECRET` | servidor. A Vercel envia `Authorization: Bearer`. |
| `HEALTH_TOKEN` | servidor |

Preview não recebe segredo de produção. Marque as variáveis sensíveis só em Production. Sem uma variável de servidor, a rota responde com `Configuração incompleta: NOME` e não quebra o build.

O cliente só usa o que o servidor já calculou. Segredo, item id e descritor cru do cartão não vão para o bundle nem para o e-mail.

## Banco

A migration está em `supabase/migrations/20261101120000_ciclo_v1.sql`. Aplique no SQL editor do Supabase. O app não aplica migration sozinho.

Ela cria `connections`, `transactions`, `subscriptions`, `charges`, `ignored_descriptors` e `reminders_sent`, com RLS ligado e sem policy para `anon`/`authenticated`. O servidor usa a service role. Também cria o bucket privado `ciclo-backups`.

Não gravamos saldo, `reservedBalance` nem o `creditCardMetadata` cru. Da metadata fica só a data da cobrança, já em `America/Sao_Paulo`.

## Auth no Supabase

Faça isto no dashboard, uma vez:

1. Authentication → Providers → Email: deixe o magic link ligado.
2. Desligue o cadastro público (public sign-up).
3. Authentication → SMTP: use o Resend. Host `smtp.resend.com`, porta 465, usuário `resend`, senha a API key do Resend. Remetente de teste `onboarding@resend.dev` serve até o domínio próprio estar verificado.
4. Authentication → URL configuration: Site URL `https://ciclo-peach.vercel.app`. Redirect URLs: só `https://ciclo-peach.vercel.app/auth/callback` (e `http://127.0.0.1:3000/auth/callback` se for testar login local).
5. O timeout de inatividade da sessão do Supabase é recurso Pro. O Ciclo faz a janela de 30 dias no app, com o cookie HttpOnly `ciclo_last_seen`. Cada visita renova. **Sair** chama `signOut({ scope: 'global' })`. A rotação do refresh token fica com o Supabase: um refresh token reusado é recusado. A tela manda `Cache-Control: no-store` e recarrega se o navegador restaurar a página pelo botão voltar.

## Webhook da Pluggy

Cadastre:

`https://ciclo-peach.vercel.app/api/webhooks/pluggy?token=SEU_PLUGGY_WEBHOOK_TOKEN`

O mesmo token pode ir no header `x-webhook-token`. O corpo é só um aviso: a rota relê o item e as transações na API. O corpo e cada resposta da Pluggy passam pelos schemas Zod de `lib/pluggy/schemas.ts`: um aviso com formato inválido é ignorado com 200, uma transação inválida é descartada (o log só conta quantas) e um item ou página fora do formato falha com `pluggy_invalid_*`. Eventos repetidos ou fora de ordem não duplicam a conexão. `item/created` marca a conexão anterior da mesma instituição como `replaced`. `USER_AUTHORIZATION_EXPIRED` marca `expired`.

## GitHub

Secrets do repositório, não da Vercel:

| Secret | Uso |
| --- | --- |
| `CICLO_URL` | `https://ciclo-peach.vercel.app`, watchdog |
| `HEALTH_TOKEN` | o mesmo valor da Vercel |
| `SUPABASE_DB_URL` | connection string do Postgres, backup |
| `BACKUP_ENCRYPTION_KEY` | senha do `openssl enc -aes-256-cbc -pbkdf2` |
| `SUPABASE_URL` | URL do projeto, upload do backup |
| `SUPABASE_SERVICE_ROLE_KEY` | upload no bucket `ciclo-backups` |

`/.github/workflows/ci.yml` roda typecheck, lint, testes, build e o Playwright. Não chama a Pluggy nem o Supabase de produção.

`watchdog.yml` falha se `/api/health` não responder ou se a última sincronização tiver mais de 48 horas.

`backup.yml` exporta as seis tabelas, cifra e envia ao bucket. Até os secrets existirem, o workflow falha com o nome do secret que falta.

## O que a tela faz

Uma tela, **Meus planos**. Total do mês, aproximação do ano, um cartão por plano confirmado e no máximo um aviso por vez (vermelho de conexão, amarelo de renovação ou atraso, neutro de sugestão e "Ainda cobrando"). O cabeçalho mostra a idade da última leitura, com **Sincronizar agora** no menu e um botão ao lado de "Atualizado há". Abrir o app, ou voltar a ele depois de um tempo em segundo plano, sincroniza sozinho.

Uma leitura vazia ou uma conexão vencida não cancela plano, não abaixa o total e não corta lembrete. Um plano confirmado vai para **Pararam de cobrar** (fora do total) só quando a última cobrança passou da janela do ciclo (45 dias, ou 13 meses no anual) e uma conexão **ativa** trouxe dado mais novo. **Ainda pago** devolve o plano ao total, e uma nova cobrança com o mesmo descritor e valor parecido o reativa sozinha.

### Sugestões

O usuário decide o que é plano, então a detecção é ampla e a confiança ordena a lista (`lib/rules.ts`, `lib/confidence.ts`). Entra como sugestão uma cobrança que se repete pelo menos 2 meses com valor parecido, um par anual, ou um serviço do catálogo cobrado uma vez nos últimos 45 dias. Valores abaixo de R$ 1 e movimentos de investimento ou reserva ficam de fora. A confiança aprende com as escolhas (`lib/learning.ts`): parecido com um plano confirmado ganha 15 pontos, parecido com algo recusado perde 25.

`POST /api/sync` exige a sessão (o mesmo login de `/api/plans`) e relê a Pluggy como o cron, sem enviar e-mail. O servidor recusa outra leitura se a última sync tiver menos de 2 minutos. O cron diário (12:00 UTC) continua como reserva: relê 35 dias, busca o que chegou desde a última sync menos 24 horas, e manda cada aviso uma vez: cobrança em 3 dias, renovação da Pluggy em 30 e em 7 dias, `LOGIN_ERROR`, conexão vencida sem item novo, resumo semanal e resumo mensal. O e-mail não leva item id nem o descritor cru.

## Desenvolvimento

```bash
npm install
npm test
npm run dev
```

`npm run lint`, `npm test`, `npm run build`, `npm run typecheck` e `npm run test:e2e` repetem o CI. O typecheck usa os tipos que o build gera em `.next/types`. O e2e sobe o app com `CICLO_E2E=1` e mocka `/api/plans`. Esse bypass não existe em `NODE_ENV=production`.

# Servidor (Supabase): passo a passo, sem programar

O "servidor" do jogo é um projeto no **Supabase**: um banco de dados com as regras do jogo dentro dele. Quem decide moedas, colheita, cartas, evento e retiradas para a Steam é o banco. O jogo só pede e mostra.

Enquanto você não configurar nada, o jogo continua usando a **API falsa** (os dados ficam no navegador e somem ao recarregar). Nada quebra.

## 1. Criar o projeto (uma vez)

1. Entre em <https://supabase.com> e crie uma conta (pode entrar com o GitHub).
2. Clique em **New project**.
   - **Name:** `village-idle-farm`.
   - **Database Password:** crie uma senha forte e **guarde** (vai precisar no passo 3).
   - **Region:** a mais perto dos jogadores (ex.: `South America (São Paulo)`).
3. Espere uns 2 minutos até o projeto ficar pronto.
4. Ligue o login anônimo (só para os testes; em produção o login será pela Steam):
   **Authentication → Sign In / Providers → Anonymous sign-ins → ligar → Save**.

## 2. Instalar a ferramenta do Supabase no computador (uma vez)

Com o Node.js 22 já instalado (ver `docs/DEPLOY.md`), no terminal, dentro da pasta do projeto:

```
pnpm i
npx supabase --version
```

Se aparecer um número de versão, está pronto. (O `npx` baixa a ferramenta sozinho.)

## 3. Enviar as regras do jogo para o projeto

Sempre que alguém mudar o servidor (arquivos em `supabase/migrations`) ou o catálogo, repita este passo.

1. Entre na sua conta pelo terminal (abre o navegador para confirmar):
   ```
   npx supabase login
   ```
2. Ligue a pasta ao seu projeto. O **Reference ID** está em **Project Settings → General** (algo como `abcdefghijklmnop`):
   ```
   npx supabase link --project-ref SEU_REFERENCE_ID
   ```
   Ele pede a senha do banco do passo 1.
3. Atualize o catálogo (itens, culturas, cartas, canteiros) e envie tudo:
   ```
   pnpm db:seed
   npx supabase db push --include-seed
   ```
   - O primeiro comando gera o arquivo `supabase/seed.sql` a partir do catálogo do jogo.
   - O segundo cria/atualiza as tabelas e as regras e grava o catálogo. Ele mostra a lista do que vai aplicar e pergunta se pode continuar: responda `Y`.

Pronto: o banco está com todas as regras.

## 4. Ligar o jogo ao servidor

1. No Supabase, abra **Project Settings → API** (ou **Data API / API Keys**) e copie:
   - **Project URL** (ex.: `https://abcdefghijklmnop.supabase.co`);
   - a chave **anon public** (também chamada de _publishable_). **Nunca** use a chave `service_role`/_secret_ no jogo.
2. Na pasta `apps/game`, crie um arquivo chamado **`.env.local`** com estas duas linhas (troque pelos seus valores):
   ```
   VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
   VITE_SUPABASE_ANON_KEY=cole_aqui_a_chave_anon
   ```
   Esse arquivo não vai para o GitHub (está no `.gitignore`).
3. Rode o jogo (`pnpm dev`). Agora ele usa o servidor: cada navegador vira um jogador anônimo, e os dados ficam salvos.
4. Para voltar à API falsa, apague (ou renomeie) o `.env.local`.

### Na hospedagem (Netlify ou Vercel)

Em **Site settings → Environment variables** (Netlify) ou **Settings → Environment Variables** (Vercel), crie as mesmas duas variáveis, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, e publique de novo. Sem elas, o site publicado usa a API falsa.

## 5. Conferir se está tudo certo

- No Supabase, **Table Editor**: devem aparecer tabelas como `items` (cerca de 54 linhas), `crop_defs`, `card_defs` (40 linhas) e `plot_slots`.
- Depois de abrir o jogo uma vez, a tabela `profiles` ganha 1 linha (o seu jogador) e `wallets` mostra as moedas.
- Nos testes do computador (`pnpm test`), os testes do servidor sobem um banco temporário sozinhos. Não precisa de Docker.

## 6. Coisas que ainda não estão ligadas

| O quê                 | Situação                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login pela Steam      | `supabase/functions/steam-auth` só descreve o que fará. Hoje o login é anônimo.                                                                                                                                                                          |
| Retirada para a Steam | O jogo tira o item do inventário e a retirada fica **"pendente"**. Quem entrega na Steam será a função `steam-extract` (ainda não implementada). Para desligar as retiradas, mude `bridgeEnabled` para `false` na linha `steam` da tabela `game_config`. |
| Visitas               | Ainda não existem no servidor.                                                                                                                                                                                                                           |

## 7. Problemas comuns

| Sintoma                                      | O que fazer                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `db push` pede senha e falha                 | É a senha do banco do passo 1. Se esqueceu: **Project Settings → Database → Reset database password**. |
| O jogo mostra "Você precisa entrar de novo." | O login anônimo está desligado (passo 1.4) ou as variáveis do passo 4 estão erradas.                   |
| "Algo deu errado" em toda ação               | Faltou o passo 3 (`db push --include-seed`).                                                           |
| Mudou o catálogo e nada mudou no jogo        | Rode de novo `pnpm db:seed` e `npx supabase db push --include-seed`.                                   |

# Como rodar e publicar (passo a passo, sem programar)

Você só vai digitar comandos prontos num terminal. Copie e cole um de cada vez.

## 1. Instalar uma vez no computador

1. Instale o **Node.js 22** (versão "LTS") em <https://nodejs.org>. Aceite tudo como vem no instalador.
2. Abra um terminal (Windows: "PowerShell"; Mac: "Terminal") e rode:
   ```
   corepack enable
   ```
   Isso liga o **pnpm**, o instalador de pacotes do projeto. (Se der erro de permissão no Windows, abra o PowerShell como Administrador. No Mac/Linux, use `sudo corepack enable`.)
3. Confira:
   ```
   node -v
   pnpm -v
   ```
   O primeiro deve começar com `v22`.

## 2. Rodar o jogo no seu computador

Dentro da pasta do projeto (`village-idle-farm`):

```
pnpm i
pnpm dev
```

- O terminal mostra um endereço, por exemplo `http://localhost:5173/`. Abra no navegador.
- Para parar: clique no terminal e aperte `Ctrl + C`.
- **Testar no celular:** celular e computador no mesmo Wi-Fi. Abra no celular o endereço da linha `Network:` que aparece no terminal (ex.: `http://192.168.0.10:5173/`).
- **Prévia sem a arte processada:** abra `http://localhost:5173/?dev-assets`. Mostra o mapa original e um layout de exemplo.

No jogo:

- Arrastar com mouse ou dedo move a câmera; roda do mouse ou pinça dá zoom.
- Tecla **D** (ou o botão **Layout** no canto) mostra colisão (vermelho), canteiros (verde), cercados (azul), lotes à venda (amarelo) e o ponto de início.

## 3. Conferir se está tudo certo antes de publicar

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Os quatro precisam terminar sem `ERR` / `failed`. O `build` cria a pasta **`apps/game/dist`** — é ela que vai para a internet.

## 4. Publicar a versão web

Hoje o jogo é um site estático (ainda sem servidor; os dados ficam só na memória do navegador e somem ao recarregar).

### Opção A: Netlify, arrastando a pasta (mais fácil)

1. Rode `pnpm build`.
2. Entre em <https://app.netlify.com/drop> (crie a conta grátis).
3. Arraste a pasta `apps/game/dist` para a página.
4. Pronto: o Netlify mostra o endereço do jogo. Para atualizar, repita com a pasta nova.

### Opção B: Netlify ou Vercel ligados ao GitHub (publica sozinho a cada mudança)

O projeto já tem `netlify.toml` e `vercel.json` com as configurações.

- **Netlify:** "Add new site" → "Import an existing project" → escolha o repositório no GitHub → não mude nada → "Deploy".
- **Vercel:** "Add New…" → "Project" → importe o repositório → deixe **Root Directory** como a raiz do projeto (não `apps/game`) → "Deploy".

Se pedirem os campos manualmente:

| Campo                      | Valor            |
| -------------------------- | ---------------- |
| Build command              | `pnpm build`     |
| Publish / Output directory | `apps/game/dist` |
| Node version               | 22               |

## 5. Problemas comuns

| Sintoma                                    | O que fazer                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`                  | Rode `corepack enable` de novo e feche/abra o terminal.                                                               |
| Tela verde escura escrita "Sem mapa ainda" | A arte ainda não foi gerada (`apps/game/public/assets`). Use `?dev-assets` para ver a prévia.                         |
| Algo não aparece                           | Aperte `F12` no navegador → aba "Console". Os avisos começam com `[assets]` ou `[layout]` e dizem qual arquivo falta. |
| `pnpm i` reclama de versão do Node         | Instale o Node 22.                                                                                                    |

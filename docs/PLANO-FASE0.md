# Plano técnico da Fase 0: Village Idle Farm

## 1. As artes e o pipeline de assets

### O que foi encontrado nas imagens (medido com Python)

| Arquivo | Tamanho e fundo | Situação real |
|---|---|---|
| Todas | JPG 2576×1438, RGB, **sem transparência** | Todas precisam de recorte e remoção de fundo. A compressão JPG deixa ruído em volta das bordas. |
| Cards.jpg | fundo cinza escuro (34,34,34), uniforme | São 6 peças grandes e bem separadas. O miolo da moldura é roxo escuro e precisa virar transparente. O brilho do fogo e das faíscas está "pintado" sobre o fundo escuro, então a transparência dele tem que sair da luminosidade. Cortar por cor não funciona. |
| Frutas/legumes | (38,38,38) | 40 ícones em grade de 4×10 com espaçamento quase regular. É a **melhor** folha: o pixel art tem grade limpa de cerca de 10 px por pixel de arte (ícones de uns 16–20 px reais). Cada ícone tem uma sombra embaixo, mais escura que o fundo, que precisa ser removida. |
| Animais | (41,41,41) | 10×6 poses com **espaçamento irregular**. A folha tem os textos "1. VACA" etc., que precisam ser excluídos. As 6 poses **não são quadros de animação**. São variações, e às vezes até de cor diferente (vaca preta e branca, malhada de marrom, marrom). Não dá para montar um ciclo de andar. |
| Personagens | cinza azulado (66,73,83) | 6 linhas com 9 a 11 quadros, espaçamento irregular. Tem frente, costas, 3/4 e lado, e as poses misturam ferramenta e sem ferramenta. **Não existe ciclo de caminhada de 4 direções × 4 quadros.** Dá no máximo 1–2 quadros por direção. O pixel art é "falso": não tem grade consistente. |
| Pets | (43,43,43) | Cachorro e gato com 16 quadros, papagaio com 7. Há pedaços soltos (linhas de latido, asas) que precisam ser juntados ao sprite. É a folha que mais se aproxima de animação (andar, sentar, dormir). |
| Veículos | (67,72,79) | 4×4 em **perspectiva isométrica 3/4**, que não combina com o mapa visto de cima. Servem só como decoração parada ou como ícone de interface. |
| mapa_do_jogo.jpg | pintura única, cerca de 3–4 px por pixel de arte, sem grade limpa | **Não é tileset.** Canteiros, plantas, animais, veículos, espantalhos e patos estão pintados na imagem. |

### Conclusão

- **Servem quase direto:** ícones de frutas e legumes (inventário e mercado) e molduras de carta. As duas precisam do pipeline.
- **Servem com limitação:** NPCs parados, animais com "andar falso" (o sprite espelha e faz um pequeno pulo via tween), pets e veículos como decoração.
- **Não servem como estão:**
  - **Mapa:** colheitas e animais pintados não mudam de estado. O jogador também não consegue passar atrás das casas.
  - **Caminhada do jogador:** faltam quadros.
  - **Estágios de crescimento das plantas:** não existem. Só existe o item já colhido.
- **Escala misturada entre as folhas.** Um personagem tem cerca de 220 px de altura na folha e cerca de 50 px dentro do mapa. Tudo precisa ser reduzido para uma escala única.
- **Risco a confirmar:** o mapa é muito parecido com Stardew Valley. Confirmar que a ferramenta de IA que gerou as artes permite uso comercial e que nada foi copiado.

### Escala do mundo (decisão)

- O mundo é o próprio mapa em resolução original (2576×1438), com grade lógica de 32 px (cerca de 80×45 células).
- Tamanhos alvo:

| Tipo | Tamanho |
|---|---|
| Jogador e NPC | quadro de 48×72, corpo com ~64 px de altura |
| Animal pequeno | 32×32 |
| Animal grande | 80×64 |
| Pet | 48×48 |
| Ícone | 32×32 |
| Veículo | 160×112 |
| Carta (interface) | 192×264 |

- Configuração do Phaser: `pixelArt: true` e `roundPixels: true`.

### Pipeline (fica em `tools/assets/`, Python 3 com Pillow, numpy, scipy e PyYAML)

O comando `python tools/assets/build.py --all` é idempotente: lê `assets-src/raw/` e um manifesto YAML por folha. Passo a passo:

1. **Manifesto por folha:** arquivo de origem, regiões a excluir (os textos dos animais), número esperado de linhas e de sprites, nomes em ordem de leitura (`cow/pose_0..5`), categoria, tamanho do quadro, âncora (base central para personagens, centro para ícones), distância para juntar pedaços soltos e modo de transparência (`flood` ou `glow`).
2. **Cor do fundo:** mediana das bordas da imagem.
3. **Máscara de fundo:** preenchimento a partir das bordas, em espaço de cor Lab, com tolerância ΔE de 12–18. Usar limiar global não serve, porque o contorno preto dos sprites é quase da cor do fundo e seria apagado junto. Depois, remover pontinhos soltos e preencher buracos.
4. **Sombras:** remover as sombras projetadas (região mais escura que o fundo e ligada à base do sprite). O jogo desenha a própria sombra como uma elipse.
5. **Separar os sprites:** componentes conectados, depois juntar caixas próximas (asas, "!" de latido, faíscas), agrupar em linhas pelo centro vertical e ordenar por x.
   - Se a contagem não bater com o manifesto, o script **falha** e gera `debug/<folha>_boxes.png` com as caixas numeradas para conferência visual.
6. **Bordas:** limpar a auréola de 1 px que o JPG deixa e deixar a transparência só em 0 ou 255.
   - No modo `glow` (cartas vermelha e dourada), a transparência vem de `max(canal − fundo)`, com a cor recalculada para tirar o fundo escuro.
7. **Pixelização:**
   - Se a folha tem grade limpa (frutas, ~10 px), reduzir pegando o pixel do centro de cada célula.
   - Se não tem (personagens, animais, pets), reduzir até a altura alvo com filtro de caixa e limitar a 24–32 cores, sem pontilhado.
8. **Padronizar:** colar cada sprite num quadro de tamanho fixo por categoria, com a âncora definida.
9. **Montar atlas:** um atlas PNG por categoria, até 2048×2048, com 2 px de espaçamento e 1 px de extrusão, no formato **JSON Hash do Phaser**. O script também gera `packages/shared/src/generated/assetKeys.ts` com as chaves dos atlas.
10. **Mapa:**
    - Exportar em WebP.
    - Cortar telhados e copas de árvore numa camada `overhead.png` com transparência (máscara em polígono), para o jogador passar por trás.
    - Recortar texturas de terra arada e grama do próprio mapa, para cobrir os canteiros pintados.
11. **Prévia para o dono:** `debug/preview_on_map.png`, com os sprites colados sobre o mapa na escala final, para aprovar a escala só olhando.

### Colisão, áreas plantáveis e expansão

- Usar o **Tiled** (gratuito e visual). O mapa entra como camada de imagem, e por cima vêm camadas de objetos:
  - `collision` (polígonos)
  - `plots` (`slotId`, retângulo, `unlockCost`, `unlockLevel`)
  - `pens` (cercados de animais)
  - `spawn`
  - `overhead`
  - `locked_lots` (lotes de expansão)
  - `npc_points`
- O agente de Assets faz a primeira versão. O dono pode ajustar arrastando os retângulos no Tiled, sem código.
- O arquivo exportado vai para `apps/game/public/assets/map/farm_layout.tmj`.
- Os `slotId` do layout são a fonte da verdade e entram no seed do banco.
- **Expansão:** o mapa é fixo e igual para todos. Os lotes bloqueados aparecem com cerca e placa "à venda" e são liberados no servidor.
- **No MVP:** cada canteiro pintado ganha por cima uma textura de terra arada, e a planta é desenhada sobre ela.

### O que o dono vai precisar refazer ou complementar (em ordem de prioridade)

1. **Mapa "limpo":** só terreno, sem plantas, animais, veículos, espantalhos e patos. Prédios e árvores grandes em PNGs separados com transparência.
2. **Estágios de crescimento:** 4 por cultura (semente, broto, crescendo, pronto). No MVP bastam 3 culturas.
3. **Jogador:** caminhada em 4 direções × 4 quadros, mais colher e regar. Pode começar só com fazendeiro e fazendeira.
4. **Animais:** a mesma cor em todas as poses e 2–4 quadros de andar.
5. **Produtos de animais** (ovo, leite, lã, trufa…), **sementes** e **interface** (moeda, botões, painéis).
6. **Dica para as próximas gerações de imagem:** pedir **PNG com fundo transparente**, ou fundo magenta puro (#FF00FF), sempre na mesma escala e numa grade fixa (por exemplo, células de 64×64). Isso elimina 80% do trabalho do pipeline.

---

## 2. Estrutura do monorepo (pnpm workspaces)

```
village-idle-farm/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, .eslintrc, .prettierrc, .github/workflows/ci.yml
  docs/            ARCHITECTURE.md, CONTRACTS.md, AGENTS.md, DEPLOY.md (passo a passo para o dono)
  assets-src/      raw/ (originais), clean/ (artes refeitas pelo dono), tiled/ (projeto .tmx)
  tools/assets/    build.py, manifests/*.yaml, requirements.txt, debug/ (ignorado no git)
  tools/seed/      gen-seed.ts  (catálogo JSON -> supabase/seed.sql)
  packages/shared/src/
    types/  api.ts  events.ts  errors.ts  realtime.ts  layout.ts
    catalog/ items.json crops.json animals.json      (fonte única de balanceamento)
    formulas/ progress.ts (só previsão visual no cliente)
    generated/ assetKeys.ts
  apps/game/
    index.html, vite.config.ts, capacitor.config.ts (depois)
    public/assets/  (GERADO pelo pipeline; não editar à mão)
    src/ main.ts config.ts
      scenes/ Boot.ts Preload.ts FarmScene.ts VisitScene.ts
      core/ bus.ts store.ts            (Fundação)
      net/  supabase.ts api.ts realtime.ts mockApi.ts
      farm/ (Fazenda)   time/ fx/ (Tempo)   ui/ hud/ panels/ market/ social/
  supabase/ config.toml, migrations/, seed.sql (gerado), tests/ (pgTAP), functions/ (futuro)
  tests/e2e/ (Playwright)
```

### Convenções

- TypeScript `strict`.
- **Moeda sempre em número inteiro** (`bigint` no banco, `number` no TS). Nunca usar número com casa decimal para dinheiro.
- Os IDs do catálogo são strings legíveis, por exemplo `crop_carrot`, `seed_carrot`, `prod_egg`, `animal_chicken`.
- O banco usa snake_case. Os RPCs devolvem JSON com chaves em camelCase (montado com `jsonb_build_object`), para bater direto com os tipos de `shared` sem camada de conversão.
- Interface: o mundo é desenhado no Phaser. Os painéis (inventário, loja, mercado) usam **DOM com Preact** por cima do canvas, porque é mais fácil para listas, rolagem e celular.
- Git:
  - Uma branch por agente (`agent/<nome>`) e merge por PR.
  - A CI roda `typecheck`, `lint`, `vitest` e `supabase test db`.
  - Rodar o banco local precisa de Docker. Se o agente não tiver Docker, usar um projeto Supabase separado só para desenvolvimento.
- Migrations com faixas numeradas por dono, para evitar conflito:

| Faixa | Dono |
|---|---|
| `20260101000xxx_` | base |
| `...001xxx_` | tempo |
| `...002xxx_` | mercado |
| `...003xxx_` | visitas |

- O cliente nunca usa `Date.now()` para decidir nada. Ele só usa o relógio para animação.

---

## 3. Modelo de dados no Supabase

### Catálogo (leitura pública, só o seed escreve)

| Tabela | Colunas-chave |
|---|---|
| `items` | `id text pk`, `kind` (seed / crop / animal_product / decor / skin / card / currency), `rarity` (common / uncommon / rare / epic / legendary, ligada às 5 molduras), `base_price`, `tradable bool`, `min_price`, `max_price`, `stackable bool`, `sprite_key` |
| `crop_defs` | `crop_id pk`, `seed_item_id`, `yield_item_id`, `grow_seconds`, `yield_min`, `yield_max`, `xp`, `unlock_level` |
| `animal_defs` | `animal_type pk`, `buy_price`, `product_item_id`, `produce_seconds`, `max_stock`, `habitat` (coop / barn / pond) |
| `plot_slots` | `slot_id pk`, `unlock_cost`, `unlock_level` (vem do layout do Tiled) |

### Dados do jogador

| Tabela | Colunas-chave |
|---|---|
| `profiles` | `id uuid pk = auth.users.id`, `nickname unique`, `avatar`, `timezone text`, `tz_changed_at`, `level`, `xp`, `last_seen_at`, `created_at` |
| `wallets` | `player_id pk`, `coins bigint check (coins >= 0)`, `gems bigint check (gems >= 0)` (reservado para monetização) |
| `farms` | `id`, `owner_id unique`, `farm_clock_s bigint`, `clock_synced_at timestamptz`, `expansion_level`, `visits_open bool` |
| `plots` | `id`, `farm_id`, `slot_id`, `unlocked`, `crop_id null`, `planted_fc bigint`, `ready_fc bigint`; `unique(farm_id, slot_id)` |
| `animals` | `id`, `farm_id`, `animal_type`, `name`, `last_collect_fc bigint` |
| `inventory` | `(player_id, item_id) pk`, `qty bigint check (qty >= 0)` |
| `item_instances` | `id uuid`, `owner_id`, `item_id`, `attrs jsonb` (para cartas e skins únicas, no futuro) |

### Economia, multiplayer e tempo

| Tabela | Colunas-chave |
|---|---|
| `ledger` | só recebe inserções: `id`, `player_id`, `delta_coins`, `item_id`, `delta_qty`, `reason`, `ref_id`, `request_id`, `created_at`; `unique(player_id, request_id)` garante que repetir o pedido não duplica nada |
| `market_listings` | `id`, `seller_id`, `item_id`, `instance_id null`, `qty_total`, `qty_left`, `price_each`, `status` (active / sold / cancelled / expired), `created_at`, `expires_at` |
| `market_trades` | `id`, `listing_id`, `buyer_id`, `seller_id`, `item_id`, `qty`, `price_each`, `fee`, `created_at` |
| `notifications` | `id`, `user_id`, `kind`, `payload jsonb`, `read` (aviso de "seu item vendeu" via Realtime) |
| `visits` | `id`, `visitor_id`, `host_id`, `visited_on date`, `liked`, `helped`; `unique(visitor_id, host_id, visited_on)` |
| `weather` | `(tz, hour_utc) pk`, `kind` (gerado por pg_cron) |
| `event_claims` | `(player_id, event_key, local_date) pk`, `claimed_at` |
| `entitlements` | reservado para VIP, passe e skins: `player_id`, `sku`, `starts_at`, `ends_at`, `source`, `receipt_id`. A criação da tabela fica para a fase de monetização, mas todos os RPCs de produção já chamam `get_modifiers(player)`, que hoje retorna 1.0. |

### Regras de RLS

- RLS ligado em **todas** as tabelas. Um teste pgTAP confere isso.
- `revoke insert, update, delete` de `anon` e `authenticated` em todas as tabelas. **Toda escrita passa por RPC** (`security definer`, `set search_path = ''`, `revoke execute from public`, `grant` só para `authenticated`).
- Catálogo: `select` liberado para todos.
- `profiles`: o jogador lê o próprio perfil completo. Os outros só veem a view `public_profiles` (nickname, avatar, level).
- `wallets`, `farms`, `plots`, `animals`, `inventory`, `ledger`, `notifications`, `event_claims`: `select` só onde o dono é `auth.uid()`.
- `market_listings`: `select` para `authenticated` quando `status = 'active'` ou quando o vendedor é o próprio jogador.
- Fazenda de outro jogador: nunca por `select` direto. Só pelo RPC `visit_get_farm`, que devolve uma visão pública sem inventário nem carteira.
- Um gatilho em `auth.users` (ao criar conta) cria perfil, carteira, fazenda, canteiros iniciais e sementes iniciais.

---

## 4. Lógica autoritativa no servidor

**Toda mutação de valor é uma função SQL (RPC).** Ela já roda numa única transação, com trava de linha, e é mais simples e mais segura do que uma Edge Function. Edge Functions ficam só para webhooks de pagamento e validação de recibo da loja de apps, no futuro.

### Produção offline com limite de 8 h: o "relógio da fazenda"

- Cada fazenda tem `farm_clock_s` (segundos de produção que já valeram). **Todos** os tempos de produção são medidos nesse relógio, não no relógio real.
- `sync_farm_clock(farm)` é chamada no início de **todo** RPC da fazenda, depois de `select ... for update` na linha da fazenda:
  - `credit = least(extract(epoch from now() - clock_synced_at), 28800)`
  - `farm_clock_s += credit`, `clock_synced_at = now()`
- Com o jogador online, o cliente chama `heartbeat()` a cada 5 min e quando a aba volta a ficar visível, então o crédito é contínuo. Offline, o crédito para em 8 h. Isso vale automaticamente para plantas, animais e qualquer produção futura.
- **Planta:** está pronta quando `farm_clock_s >= ready_fc`, com `ready_fc = planted_fc + grow_seconds × modificador`.
- **Animal:**
  - `n = least(floor((fc - last_collect_fc) / produce_seconds), max_stock)`
  - Ao coletar: `last_collect_fc += n × produce_seconds`. Se bateu no `max_stock`, `last_collect_fc = fc`.
- `bootstrap()` devolve um `offlineReport` `{realSeconds, creditedSeconds, capped}` para a tela "Você ficou fora 11 h; sua fazenda produziu 8 h".
- O relógio do aparelho não interfere: só `now()` do Postgres conta. O cliente recebe `serverNow` e `farmClock` apenas para desenhar barras de progresso.

### Mercado sem duplicação

- **Escrow:** `market_create_listing` trava a linha de `inventory` (`for update`), confere a quantidade, **retira os itens do inventário** e cria o anúncio. O item deixa de existir no inventário enquanto está à venda.
  - Valida `tradable`, `min_price ≤ price ≤ max_price` e no máximo 20 anúncios ativos por jogador.
- **Compra:** `market_buy(listing_id, qty, request_id)` numa única função:
  1. Trava o anúncio (`for update`) e verifica `active`, `qty_left >= qty` e que o comprador não é o vendedor.
  2. Trava as carteiras **em ordem de `player_id`**, para não haver deadlock.
  3. Debita o comprador, credita o vendedor menos a taxa (por exemplo, 5%; a taxa tira moeda da economia), adiciona o item ao comprador e diminui `qty_left`.
  4. Grava `market_trades`, `ledger` e `notifications`.
- **Cancelar e expirar:** devolvem os itens ao inventário. O pg_cron expira anúncios após 48 h.
- **Rede de segurança:** `check (qty >= 0)`, `check (coins >= 0)` e `unique(request_id)`. Mesmo um bug de lógica não cria nem duplica valor.
- **Teste obrigatório:** 50 compras simultâneas do mesmo anúncio. Exatamente `qty_total` unidades são vendidas e o total de moedas e itens se conserva.

### Dia/noite e evento das 19h às 21h sem trapaça de fuso

- No cadastro, o fuso vem de `Intl.DateTimeFormat().resolvedOptions().timeZone` e o servidor valida contra `pg_timezone_names`.
- `set_timezone(tz)` só pode ser usado 1 vez a cada 30 dias e grava `tz_changed_at`.
- `get_world_state()` devolve:
  - `localHour = extract(hour from now() at time zone tz)`
  - a fase (madrugada, dia, entardecer, noite)
  - `nightEventActive = localHour in (19, 20)`
  - `eventEndsAt`
  - o clima atual
- `claim_night_event()` só aceita se:
  - o evento está ativo agora, pela hora do servidor;
  - `tz_changed_at < now() - 24h`;
  - o último resgate foi há mais de 20 h;
  - ainda não existe resgate em `event_claims (player, event_key, local_date)`.
- Trocar o fuso, portanto, não repete o evento no mesmo dia.
- O céu, a iluminação e o clima no cliente são só visuais: `serverNow` mais o fuso do perfil. Ao visitar uma fazenda, aparece o céu do fuso do anfitrião.
- **Clima:** o pg_cron gera a cada hora as próximas 48 h por fuso ativo (sorteio com semente determinística `hash(tz, hora)`). É igual para todos do mesmo fuso. Se o clima afetar a produção (chuva rega), quem aplica é o servidor.

---

## 5. Divisão de trabalho por agentes

Regra geral: cada agente só altera os arquivos de que é **dono**. Se precisar mudar um contrato de `packages/shared`, ele abre um pedido ao agente Fundação, ou ao Revisor depois da Fase 1.

### Fase 1: Base (sequencial, rápida)

**A0. Fundação**
- **Objetivo:** montar o monorepo, a CI, os contratos da seção 6, `core/bus.ts`, `core/store.ts`, `net/mockApi.ts` (API falsa em memória que segue os contratos) e uma `FarmScene` vazia que carrega o mapa.
- **Dono de:** arquivos da raiz, `packages/shared/**` (exceto `generated/`), `apps/game/src/core/**`, `main.ts`, `config.ts`, `scenes/Boot.ts`, `docs/**`, `.github/**`, `tools/seed/**`.
- **Pronto quando:** `pnpm i && pnpm build && pnpm test` passam na CI, o jogo abre no navegador mostrando o mapa com câmera que arrasta e dá zoom, e `CONTRACTS.md` está publicado.

**A1. Assets** (começa junto com A0, porque só depende do formato dos atlas)
- **Objetivo:** construir o pipeline da seção 1, os atlas, o layout no Tiled, a camada de telhados (`overhead`) e as prévias.
- **Dono de:** `tools/assets/**`, `assets-src/**`, `apps/game/public/assets/**`, `packages/shared/src/generated/**`.
- **Pronto quando:**
  - `build.py --all` roda sem erro e a contagem de sprites bate com os manifestos;
  - os atlas carregam no Phaser;
  - `preview_on_map.png` foi aprovada pelo dono;
  - o `.tmj` tem colisão, ≥ 20 `plots`, `pens`, `spawn` e `locked_lots`;
  - existe um README de como trocar uma arte.

### Fase 2: Núcleo (4 agentes em paralelo)

**A2. Servidor**
- **Objetivo:** schema, RLS, gatilho de cadastro, relógio da fazenda, RPCs da fazenda e da loja NPC (seção 6), seed gerado a partir do catálogo e a implementação real de `net/api.ts`.
- **Dono de:** migrations `000xxx`, `supabase/tests/base_*`, `apps/game/src/net/**` (exceto `mockApi.ts`).
- **Depende de:** `shared/types`, `api.ts`, `errors.ts`, catálogo.
- **Pronto quando os testes pgTAP passam:**
  - `update` direto em `wallets` falha;
  - colher antes da hora retorna `NOT_READY`;
  - 30 h offline creditam exatamente 28800 s;
  - repetir o mesmo `request_id` não duplica nada;
  - todas as tabelas têm RLS;
  - a API real e a mock passam na mesma suíte Vitest de contrato.

**A3. Fazenda (cliente)**
- **Objetivo:** movimento do jogador (teclado e toque), colisão e ordenação por profundidade a partir do `.tmj`, desenho dos canteiros e estágios das plantas, animais vagando nos cercados, interação (tocar no canteiro abre plantar ou colher) chamando a API e atualização otimista revertida em caso de erro.
- **Dono de:** `apps/game/src/farm/**`, `scenes/FarmScene.ts`, `scenes/Preload.ts`.
- **Depende de:** chaves dos atlas, esquema do layout, `IApi` (desenvolve com a mock), eventos do bus.
- **Pronto quando:** com a mock, dá para plantar, ver o progresso e colher; o jogador não atravessa paredes e passa atrás dos telhados; roda a 60 fps num celular médio (teste no Chrome emulando celular).

**A4. Tempo**
- **Objetivo:** sincronização da hora do servidor, `set_timezone`, tabela de clima e cron, `get_world_state`, `claim_night_event`, iluminação noturna e efeitos de chuva no cliente, aviso de início e fim do evento.
- **Dono de:** migrations `001xxx`, `supabase/tests/time_*`, `apps/game/src/time/**`, `apps/game/src/fx/**`.
- **Depende de:** `ServerTime`, `WorldState`, eventos `time:*`.
- **Pronto quando:**
  - o pgTAP cobre o evento ativo às 19:30 e inativo às 21:00 no fuso do perfil, e a troca de fuso bloqueando o resgate por 24 h;
  - um teste Vitest mostra que mudar o relógio do aparelho não altera a fase calculada.

**A5. Interface**
- **Objetivo:** HUD (moedas, nível, relógio local, ícone do evento), inventário, loja NPC (comprar sementes, vender produção), tela "enquanto você esteve fora", mensagens de erro a partir dos códigos de erro, e layout responsivo para celular.
- **Dono de:** `apps/game/src/ui/**` (exceto `market/` e `social/`).
- **Depende de:** store, bus e `IApi`.
- **Pronto quando:** o fluxo de comprar semente, plantar, colher e vender funciona de ponta a ponta com a mock, e os botões têm pelo menos 44 px no celular.

### Fase 3: Multiplayer (paralelo, depois que a Fase 2 é integrada)

**A6. Mercado**
- **Objetivo:** RPCs do mercado com escrow, expiração por pg_cron, telas de busca, venda, meus anúncios e histórico de preço, notificação de venda via Realtime.
- **Dono de:** migrations `002xxx`, `supabase/tests/market_*`, `apps/game/src/ui/market/**`, `net/market.ts`.
- **Pronto quando:** o teste de concorrência (50 compradores simultâneos) mostra que moedas e itens se conservam; cancelar devolve os itens; o anúncio aparece para outro navegador em menos de 2 s.

**A7. Visitas**
- **Objetivo:** `visit_list_candidates`, `visit_get_farm` (visão pública), `visit_interact` (curtir e regar, 1 vez por dia por anfitrião), `VisitScene` só de leitura, presença em `farm:{id}`.
- **Dono de:** migrations `003xxx`, `supabase/tests/visit_*`, `scenes/VisitScene.ts`, `ui/social/**`, `net/visits.ts`.
- **Pronto quando:** o visitante vê a fazenda do outro, mas não consegue colher nem ver o inventário (testado via RPC e via `select` direto); o limite diário funciona; o anfitrião vê "X está visitando".

### Fase 4: Revisão

**A8. Revisor (segurança e integração)**
- **Objetivo:** auditoria e correções.
  - Toda função `security definer` tem `search_path = ''`.
  - Nenhuma chave `service_role` no cliente.
  - Nenhuma decisão de valor tomada no cliente.
  - Ordem das travas de linha consistente.
  - Teste E2E com Playwright, em 2 contas: plantar, colher, vender no mercado, comprar com a outra conta, visitar.
  - Revisar o `DEPLOY.md` do ponto de vista de quem não programa.
- **Dono de:** `tests/e2e/**`. Correções em outras pastas entram por PR revisada.
- **Pronto quando:** a CI está verde, o E2E passa contra o projeto de staging, e o checklist de segurança está assinado em `docs/`.

---

## 6. Contratos que precisam existir antes do paralelo (entregues pelo A0)

**Tipos em `packages/shared/src/types`:** `ItemId`, `ItemDef`, `Rarity`, `CropDef`, `AnimalDef`, `PlotSlotId`, `PlotState`, `AnimalState`, `InventoryEntry`, `Wallet`, `FarmSnapshot`, `OfflineReport`, `MutationResult`, `WorldState` (`localHour`, `phase`, `weather`, `nightEventActive`, `eventEndsAt`), `MarketListing`, `MarketTrade`, `PublicFarmSnapshot`, `ApiError`.

**Formato de retorno das mutações:** `MutationResult = { wallet?, inventoryChanges?: InventoryEntry[], plots?, animals?, xp?, farmClock, serverNow }`. O cliente aplica isso no store sem recarregar tudo.

**Códigos de erro (`errors.ts`):** `NOT_AUTHENTICATED`, `NOT_OWNER`, `NOT_READY`, `SLOT_LOCKED`, `SLOT_OCCUPIED`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_ITEMS`, `NOT_TRADABLE`, `PRICE_OUT_OF_RANGE`, `LISTING_GONE`, `LISTING_LIMIT`, `OWN_LISTING`, `RATE_LIMITED`, `INVALID_TZ`, `TZ_CHANGE_TOO_SOON`, `EVENT_NOT_ACTIVE`, `ALREADY_CLAIMED`, `VISIT_LIMIT`, `DUPLICATE_REQUEST`.
- O SQL lança esses códigos com `raise exception '<CODE>'`.

**RPCs (`api.ts`, interface `IApi`, implementada pela mock e pela real).** Todo RPC que mexe em valor recebe `request_id uuid`.

| Grupo | RPCs |
|---|---|
| Núcleo | `bootstrap()`, `heartbeat()`, `get_server_time()`, `plant(slot_id, seed_item_id)`, `harvest(slot_id)`, `harvest_all()`, `unlock_slot(slot_id)`, `buy_animal(animal_type)`, `collect_animal(animal_id)`, `shop_buy(item_id, qty)`, `shop_sell(item_id, qty)` |
| Tempo | `get_world_state()`, `set_timezone(tz)`, `claim_night_event()` |
| Mercado | `market_create_listing(item_id, qty, price_each)`, `market_buy(listing_id, qty)`, `market_cancel(listing_id)`, `market_search(item_id?, sort, page)`, `market_my_listings()`, `market_price_history(item_id)` |
| Visitas | `visit_list_candidates(page)`, `visit_get_farm(host_id)`, `visit_interact(host_id, kind)` |

**Eventos internos do cliente (`events.ts`):** `farm:snapshot`, `plot:updated`, `animal:updated`, `inventory:changed`, `wallet:changed`, `xp:changed`, `time:tick`, `time:phase`, `weather:changed`, `event:night-start`, `event:night-end`, `ui:open-panel`, `ui:toast`, `api:error`, `market:listing-changed`, `notify:sold`, `visit:presence`.

**Canais Realtime (`realtime.ts`):**
- `market`: mudanças em `market_listings`
- `user:{uid}`: mudanças em `notifications`
- `farm:{farmId}`: presença de visitantes

**Layout (`layout.ts`):** esquema dos objetos do `.tmj` (`collision`, `plots{slotId}`, `pens{habitat}`, `spawn`, `overhead`, `locked_lots{lotId, cost}`).

**Atlas:** as chaves seguem o padrão `atlas_<categoria>` e `<entidade>/<ação>_<direção>_<n>`, por exemplo `farmer_m/walk_down_0`.

---

## 7. Primeiro marco jogável (MVP)

- **Login:** conta de convidado (login anônimo do Supabase), com opção de ligar e-mail depois.
- **Um mapa com:**
  - jogador fazendeiro andando com 1 quadro por direção e um pulinho de animação;
  - **4 canteiros liberados** e 2 bloqueados, que podem ser comprados.
- **3 culturas** com ícones existentes: cenoura (2 min), batata (10 min), morango (1 h).
- Comprar semente, plantar, colher e vender na loja NPC. Moedas e inventário na interface.
- **Produção offline com limite de 8 h** e a tela "enquanto você esteve fora".
- Iluminação dia/noite pelo fuso do perfil.
- **Fica de fora:** animais, clima, evento, mercado, visitas, cartas.
- **Teste de aceitação:**
  1. Plante o morango.
  2. Feche o jogo.
  3. Mude o relógio do celular para +1 dia e reabra: o morango **não** pode estar pronto antes da hora real.
  4. Volte depois de 1 h real: está pronto.

---

## 8. Perguntas em aberto para o dono

1. **Cartas com raridade:** para que servem? Coleção, bônus de produção, pacotes sorteados? Se houver sorteio pago, atenção à legislação brasileira sobre caixas de recompensa em jogos acessíveis a menores.
2. **Evento noturno das 19h às 21h:** o que acontece nele?
3. **Mercado:** só com moeda do jogo, ou também com gemas compradas? Skins e cartas poderão ser vendidas entre jogadores?
4. **Público:** o jogo é para crianças? Isso muda login, dados pessoais (LGPD) e chat.
5. **Celular:** retrato ou paisagem?
6. **Artes que faltam:** gerar com IA ou contratar um pixel artist? Em que prazo?

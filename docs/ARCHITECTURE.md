# Arquitetura

## Princípio

**O servidor decide tudo que tem valor.** O cliente desenha, anima e prevê; quem diz se a planta está pronta, quanto você tem de moedas, se a carta vale ou se a retirada para a Steam pode sair é o Postgres (RPCs). Nesta fase o "servidor" é a `MockApi` em memória, que segue as mesmas regras.

## Plataforma (DECISOES.md)

```
 Electron (janela redimensionável, paisagem)
  ├─ Phaser + Preact (este repositório: apps/game)
  └─ Steamworks (greenworks/steamworks.js): ticket de login, leitura do inventário Steam, microtransações
         │ ticket                                  │ RPCs (supabase-js, JWT)
         ▼                                         ▼
 Edge Function steam-auth ──sessão──►  Supabase (Postgres: RPCs, RLS, pg_cron, Realtime)
                                                   │ Edge Functions steam-inventory (chave de publisher)
                                                   ▼
                                       Steam Web API / Steam Inventory Service
```

- **Só Steam no PC**, jogo pago (US$ 1,99), 18+. O build web serve só para desenvolvimento e testes internos.
- **Login pela Steam**: ticket (`GetAuthTicketForWebApi`) → Edge Function valida e confere a posse do jogo → sessão Supabase. Em dev: login anônimo ou `MockApi`.
- **Sem mercado interno.** O comércio é no mercado da Steam: o jogador **retira** itens (colheitas, produtos, cartas usadas, skins) para o inventário Steam, com cota de 1 a cada 7 h (4 com VIP), e pode **trazer de volta** o que tiver lá. Quem fala com a Steam é sempre o servidor (chave de publisher nos segredos das Edge Functions); o cliente só lê o inventário local pelo Steamworks para escolher o que trazer.
- **VIP e compras**: microtransações da Steam (fase de monetização). Hoje só existe a flag `profile.vip`.
- **Cartas de buff, álbum e evento noturno**: regras em `CONTRACTS.md` §5 e §7; funções puras em `packages/shared/src/formulas/`.

## Pastas

```
packages/shared/     contratos (tipos, erros, eventos, IApi, layout, manifest), catálogo JSON (itens, culturas,
                     animais, cartas), fórmulas (progresso, buffs, evento noturno)
apps/game/
  index.html         #game (canvas Phaser) + #ui-root (painéis DOM em Preact por cima)
  vite.config.ts     build estático; em dev serve a prévia /__dev/ (?dev-assets)
  public/assets/     GERADO pelo pipeline de arte (A1). Não editar à mão.
  src/
    main.ts          cria o Phaser e monta a camada DOM
    config.ts        pixelArt, roundPixels, escala RESIZE (janela redimensionável)
    core/            Fundação: bus, store, services, assets, câmera, depuração do layout, ids
    net/             mockApi.ts (A0); api.ts, realtime.ts (A2); steam.ts (A6); visits.ts (A7)
    scenes/          Boot.ts (A0), FarmScene.ts (A3), VisitScene.ts (A7)
    farm/ time/ fx/ ui/   donos na docs/AGENTS.md
  test/              Vitest (node): mock, store, bus, manifest, câmera
```

## Fluxo de inicialização

1. `BootScene` lê `assets/manifest.json` (`core/assets.ts`). Ausente → segue sem assets.
2. Enfileira no loader do Phaser o mapa (`map_ground`), o overhead (`map_overhead`) e os atlas. O JSON de cada atlas é lido antes; se faltar, o atlas é pulado. Falhas viram aviso no console.
3. Lê e interpreta o layout (`parseLayout`).
4. `createServices(layout)`: `bus` + `ClientStore` + `MockApi` (canteiros vindos do layout).
5. `api.bootstrap()` → `store.applyBootstrap()` → evento `farm:snapshot`. Começa o `time:tick` (1 s) e o heartbeat (5 min; 1 min durante o evento noturno; e ao voltar para a aba).
6. `FarmScene`: desenha o mapa (depth 0), o overhead por cima (depth 5000), liga a câmera e a depuração do layout (depth 10000).

## Fluxo de uma ação (exemplo: plantar)

```
UI/cena → (opcional) store.optimisticPlot(...)  → api.plant({ slotId, seedItemId, requestId: newRequestId() })
        ← MutationResult → store.apply(result) → bus: plot:updated, inventory:changed …
        ← ApiError       → desfaz o otimista; bus: api:error (A5 mostra a mensagem)
```

`core/services.ts: run(op, call)` já converte erros e publica `api:error`.

## Tempo

- O relógio que vale é o `farm_clock_s` do servidor (crédito offline limitado a 8 h; ver CONTRACTS §2).
- O cliente guarda o último `farmClock`/`serverNow` recebido e interpola com `performance.now()` só para barras e animação (`store.estimatedFarmClock()`, `formulas/progress.ts`).
- Mudar o relógio do aparelho não muda nada: o cliente não usa `Date.now()` para decidir.
- Evento noturno (19h–21h locais): o servidor mede a presença (heartbeat + interação) e encurta `readyFc`; o cliente recebe os canteiros atualizados no heartbeat. A previsão visual pode usar `nightEvent.speedMult` do `get_world_state`.
- Cartas: janelas no relógio da fazenda; `store.currentBuffs()` filtra as ainda ativas para a interface.

## Câmera e escala

- Escala `RESIZE`: o canvas ocupa a tela toda. O zoom mínimo é o que cobre a tela inteira com o mapa (nunca aparece fora das bordas); máximo 3×.
- Arrastar (mouse ou 1 dedo, com limiar de 6 px para não roubar toques), roda do mouse e pinça (2 dedos) com zoom em volta do ponto tocado.
- `CameraController.isDragging` permite à cena ignorar o toque que terminou um arrasto.

## Camadas de desenho (`DEPTH` em `core/constants.ts`)

`map 0` · `ground 10` (terra arada sobre os canteiros) · `entities 100 + y` (ordenação por profundidade) · `overhead 5000` · `debug 10000`.

## Interface DOM

Painéis (inventário, loja, cartas, álbum, retirada para a Steam) são Preact em `#ui-root`, por cima do canvas. Falam com o jogo só pelo `bus` e pelo `store`. Exemplo mínimo: `core/devOverlay.tsx` (botão "Layout").

## Build e testes

- `pnpm build` gera `apps/game/dist/` (site estático; JS em `dist/_app/`, arte em `dist/assets/`).
- `pnpm test` roda Vitest em `packages/shared` e `apps/game` (ambiente node; o Phaser não é carregado nos testes — a lógica testável fica em módulos puros como `cameraMath.ts` e `assets.ts`).

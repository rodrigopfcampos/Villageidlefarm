# Contratos (Fase 0)

Fonte da verdade: o código em `packages/shared/src` (importe sempre de `@vif/shared`).
Este arquivo resume as regras. Mudou um contrato? Peça à Fundação (A0) e atualize este arquivo no mesmo PR.

## 1. Unidades e convenções

| O quê                                                | Tipo                                        | Regra                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Moedas, gemas, preços, quantidades                   | `number` inteiro                            | Nunca decimal. Nunca negativo (o servidor tem `check (>= 0)`).                                                                     |
| `farmClock`, `plantedFc`, `readyFc`, `lastCollectFc` | segundos inteiros do **relógio da fazenda** | Toda produção é medida nesse relógio, não no relógio real.                                                                         |
| `serverNow`, `eventEndsAt`, `createdAt`…             | ms Unix (UTC)                               | Sempre vindos do servidor.                                                                                                         |
| Ids do catálogo                                      | string legível                              | `seed_carrot`, `crop_carrot`, `prod_egg`, `animal_chicken`. A cultura usa o id do item colhido (`crop_carrot`).                    |
| `slotId`                                             | string do layout do Tiled                   | Fonte da verdade dos canteiros; entra no seed do banco.                                                                            |
| JSON das RPCs                                        | camelCase                                   | Montado no SQL com `jsonb_build_object`, igual aos tipos de `shared`. Argumentos das RPCs em snake_case (`slot_id`, `request_id`). |

O cliente **nunca** usa `Date.now()` para decidir nada (o ESLint avisa). Só para animação, via `store.estimatedFarmClock()`.

## 2. Relógio da fazenda (servidor e mock fazem igual)

No início de toda RPC da fazenda, depois de travar a linha da fazenda:

```
elapsed = now() - clock_synced_at            (nunca negativo)
real    = floor(elapsed em segundos)
se real >= 28800:  farm_clock_s += 28800;  clock_synced_at = now()
senão:             farm_clock_s += real;   clock_synced_at += real segundos   (guarda a fração)
```

- `bootstrap()` devolve `offlineReport = { realSeconds, creditedSeconds, capped }` (`capped` = ficou fora mais de 8 h).
- Planta pronta quando `farm_clock_s >= ready_fc`; `ready_fc = planted_fc + grow_seconds × get_modifiers()` (hoje 1.0).
- Animal: `n = min(floor((fc - last_collect_fc) / produce_seconds), max_stock)`; ao coletar `last_collect_fc += n × produce_seconds`, ou `= fc` se `n = max_stock`. `n = 0` → `NOTHING_TO_COLLECT`.
- Rendimento da colheita: entre `yieldMin` e `yieldMax`, determinístico por `request_id` + `slot_id` (a mock usa FNV-1a; o servidor pode usar `hashtext`).

## 3. Idempotência (`request_id`)

- Toda chamada que mexe em valor recebe `requestId` (UUID gerado em `core/ids.ts: newRequestId()`).
- Mutação **bem-sucedida** grava o id (`unique(player_id, request_id)` no `ledger`).
- Repetir um id já usado → erro `DUPLICATE_REQUEST` e **nada muda**. O cliente trata como "já foi feito" e ressincroniza (`heartbeat`/`bootstrap`).
- Mutação que **falhou** não consome o id (a transação desfaz tudo, inclusive o crédito do relógio).

## 4. Retorno das mutações: `MutationResult`

```ts
{ wallet?, inventoryChanges?, plots?, animals?, xp?, gained?, farmClock, serverNow }
```

- `inventoryChanges`: quantidade **absoluta** nova de cada item que mudou (`qty: 0` = sumiu).
- `plots` / `animals`: estado completo de cada entidade que mudou.
- `xp`: `{ level, xp }` totais depois da ação.
- `gained`: o que entrou no inventário nesta ação (só para efeitos visuais).
- O cliente aplica com `store.apply(result)`, que dispara os eventos do bus.

## 5. Códigos de erro (`errors.ts`)

Do plano: `NOT_AUTHENTICATED`, `NOT_OWNER`, `NOT_READY`, `SLOT_LOCKED`, `SLOT_OCCUPIED`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_ITEMS`, `NOT_TRADABLE`, `PRICE_OUT_OF_RANGE`, `LISTING_GONE`, `LISTING_LIMIT`, `OWN_LISTING`, `RATE_LIMITED`, `INVALID_TZ`, `TZ_CHANGE_TOO_SOON`, `EVENT_NOT_ACTIVE`, `ALREADY_CLAIMED`, `VISIT_LIMIT`, `DUPLICATE_REQUEST`.

Acrescentados pela Fundação:

| Código                                        | Quando                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `SLOT_EMPTY`                                  | colher canteiro vazio                                                                  |
| `ALREADY_UNLOCKED`                            | liberar canteiro/lote já liberado                                                      |
| `LEVEL_TOO_LOW`                               | nível abaixo do exigido (cultura, canteiro, animal)                                    |
| `NOT_FOR_SALE`                                | a loja NPC não vende (`shopBuyable = false`) ou não compra (`sellPrice = null`) o item |
| `NOT_FOUND`                                   | id inexistente                                                                         |
| `INVALID_INPUT`                               | qty não inteira, ≤ 0 ou > 999; item do tipo errado (plantar algo que não é semente)    |
| `NOTHING_TO_COLLECT`                          | animal sem produção                                                                    |
| `NOT_IMPLEMENTED`, `NETWORK_ERROR`, `UNKNOWN` | só no cliente                                                                          |

O SQL lança `raise exception '<CODE>'`. `toApiError(err)` acha o código dentro da mensagem do Postgres. Mensagens em português: `ERROR_MESSAGES_PT`.

Ordem das validações (a mock segue; o SQL deve seguir para os testes de contrato baterem):

- `plant`: `NOT_FOUND` → `SLOT_LOCKED` → `SLOT_OCCUPIED` → `INVALID_INPUT` (não é semente) → `LEVEL_TOO_LOW` → `INSUFFICIENT_ITEMS`
- `harvest`: `NOT_FOUND` → `SLOT_LOCKED` → `SLOT_EMPTY` → `NOT_READY`
- `unlock_slot`: `NOT_FOUND` → `ALREADY_UNLOCKED` → `LEVEL_TOO_LOW` → `INSUFFICIENT_FUNDS`
- `shop_buy`: `NOT_FOUND` → `NOT_FOR_SALE` → `INVALID_INPUT` → `INSUFFICIENT_FUNDS`
- `shop_sell`: `NOT_FOUND` → `NOT_FOR_SALE` → `INVALID_INPUT` → `INSUFFICIENT_ITEMS`
- `harvest_all` sem nada pronto **não é erro**: devolve só `farmClock`/`serverNow`.

## 6. `IApi` (`api.ts`) e nomes das RPCs

| Método                       | RPC                      | Parâmetros                             |
| ---------------------------- | ------------------------ | -------------------------------------- |
| `bootstrap()`                | `bootstrap`              | —                                      |
| `heartbeat()`                | `heartbeat`              | —                                      |
| `getServerTime()`            | `get_server_time`        | —                                      |
| `plant(p)`                   | `plant`                  | `slot_id, seed_item_id, request_id`    |
| `harvest(p)`                 | `harvest`                | `slot_id, request_id`                  |
| `harvestAll(p)`              | `harvest_all`            | `request_id`                           |
| `unlockSlot(p)`              | `unlock_slot`            | `slot_id, request_id`                  |
| `buyAnimal(p)`               | `buy_animal`             | `animal_type, request_id`              |
| `collectAnimal(p)`           | `collect_animal`         | `animal_id, request_id`                |
| `shopBuy(p)` / `shopSell(p)` | `shop_buy` / `shop_sell` | `item_id, qty, request_id`             |
| `getWorldState()`            | `get_world_state`        | —                                      |
| `setTimezone(p)`             | `set_timezone`           | `tz, request_id`                       |
| `claimNightEvent(p)`         | `claim_night_event`      | `request_id`                           |
| `marketCreateListing(p)`     | `market_create_listing`  | `item_id, qty, price_each, request_id` |
| `marketBuy(p)`               | `market_buy`             | `listing_id, qty, request_id`          |
| `marketCancel(p)`            | `market_cancel`          | `listing_id, request_id`               |
| `marketSearch(p)`            | `market_search`          | `item_id?, sort, page`                 |
| `marketMyListings()`         | `market_my_listings`     | —                                      |
| `marketPriceHistory(itemId)` | `market_price_history`   | `item_id`                              |
| `visitListCandidates(page)`  | `visit_list_candidates`  | `page`                                 |
| `visitGetFarm(hostId)`       | `visit_get_farm`         | `host_id`                              |
| `visitInteract(p)`           | `visit_interact`         | `host_id, kind ('like'                 | 'water'), request_id` |

O mapa método → RPC está em `RPC_NAMES`. Constantes de economia em `ECONOMY` (teto offline 28800 s, heartbeat 5 min, qty máx. 999, taxa 5 %, 20 anúncios, 48 h).

**Mock (`apps/game/src/net/mockApi.ts`)**: implementa todo o Núcleo + `getWorldState` (provisório). `setTimezone`, `claimNightEvent`, Mercado e Visitas lançam `NOT_IMPLEMENTED`. Relógio injetável: `new MockApi({ clock: new FakeClock() })`.

## 7. Catálogo (`packages/shared/src/catalog/*.json`)

- `items.json`: `ItemDef` — `basePrice` (a loja NPC **vende** por este preço se `shopBuyable`), `sellPrice` (a loja **paga** isto, ou `null`), `tradable`, `minPrice`/`maxPrice` (mercado), `spriteKey` (quadro no atlas, ex. `icon/carrot`).
- `crops.json`: cenoura 120 s, batata 600 s, morango 3600 s.
- `animals.json`: galinha, pato, vaca (fora do MVP, mas com tipos prontos).
- Kit inicial (`STARTER_KIT`): 100 moedas + 5 `seed_carrot`. Canteiros iniciais: os que têm `startsUnlocked = true` no layout.
- Nível: `xpForLevel(L) = 25 × (L-1) × L` (nível 2 = 50 xp, 3 = 150, 4 = 300…). `levelForXp` é usada pela mock e deve ser igual no SQL.
- `validateCatalog()` roda nos testes: referências, inteiros, e a loja nunca paga mais do que cobra.

## 8. Eventos do cliente (`events.ts`, bus em `core/bus.ts`)

`farm:snapshot`, `plot:updated`, `animal:updated`, `inventory:changed`, `wallet:changed`, `xp:changed`, `time:tick`, `time:phase`, `weather:changed`, `event:night-start`, `event:night-end`, `ui:open-panel`, `ui:toast`, `api:error`, `market:listing-changed`, `notify:sold`, `visit:presence`, e `debug:toggle-layout` (ferramenta de dev). Os payloads estão tipados em `ClientEvents`.

## 9. Realtime (`realtime.ts`)

- `market` — mudanças em `market_listings`
- `user:{uid}` — mudanças em `notifications` (`RT_CHANNELS.user(uid)`)
- `farm:{farmId}` — presença de visitantes (`RT_CHANNELS.farm(id)`)

## 10. Assets: `apps/game/public/assets/manifest.json` (escrito pelo A1)

```json
{
  "map": {
    "image": "map/farm.webp",
    "overhead": "map/overhead.png",
    "layout": "map/farm_layout.tmj",
    "width": 2576,
    "height": 1438
  },
  "atlases": [
    { "key": "atlas_icons", "png": "atlas/atlas_icons.png", "json": "atlas/atlas_icons.json" }
  ]
}
```

- Caminhos relativos à pasta do manifest. Atlas em **JSON Hash** do Phaser. Chaves `atlas_<categoria>` (icons, cards, animals, characters, pets, vehicles).
- Quadros: `"<entidade>/<pose>_<n>"` (ex.: `cow/pose_0`, `icon/carrot`, `card/frame_rare`, `farmer_m/idle_down_0`).
- Tudo é opcional: o jogo abre sem manifest, sem mapa ou sem algum atlas (só avisa no console).
- Chaves de textura fixas no jogo: `map_ground` e `map_overhead` (`TEXTURE_KEYS`, iguais a `MAP_KEYS` gerado pelo A1).
- Ícones de semente e de produto animal (`icon/seed_*`, `icon/egg`, `icon/milk`…) ainda não existem no atlas: quem desenha deve usar um substituto (ex.: o ícone da cultura) quando `textures.get(atlas).has(frame)` for falso.

## 11. Layout do Tiled (`layout.ts`)

Mapa ortogonal, tile 32×32, 81×45 células. Camadas de objetos (nomes exatos; podem estar dentro de grupos):

| Camada                | Objetos                 | Propriedades                                                                                                                 |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `collision`           | retângulos ou polígonos | —                                                                                                                            |
| `plots`               | retângulos              | `slotId: string` (único), `unlockCost: int` (padrão 0), `unlockLevel: int` (padrão 1), `startsUnlocked: bool` (padrão false) |
| `pens`                | retângulos              | `habitat: coop                                                                                                               | barn | pond`; o `name` vira o id do cercado |
| `spawn`               | ponto com name `player` | —                                                                                                                            |
| `locked_lots`         | retângulos              | `lotId: string` (único), `cost: int`                                                                                         |
| `npc_points`          | pontos                  | `npc: string`                                                                                                                |
| `overhead` (opcional) | retângulos ou polígonos | áreas de telhado/copa                                                                                                        |

`parseLayout(tmj)` devolve `{ layout, warnings }` com coordenadas absolutas em pixels. Só lança `LayoutError` se o mapa for inutilizável (não ortogonal, infinito, sem tamanho). Objeto inválido é ignorado com aviso. `layoutPlotSlots(layout)` dá as `PlotSlotDef` para a mock e para o seed.

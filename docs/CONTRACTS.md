# Contratos

Fonte da verdade: o código em `packages/shared/src` (importe sempre de `@vif/shared`).
Este arquivo resume as regras. Mudou um contrato? Peça à Fundação (A0) e atualize este arquivo no mesmo PR.
As decisões do dono em `docs/DECISOES.md` e `docs/BALANCEAMENTO.md` valem por cima do `PLANO-FASE0.md`.

## 1. Unidades e convenções

| O quê                                                                       | Tipo                               | Regra                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Moedas, gemas, preços, quantidades                                          | `number` inteiro                   | Nunca decimal. Nunca negativo (o servidor tem `check (>= 0)`). Bônus fracionários usam arredondamento estocástico (§5). |
| `farmClock`, `plantedFc`, `readyFc`, `lastCollectFc`, `startedFc`, `endsFc` | segundos do **relógio da fazenda** | Toda produção e toda janela de carta são medidas nesse relógio.                                                         |
| `serverNow`, `endsAt`, `createdAt`…                                         | ms Unix (UTC)                      | Sempre vindos do servidor.                                                                                              |
| Ids do catálogo                                                             | string legível                     | `seed_carrot`, `crop_carrot`, `prod_egg`, `animal_chicken`, `card_gold_rare`. A cultura usa o id do item colhido.       |
| `slotId`                                                                    | string do layout do Tiled          | Fonte da verdade dos canteiros; entra no seed do banco.                                                                 |
| JSON das RPCs                                                               | camelCase                          | Montado com `jsonb_build_object`. Argumentos em snake_case (`slot_id`, `request_id`).                                   |

O cliente **nunca** usa `Date.now()` para decidir nada (o ESLint avisa). Só para animação/agendamento.

## 2. Relógio da fazenda

No início de toda RPC da fazenda, depois de travar a linha da fazenda (`sync_farm_clock`):

```
-- 1) evento noturno (ver §7): acelera canteiros pela presença em [last_sync_at, min(now, last_interaction_at + 5 min)]
-- 2) crédito:
elapsed = now() - clock_synced_at            (nunca negativo)
real    = floor(elapsed em segundos)
se real >= 28800:  farm_clock_s += 28800;  clock_synced_at = now()
senão:             farm_clock_s += real;   clock_synced_at += real segundos   (guarda a fração)
last_sync_at = now()
```

- `bootstrap()` devolve `offlineReport = { realSeconds, creditedSeconds, capped }`.
- Planta pronta quando `farm_clock_s >= ready_fc`; `ready_fc = planted_fc + round(grow_seconds × (1 − bônus de Adubo do álbum))`. Adubo (carta) e evento **diminuem** `ready_fc`, nunca abaixo de `planted_fc`.
- Animal: `n = min(floor((fc − last_collect_fc) / produce_seconds), max_stock)`; ao coletar `last_collect_fc += n × produce_seconds`, ou `= fc` se `n = max_stock`. `n = 0` → `NOTHING_TO_COLLECT`.
- Heartbeat: no máximo 1 a cada 10 s (`RATE_LIMITED`). O cliente manda a cada 5 min, e a cada 1 min durante o evento.

## 3. Idempotência (`request_id`)

- Toda chamada que mexe em valor recebe `requestId` (UUID de `core/ids.ts: newRequestId()`), inclusive `card_activate`, `claim_night_event`, `set_timezone`, `extraction_request` e `steam_return_sync`.
- Mutação **bem-sucedida** grava o id (`unique(player_id, request_id)` no `ledger`). Repetir → `DUPLICATE_REQUEST` e **nada muda**. O cliente trata como "já foi feito" e ressincroniza.
- Mutação que **falhou** não consome o id (a transação desfaz tudo).
- Toda mutação bem-sucedida grava `last_interaction_at = now()` (presença no evento, anti-bot).

## 4. Retorno das mutações: `MutationResult`

```ts
{ wallet?, inventoryChanges?, plots?, animals?, xp?, gained?, bonusCoins?, cards?, activeBuffs?, farmClock, serverNow }
```

- `inventoryChanges`: quantidade **absoluta** nova de cada item que mudou (`qty: 0` = sumiu). Itens `card_*` = cópias de carta usada (álbum).
- `plots` / `animals`: estado completo de cada entidade que mudou (inclui canteiros acelerados pelo evento durante a sincronização).
- `xp`: `{ level, xp, accountLevel, accountXp }` (XP de fazenda e XP de conta).
- `gained`: o que entrou no inventário (efeitos visuais). `bonusCoins`: moedas extras de buffs, já somadas em `wallet`.
- `cards`: cartas novas (drop) ou que mudaram (usadas). `activeBuffs`: lista **completa** de buffs em vigor, quando mudou.
- O cliente aplica com `store.apply(result)`, que dispara os eventos do bus.

## 5. Cartas de buff (`catalog/cards.json`, `formulas/buffs.ts`)

**Catálogo:** 8 buffs × 5 raridades = 40 `CardDef` (`card_<buff>_<raridade>`). Cada carta também é um item (`kind: "card"`, `steamExtractable: true`).

| Buff (`BuffKind`)   | `magnitude`                | Efeito                                                    | Arte (PROVISÓRIO)       |
| ------------------- | -------------------------- | --------------------------------------------------------- | ----------------------- |
| `gold`              | 0.5                        | moedas extras = 50% do valor de venda NPC da produção     | `card/art_1` sol        |
| `bountiful_harvest` | 1                          | +1 unidade por colheita                                   | `card/art_2` cesta      |
| `animals`           | 0.5                        | +50% de produção dos animais                              | `card/art_3` ovelha     |
| `account_xp`        | 0.5                        | +50% de XP de conta                                       | `card/art_4` coruja     |
| `fertilizer`        | 1800/2700/3600/4500/5400 s | **instantâneo**: avança todos os canteiros em crescimento | `card/art_5` ampulheta  |
| `farm_xp`           | 0.5                        | +50% de XP de fazenda                                     | `card/art_6` nuvem      |
| `luck`              | 1.0                        | +100% de chance de carta                                  | `card/art_7` ferradura  |
| `merchant`          | 0.25                       | −25% no preço das sementes (`ceil`)                       | `card/art_8` engrenagem |

Ícones: `buff/icon_1..8` na mesma ordem. Moldura: `card/frame_<raridade>`. Duração: comum 1 h, incomum 1h30, rara 2 h, épica 2h30, lendária 3 h (Adubo = 0).

**Regras:**

- **Drop** na colheita: chance = `growSeconds/3600 × 0,0125 × (1 + Sorte)`, máx. 1. Buff uniforme entre os 8; raridade 55/27/12/5/1.
- **Ativar** (`card_activate`): carta `unused` → `used` e +1 item `card_*` (cópia no álbum). Erros: `NOT_FOUND`, `CARD_ALREADY_USED`, `BUFF_ALREADY_ACTIVE` (mesmo buff já ativo), `CARD_SLOT_FULL` (1 ativa; 2 com VIP). Adubo não ocupa vaga.
- **Janela:** `[startedFc, endsFc)` no relógio da fazenda. O servidor guarda o **histórico** de janelas (inclui expiradas).
- **Só vale o que foi produzido na janela:** para uma produção em `[início, fim]` (planta: `[plantedFc, readyFc]`; animal: `[lastCollectFc, lastCollectFc + n×produce]`), bônus = Σ `magnitude × sobreposição/duração`. Ex.: Ouro ativo só na última 1 h de uma melancia de 8 h → 480 × 0,5 × 1/8 = 30 moedas. Ativar na hora da colheita → 0.
- **Mercador** vale no instante da compra (carta ativa agora).
- **Arredondamento estocástico** dos bônus fracionários (2,3 → 2 ou 3, média exata).
- **Álbum** (`album_get`): 40 espaços; espaço cheio se tiver ≥ 1 cópia (`card_*` no inventário). Linha completa (5 raridades de um buff) → +2% permanente daquele buff (Ouro +2% moedas, XP +2%, Animais +2%, Sorte +2% de chance, Mercador −2%, Colheita farta +0,02 unidade, Adubo −2% no tempo de cultivo). **Retirar a última cópia para a Steam esvazia o espaço e tira o bônus da linha** (decisão provisória, a confirmar com o dono).

## 6. Erros (`errors.ts`)

Do plano (sem os do mercado interno, cancelado): `NOT_AUTHENTICATED`, `NOT_OWNER`, `NOT_READY`, `SLOT_LOCKED`, `SLOT_OCCUPIED`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_ITEMS`, `RATE_LIMITED`, `INVALID_TZ`, `TZ_CHANGE_TOO_SOON`, `EVENT_NOT_ACTIVE`, `ALREADY_CLAIMED`, `VISIT_LIMIT`, `DUPLICATE_REQUEST`.

Acrescentados: `SLOT_EMPTY`, `ALREADY_UNLOCKED`, `LEVEL_TOO_LOW`, `NOT_FOR_SALE`, `NOT_FOUND`, `INVALID_INPUT`, `NOTHING_TO_COLLECT`, `CARD_SLOT_FULL`, `BUFF_ALREADY_ACTIVE`, `CARD_ALREADY_USED`, `EXTRACTION_QUOTA`, `NOT_EXTRACTABLE`, `NOT_ACTIVE` (presença insuficiente no evento), `STEAM_UNAVAILABLE`; só no cliente: `NOT_IMPLEMENTED`, `NETWORK_ERROR`, `UNKNOWN`.

O SQL lança `raise exception '<CODE>'`; `toApiError(err)` acha o código na mensagem. Mensagens: `ERROR_MESSAGES_PT`.

Ordem das validações (a mock segue; o SQL deve seguir):

- `plant`: `NOT_FOUND` → `SLOT_LOCKED` → `SLOT_OCCUPIED` → `INVALID_INPUT` → `LEVEL_TOO_LOW` → `INSUFFICIENT_ITEMS`
- `harvest`: `NOT_FOUND` → `SLOT_LOCKED` → `SLOT_EMPTY` → `NOT_READY`
- `unlock_slot`: `NOT_FOUND` → `ALREADY_UNLOCKED` → `LEVEL_TOO_LOW` → `INSUFFICIENT_FUNDS`
- `shop_buy`: `NOT_FOUND` → `NOT_FOR_SALE` → `INVALID_INPUT` → `INSUFFICIENT_FUNDS`; `shop_sell`: … → `INSUFFICIENT_ITEMS`
- `card_activate`: `NOT_FOUND` → `CARD_ALREADY_USED` → `BUFF_ALREADY_ACTIVE` → `CARD_SLOT_FULL`
- `claim_night_event`: `TZ_CHANGE_TOO_SOON` → `ALREADY_CLAIMED` → `NOT_ACTIVE`
- `extraction_request`: `STEAM_UNAVAILABLE` → `NOT_FOUND` → `NOT_EXTRACTABLE` → `INVALID_INPUT` → `LEVEL_TOO_LOW` → `EXTRACTION_QUOTA` → `INSUFFICIENT_ITEMS`
- `harvest_all` sem nada pronto **não é erro**.

## 7. Evento noturno (`formulas/nightEvent.ts`, `NIGHT_EVENT`)

- 19h–21h no horário local do perfil. Fuso: 1 troca a cada 30 dias (`TZ_CHANGE_TOO_SOON`); após trocar, o resgate fica bloqueado por 24 h.
- **Presença:** na sincronização, conta o intervalo `[last_sync_at, min(now, last_interaction_at + 5 min)]` que cai dentro do evento. Sem interação (mutação) nos últimos 5 min = inativo; offline = nada.
- **Velocidade ×1.5:** cada segundo de presença no evento tira 0,5 s de `ready_fc` dos canteiros em crescimento. Só cultivo (animais não).
- **Carta garantida:** `claim_night_event` quando a presença do dia local ≥ 1800 s; 1 por dia local e intervalo mínimo de 20 h.
- `get_world_state().nightEvent = { active, speedMult: 1.5, attendanceSeconds, requiredSeconds: 1800, cardClaimed, endsAt }`. É leitura pura (não sincroniza).

## 8. Steam: login, retirada e volta

**Login (só produção; nada implementado ainda):**

1. Cliente Electron chama `SteamUser.GetAuthTicketForWebApi("vif-auth")` (Steamworks) e envia o ticket à Edge Function `steam-auth`.
2. A Edge Function valida em `ISteamUserAuth/AuthenticateUserTicket` (Steam Web API, chave de publisher nos segredos) e confere que a conta **possui o jogo** (`ISteamUser/CheckAppOwnership`).
3. Cria/acha o usuário do Supabase ligado ao `steamid` e devolve uma sessão (JWT). O `nickname` vem da Steam.
4. Em desenvolvimento: login anônimo do Supabase ou a `MockApi`. Não existe e-mail nem convidado em produção.

**Retirada (`extraction_request(item_id, qty, request_id)`)** — só o servidor fala com o Steam Inventory Service:

- Item com `steamExtractable` (colheitas, produtos, cartas usadas, skins). Sementes e moedas não (`NOT_EXTRACTABLE`).
- Nível de fazenda ≥ 5 (`EXTRACTION_MIN_LEVEL`, **provisório**). `qty` ≤ 1 (`EXTRACTION_MAX_QTY`, **provisório**: pendente "1 unidade ou pilha").
- Cota: janela **deslizante** de 7 h; contam `pending` + `granted`. 1 por janela, 4 com VIP. `extraction_quota()` → `{ used, limit, windowHours, nextSlotAt }`.
- Os itens saem do inventário na hora (escrow). `pending` → `granted` (com `steamItemId`) ou `failed` (devolve os itens). A mock concede na hora com id falso.
- Notificação `extraction_granted` / `extraction_failed` no canal `user:{uid}`.

**Volta (`steam_return_sync(steam_item_ids, request_id)`):** o cliente lê o inventário Steam pelo Steamworks e escolhe os itens; o servidor confere a posse, consome (`ConsumeItem`) e credita no jogo. Gera registros `returned`. Id inexistente → `NOT_FOUND`.

`extraction_list()` lista retiradas e voltas (mais novas primeiro). Tudo no ledger com `request_id`.

## 9. `IApi` (`api.ts`) e RPCs

| Método                              | RPC                             | Parâmetros                                    |
| ----------------------------------- | ------------------------------- | --------------------------------------------- |
| `bootstrap()`                       | `bootstrap`                     | — (inclui `cards` não usadas e `activeBuffs`) |
| `heartbeat()`                       | `heartbeat`                     | — (devolve `plots` acelerados pelo evento)    |
| `getServerTime()`                   | `get_server_time`               | —                                             |
| `plant(p)`                          | `plant`                         | `slot_id, seed_item_id, request_id`           |
| `harvest(p)` / `harvestAll(p)`      | `harvest` / `harvest_all`       | `slot_id?, request_id`                        |
| `unlockSlot(p)`                     | `unlock_slot`                   | `slot_id, request_id`                         |
| `buyAnimal(p)` / `collectAnimal(p)` | `buy_animal` / `collect_animal` | `animal_type` / `animal_id`, `request_id`     |
| `shopBuy(p)` / `shopSell(p)`        | `shop_buy` / `shop_sell`        | `item_id, qty, request_id`                    |
| `cardActivate(p)`                   | `card_activate`                 | `instance_id, request_id`                     |
| `albumGet()`                        | `album_get`                     | —                                             |
| `getWorldState()`                   | `get_world_state`               | —                                             |
| `setTimezone(p)`                    | `set_timezone`                  | `tz, request_id`                              |
| `claimNightEvent(p)`                | `claim_night_event`             | `request_id`                                  |
| `extractionQuota()`                 | `extraction_quota`              | —                                             |
| `extractionRequest(p)`              | `extraction_request`            | `item_id, qty, request_id`                    |
| `extractionList()`                  | `extraction_list`               | —                                             |
| `steamReturnSync(p)`                | `steam_return_sync`             | `steam_item_ids, request_id`                  |
| `visitListCandidates(page)`         | `visit_list_candidates`         | `page`                                        |
| `visitGetFarm(hostId)`              | `visit_get_farm`                | `host_id`                                     |
| `visitInteract(p)`                  | `visit_interact`                | `host_id, kind ('like'\|'water'), request_id` |

Mapa método → RPC em `RPC_NAMES`. Limites em `ECONOMY` e `NIGHT_EVENT`.

**Mock (`apps/game/src/net/mockApi.ts`)**: implementa tudo menos Visitas (`NOT_IMPLEMENTED`). Relógio injetável (`FakeClock`). Ajudas de teste: `setVip()`, `setSteamAvailable()`, `grantCard()`, `mockSteamGrant()`, `inspect()`. Opções: `vip`, `xp`, `starter`, `timezone`, `steamAvailable`.

## 10. Catálogo (`packages/shared/src/catalog/*.json`)

- `items.json`: `basePrice` (loja **vende** se `shopBuyable`), `sellPrice` (loja **paga**, ou `null`), `steamExtractable`, `spriteKey`. Os campos do mercado interno (`tradable`, `minPrice`, `maxPrice`) foram removidos.
- `crops.json` (BALANCEAMENTO): cenoura 2 min 4→6, batata 10 min 10→18, morango 1 h 40→82, abóbora 4 h 140→280, melancia 8 h 240→480; rendimento 1; XP = lucro/2 (1, 4, 21, 70, 120). Nível: abóbora 3, melancia 5.
- `animals.json`: galinha, pato, vaca, ovelha (lã). **Não balanceados.**
- `cards.json`: buffs, 40 cartas, `dropChancePerPlotHour`, `rarityWeights`, `durationSeconds`, `album`, `provisionalArtMapping: true`.
- Kit inicial: 100 moedas + 5 `seed_carrot`. Nível (fazenda e conta): `xpForLevel(L) = 25 × (L−1) × L`.
- `validateCatalog()` roda nos testes.
- Sprites que ainda faltam no atlas: `icon/seed_pumpkin`, `icon/seed_watermelon` (use um substituto se `has(frame)` for falso).

## 11. Eventos do cliente (`events.ts`)

`farm:snapshot`, `plot:updated`, `animal:updated`, `inventory:changed`, `wallet:changed` (com `bonusCoins`), `xp:changed` (`leveledUp`, `accountLeveledUp`), `cards:changed` (`changed`, `dropped`), `buffs:changed`, `time:tick`, `time:phase`, `weather:changed`, `event:night-start`, `event:night-end`, `ui:open-panel` (`inventory|shop|cards|album|extraction|social|settings|offline-report`), `ui:toast`, `api:error`, `extraction:changed`, `notify:received`, `visit:presence`, `debug:toggle-layout`. Removidos: `market:listing-changed`, `notify:sold`.

## 12. Realtime (`realtime.ts`)

- `user:{uid}` — `notifications` (`extraction_granted`, `extraction_failed`, `steam_returned`, `visit_like`, `visit_help`, `system`)
- `farm:{farmId}` — presença de visitantes
- O canal `market` foi removido.

## 13. Assets: `apps/game/public/assets/manifest.json` (escrito pelo A1)

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

- Caminhos relativos à pasta do manifest. Atlas em **JSON Hash** do Phaser. Chaves `atlas_<categoria>` (icons, cards, animals, characters, pets, vehicles, buildings, crops, tiles, ui).
- Quadros: `"<entidade>/<pose>_<n>"` (ex.: `cow/pose_0`, `icon/carrot`, `card/art_1`, `buff/icon_1`, `farmer_m/idle_down_0`).
- Tudo é opcional: o jogo abre sem manifest, sem mapa ou sem algum atlas (só avisa no console).
- Chaves de textura fixas: `map_ground` e `map_overhead` (`TEXTURE_KEYS`, iguais a `MAP_KEYS` do A1).

## 14. Layout do Tiled (`layout.ts`)

Mapa ortogonal, tile 32×32, 81×45 células. Camadas de objetos (nomes exatos; podem estar dentro de grupos):

| Camada                | Objetos                 | Propriedades                                                                                            |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `collision`           | retângulos ou polígonos | —                                                                                                       |
| `plots`               | retângulos              | `slotId: string` (único), `unlockCost: int` (0), `unlockLevel: int` (1), `startsUnlocked: bool` (false) |
| `pens`                | retângulos              | `habitat: coop\|barn\|pond`; o `name` vira o id                                                         |
| `spawn`               | ponto com name `player` | —                                                                                                       |
| `locked_lots`         | retângulos              | `lotId: string` (único), `cost: int`                                                                    |
| `npc_points`          | pontos                  | `npc: string`                                                                                           |
| `overhead` (opcional) | retângulos ou polígonos | áreas de telhado/copa                                                                                   |

`parseLayout(tmj)` devolve `{ layout, warnings }` com coordenadas absolutas. Só lança `LayoutError` se o mapa for inutilizável. `layoutPlotSlots(layout)` dá as `PlotSlotDef`.

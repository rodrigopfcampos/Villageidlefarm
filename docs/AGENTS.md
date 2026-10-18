# Agentes: quem é dono de quê

Regra geral: **cada agente só altera os arquivos de que é dono.** Precisa mudar um contrato em `packages/shared`? Abra um pedido para a Fundação (A0) — depois da Fase 1, para o Revisor (A8). O integrador faz os commits/merges.

| Agente           | Dono de                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A0 Fundação**  | arquivos da raiz (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `netlify.toml`, `vercel.json`), `.github/**`, `docs/**`, `packages/shared/**` (exceto `src/generated/`), `tools/seed/**`, `apps/game/{index.html,vite.config.ts,package.json,tsconfig.json}`, `apps/game/src/{main.ts,config.ts}`, `apps/game/src/core/**`, `apps/game/src/net/mockApi.ts`, `apps/game/src/scenes/Boot.ts`, `apps/game/test/{mockApi,store,assets}.test.ts` |
| **A1 Assets**    | `tools/assets/**`, `assets-src/**`, `apps/game/public/assets/**`, `packages/shared/src/generated/**`                                                                                                                                                                                                                                                                                                                                                                                          |
| **A2 Servidor**  | `supabase/migrations/20260101000xxx_*`, `supabase/tests/base_*`, `apps/game/src/net/**` (exceto `mockApi.ts`, `market.ts`, `visits.ts`)                                                                                                                                                                                                                                                                                                                                                       |
| **A3 Fazenda**   | `apps/game/src/farm/**`, `apps/game/src/scenes/FarmScene.ts`, `apps/game/src/scenes/Preload.ts`                                                                                                                                                                                                                                                                                                                                                                                               |
| **A4 Tempo**     | `supabase/migrations/...001xxx_*`, `supabase/tests/time_*`, `apps/game/src/time/**`, `apps/game/src/fx/**`                                                                                                                                                                                                                                                                                                                                                                                    |
| **A5 Interface** | `apps/game/src/ui/**` (exceto `ui/market/` e `ui/social/`)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **A6 Mercado**   | `supabase/migrations/...002xxx_*`, `supabase/tests/market_*`, `apps/game/src/ui/market/**`, `apps/game/src/net/market.ts`                                                                                                                                                                                                                                                                                                                                                                     |
| **A7 Visitas**   | `supabase/migrations/...003xxx_*`, `supabase/tests/visit_*`, `apps/game/src/scenes/VisitScene.ts`, `apps/game/src/ui/social/**`, `apps/game/src/net/visits.ts`                                                                                                                                                                                                                                                                                                                                |
| **A8 Revisor**   | `tests/e2e/**`; correções em outras pastas só por PR revisada                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Testes novos de cada agente ficam em `apps/game/test/<area>/` ou junto do código da sua pasta (`*.test.ts`).

## Regras

1. **Contratos primeiro.** Tipos, erros, eventos e RPCs vêm de `@vif/shared`. Não declare cópias locais.
2. **Valor só no servidor.** Nada de calcular moedas, prontidão ou estoque no cliente para decidir; só para prever/desenhar. Nada de `Date.now()` para decidir (o lint avisa).
3. **Toda mutação leva `requestId`** (`newRequestId()` de `core/ids.ts`).
4. **Moeda inteira.** Nunca `0.5` moeda.
5. **Use a mock para desenvolver.** `new MockApi({ clock: new FakeClock() })` nos testes; a mesma suíte de contrato deve passar contra a API real (A2).
6. **Arte gerada não se edita à mão** (`public/assets`, `shared/src/generated`). Troque a arte de origem e rode o pipeline.
7. **Antes de entregar:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
8. **Branches:** `agent/<nome>`, merge por PR. Migrations com a faixa numerada do seu dono.
9. **Eventos novos** no bus: peça ao A0 para incluir em `ClientEvents`.

## Pontos de extensão deixados pela Fundação

- `FarmScene` (A3): já tem mapa, overhead, `cameraController` (com `isDragging`) e `layoutDebug`. Recebe `{ loaded, layout }` do Boot. Use `getServices()` para `store`, `api`, `bus`, `layout`.
- `DEPTH` e `TEXTURE_KEYS` em `core/constants.ts` / `core/assets.ts`.
- `store.optimisticPlot()` / `store.optimisticItems()` devolvem a função que desfaz.
- `services.run(op, call)` publica `api:error` automaticamente.
- Prévia sem pipeline: `pnpm dev` e abra `http://localhost:5173/?dev-assets` (JPG original + layout de exemplo dos testes).

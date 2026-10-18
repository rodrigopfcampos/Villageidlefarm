# Village Idle Farm — guia para novas sessões

O dono não programa. Ele decide o design, gera as artes com IA e testa. Responda em português do Brasil, curto e direto, e pergunte em vez de adivinhar.

## Estado (2026-10-18)
- Monorepo pnpm:
  - `packages/shared`: contratos, catálogo, erros;
  - `apps/game`: Phaser 3 + Preact, API falsa em `net/mockApi.ts`;
  - `supabase/`: servidor com RLS, RPCs e testes;
  - `tools/assets`: pipeline de arte em Python;
  - `tools/balance`: simuladores.
- `main` compila e passa nos testes (commit 8ce1cdd mais as docs).
- A branch `wip/interrompido` tem trabalho incompleto (contratos v3, grade de pixel, controle só pelo mouse). Use como referência e não faça merge direto.
- **PAUSADO:** nenhum agente roda até a bíblia de arte e a fatia vertical estarem aprovadas.

## Leia antes de qualquer coisa
1. `docs/DECISOES.md`: plataforma Steam PC, US$ 1,99, 18+, mercado da Steam, regras.
2. `docs/ECONOMIA.md` e `docs/BALANCEAMENTO.md`: números aprovados.
3. `docs/ARTE-ESPECIFICACAO.md`: **regras obrigatórias de arte (16×16, PNG, paleta, tiles)**.
4. `docs/CONTRACTS.md` e `docs/ARCHITECTURE.md`.

## Próximo passo combinado
1. Fechar a bíblia de arte com o dono (paleta, estilo, ou um pacote comprado).
2. Gerar a **fatia vertical** (cena de 20×12 tiles) dentro da especificação.
3. Migrar o mapa de "pintura única" para **tilemap no Tiled** e os canteiros para **1 planta por tile**.
4. Só depois: contratos v3 (39 culturas, XP único, exploração), servidor da exploração, telas.

## Regras de trabalho
- Trabalhe direto na sessão. Use subagentes só quando o dono pedir: cada um custa ~350–500 mil tokens.
- Nada é "pronto" sem uma screenshot do jogo rodando, conferida.
- Commits pequenos em `main` só quando compila e passa nos testes.

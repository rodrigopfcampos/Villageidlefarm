# Pipeline de artes (tools/assets)

Transforma as imagens de `assets-src/raw/` nos arquivos que o jogo usa, em `apps/game/public/assets/`.
Você **nunca** edita `apps/game/public/assets/` à mão: ele é gerado.

## Rodar

```
pip install -r tools/assets/requirements.txt     # só na primeira vez
python tools/assets/build.py --all
```

Termina com `Pronto.` quando tudo deu certo. Rodar de novo gera exatamente os mesmos arquivos.
Outras opções: `--sheet animals` (só uma folha), `--map` (só mapa e layout), `--keep-going` (não para na primeira folha com erro).

## O que sai

| Arquivo | O que é |
|---|---|
| `atlas/atlas_<categoria>.png` + `.json` | Sprites de icons, cards, animals, characters, pets, vehicles (JSON Hash do Phaser) |
| `map/farm.webp` | O mapa |
| `map/overhead.png` | Só telhados e copas, desenhado por cima do jogador |
| `map/farm_layout.tmj` | Colisão, canteiros, cercados, lotes, spawn, NPCs (cópia do arquivo do Tiled) |
| `manifest.json` | Lista de tudo acima (o jogo lê este arquivo) |
| `packages/shared/src/generated/assetKeys.ts` | Nomes de atlas e quadros para o código |
| `tools/assets/debug/` | Prévias para você conferir (não vão para o git) |

## Trocar uma arte (ex.: folha de animais nova)

1. Gere a imagem nova **na mesma organização** (mesmas linhas, mesma ordem). Ideal: PNG com fundo transparente ou fundo de uma cor só.
2. Salve em `assets-src/clean/` **com o mesmo nome** do original (ex.: `assets-src/clean/Foto_dos_animais.jpg`
   ou `.png`, contanto que o nome em `source:` do manifesto bata). O que está em `clean/` tem prioridade sobre `raw/`.
   Não apague nem altere nada em `raw/`.
3. Rode `python tools/assets/build.py --all`.
4. Abra `tools/assets/debug/<folha>_boxes.png` (caixas numeradas em cima da folha) e `debug/contact_<categoria>.png` (sprites prontos sobre xadrez).

Se aparecer **"contagem não bate"**: o script encontrou mais ou menos sprites do que o manifesto espera.
Abra `debug/<folha>_boxes.png`, veja onde está a diferença e ajuste em `manifests/<folha>.yaml`:
- sprite partido em dois → aumente `merge_distance`;
- dois sprites viraram um → diminua `merge_distance` ou use `accept_pieces: false` em `overrides`;
- partes escuras sumindo (ex.: penas pretas) → diminua `bg_tolerance`;
- sobrou borda/fundo em volta → aumente `bg_tolerance` ou `halo_tolerance`.

## Adicionar uma arte nova (ex.: sementes)

1. Coloque a folha em `assets-src/raw/` (ou `clean/`).
2. Copie um manifesto parecido (ícones → `icons.yaml`; bichos → `pets.yaml`) para `manifests/<nome>.yaml`.
3. Ajuste: `sheet`, `source`, `category` (uma das 6 existentes, ou uma nova), `rows` (quantos sprites por linha),
   `names` (um nome por sprite, na ordem de leitura: linha por linha, da esquerda para a direita) e `frame.size`.
4. Rode o build. Se criar uma categoria nova, avise quem cuida do código (ela entra no `manifest.json` só se for
   adicionada à lista `CATEGORIES` no `build.py`).

Nomes de quadro: `<entidade>/<pose>_<n>` (ex.: `cow/idle_0`) ou `<entidade>/<ação>_<direção>_<n>` (ex.: `farmer_m/idle_down_0`).
Direções: `down` (de frente), `up` (de costas), `side` (perfil olhando para a **direita**; para a esquerda o jogo espelha).
Os manifestos explicam, em comentários, o que é cada pose.

## Mexer no layout (canteiros, colisão, cercados)

1. Instale o [Tiled](https://www.mapeditor.org/) (gratuito).
2. Abra `assets-src/tiled/farm_layout.tmj`. O mapa aparece como fundo.
3. Arraste/redimensione os retângulos. Para mudar preço de canteiro, clique nele e edite `unlockCost`, `unlockLevel`,
   `startsUnlocked` no painel de propriedades. **Não mude os nomes das camadas** e não repita `slotId`.
4. Salve (Ctrl+S) e rode `python tools/assets/build.py --all`. O build confere o layout e copia para o jogo.
5. Confira `tools/assets/debug/layout_overlay.png` (vermelho = colisão, verde = canteiros, azul = cercados,
   amarelo = lotes à venda, rosa = telhados/copas, bolinhas = spawn e NPCs).

Camadas: `collision`, `plots` (slotId, unlockCost, unlockLevel, startsUnlocked), `pens` (habitat: coop/barn/pond),
`spawn` (ponto `player`), `locked_lots` (lotId, cost), `npc_points` (npc: shopkeeper/blacksmith/scientist) e
`overhead` (formas de telhado/copa; a propriedade `drop` diz que cor de chão tirar do recorte: `path` ou `path_grass`).

`tools/assets/seed_layout.py` só cria a primeira versão do layout. Ele **não** sobrescreve o arquivo do Tiled
(a menos que se use `--force`, que apaga seus ajustes).

## Trocar o mapa

Coloque o mapa novo em `assets-src/clean/mapa_do_jogo.png` com **2576×1438 px**. Se os prédios mudarem de lugar,
ajuste as formas da camada `overhead` e a colisão no Tiled.

## Prévias para aprovar

- `debug/preview_on_map.png` e `debug/preview_on_map_animals.png`: sprites colados no mapa na escala final.
- `debug/layout_overlay.png`: objetos do layout por cima do mapa.
- `debug/contact_<categoria>.png`: todos os quadros de cada atlas.
- `debug/<folha>_boxes.png`: como cada folha foi recortada.

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
| `atlas/atlas_<categoria>.png` + `.json` | Sprites de icons, cards, animals, characters, pets, vehicles, buildings, crops, tiles, ui (JSON Hash do Phaser) |
| `map/farm.webp` | O mapa base (hoje: `raw/v2/mapa_limpo.jpg`, só terreno) |
| `map/overhead.png` | Telhados e copas dos prédios/árvores da camada `buildings`, desenhado por cima do jogador |
| `map/farm_layout.tmj` | Colisão, canteiros, cercados, lotes, spawn, NPCs e prédios (cópia do arquivo do Tiled) |
| `manifest.json` | Lista de tudo acima (o jogo lê este arquivo) |
| `packages/shared/src/generated/assetKeys.ts` | Nomes de atlas e quadros para o código |
| `tools/assets/debug/` | Prévias para você conferir (não vão para o git) |

## Folhas e manifestos

| Manifesto | Folha | Vai para |
|---|---|---|
| `icons.yaml` | Frutas/legumes (40) | atlas_icons |
| `products.yaml` | `v2/produtos_sementes.jpg` (ovo, ovo de pato, leite, lã, 3 sacos de semente) | atlas_icons |
| `buffs.yaml` | `v2/buffs_cartas.jpg`: `card/art_1..8` (132x192, miolo da carta) e `buff/icon_1..8` (24x24) | atlas_cards / atlas_icons |
| `cards.yaml` | Molduras de carta | atlas_cards |
| `animals_v3.yaml` | `v2/fazendeiro_animais_v3.jpg` (animais; PRIORIDADE: são os pose_0.. de cada raça) | atlas_animals |
| `farmer_v3.yaml` | `v2/fazendeiro_animais_v3.jpg` (farmer_m: idle, walk, pickaxe, hoe, water) | atlas_characters |
| `animals_v2.yaml` | `v2/animais_v2.jpg` (mesmas raças; numeração continua depois da v3) | atlas_animals |
| `animals.yaml` | folha antiga de animais — **desativada** (`enabled: false`) | — |
| `characters_v2.yaml` | `v2/personagens_v2.jpg` (farmer_f inteira; do farmer_m só os perfis) | atlas_characters |
| `characters.yaml` | folha antiga: só os NPCs (elder, blacksmith, shopkeeper, scientist) | atlas_characters |
| `pets.yaml`, `vehicles.yaml` | folhas antigas | atlas_pets / atlas_vehicles |
| `buildings.yaml` | `v2/predios_arvores.jpg` (building/*, tree/*, decor/crop_rows_*) | atlas_buildings |
| `crops.yaml` | `v2/estagios_plantas.jpg` (crop/carrot_0..3, potato, strawberry) | atlas_crops |
| `tiles.yaml` | `v2/canteiro_terra.jpg` (tile/soil_raw, soil_tilled, soil_wet; 112x112) | atlas_tiles |
| `ui.yaml` | `v2/interface.jpg` (moeda, coroa, estrela, evento, botões, painel, barras) | atlas_ui |

Cada manifesto explica nos comentários o que é cada quadro (direção, pose, raça) e o que está faltando.

Escalas: ícones 32x32; animais 80x64 / 48x48 / 32x32; personagens com corpo de ~64 px; prédios e árvores
ampliados 2x com vizinho mais próximo (casa 400x386); plantas 3x (cabem num canteiro); interface 2x.

Informações extras para o código (em `assetKeys.ts`):
- `NINE_SLICE`: margens [esq, dir, cima, baixo] de painel, botões, barras e tiles de terra
  (o painel também sai cortado em `ui/panel_corner_tl` ... `ui/panel_center`).
- `CARD_ART_SLOT`: onde fica o miolo de cada moldura. Desenhe `card/art_N` ATRÁS da moldura, centrado em (cx, cy).
  Prévia: `debug/cards_art_in_frames.png`.
- `BUILDING_FOOTPRINTS`: base com colisão e `overheadSplitY` de cada prédio/árvore.

Opções de manifesto para folhas difíceis (todas comentadas nos manifestos que usam):
- `regions`: folha com blocos diferentes; cada caixa tem as próprias linhas, o resto é ignorado.
- `exclude`: caixas que viram fundo (textos, bichos de outro manifesto).
- `split_erode` / `split_cuts`: separar sprites que encostam um no outro.
- `group_boxes`: juntar pedaços num sprite só. `overrides.<quadro>`: `clip_box`, `add_box`, `fill_box`,
  `accept_pieces`, `restore_enclosed`, `strip_bg_dE`, `glow`, `interior`.
- `segment`: separar com uma tolerância e recortar os pixels com outra (fundo quase da cor do sprite).
- `scale.factors`: escala fixa, igual entre folhas (animals_v2 e animals_v3 usam a mesma).

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
`spawn` (ponto `player`), `locked_lots` (lotId, cost), `npc_points` (npc: shopkeeper/blacksmith/scientist),
`buildings` e `overhead` (opcional: formas extras de telhado; `drop` = `path` ou `path_grass`).

**Camada `buildings`** (prédios e árvores): cada objeto é um retângulo do tamanho do sprite, com as propriedades
`sprite` (ex.: `building/house`, `tree/oak`) e `overheadSplitY` (int). O sprite é desenhado com a base central
no meio da borda de baixo do retângulo (pivot 0.5, 1). `overheadSplitY` é a linha do sprite, contada a partir
do TOPO, acima da qual o sprite fica por cima do jogador (telhado/copa); 0 = nunca cobre (píer, plantinhas).
O build já recorta essa parte de cima e coloca em `map/overhead.png`, então o jogo pode simplesmente desenhar:
mapa → prédios (inteiros) → jogador → overhead.png. A base de cada prédio/árvore tem um retângulo
`<nome>_base` na camada `collision`. Para mover um prédio no Tiled, arraste o retângulo **e** a base dele.

`tools/assets/seed_layout.py` só cria a primeira versão do layout. Ele **não** sobrescreve o arquivo do Tiled
(a menos que se use `--force`, que apaga seus ajustes).

## Trocar o mapa

O mapa base é `assets-src/raw/v2/mapa_limpo.jpg` (constante `MAP_NAME` em `mapbuild.py`). Para trocar, coloque o
novo em `assets-src/clean/v2/mapa_limpo.png` com **2576×1438 px** e rode o build. Se o terreno mudar (rio,
canteiros), recrie o layout: `python tools/assets/seed_layout.py --force` (apaga ajustes manuais!) ou ajuste no Tiled.

## Prévias para aprovar

- `debug/preview_composto.png`: mapa + prédios + árvores + plantas nos canteiros + fazendeiros + animais (escala final).
- `debug/preview_on_map.png` (zoom 2x na casa/campo) e `debug/preview_on_map_animals.png` (celeiro/galinheiro/lago).
- `debug/cards_art_in_frames.png`: cada arte de carta dentro de cada moldura.
- `debug/layout_overlay.png`: objetos do layout por cima do mapa.
- `debug/contact_<categoria>.png`: todos os quadros de cada atlas.
- `debug/<folha>_boxes.png`: como cada folha foi recortada.

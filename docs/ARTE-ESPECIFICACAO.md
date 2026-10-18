# Especificação de arte (bíblia de arte)

Todo asset novo segue este documento. Nada é gerado ou aceito fora dele.

## Por que as artes anteriores não funcionaram
- **Tamanhos e grade:** cada folha veio numa escala, sem grade de pixel e em JPG com fundo, e o pipeline teve de adivinhar o tamanho do "pixel" de cada uma.
- **Mapa:** era uma pintura única. Jogos como Stardew Valley montam o mapa com **tiles** (peças de 16×16) num editor (Tiled), e todos os objetos usam a mesma grade.
- **Canteiros:** havia uma imagem grande por canteiro. No padrão Stardew, cada **tile de terra arada recebe 1 planta**, e um canteiro é um conjunto de tiles.

## Regras globais
| Item | Regra |
|---|---|
| Grade base | **1 tile = 16×16 px de arte** |
| Escala na tela | ×4 (1 px de arte = 4 px na tela); zoom sempre em inteiros (×3, ×4, ×5) |
| Formato | **PNG com fundo transparente** (alfa 0 ou 255, sem semitransparência, exceto sombras) |
| Anti-aliasing | **Nenhum.** Sem borrado, sem gradiente suave nas bordas |
| Paleta | Única para o jogo inteiro: 48 cores, definida em `assets-src/palette.png` |
| Contorno | 1 px, cor escura da própria paleta (não preto puro) |
| Luz | Vem de cima à esquerda, igual em tudo |
| Sombras | **Não** desenhar sombra no chão: o jogo desenha a sombra |
| Folhas | Grade fixa de células de tamanho exato, sem texto, sem números, sem moldura, sem espaço irregular |
| Perspectiva | Vista de cima, 3/4 (como Stardew). Nada isométrico |

## Tamanhos por tipo (px de arte; na tela ×4)
| Asset | Célula | Quadros |
|---|---|---|
| Tile de terreno (grama, terra, caminho, água, penhasco, cerca) | 16×16 | autotile de 16 ou 47 peças por terreno |
| Terra arada (seca e molhada) | 16×16 | autotile de 16 peças por estado |
| Planta (por estágio) | 16×32 (base no tile, folhas podem subir) | 5 estágios: semente, broto, jovem, madura, pronta |
| Ícone de item (colheita, semente, produto) | 16×16 | 1 |
| Personagem (fazendeiro/fazendeira) | 16×32 | 4 direções × 4 de caminhada, 2 de parado, 4 de enxada, 4 de regar, 3 de colher |
| Animal pequeno (galinha, pato, coelho, ganso, peru) | 16×16 | 4 direções (ou 2 + espelho) × 4 de andar, 2 de comer, 2 de dormir |
| Animal grande (vaca, porco, ovelha, cabra, alpaca) | 32×32 | idem |
| Pet | 16×16 ou 32×32 | idem |
| Árvore | 48×80 | 1 + 2 de balanço opcionais |
| Casa | 80×96 (5×6 tiles) | 1 (+ telhado separado na linha da porta) |
| Celeiro | 112×96 | 1 |
| Galinheiro | 64×64 | 1 |
| Estufa | 96×80 | 1 |
| Garagem | 96×64 | 1 |
| Veículos (vista de cima 3/4) | carroça 48×32, carro 48×32, caminhonete 48×32, caminhão 64×32 | 4 direções |
| Carta (arte interna) | 44×64 | 1 |
| Ícone de buff | 16×16 | 1 |
| Interface | múltiplos de 16 | nine-slice com bordas de 8 px |

## Formato de entrega de cada folha
- Uma folha por assunto, por exemplo `cenoura_estagios.png`: 5 células de 16×32 lado a lado = 80×32 px.
- Personagem: as linhas são as direções (baixo, esquerda, direita, cima) e as colunas são os quadros.
- Envie no **tamanho real** (ex.: 80×32). Se a ferramenta de IA só gerar grande, gere exatamente ×8 (ex.: 640×256), com fundo **magenta puro #FF00FF**. O pipeline reduz exatamente ÷8 e confere a grade.

## Modelo de pedido para a IA de imagem
> Pixel art sprite sheet, top-down 3/4 view like Stardew Valley, **exact 16×16 pixel grid**, [ASSUNTO], [N] frames in a single row, each cell [L]×[A] pixels, no anti-aliasing, hard pixel edges, 1-pixel dark colored outline, light from top-left, limited palette (use attached palette), **solid #FF00FF background**, no shadows on the ground, no text, no labels, no borders, evenly spaced cells, output at 8× scale ([L×N×8]×[A×8] px).

Sempre anexe a paleta e 1 sprite já aprovado como referência de estilo.

## Processo de aprovação (antes de gerar em massa)
1. **Fatia vertical:** uma cena de 20×12 tiles com casa, 6 tiles de canteiro com plantas em estágios diferentes, fazendeiro andando, 1 galinha, 1 vaca e 1 árvore, tudo na especificação.
2. O dono aprova a fatia no jogo rodando (não em prévia).
3. Só depois disso o resto é gerado, em lotes, usando a fatia como referência.
4. Todo asset passa pelo validador: grade, paleta, alfa, tamanho de célula e sem texto. Reprovado = refazer.

## Alternativa mais rápida e mais garantida
Comprar um **pacote de assets profissional** em 16×16 com licença comercial (por exemplo, pacotes de fazenda conhecidos no itch.io, como "Mana Seed" e "Sprout Lands"; confira a licença antes) e usar IA só para o que faltar, imitando o pacote. É o caminho mais curto para a qualidade de Stardew.

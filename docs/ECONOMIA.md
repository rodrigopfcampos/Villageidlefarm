# Economia: progressão por nível e exploração

O simulador está em `tools/balance/economia.py` (rodar com `python3 tools/balance/economia.py`). Este documento complementa o BALANCEAMENTO.md e o DECISOES.md.

## XP e níveis
- Existe **um único XP**, o da fazenda. A antiga "XP de conta" é a mesma coisa.
- **Lançamento:** nível máximo 40, a cerca de 118 dias para um jogador regular. Os níveis de 41 a 50 ficam reservados para conteúdo futuro.
- **Curva:** `xp_next(L) = 100 × 1,06^L × L^1,6`.
- Ritmo de um jogador regular:

| Nível | Dia | Desbloqueia |
|---|---|---|
| 1 | 0 | cenoura, morango (2 culturas iniciais), 4 canteiros |
| 3 | 0,4 | **exploração**: carroça + destino Vila; galinha |
| 5 | 1,5 | pato |
| 10 | 7 | destino Cidade |
| 12 | 10 | carro |
| 20 | 29 | caminhonete; vaca; 3ª viagem diária |
| 22 | 35 | destino Porto |
| 32 | 75 | caminhão; peru |
| 35 | 90 | 4ª viagem diária |
| 40 | 118 | última cultura e último canteiro do lançamento |

- **Culturas:** 1 nova por nível, até usar os 39 ícones (lista em `economia.py`).
- **Lucro por hora:** cresce 6% por nível de desbloqueio. Culturas curtas rendem até ~2× mais por hora que as de 8 h.
- **Margens:** a semente custa metade do preço de venda. O XP é igual a lucro/2.
- **Canteiros:** 20 no total, liberados por nível (1,1,1,1,2,3,5,7,9,11,13,15,18,21,24,27,30,34,38,42). Cada um também custa ouro: `150 × 1,32^(n−4)`.
- **Animais:** galinha 3, pato 5, coelho 8, porco 11, ovelha 14, cabra 17, vaca 20, ganso 24, alpaca 28, peru 32.

## Exploração (viagens de venda)
- **Como funciona:** o jogador carrega um veículo com colheitas e produtos e manda vender num destino.
  - A viagem leva um tempo e não pode ser cancelada.
  - O resultado é sorteado **no servidor** na hora em que o veículo sai, e só é revelado quando ele volta.
- **Viagens por dia:** 2 no início, 3 no nível 20 e 4 no nível 35. As vagas voltam à meia-noite local.
- **Custos por viagem:** ração do cavalo ou gasolina, em ouro.
- **Desgaste:** cada viagem gasta a **condição** do veículo.
  - Abaixo de 50%, as chances de resultado ruim ficam ×1,5.
  - Com 0%, o veículo não sai.
  - O conserto custa ouro.
- **Capacidade:** é medida em valor de carga e cresce com **melhorias** compradas com ouro (+25% cada, até 3 por veículo).

| Veículo | Nível | Capacidade base* | Custo/viagem | Desgaste | Velocidade | Risco | Preço |
|---|---|---|---|---|---|---|---|
| Carroça (cavalo) | 3 | ~780 | ~4% da carga (ração) | 6% | 1× | 1,0 | grátis |
| Carro | 12 | ~2 700 | ~5% (gasolina) | 5% | 2× | 0,8 | 4 000 |
| Caminhonete | 20 | ~6 200 | ~5% | 7% | 1,5× | 0,9 | 15 000 |
| Caminhão | 32 | ~16 900 | ~6% | 9% | 1× | 1,1 | 60 000 |

\*Em moedas de preço de loja. São fixas por veículo e equivalem a ~12% da produção diária no nível de desbloqueio.

| Destino | Nível | Duração (carroça) | Resultados (chance → multiplicador sobre o preço da loja) |
|---|---|---|---|
| Vila | 3 | 2 h | perda total 3% → 0; roubo parcial 10% → 0,5; venda normal 62% → 1,12; boa feira 20% → 1,4; ótima 5% → 2,2 |
| Cidade | 10 | 4 h | perda total 5%; roubo parcial 12%; normal 50% → 1,15; boa 25% → 1,6; ótima 7% → 2,5; **jackpot 1% → 5×** |
| Porto | 22 | 8 h | perda total 10%; roubo parcial 15%; normal 40% → 1,1; boa 24% → 1,6; ótima 8% → 2,8; **jackpot 3% → 6×** |

- **Resultados ótima e jackpot:** também têm chance de trazer uma carta.

### Resultado do balanceamento
- **Ganho esperado por viagem, já descontados custos e desgaste:**
  - Vila: +3% a +9%, com prejuízo em 10–14% das viagens.
  - Cidade: +14% a +22%, com prejuízo em 14–19%.
  - Porto: +17% a +30%, com prejuízo em 20–28%.
- **Peso na renda diária**, usando todas as viagens:
  - níveis 3–10: +2% a +6%;
  - níveis 12–30: +9% a +15%;
  - níveis 35–40: +16% a +19%.
- A exploração nunca move mais de ~55% da produção, porque a loja continua sendo necessária.

## Cartas (revisado)
| Arte | Buff | Efeito |
|---|---|---|
| Sol | Ouro | +50% na venda da produção feita durante a janela |
| Cesta | Colheita farta | +1 unidade por colheita |
| Ovelha | Animais | +50% na produção animal |
| Coruja | XP | +50% de XP |
| Ampulheta | Adubo | avança na hora todos os canteiros em 30/45/60/75/90 min |
| Chuva | **Céu limpo** (proposta) | corta pela metade a chance de resultado ruim nas viagens que saírem durante a janela (vila 13%→6%, porto 25%→12%) |
| Ferradura | Sorte | +100% de chance de carta |
| Engrenagem | **Exploração** | +50% no lucro extra (a parte acima do preço da loja) das viagens que saírem durante a janela; sem desgaste nessas viagens |

- **O antigo "Mercador" foi removido.** A carta de XP de conta virou parte da XP única.

## Álbum
- Uma carta usada entra no álbum **para sempre**. Retirar a carta para a Steam não remove o card da coleção nem o bônus.
- A cópia retirada é uma cópia extra, um item à parte.

## Pendências
- Confirmar a carta Chuva como **Céu limpo**.
- Confirmar se o VIP ganha +1 viagem por dia.
- Recalibrar quando houver dados reais de jogadores.

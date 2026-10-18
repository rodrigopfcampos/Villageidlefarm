# Balanceamento: cartas de buff e evento noturno

O simulador está em `tools/balance/sim.py` (rodar com `python3 tools/balance/sim.py`). Ele simula 28 dias, minuto a minuto, de uma fazenda com 8 canteiros. Testa três perfis de jogador:

| Perfil | Comportamento |
|---|---|
| casual | entra 3 vezes por dia, 10 minutos de cada vez |
| regular | entra 4 vezes por dia e vai ao evento em 60% dos dias |
| hardcore | fica cerca de 7h30 por dia com o jogo aberto |

## Conclusão principal

Num jogo idle, **a colheita só acontece quando o jogador está logado**. Por isso, buffs de *velocidade* rendem pouco: a planta fica pronta mais cedo, mas ninguém está lá para colher e replantar. Os buffs que funcionam são os que aumentam o *valor* do que é produzido.

## Culturas (ajuste necessário)

No catálogo atual, a cenoura rende ~375/h por canteiro e o morango ~75/h. Quem fica jogando ativamente ganha 5× mais, e qualquer buff de ouro fica desproporcional, porque a margem é pequena. A tabela usada no teste tem margem de 50% e um lucro por hora que cai com a duração da cultura (quem joga ativo ganha ~2× mais, não 5×):

| Cultura | Tempo | Semente | Venda | Lucro/h por canteiro |
|---|---|---|---|---|
| cenoura | 2 min | 4 | 6 | 60 |
| batata | 10 min | 10 | 18 | 48 |
| morango | 1 h | 40 | 82 | 42 |
| abóbora | 4 h | 140 | 280 | 35 |
| melancia | 8 h | 240 | 480 | 30 |

## Evento noturno (19h–21h, horário real, precisa estar logado)

| Configuração | casual | regular | hardcore |
|---|---|---|---|
| ×1.2 (30 → 25 min) | 0% | ~0–1% | +3,8% |
| ×1.5 (30 → 20 min) | 0% | ~+1% | +6,3% |

Com ×1.2, o ganho quase não se nota. **Recomendação:**
- **Velocidade ×1.5**, com 30 min virando 20 min.
- **1 carta garantida** por dia para quem ficar pelo menos 30 min logado dentro do evento. A carta é o que realmente motiva a aparecer.
- **"Logado" precisa de interação:** um sinal de vida mais uma ação a cada alguns minutos, para impedir bots.

## Cartas

Regras usadas no teste:
- Só 1 carta ativa por vez.
- O efeito vale só para o que é **produzido durante a janela** da carta.
- A carta de ouro, por exemplo, não pode ser ativada um segundo antes de colher 8 h de melancia. Isso seria uma brecha que deixa a raridade sem importância.

| Opção | casual | regular | hardcore |
|---|---|---|---|
| A: original, +30% ouro, 30–90 min | +3,6% | +8,0% | +6,6% |
| A: velocidade ×1.25, 30–90 min | ~0% | ~0% | +4,1% |
| **C: +50% ouro, 1h–3h (recomendado)** | **+8,9%** | **+13,5%** | **+19,2%** |
| B: +50% ouro, 2h–6h | +15,2% | +29,5% | +28,0% |

### Recomendação
- **Duração:** começa em 1h e sobe 30 min por raridade (comum 1h, incomum 1h30, rara 2h, épica 2h30, lendária 3h). É a mesma escada da ideia original, só que com o dobro do tempo.
- **Velocidade vira "Adubo":** em vez de acelerar, a carta **avança na hora** o crescimento de todos os canteiros em 30/45/60/75/90 min, conforme a raridade. Assim o jogador sente o efeito na hora e o valor é previsível.
- **Lista de buffs (8):**

| Buff | Efeito |
|---|---|
| Ouro | +50% na venda |
| XP de fazenda | +50% |
| XP de conta | +50% |
| Adubo | avanço instantâneo do crescimento |
| Colheita farta | +1 unidade por colheita |
| Animais | +50% na produção |
| Sorte | +100% de chance de carta |
| Mercador | −25% no preço das sementes |

- **Drop:** a chance de ganhar carta é **proporcional ao tempo de cultivo**, 1,25% por hora-canteiro. Plantar cenoura sem parar não gera mais cartas, o que dificulta bots.
  - Resultado: 0,75 a 1,6 cartas/dia, mais 1 do evento.
  - Raridades: comum 55%, incomum 27%, rara 12%, épica 5%, lendária 1%.
- **Álbum:** 8 buffs × 5 raridades = 40 espaços. Completar uma linha dá um bônus pequeno e permanente (ex.: +2%).
  - Sozinho, um jogador acha 1 lendária a cada ~80 dias.
  - Completar o álbum depende de trocas, o que alimenta o mercado.
- **Nunca vender cartas aleatórias por dinheiro real.** As cartas vêm só de jogar.

## Pendências
- Recalibrar com os números finais do catálogo.
- Rodar de novo quando houver animais e mais canteiros.

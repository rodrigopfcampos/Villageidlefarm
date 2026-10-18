# Decisões do dono (valem por cima do PLANO-FASE0 quando houver conflito)

Data: 2026-10-18

## Plataforma e negócio
- **Plataforma:** só Steam no PC. O celular fica para o futuro. A tela é em paisagem e a janela pode ser redimensionada.
- **Empacotamento:** Phaser + Electron com Steamworks. O build web serve só para desenvolvimento e testes internos.
- **Preço:** jogo pago, US$ 1,99.
- **Público:** maiores de 18 anos.
- **Login:** pela conta Steam.
  - O cliente pega um ticket de autenticação da Steam (`GetAuthTicketForWebApi`).
  - Uma Edge Function valida o ticket na Steam Web API e entrega a sessão do Supabase.
  - Não existe login por e-mail nem conta de convidado em produção. Em desenvolvimento, usamos o login anônimo ou a API falsa.
- **Compras (VIP etc.):** pelo sistema de microtransações da Steam. Isso fica para a fase de monetização.

## Mercado
- **Não existe mercado entre jogadores dentro do jogo.** A fase do agente A6 (Mercado) foi cancelada.
- O comércio acontece no **mercado da Steam**, pelo Steam Inventory Service.
- **Retirada (jogo → Steam):**
  - Sem VIP: 1 item a cada 7 h. Com VIP: 4 itens a cada 7 h.
  - Só o servidor faz a retirada, com a chave de publisher guardada nos segredos das Edge Functions.
  - A janela de 7 h é deslizante e conferida no servidor.
- **Itens que podem sair:** cartas usadas (do álbum), skins, colheitas e produtos.
- **Volta (Steam → jogo):** o servidor consome o item no inventário Steam e devolve o item ao inventário do jogo.
- **Registro:** toda retirada e toda volta ficam no ledger com `request_id` (idempotente).
- **Pendente:** decidir se 1 retirada é 1 unidade ou uma pilha.

## Cartas (ver BALANCEAMENTO.md)
- **Ativas:** 1 carta por vez, 2 com VIP.
- **Efeito:** vale só para o que é produzido durante a janela da carta.
- **Duração:** começa em 1h e sobe 30 min por raridade (comum 1h, incomum 1h30, rara 2h, épica 2h30, lendária 3h).
- **Os 8 buffs:**

| Buff | Efeito |
|---|---|
| Ouro | +50% |
| XP de fazenda | +50% |
| XP de conta | +50% |
| Adubo | avança na hora todos os canteiros em 30/45/60/75/90 min, conforme a raridade |
| Colheita farta | +1 unidade por colheita |
| Animais | +50% de produção |
| Sorte | +100% de chance de carta |
| Mercador | −25% no preço das sementes |

- **Drop:** a chance é proporcional ao tempo de cultivo, 1,25% por hora-canteiro.
  - Raridades: comum 55%, incomum 27%, rara 12%, épica 5%, lendária 1%.
- **Proibido:** vender cartas aleatórias por dinheiro.
- **Depois de usada:** a carta vira um card colecionável no álbum (8 buffs × 5 raridades = 40 espaços). Completar uma linha dá um bônus pequeno e permanente.
- **Arte:** a ligação entre arte e buff está pendente. A proposta é:

| Arte | Buff |
|---|---|
| 1 sol | Ouro |
| 2 cesta | Colheita farta |
| 3 ovelha | Animais |
| 4 coruja | XP de conta |
| 5 ampulheta | Adubo |
| 6 nuvem/chuva | XP de fazenda |
| 7 ferradura | Sorte |
| 8 engrenagem | Mercador |

## Evento noturno
- **Horário:** 19h às 21h no horário real local do jogador. O fuso só pode ser trocado 1 vez a cada 30 dias.
- **Velocidade:** ×1.5 (30 min viram 20 min) para quem está **logado e ativo**.
  - "Ativo" = sinal de vida e pelo menos 1 interação a cada poucos minutos, para impedir bots.
- **Carta garantida:** 1 carta para quem fica pelo menos 30 min ativo dentro do evento, no máximo 1 por dia.

## Economia de culturas
- A tabela de culturas do BALANCEAMENTO.md substitui o catálogo atual:
  - margem de 50%;
  - o lucro por hora cai conforme a duração da cultura.

## Anti-bot (desde o início)
- O jogo é pago.
- A retirada exige conta Steam dona do jogo e nível mínimo de fazenda (a definir; sugestão: nível 5).
- Os sinais de vida (heartbeats) têm limite de frequência.
- O evento e as cartas exigem interação real.

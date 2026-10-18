"""Simulador de balanceamento: cartas de buff e evento noturno.
Rodar: python3 tools/balance/sim.py
Modelo por minuto, 28 dias, 8 canteiros, jogador replanta ao logar.
"""
import random, statistics as st

DAYS = 28
PLOTS = 8
OFFLINE_CAP = 8 * 60  # minutos

# culturas: (nome, minutos, custo semente, receita media por colheita, xp)
# alvo: lucro/h por canteiro cai com a duracao (premio para quem joga ativo ~2x)
CROPS = [
    ("cenoura", 2, 4, 6, 1),       # lucro 2   -> 60/h por canteiro
    ("batata", 10, 10, 18, 4),     # lucro 8   -> 48/h
    ("morango", 60, 40, 82, 20),   # lucro 42  -> 42/h
    ("abobora", 240, 140, 280, 70),# lucro 140 -> 35/h
    ("melancia", 480, 240, 480, 120), # lucro 240 -> 30/h
]

RARITIES = ["comum", "incomum", "rara", "epica", "lendaria"]
DURATION = {"comum": 30, "incomum": 45, "rara": 60, "epica": 75, "lendaria": 90}

def sessions(profile, day):
    """lista de (inicio_min, fim_min) no dia, horario local."""
    r = random.Random(day * 97 + hash(profile) % 1000)
    j = lambda m: m + r.randint(-20, 20)
    if profile == "casual":
        s = [(j(8*60), 10), (j(13*60), 10), (j(22*60), 10)]
    elif profile == "regular":
        s = [(j(7*60+30), 10), (j(12*60+30), 15), (j(18*60), 15), (j(23*60), 10)]
        if r.random() < 0.6:  # vai ao evento em 60% dos dias
            s.append((19*60 + 5, 60))
    else:  # hardcore: janela aberta muito tempo
        s = [(8*60, 60), (12*60, 60), (18*60, 330)]
    return [(day*1440 + a, day*1440 + a + d) for a, d in s]

def run(profile, cards_on, event_on, ev_mult=1.2, kind="speed", durations=None, event_card=False, card_speed=1.25, card_gold=0.30,
        drop_per_plot_hour=0.0125, weights=(55, 27, 12, 5, 1), speed_cap=1.5, seed=1):
    random.seed(seed)
    online = set()
    for d in range(DAYS):
        for a, b in sessions(profile, d):
            online.update(range(a, b))
    login_starts = sorted({m for m in online if m - 1 not in online})
    plots = [None] * PLOTS  # (crop_idx, progresso_min)
    coins = 0; xp = 0; cards = {k: 0 for k in RARITIES}
    buff_until = {"speed": -1, "gold": -1}
    inventory = []  # cartas guardadas (raridade)
    last_seen = 0
    ev_bonus_coins = 0
    ev_claimed = set()

    def next_login_after(t):
        for s in login_starts:
            if s > t: return s
        return t + 1440

    def mult_at(m, on):
        k = 1.0
        if event_on and on and 19*60 <= m % 1440 < 21*60: k *= ev_mult
        if m < buff_until["speed"]: k *= card_speed
        return min(k, speed_cap)

    def plant(t, carry):
        nonlocal coins
        nl = next_login_after(t)
        if t + 1 in online:
            choice = 0  # ativo: cultura mais rapida
        else:
            gap = sum(mult_at(m, False) for m in range(t, min(nl, t + OFFLINE_CAP)))
            fits = [i for i, c in enumerate(CROPS) if c[1] <= gap]
            choice = max(fits, key=lambda i: CROPS[i][1]) if fits else 0
        for i in range(PLOTS):
            if plots[i] is None:
                coins -= CROPS[choice][2]
                plots[i] = [choice, carry.get(i, 0.0)]

    for t in range(DAYS * 1440):
        is_on = t in online
        if is_on and t - 1 not in online:
            # login: credita offline limitado (ja tratado no crescimento), usa carta
            if cards_on and inventory:
                inventory.sort(key=RARITIES.index, reverse=True)
                r = inventory.pop(0)
                buff_until[kind] = max(buff_until[kind], t) + (durations or DURATION)[r]
        minute_of_day = t % 1440
        if event_card and is_on and 19*60 <= minute_of_day < 21*60 and t // 1440 not in ev_claimed \
                and sum((t - k) in online for k in range(minute_of_day - 19*60 + 1)) >= 30:
            ev_claimed.add(t // 1440)
            r = random.choices(RARITIES, weights)[0]; cards[r] += 1; inventory.append(r)
        mult = 1.0
        if event_on and is_on and 19*60 <= minute_of_day < 21*60:
            mult *= ev_mult
        if t < buff_until["speed"]:
            mult *= card_speed
        mult = min(mult, speed_cap)
        # offline cap: se offline ha mais de 8h, nada cresce
        if is_on: last_seen = t
        grows = is_on or (t - last_seen) <= OFFLINE_CAP
        for p in plots:
            if p is not None and grows:
                p[1] += mult
                if t < buff_until["gold"]: p.append(mult * card_gold)
                if event_on and mult > 1 and 19*60 <= minute_of_day < 21*60 and is_on:
                    pass
        if is_on:
            carry = {}
            for i, p in enumerate(plots):
                if p is not None and p[1] >= CROPS[p[0]][1]:
                    c = CROPS[p[0]]
                    g = 1 + min(sum(p[2:]), c[1]) / c[1]
                    coins += c[3] * g; xp += c[4]
                    plots[i] = None
                    if t + 1 in online and p[0] == 0: carry[i] = p[1] - c[1]
                    if cards_on and random.random() < drop_per_plot_hour * c[1] / 60:
                        r = random.choices(RARITIES, weights)[0]
                        cards[r] += 1; inventory.append(r)
            plant(t, carry)
    return coins / DAYS, xp / DAYS, {k: v / DAYS for k, v in cards.items()}

if __name__ == "__main__":
    profs = ["casual", "regular", "hardcore"]
    base = {pr: run(pr, False, False)[0] for pr in profs}
    print("== EVENTO (ganho sobre a renda do dia) ==")
    for m in (1.2, 1.5):
        print(f"x{m}: " + "  ".join(f"{pr} {run(pr, False, True, ev_mult=m)[0]/base[pr]-1:+.1%}" for pr in profs))
    print("== CARTAS (1 ativa por vez, efeito so na producao durante a janela) ==")
    A = DURATION
    B = {"comum": 120, "incomum": 180, "rara": 240, "epica": 300, "lendaria": 360}
    for name, dur, gold, spd in [("A ouro+30% 30-90min", A, .30, 1.25), ("A veloc x1.25 30-90min", A, .30, 1.25),
                                 ("B ouro+50% 2-6h", B, .50, 1.5), ("B veloc x1.5 2-6h", B, .50, 1.5)]:
        k = "gold" if "ouro" in name else "speed"
        row = []
        for pr in profs:
            c, _, cards = run(pr, True, False, kind=k, durations=dur, card_gold=gold, card_speed=spd)
            row.append(f"{pr} {c/base[pr]-1:+.1%} ({sum(cards.values()):.1f}/dia)")
        print(f"{name:24} " + "  ".join(row))
    print("== RECOMENDADO: evento x1.5 + carta garantida, cartas B ouro ==")
    for pr in profs:
        c, _, cards = run(pr, True, True, ev_mult=1.5, kind="gold", durations=B, card_gold=.5, card_speed=1.5, event_card=True)
        print(f"{pr:9} {c/base[pr]-1:+.1%}  cartas/dia " + "/".join(f"{v:.2f}" for v in cards.values()))

def final():
    profs = ["casual", "regular", "hardcore"]
    base = {pr: run(pr, False, False)[0] for pr in profs}
    C = {"comum": 60, "incomum": 90, "rara": 120, "epica": 150, "lendaria": 180}
    print("== FINAL C: cartas ouro +50% 1h-3h ==")
    for pr in profs:
        c, _, cards = run(pr, True, False, kind="gold", durations=C, card_gold=.5)
        print(f"{pr:9} {c/base[pr]-1:+.1%}  {sum(cards.values()):.2f} cartas/dia")
    print("== FINAL evento x1.5 + carta garantida (sem outras cartas usadas: so contagem) ==")
    for pr in profs:
        e = run(pr, False, True, ev_mult=1.5)[0]
        _, _, cards = run(pr, True, True, ev_mult=1.5, kind="gold", durations=C, card_gold=.5, event_card=True)
        c2 = run(pr, True, True, ev_mult=1.5, kind="gold", durations=C, card_gold=.5, event_card=True)[0]
        print(f"{pr:9} evento {e/base[pr]-1:+.1%} | evento+cartas C {c2/base[pr]-1:+.1%} | {sum(cards.values()):.2f} cartas/dia")

final()

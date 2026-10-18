"""Progressao por nivel + exploracao (viagens de venda). Rodar: python3 tools/balance/economia.py"""
import random, math

# ---------- culturas: 40 icones, desbloqueio por nivel ----------
DUR = [2, 5, 10, 30, 60, 120, 240, 360, 480, 720]          # minutos
def dur_factor(d): return (480 / d) ** 0.126                # curta rende ~2x por hora vs 8h
def base_pph(lvl): return 30 * 1.06 ** (lvl - 1)            # lucro/h por canteiro (8h) no nivel de desbloqueio

CROP_ORDER = [  # (nome, nivel, duracao)
 ("cenoura",1,2),("morango",1,60),("batata",2,10),("alface",3,30),("tomate",4,120),
 ("milho",5,240),("cebola",6,5),("abobora",7,480),("pimentao",8,60),("repolho",9,360),
 ("melancia",10,720),("alho",11,10),("berinjela",12,120),("couve",13,30),("maca",14,480),
 ("pera",15,240),("brocolis",16,60),("pimenta",17,10),("laranja",18,720),("espinafre",19,30),
 ("uva",20,360),("couve-flor",21,120),("limao",22,480),("pessego",23,240),("aipo",24,60),
 ("banana",25,720),("gengibre",26,30),("cereja",27,360),("aspargo",28,120),("mirtilo",29,60),
 ("figo",30,480),("alcachofra",31,240),("kiwi",32,360),("amora",33,120),("alho-poro",34,30),
 ("manga",35,720),("roma",36,480),("melao",37,240),("abacaxi",38,720),("maca-verde",39,360),
]
CROPS = []
for n, l, d in CROP_ORDER:
    profit = round(base_pph(l) * dur_factor(d) * d / 60)
    profit = max(profit, 1)
    CROPS.append(dict(name=n, level=l, minutes=d, seed=profit, sell=2*profit, xp=max(1, profit//2)))

# ---------- canteiros (mapa tem 20) ----------
PLOT_LEVEL = [1,1,1,1,2,3,5,7,9,11,13,15,18,21,24,27,30,34,38,42]
def plots_at(l): return sum(1 for x in PLOT_LEVEL if x <= l)
def plot_cost(i): return 0 if i < 4 else round(150 * 1.32 ** (i - 4), -1)

# ---------- animais ----------
ANIMALS = [("galinha",3),("pato",5),("coelho",8),("porco",11),("ovelha",14),("cabra",17),
           ("vaca",20),("ganso",24),("alpaca",28),("peru",32)]
# cada animal produz ~ 1,0 canteiro-equivalente de 1h no nivel dele, sem replantio, cap 8h

# ---------- curva de XP ----------
def xp_next(l): return round(100 * 1.06 ** l * l ** 1.6)
MAX_LEVEL = 50
EFFECTIVE_PLOT_HOURS = 10.4   # do sim.py (jogador regular)

def daily(l):
    """lucro e xp por dia de um jogador regular no nivel l (melhor cultura de ~1h disponivel)."""
    best = max((c for c in CROPS if c["level"] <= l), key=lambda c: c["level"])
    pph = base_pph(best["level"]) * dur_factor(60)
    crops = plots_at(l) * EFFECTIVE_PLOT_HOURS * pph
    animals = sum(1 for _, al in ANIMALS if al <= l) * 2 * 12 * pph * 0.5  # 2 animais por tipo, 12h/dia, meia eficiencia
    profit = crops + animals
    return profit, profit / 2

def progression():
    day, l, xp, rows = 0.0, 1, 0.0, []
    while l < MAX_LEVEL:
        p, x = daily(l)
        need = xp_next(l) - xp
        day += need / x
        xp = 0; l += 1
        rows.append((l, day, p))
    return rows

# ---------- exploracao ----------
VEHICLES = {  # nivel, capacidade(unid), custo por viagem, desgaste %, vel, risco, preco
 "carroca":    dict(level=3,  cap=10, fuel=0.04, wear=6, speed=1.0, risk=1.00, price=0),
 "carro":      dict(level=12, cap=12, fuel=0.05, wear=5, speed=2.0, risk=0.80, price=4000),
 "caminhonete":dict(level=20, cap=20, fuel=0.05, wear=7, speed=1.5, risk=0.90, price=15000),
 "caminhao":   dict(level=32, cap=35, fuel=0.06, wear=9, speed=1.0, risk=1.10, price=60000),
}
# combustivel = fracao do valor-base de UMA carga cheia da melhor cultura do nivel de desbloqueio do veiculo (fixo em ouro depois)
DEST = {  # nivel, horas (carroca), resultados (prob, multiplicador sobre o preco da loja)
 "vila":   dict(level=3,  hours=2, out=[("perda total",.03,0),("roubo parcial",.10,.5),("venda normal",.62,1.12),("boa feira",.20,1.4),("otima",.05,2.2)]),
 "cidade": dict(level=10, hours=4, out=[("perda total",.05,0),("roubo parcial",.12,.5),("venda normal",.50,1.15),("boa feira",.25,1.6),("otima",.07,2.5),("jackpot",.01,5)]),
 "porto":  dict(level=22, hours=8, out=[("perda total",.10,0),("roubo parcial",.15,.5),("venda normal",.40,1.1),("boa feira",.24,1.6),("otima",.08,2.8),("jackpot",.03,6)]),
}
REPAIR_COST_PER_PCT = 0.004   # fracao do preco de referencia por ponto de condicao

def trip(dest, risk=1.0, condition=100, safe_card=False, rng=random):
    outs = DEST[dest]["out"]
    bad_mult = risk * (1.5 if condition < 50 else 1.0) * (0.5 if safe_card else 1.0)
    probs = [p * (bad_mult if m < 1 else 1) for _, p, m in outs]
    s = sum(probs[i] for i, (_, _, m) in enumerate(outs) if m < 1)
    good = 1 - s
    gtot = sum(p for (_, p, m) in outs if m >= 1)
    probs = [p if m < 1 else p0 / gtot * good for p, (_, p0, m) in zip(probs, outs)]
    r = rng.random(); acc = 0
    for (name, _, m), p in zip(outs, probs):
        acc += p
        if r <= acc: return name, m
    return outs[-1][0], outs[-1][2]

def ev(dest, veh, n=200000, **kw):
    rng = random.Random(7); tot = 0; neg = 0
    v = VEHICLES[veh]
    for _ in range(n):
        _, m = trip(dest, risk=v["risk"], rng=rng, **kw)
        net = m - 1 - v["fuel"] - v["wear"] * REPAIR_COST_PER_PCT * 1.0
        tot += net; neg += net < 0
    return tot / n, neg / n

if __name__ == "__main__":
    print("== PROGRESSAO (jogador regular) ==")
    print("nivel | dia | lucro/dia | canteiros | desbloqueia")
    unl = {}
    for c in CROPS: unl.setdefault(c["level"], []).append(c["name"])
    for a, l in ANIMALS: unl.setdefault(l, []).append("animal:" + a)
    for v, d in VEHICLES.items(): unl.setdefault(d["level"], []).append("veiculo:" + v)
    for d, x in DEST.items(): unl.setdefault(x["level"], []).append("destino:" + d)
    for l, day, p in progression():
        if l <= 12 or l % 5 == 0 or l in (22, 32):
            print(f"{l:5} | {day:5.1f} | {p:9.0f} | {plots_at(l):2} | {', '.join(unl.get(l, []))}")
    print("\n== EXPLORACAO: valor esperado liquido por viagem (fracao do preco de loja da carga) ==")
    for d in DEST:
        for veh in VEHICLES:
            e, neg = ev(d, veh, n=60000)
            e2, neg2 = ev(d, veh, n=60000, safe_card=True)
            print(f"{d:7} {veh:12} EV {e:+.1%}  prejuizo {neg:.0%} | com carta Ceu Limpo EV {e2:+.1%} prejuizo {neg2:.0%}")
    print("\n== peso da exploracao na renda diaria (capacidade em valor; melhorias +25% cada, ate 3; viagens 2/3/4 nos niveis 1/20/35) ==")
    def rev(l): return 2 * daily(l)[0]
    for v in VEHICLES.values(): v["capv"] = round(0.12 * rev(v["level"]), -1)
    for k, v in VEHICLES.items(): print(f"  {k:12} capacidade base {v['capv']:8.0f} moedas")
    for l in (3, 5, 8, 10, 12, 15, 20, 25, 30, 32, 35, 40, 45, 50):
        p, _ = daily(l)
        veh = max((k for k, v in VEHICLES.items() if v["level"] <= l), key=lambda k: VEHICLES[k]["level"])
        dest = max((k for k, v in DEST.items() if v["level"] <= l), key=lambda k: DEST[k]["level"])
        u = min(3, (l - VEHICLES[veh]["level"]) // 3)
        cargo = VEHICLES[veh]["capv"] * 1.25 ** u
        e, _ = ev(dest, veh, n=40000)
        trips = 2 if l < 20 else 3 if l < 35 else 4
        moved = min(trips * cargo, 2 * p)
        print(f"nivel {l:2}: {veh:11}+{u} {dest:6} x{trips}: move {moved/(2*p):4.0%} da producao | +{moved*e/p:4.0%} na renda")

"""Gera o catálogo do jogo (packages/shared/src/catalog/*.json) a partir de economia.py.

Rodar:   python3 tools/balance/gen_catalog.py          (escreve os JSON)
         python3 tools/balance/gen_catalog.py --check  (falha se os JSON estiverem desatualizados)

Fonte dos números: tools/balance/economia.py + docs/ECONOMIA.md. Os testes de packages/shared
conferem as fórmulas (curva de XP, custo de canteiro, preço das culturas) contra estes arquivos.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import economia as E  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "packages", "shared", "src", "catalog")

# ---------------------------------------------------------------- culturas
# nome em economia.py -> (id em inglês = frames crop/<id>_0..3, icon/<id>, icon/seed_<id>; nome pt-BR)
CROP_IDS = {
    "cenoura": ("carrot", "Cenoura"), "morango": ("strawberry", "Morango"),
    "batata": ("potato", "Batata"), "alface": ("lettuce", "Alface"),
    "tomate": (None, "Tomate"),  # sem arte (39 ícones): fica de fora
    "milho": ("corn", "Milho"), "cebola": ("onion", "Cebola"), "abobora": ("pumpkin", "Abóbora"),
    "pimentao": ("bell_pepper", "Pimentão"), "repolho": ("cabbage", "Repolho"),
    "melancia": ("watermelon", "Melancia"), "alho": ("garlic", "Alho"),
    "berinjela": ("eggplant", "Berinjela"), "couve": ("kale", "Couve"), "maca": ("apple", "Maçã"),
    "pera": ("pear", "Pera"), "brocolis": ("broccoli", "Brócolis"),
    "pimenta": ("chili_pepper", "Pimenta"), "laranja": ("orange", "Laranja"),
    "espinafre": ("spinach", "Espinafre"), "uva": ("grape", "Uva"),
    "couve-flor": ("cauliflower", "Couve-flor"), "limao": ("lemon", "Limão"),
    "pessego": ("peach", "Pêssego"), "aipo": ("celery", "Aipo"), "banana": ("banana", "Banana"),
    "gengibre": ("ginger", "Gengibre"), "cereja": ("cherry", "Cereja"),
    "aspargo": ("asparagus", "Aspargo"), "mirtilo": ("blueberry", "Mirtilo"),
    "figo": ("fig", "Figo"), "alcachofra": ("artichoke", "Alcachofra"), "kiwi": ("kiwi", "Kiwi"),
    "amora": ("blackberry", "Amora"), "alho-poro": ("leek", "Alho-poró"),
    "manga": ("mango", "Manga"), "roma": ("pomegranate", "Romã"), "melao": ("melon", "Melão"),
    "abacaxi": ("pineapple", "Abacaxi"), "maca-verde": ("green_apple", "Maçã-verde"),
}


def item(id, kind, name, base, sell, buyable, sprite, extract, rarity="common"):
    return dict(id=id, kind=kind, name=name, rarity=rarity, basePrice=base, sellPrice=sell,
                shopBuyable=buyable, stackable=True, steamExtractable=extract, spriteKey=sprite)


items, crops = [], []
for c in E.CROPS:
    en, pt = CROP_IDS[c["name"]]
    if en is None:
        continue
    items.append(item(f"seed_{en}", "seed", f"Semente de {pt.lower()}", c["seed"], None, True,
                      f"icon/seed_{en}", False))
    items.append(item(f"crop_{en}", "crop", pt, c["sell"], c["sell"], False, f"icon/{en}", True))
    crops.append(dict(cropId=f"crop_{en}", seedItemId=f"seed_{en}", yieldItemId=f"crop_{en}",
                      growSeconds=c["minutes"] * 60, yieldMin=1, yieldMax=1, xp=c["xp"],
                      unlockLevel=c["level"]))

# ---------------------------------------------------------------- animais
# (tipo, nome economia.py, produto, nome do produto, habitat, horas por unidade)
ANIMAL_DEFS = [
    ("chicken", "galinha", "egg", "Ovo", "coop", 1.0),
    ("duck", "pato", "duck_egg", "Ovo de pato", "pond", 1.5),
    ("rabbit", "coelho", "rabbit_fur", "Pelo de coelho", "coop", 2.0),
    ("pig", "porco", "truffle", "Trufa", "barn", 4.0),
    ("sheep", "ovelha", "wool", "Lã", "barn", 3.0),
    ("goat", "cabra", "goat_milk", "Leite de cabra", "barn", 2.0),
    ("cow", "vaca", "milk", "Leite", "barn", 2.0),
    ("goose", "ganso", "goose_egg", "Ovo de ganso", "pond", 3.0),
    ("alpaca", "alpaca", "alpaca_wool", "Lã de alpaca", "barn", 4.0),
    ("turkey", "peru", "turkey_feather", "Pena de peru", "coop", 3.0),
]
ANIMAL_LEVEL = dict(E.ANIMALS)
animals = []
for typ, pt, prod, prod_name, habitat, hours in ANIMAL_DEFS:
    lvl = ANIMAL_LEVEL[pt]
    # ~1 canteiro-equivalente de uma cultura de 1 h no nível do animal (sem custo de semente)
    pph = E.base_pph(lvl) * E.dur_factor(60)
    sell = max(1, round(pph * hours))
    items.append(item(f"prod_{prod}", "animal_product", prod_name, sell, sell, False,
                      f"icon/{prod}", True))
    animals.append(dict(animalType=f"animal_{typ}", name=pt.capitalize(), buyPrice=int(round(pph * 24, -1)),
                        productItemId=f"prod_{prod}", produceSeconds=int(hours * 3600),
                        maxStock=max(1, int(8 // hours)), habitat=habitat,
                        xp=max(1, sell // 2), unlockLevel=lvl))

# ---------------------------------------------------------------- canteiros e XP
plots = [dict(index=i, unlockLevel=lvl, unlockCost=int(E.plot_cost(i)), startsUnlocked=i < 4)
         for i, lvl in enumerate(E.PLOT_LEVEL)]
progression = dict(
    maxLevel=40,
    reservedMaxLevel=E.MAX_LEVEL,
    # xpToNext[L-1] = XP para ir do nível L ao L+1 = round(100 × 1,06^L × L^1,6)
    xpToNext=[E.xp_next(l) for l in range(1, E.MAX_LEVEL)],
    plots=plots,
    explorationUnlockLevel=3,
    tripsPerDay=[dict(level=1, trips=2), dict(level=20, trips=3), dict(level=35, trips=4)],
    tripsPerDayVipBonus=1,
)

# ---------------------------------------------------------------- cartas
RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]
RARITY_PT = ["Comum", "Incomum", "Rara", "Épica", "Lendária"]
DUR = {r: 3600 + 1800 * i for i, r in enumerate(RARITIES)}
# ordem = card/art_1..8 e buff/icon_1..8: sol, cesta, ovelha, coruja, ampulheta, chuva, ferradura, engrenagem
BUFFS = [
    ("gold", "Ouro", {"*": 0.5}, "+50% de moedas (venda NPC) sobre o que for produzido durante a janela"),
    ("bountiful", "Colheita farta", {"*": 1}, "+1 unidade por colheita (parte do cultivo dentro da janela)"),
    ("animals", "Animais", {"*": 0.5}, "+50% na produção animal durante a janela"),
    ("xp", "XP", {"*": 0.5}, "+50% de XP sobre o que for produzido durante a janela"),
    ("fertilizer", "Adubo", {r: 1800 + 900 * i for i, r in enumerate(RARITIES)},
     "avança na hora todos os canteiros em 30/45/60/75/90 min"),
    ("clear_sky", "Céu limpo", {"*": 0.5}, "metade da chance de resultado ruim nas viagens que saírem na janela"),
    ("lucky", "Sorte", {"*": 1.0}, "+100% de chance de carta"),
    ("exploration", "Exploração", {"*": 0.5},
     "+50% no lucro acima do preço da loja e sem desgaste nas viagens que saírem na janela"),
]
buffdefs, cards = [], []
for idx, (kind, name, mag, desc) in enumerate(BUFFS, start=1):
    instant = kind == "fertilizer"
    buffdefs.append(dict(kind=kind, name=name, description=desc, instant=instant,
                         artKey=f"card/art_{idx}", iconKey=f"buff/icon_{idx}"))
    for ri, r in enumerate(RARITIES):
        cards.append(dict(id=f"card_{kind}_{r}", name=f"{name} ({RARITY_PT[ri]})", buff=kind, rarity=r,
                          durationSeconds=0 if instant else DUR[r], magnitude=mag.get(r, mag.get("*")),
                          artKey=f"card/art_{idx}", iconKey=f"buff/icon_{idx}", frameKey=f"card/frame_{r}"))
cards_json = dict(
    provisionalArtMapping=False,  # confirmado em ECONOMIA.md
    dropChancePerPlotHour=0.0125,
    rarityWeights=dict(common=55, uncommon=27, rare=12, epic=5, legendary=1),
    durationSeconds=DUR,
    album=dict(slots=40, lineBonusPercent=2),
    buffs=buffdefs, cards=cards)

# ---------------------------------------------------------------- exploração
# capacidade base (moedas de preço de loja) calculada como em economia.py (~12% da produção diária x2)
for v in E.VEHICLES.values():
    v["capv"] = round(0.12 * 2 * E.daily(v["level"])[0], -1)
VEHICLE_META = [  # id, chave economia.py, nome, custo fixo por viagem, ícone do custo, sprite
    ("cart", "carroca", "Carroça", 30, "icon/feed_sack", "vehicle/cart"),
    ("car", "carro", "Carro", 135, "icon/fuel_can", "vehicle/car"),
    ("pickup", "caminhonete", "Caminhonete", 310, "icon/fuel_can", "vehicle/pickup"),
    ("truck", "caminhao", "Caminhão", 1000, "icon/fuel_can", "vehicle/truck"),
]
vehicles = []
for vid, key, name, cost, cost_icon, sprite in VEHICLE_META:
    v = E.VEHICLES[key]
    price = v["price"]
    upgrade_base = price if price > 0 else 1000  # carroça é grátis: melhorias 500/1000/2000
    vehicles.append(dict(
        id=vid, name=name, unlockLevel=v["level"], price=price, capacity=int(v["capv"]),
        tripCost=cost, tripCostIcon=cost_icon, wear=v["wear"], speed=v["speed"], risk=v["risk"],
        repairCostPerPoint=round(v["capv"] * E.REPAIR_COST_PER_PCT, 4),
        upgradeCosts=[int(upgrade_base * f) for f in (0.5, 1, 2)], upgradeCapacityMult=1.25,
        maxUpgrades=3, spriteKey=sprite))

OUT_IDS = {"perda total": ("total_loss", "Perda total"), "roubo parcial": ("robbery", "Roubo parcial"),
           "venda normal": ("normal", "Venda normal"), "boa feira": ("good", "Boa feira"),
           "otima": ("great", "Ótima venda"), "jackpot": ("jackpot", "Jackpot")}
CARD_CHANCE = {"great": 0.25, "jackpot": 1.0}  # PROVISÓRIO: ECONOMIA.md só diz "chance de carta"
DEST_META = [("village", "vila", "Vila"), ("city", "cidade", "Cidade"), ("port", "porto", "Porto")]
destinations = []
for did, key, name in DEST_META:
    d = E.DEST[key]
    outs = []
    for pt, p, m in d["out"]:
        oid, oname = OUT_IDS[pt]
        outs.append(dict(id=oid, name=oname, chance=p, mult=m, cardChance=CARD_CHANCE.get(oid, 0),
                         iconKey=f"explore/out_{oid}"))
    destinations.append(dict(id=did, name=name, unlockLevel=d["level"], hours=d["hours"],
                             outcomes=outs, iconKey=f"explore/dest_{did}"))

FILES = {
    "items.json": items, "crops.json": crops, "animals.json": animals,
    "progression.json": progression, "cards.json": cards_json,
    "vehicles.json": vehicles, "destinations.json": destinations,
}

if __name__ == "__main__":
    check = "--check" in sys.argv
    stale = []
    for name, data in FILES.items():
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        path = os.path.join(OUT, name)
        if check:
            cur = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
            if cur != text:
                stale.append(name)
        else:
            open(path, "w", encoding="utf-8").write(text)
    if check and stale:
        sys.exit("catálogo desatualizado: " + ", ".join(stale) + " (rode python3 tools/balance/gen_catalog.py)")
    print(f"{len(crops)} culturas, {len(animals)} animais, {len(cards)} cartas, "
          f"{len(vehicles)} veículos, {len(destinations)} destinos, {len(plots)} canteiros")
    print("capacidades:", [v["capacity"] for v in vehicles])

#!/usr/bin/env python3
"""Cria a PRIMEIRA versão do layout do Tiled (assets-src/tiled/farm_layout.tmj).

Depois disso, o arquivo do Tiled é a fonte da verdade: o dono ajusta os retângulos
no Tiled e o build.py só copia/valida. Este script NÃO sobrescreve o arquivo existente,
a menos que receba --force (isso apaga os ajustes feitos à mão no Tiled!).

As coordenadas abaixo foram medidas olhando o mapa ampliado (pixels da imagem 2576x1438).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
RAW_MAP = ROOT / "assets-src" / "raw" / "mapa_do_jogo.jpg"
TMJ = ROOT / "assets-src" / "tiled" / "farm_layout.tmj"
W, H, TILE = 2576, 1438, 32

# ---------------------------------------------------------------------------
# Canteiros pintados (x0, y0, x1, y1). Ordem = slotId plot_01, plot_02, ...
# Colunas do campo: A 198-340, B 378-516, C 556-695, D 707-825, E 860-1000, F 1040-1180
# Linhas: 1: 730-862, 2: 882-1020, 3: 1050-1190, 4: 1215-1358
# ---------------------------------------------------------------------------
PLOTS = [
    # linha 1 (mais perto da casa) — os 4 primeiros já começam liberados
    (198, 730, 340, 862), (378, 730, 516, 862), (556, 730, 662, 862), (707, 730, 825, 862), (860, 730, 1000, 862),
    # linha 2 (C2 é o poço e os baús)
    (198, 882, 340, 1020), (378, 882, 516, 1020), (707, 882, 825, 1020), (860, 895, 1000, 1020),
    # linha 3 (C3 fica embaixo do poço)
    (198, 1050, 340, 1190), (378, 1050, 516, 1190), (556, 1100, 700, 1188), (707, 1055, 825, 1188),
    (860, 1055, 1000, 1188), (1040, 1050, 1180, 1190),
    # linha 4
    (198, 1215, 340, 1358), (378, 1215, 516, 1358), (556, 1215, 695, 1358), (707, 1215, 825, 1358),
    (860, 1220, 1000, 1358), (1040, 1225, 1180, 1358),
    # horta do leste (dentro do lote lot_east_garden)
    (2178, 895, 2280, 1020), (2178, 1030, 2280, 1120), (2178, 1130, 2280, 1225),
    # canteiro ao lado do vinhedo (dentro do lote lot_vineyard)
    (1365, 1245, 1500, 1372),
]
STARTS_UNLOCKED = {1, 2, 3, 4}
# custo/nível por índice (1-based). 5 e 6: os 2 bloqueados baratos do MVP.
def plot_price(i: int) -> tuple[int, int]:
    if i in STARTS_UNLOCKED:
        return 0, 1
    if i in (5, 6):
        return 100, 1
    if i <= 9:
        return 250, 2
    if i <= 15:
        return 500, 3
    if i <= 21:
        return 1000, 5
    return 2000, 8


# ---------------------------------------------------------------------------
# Colisão (retângulos). Água vem automática da cor azul (menos as pontes).
# ---------------------------------------------------------------------------
COLLISION = [
    # bordas do mundo
    ("border_top_left", (0, 0, 1240, 150)),
    ("fence_top_left", (0, 130, 645, 168)),
    ("fence_top_mid", (1012, 130, 1240, 168)),
    ("border_left_top", (0, 150, 100, 640)),
    ("bush_left", (100, 170, 165, 268)),
    ("border_left_field", (0, 620, 190, H)),
    ("border_bottom", (0, 1385, W, H)),
    ("border_top_right", (1240, 0, 2300, 140)),
    ("cliff_pigpen", (1700, 140, 1960, 228)),
    ("cliff_right_coop", (2232, 140, 2300, 330)),
    ("border_right_top", (2300, 0, W, 745)),
    ("border_right_bottom", (2300, 880, W, H)),
    ("east_gate", (2430, 745, W, 880)),
    # prédios e objetos
    ("house", (125, 150, 580, 490)),
    ("doghouse", (100, 410, 195, 525)),
    ("house_table", (220, 480, 265, 515)),
    ("shed", (645, 97, 1012, 292)),
    ("truck", (1018, 178, 1110, 392)),
    ("greenhouse", (1035, 620, 1225, 915)),
    ("greenhouse_tree", (1255, 815, 1295, 862)),
    ("well", (565, 930, 660, 1085)),
    ("chests", (555, 872, 632, 916)),
    ("barn", (1400, 120, 1700, 262)),
    ("coop", (1960, 200, 2232, 382)),
    ("coop_barrels", (2232, 330, 2262, 400)),
    ("market_box", (2205, 628, 2318, 700)),
    ("market_sign", (2335, 660, 2390, 720)),
    ("vine_1", (1398, 948, 1502, 1022)),
    ("vine_2", (1360, 1032, 1470, 1112)),
    ("vine_3", (1365, 1120, 1500, 1228)),
    # cercas
    ("fence_field_top_a", (165, 665, 568, 705)),
    ("fence_field_top_b", (650, 665, 1035, 705)),
    ("fence_field_right", (1193, 1025, 1215, 1395)),
    ("fence_pasture_left", (1305, 240, 1330, 470)),
    ("fence_pasture_bottom", (1305, 440, 1420, 470)),
    ("fence_pond_north", (1450, 510, 1600, 560)),
    ("fence_pasture_right", (1600, 420, 1760, 460)),
    ("fence_pigpen_top", (1700, 225, 1960, 262)),
    ("fence_pigpen_bottom", (1700, 415, 1870, 460)),
    ("fence_coop_left", (1885, 330, 1915, 470)),
    ("fence_coop_bottom_a", (1975, 515, 2105, 560)),
    ("fence_coop_bottom_b", (2175, 515, 2282, 560)),
    ("fence_coop_right", (2262, 330, 2282, 560)),
    ("fence_orchard_top_a", (1495, 820, 1815, 850)),
    ("fence_orchard_top_b", (1855, 820, 2245, 850)),
    ("fence_orchard_right", (2153, 815, 2172, 1330)),
]
ORCHARD_X = [1552, 1662, 1765, 1885, 1995, 2100]
ORCHARD_BASE_Y = [925, 1060, 1205, 1355]
BRIDGES = [(1290, 500, 1430, 592), (1405, 736, 1540, 808), (1228, 1160, 1358, 1208), (1255, 1372, 1362, 1405)]

# coisas azuis que não são água (vidro da estufa, caixa de venda, lixeira do deque)
NOT_WATER = [(1030, 610, 1230, 920), (2195, 620, 2325, 705), (1135, 255, 1175, 300)]

PENS = [
    ("barn_pasture", "barn", (1335, 272, 1700, 440)),
    ("pig_pen", "barn", (1705, 265, 1950, 410)),
    ("coop_yard", "coop", (1920, 390, 2260, 515)),
    ("pond", "pond", (1650, 530, 1910, 700)),
]
LOCKED_LOTS = [
    ("lot_east_garden", 1500, (2165, 880, 2295, 1235)),
    ("lot_vineyard", 2500, (1350, 930, 1515, 1385)),
    ("lot_orchard", 5000, (1520, 790, 2160, 1385)),
]
SPAWN = ("player", (505, 575))
NPCS = [("shopkeeper", (2172, 712)), ("blacksmith", (760, 330)), ("scientist", (1135, 1000))]

# Telhados e copas (camada "overhead"): o build recorta esses pixels do mapa para overhead.png
OVERHEAD_POLYS = [
    ("house_roof", "path_grass", [(126, 292), (180, 220), (180, 176), (238, 176), (244, 182), (278, 86), (342, 126),
                          (452, 60), (535, 208), (580, 292), (470, 348), (342, 424), (300, 380), (250, 370),
                          (240, 330)]),
    ("shed_roof", "path_grass", [(645, 97), (1012, 97), (1012, 152), (645, 152)]),
    ("barn_roof", "path_grass", [(1440, 100), (1522, 50), (1582, 50), (1655, 97), (1657, 190), (1440, 190)]),
    ("coop_roof", "path_grass", [(1962, 240), (2045, 142), (2055, 142), (2135, 227), (2228, 227), (2228, 285),
                         (2137, 300), (1962, 300)]),
    ("greenhouse_roof", "path_grass", [(1035, 675), (1087, 620), (1170, 620), (1225, 675), (1225, 830), (1035, 830)]),
]
# Copas: só a parte de cima (até ~62 px acima da base do tronco), para quem passa NA FRENTE da árvore
# não ficar com a cabeça coberta. Retângulo + "drop: path" recorta o formato da copa sozinho.
OVERHEAD_RECTS = [("greenhouse_tree", "path_grass", (1226, 676, 1336, 800))] + [
    (f"orchard_tree_{r}{c}", "path", (x - 54, y - 145, x + 54, y - 62))
    for r, y in enumerate(ORCHARD_BASE_Y) for c, x in enumerate(ORCHARD_X)
]


def is_path(rgb: np.ndarray) -> np.ndarray:
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    return (r > 195) & (g > 120) & (g < 215) & (b < 110)


def refine(rect, rgb, path, search=8):
    """Ajusta cada borda do canteiro até onde termina a terra (o caminho laranja não conta)."""
    x0, y0, x1, y1 = rect
    notpath = ~path

    def frac_col(x, a, b):
        return notpath[a:b, x].mean()

    def frac_row(y, a, b):
        return notpath[y, a:b].mean()

    def best(cands, f):
        ok = [c for c in cands if f(c) >= 0.6]
        return ok

    m = 10  # margem para não medir na quina
    c = best(range(x0 - search, x0 + search), lambda x: frac_col(x, y0 + m, y1 - m))
    nx0 = min(c) if c else x0
    c = best(range(x1 - search, x1 + search), lambda x: frac_col(x, y0 + m, y1 - m))
    nx1 = max(c) + 1 if c else x1
    c = best(range(y0 - search, y0 + search), lambda y: frac_row(y, x0 + m, x1 - m))
    ny0 = min(c) if c else y0
    c = best(range(y1 - search, y1 + search), lambda y: frac_row(y, x0 + m, x1 - m))
    ny1 = max(c) + 1 if c else y1
    return (nx0, ny0, nx1, ny1)


def water_rects(rgb: np.ndarray, cell: int = 16):
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    water = (b > 140) & (b > r + 50) & (g > 110)
    water = ndi.binary_opening(water, iterations=1)
    for x0, y0, x1, y1 in BRIDGES + NOT_WATER:
        water[y0:y1, x0:x1] = False
    ch, cw = H // cell + 1, W // cell + 1
    pad = np.zeros((ch * cell, cw * cell), bool)
    pad[:H, :W] = water
    frac = pad.reshape(ch, cell, cw, cell).mean(axis=(1, 3))
    grid = frac >= 0.5
    for x0, y0, x1, y1 in BRIDGES:  # a ponte fica sempre livre
        grid[y0 // cell:(y1 + cell - 1) // cell, x0 // cell:(x1 + cell - 1) // cell] = False
    lbl, n = ndi.label(grid)
    sizes = ndi.sum(grid, lbl, range(1, n + 1))
    for i, s in enumerate(sizes):
        if s < 3:
            grid[lbl == i + 1] = False
    # junta células em retângulos: corridas por linha, depois empilha corridas iguais
    rects = []
    open_runs = {}
    for y in range(ch):
        runs = []
        x = 0
        while x < cw:
            if grid[y, x]:
                s = x
                while x < cw and grid[y, x]:
                    x += 1
                runs.append((s, x))
            else:
                x += 1
        new_open = {}
        for run in runs:
            if run in open_runs:
                new_open[run] = open_runs.pop(run)
            else:
                new_open[run] = y
        for (s, e), y0 in open_runs.items():
            rects.append((s, y0, e, y))
        open_runs = new_open
    for (s, e), y0 in open_runs.items():
        rects.append((s, y0, e, ch))
    out = []
    for s, y0, e, y1 in rects:
        out.append((s * cell, y0 * cell, min(e * cell, W), min(y1 * cell, H)))
    return out


class Ids:
    def __init__(self):
        self.n = 0

    def __call__(self):
        self.n += 1
        return self.n


def rect_obj(ids, name, r, props=None, otype=""):
    x0, y0, x1, y1 = r
    o = {"id": ids(), "name": name, "type": otype, "x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0,
         "rotation": 0, "visible": True}
    if props:
        o["properties"] = props
    return o


def prop(name, typ, value):
    return {"name": name, "type": typ, "value": value}


def layer(lid, name, objects):
    return {"id": lid, "name": name, "type": "objectgroup", "draworder": "topdown", "objects": objects,
            "opacity": 1, "visible": True, "x": 0, "y": 0}


def build(force: bool):
    if TMJ.exists() and not force:
        print(f"{TMJ} já existe; nada feito (use --force para recriar e PERDER ajustes manuais).")
        return
    rgb = np.asarray(Image.open(RAW_MAP).convert("RGB"))
    path = is_path(rgb)
    ids = Ids()
    col = [rect_obj(ids, n, r) for n, r in COLLISION]
    for r, y in enumerate(ORCHARD_BASE_Y):
        for c, x in enumerate(ORCHARD_X):
            col.append(rect_obj(ids, f"orchard_trunk_{r}{c}", (x - 14, y - 34, x + 14, y - 4)))
    for i, r in enumerate(water_rects(rgb)):
        col.append(rect_obj(ids, f"water_{i:02d}", r))
    refined = [refine(r, rgb, path) if i <= 21 else r for i, r in enumerate(PLOTS, start=1)]
    refined = [list(r) for r in refined]
    # canteiros vizinhos não podem se sobrepor: corta no meio da sobreposição
    for a in refined:
        for b in refined:
            if a is b:
                continue
            ox = min(a[2], b[2]) - max(a[0], b[0])
            oy = min(a[3], b[3]) - max(a[1], b[1])
            if ox > 0 and oy > 0:
                if ox <= oy:
                    left, right = (a, b) if a[0] < b[0] else (b, a)
                    mid = (left[2] + right[0]) // 2
                    left[2], right[0] = mid - 2, mid + 2
                else:
                    top, bot = (a, b) if a[1] < b[1] else (b, a)
                    mid = (top[3] + bot[1]) // 2
                    top[3], bot[1] = mid - 2, mid + 2
    plots = []
    for i, rr in enumerate(refined, start=1):
        rr = tuple(rr)
        cost, lvl = plot_price(i)
        plots.append(rect_obj(ids, f"plot_{i:02d}", rr, [
            prop("slotId", "string", f"plot_{i:02d}"),
            prop("unlockCost", "int", cost),
            prop("unlockLevel", "int", lvl),
            prop("startsUnlocked", "bool", i in STARTS_UNLOCKED),
        ]))
    pens = [rect_obj(ids, n, r, [prop("habitat", "string", h)]) for n, h, r in PENS]
    lots = [rect_obj(ids, n, r, [prop("lotId", "string", n), prop("cost", "int", c)]) for n, c, r in LOCKED_LOTS]
    spawn = [{"id": ids(), "name": SPAWN[0], "type": "", "x": SPAWN[1][0], "y": SPAWN[1][1], "width": 0,
              "height": 0, "rotation": 0, "visible": True, "point": True}]
    npcs = [{"id": ids(), "name": n, "type": "", "x": p[0], "y": p[1], "width": 0, "height": 0, "rotation": 0,
             "visible": True, "point": True, "properties": [prop("npc", "string", n)]} for n, p in NPCS]
    over = []
    for n, drop, pts in OVERHEAD_POLYS:
        x0, y0 = pts[0]
        over.append({"id": ids(), "name": n, "type": "", "x": x0, "y": y0, "width": 0, "height": 0,
                     "rotation": 0, "visible": True,
                     "polygon": [{"x": x - x0, "y": y - y0} for x, y in pts],
                     "properties": [prop("drop", "string", drop)]})
    for n, drop, r in OVERHEAD_RECTS:
        over.append(rect_obj(ids, n, r, [prop("drop", "string", drop)]))
    layers = [
        {"id": 1, "name": "ground", "type": "imagelayer", "image": "../raw/mapa_do_jogo.jpg",
         "imagewidth": W, "imageheight": H, "x": 0, "y": 0, "offsetx": 0, "offsety": 0, "opacity": 1,
         "visible": True, "repeatx": False, "repeaty": False},
        layer(2, "collision", col),
        layer(3, "plots", plots),
        layer(4, "pens", pens),
        layer(5, "locked_lots", lots),
        layer(6, "spawn", spawn),
        layer(7, "npc_points", npcs),
        layer(8, "overhead", over),
    ]
    tmj = {"compressionlevel": -1, "width": 81, "height": 45, "tilewidth": TILE, "tileheight": TILE,
           "infinite": False, "orientation": "orthogonal", "renderorder": "right-down",
           "tiledversion": "1.10.2", "type": "map", "version": "1.10", "nextlayerid": 9,
           "nextobjectid": ids.n + 1, "layers": layers, "tilesets": []}
    TMJ.parent.mkdir(parents=True, exist_ok=True)
    with open(TMJ, "w") as fp:
        json.dump(tmj, fp, indent=1)
        fp.write("\n")
    print(f"escrito {TMJ}: {len(col)} colisões, {len(plots)} canteiros, {len(pens)} cercados, "
          f"{len(lots)} lotes, {len(over)} formas de overhead")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    build(a.force)
    sys.exit(0)

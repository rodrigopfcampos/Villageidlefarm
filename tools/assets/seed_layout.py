#!/usr/bin/env python3
"""Cria a PRIMEIRA versão do layout do Tiled (assets-src/tiled/farm_layout.tmj) para o MAPA LIMPO (v2).

Depois disso, o arquivo do Tiled é a fonte da verdade: o dono ajusta os objetos no Tiled e o build.py só
valida/copia. Este script NÃO sobrescreve o arquivo existente, a menos que receba --force (isso apaga
os ajustes feitos à mão!).

Coordenadas em pixels do mapa (2576x1438), medidas no mapa ampliado. Os canteiros são detectados pela cor
da terra marrom.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
RAW_MAP = ROOT / "assets-src" / "raw" / "v2" / "mapa_limpo.jpg"
TMJ = ROOT / "assets-src" / "tiled" / "farm_layout.tmj"
BUILD_MANIFEST = ROOT / "tools" / "assets" / "manifests" / "buildings.yaml"
ATLAS_BUILDINGS = ROOT / "apps" / "game" / "public" / "assets" / "atlas" / "atlas_buildings.json"
W, H, TILE = 2576, 1438, 32

# Pontes (água liberada). As duas "cercas" de madeira sobre o rio (y~1180 e y~1390) contam como pontes.
BRIDGES = [(1265, 478, 1402, 602), (1378, 718, 1562, 832), (1230, 1148, 1356, 1216), (1238, 1358, 1374, 1421)]
NOT_WATER: list = []

COLLISION = [
    ("cliff_top_left", (0, 0, 1190, 150)),
    ("cliff_left", (0, 0, 60, 530)),
    ("border_left", (0, 520, 150, H)),
    ("cliff_top_mid", (1300, 0, 1810, 195)),
    ("cliff_top_right_a", (1800, 0, 2010, 250)),
    ("cliff_top_right_b", (2000, 0, 2240, 330)),
    ("plateau_right", (2230, 0, W, 700)),
    ("border_right_exit", (W - 16, 700, W, 860)),
    ("cliff_right_bottom", (2225, 850, W, H)),
    ("border_bottom", (0, 1385, W, H)),
]

# Prédios e árvores: (sprite, x da base central, y da base). A base é o pé do sprite (pivot 0.5, 1).
PLACEMENTS = [
    # prédios HD (v4) — tamanhos em atlas_buildings; base central = (x, y)
    ("building/house", 400, 560),
    ("building/garage", 905, 470),
    ("building/greenhouse", 1560, 485),     # área de grama acima do lago (era perto dos canteiros)
    ("building/barn", 1640, 1132),
    ("building/coop", 2045, 1112),
    ("building/pier", 1830, 724),           # entra no lago pela margem de baixo/direita
    # árvores
    ("tree/pine", 92, 800), ("tree/pine", 92, 1050), ("tree/pine", 92, 1300),
    ("tree/apple", 1140, 960),              # grama à direita dos canteiros, longe da coluna 5 e do lote
    ("tree/apple", 1870, 470),              # grama entre a estufa e o carvalho, acima do lago
    ("tree/palm", 2175, 690),
    ("tree/bush_round", 700, 690),
    ("tree/oak", 2120, 470),
    ("tree/pine", 2330, 345), ("tree/oak", 2470, 470), ("tree/pine", 2420, 660),
    ("tree/oak", 2330, 1100), ("tree/pine", 2470, 1300),
]

PENS = [
    ("barn_pasture", "barn", (1480, 1150, 1900, 1370)),
    ("coop_yard", "coop", (1920, 1140, 2210, 1370)),
    ("pond", "pond", (1610, 500, 1980, 712)),
]
LOCKED_LOTS = [
    ("lot_field_east", 1500, (1030, 1050, 1192, 1206)),
    ("lot_field_south", 2500, (188, 1222, 1192, 1376)),
    ("lot_meadow", 5000, (1470, 1138, 2215, 1376)),
]
SPAWN = ("player", (450, 625))
NPCS = [("shopkeeper", (2150, 795)), ("blacksmith", (905, 500)), ("scientist", (1480, 530))]
STARTS_UNLOCKED = {1, 2, 3, 4}
# Pontos de interesse (camada "spots"): saída do veículo na frente da garagem e saída da fazenda pela estrada
SPOTS = [("vehicle_spawn", (850, 545)), ("farm_exit", (2545, 805))]


def plot_price(i: int) -> tuple[int, int]:
    if i in STARTS_UNLOCKED:
        return 0, 1
    if i in (5, 6):
        return 100, 1
    if i <= 9:
        return 250, 2
    if i <= 14:
        return 500, 3
    return 1000, 5


def detect_plots(rgb: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Blocos de terra marrom. Bloco duplo retangular (largura > 1,6x a de um bloco) vira 2 canteiros;
    bloco em L (duplo com recorte) fica 1 canteiro só."""
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    soil = (r > 70) & (r < 150) & (g > 35) & (g < 95) & (b < 50) & (r - g > 30)
    soil = ndi.binary_opening(soil, iterations=3)
    lbl, n = ndi.label(soil)
    blocks = []
    for i, s in enumerate(ndi.find_objects(lbl)):
        area = int((lbl[s] == i + 1).sum())
        if area < 5000:
            continue
        x0, y0, x1, y1 = s[1].start, s[0].start, s[1].stop, s[0].stop
        fill = area / ((x1 - x0) * (y1 - y0))
        if x1 - x0 > 230 and fill > 0.9:  # retângulo duplo: divide no meio
            mid = (x0 + x1) // 2
            blocks += [(x0, y0, mid - 6, y1), (mid + 6, y0, x1, y1)]
        elif fill < 0.9:  # bloco em L: o retângulo cobre a terra pintada inteira (caixa envolvente)
            blocks.append((x0, y0, x1, y1))
        else:
            blocks.append((x0, y0, x1, y1))
    rows: list[list] = []
    for bl in sorted(blocks, key=lambda q: q[1]):
        if rows and abs(rows[-1][0][1] - bl[1]) < 60:
            rows[-1].append(bl)
        else:
            rows.append([bl])
    out = []
    for row in rows:
        out += sorted(row, key=lambda q: q[0])
    # retângulo = borda exata da terra marrom pintada
    return out


def water_rects(rgb: np.ndarray, cell: int = 16):
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    water = (b > 140) & (b > r + 50) & (g > 110)
    water = ndi.binary_opening(water, iterations=1)
    water = ndi.binary_dilation(water, iterations=6)  # inclui a margem de pedra cinza
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
    x0, y0, x1, y1 = (int(v) for v in r)
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


def load_sizes() -> tuple[dict, dict]:
    fps = {}
    for p in sorted(BUILD_MANIFEST.parent.glob("*.yaml")):
        cfg = yaml.safe_load(open(p)) or {}
        if cfg.get("enabled", True):
            fps.update(cfg.get("footprints") or {})
    if not ATLAS_BUILDINGS.exists():
        raise SystemExit("rode antes: python tools/assets/build.py --sheet buildings")
    js = json.load(open(ATLAS_BUILDINGS))
    sizes = {n: (f["sourceSize"]["w"], f["sourceSize"]["h"]) for n, f in js["frames"].items()}
    return fps, sizes


def build(force: bool):
    if TMJ.exists() and not force:
        print(f"{TMJ} já existe; nada feito (use --force para recriar e PERDER ajustes manuais).")
        return
    rgb = np.asarray(Image.open(RAW_MAP).convert("RGB"))
    fps, sizes = load_sizes()
    ids = Ids()
    col = [rect_obj(ids, n, r) for n, r in COLLISION]
    for i, r in enumerate(water_rects(rgb)):
        col.append(rect_obj(ids, f"water_{i:02d}", r))
    blds = []
    count: dict[str, int] = {}
    for sprite, bx, by in PLACEMENTS:
        w, h = sizes[sprite]
        fp = fps.get(sprite, [0, 0])
        fw, fh = fp[0], fp[1]
        fdx = fp[2] if len(fp) > 2 else 0
        k = sprite.split("/")[1]
        count[k] = count.get(k, 0) + 1
        name = k if sprite.startswith("building/") else f"{k}_{count[k]}"
        x0 = int(round(bx - w / 2))
        blds.append(rect_obj(ids, name, (x0, by - h, x0 + w, by), [
            prop("sprite", "string", sprite),
            # sem base (píer, plantinhas): é "chão", nunca cobre o jogador -> overheadSplitY = 0
            prop("overheadSplitY", "int", int(h - fh) if fh else 0),
        ]))
        if fw and fh:
            col.append(rect_obj(ids, f"{name}_base", (int(bx + fdx - fw / 2), by - fh, int(bx + fdx + fw / 2), by)))
    plots = []
    for i, rr in enumerate(detect_plots(rgb), start=1):
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
    spots = [{"id": ids(), "name": n, "type": "", "x": p[0], "y": p[1], "width": 0, "height": 0, "rotation": 0,
              "visible": True, "point": True} for n, p in SPOTS]
    layers = [
        {"id": 1, "name": "ground", "type": "imagelayer", "image": "../raw/v2/mapa_limpo.jpg",
         "imagewidth": W, "imageheight": H, "x": 0, "y": 0, "offsetx": 0, "offsety": 0, "opacity": 1,
         "visible": True, "repeatx": False, "repeaty": False},
        layer(2, "collision", col),
        layer(3, "plots", plots),
        layer(4, "pens", pens),
        layer(5, "locked_lots", lots),
        layer(6, "spawn", spawn),
        layer(7, "npc_points", npcs),
        layer(8, "buildings", blds),
        layer(9, "overhead", []),
        layer(10, "spots", spots),
    ]
    tmj = {"compressionlevel": -1, "width": 81, "height": 45, "tilewidth": TILE, "tileheight": TILE,
           "infinite": False, "orientation": "orthogonal", "renderorder": "right-down",
           "tiledversion": "1.10.2", "type": "map", "version": "1.10", "nextlayerid": 11,
           "nextobjectid": ids.n + 1, "layers": layers, "tilesets": []}
    TMJ.parent.mkdir(parents=True, exist_ok=True)
    with open(TMJ, "w") as fp:
        json.dump(tmj, fp, indent=1)
        fp.write("\n")
    print(f"escrito {TMJ}: {len(col)} colisões, {len(plots)} canteiros, {len(pens)} cercados, "
          f"{len(lots)} lotes, {len(blds)} prédios/árvores")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    build(a.force)
    sys.exit(0)

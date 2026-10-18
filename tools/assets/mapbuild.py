"""Mapa: farm.webp, overhead.png, cópia validada do layout do Tiled e prévias."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

from build import (CLEAN, DEBUG, OUT, RAW, TILED, BuildError, font)

MAP_W, MAP_H, TILE = 2576, 1438, 32
SRC_TMJ = TILED / "farm_layout.tmj"
REQUIRED_LAYERS = ["collision", "plots", "pens", "spawn", "locked_lots", "npc_points", "buildings"]


MAP_NAME = "v2/mapa_limpo"   # mapa base atual (só terreno). Troque aqui se o dono mandar outro.


def map_source() -> Path:
    for ext in ("png", "webp", "jpg"):
        p = CLEAN / f"{MAP_NAME}.{ext}"
        if p.exists():
            return p
    return RAW / f"{MAP_NAME}.jpg"


def load_map() -> Image.Image:
    im = Image.open(map_source()).convert("RGB")
    if im.size != (MAP_W, MAP_H):
        raise BuildError(f"mapa precisa ter {MAP_W}x{MAP_H}, tem {im.size}")
    return im


def props(o: dict) -> dict:
    return {p["name"]: p["value"] for p in o.get("properties", [])}


def layer_objects(tmj: dict, name: str) -> list[dict]:
    for l in tmj["layers"]:
        if l["name"] == name and l["type"] == "objectgroup":
            return l["objects"]
    return []


def ground_masks(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    # chão de terra laranja (com e sem sombra das árvores)
    path = (r > 140) & (r > g) & (g > b) & (r - b > 100) & (g > r * 0.45) & (g < r * 0.88)
    grass = (g > 140) & (r < 200) & (b < 100) & (g > r + 25)
    return path, grass


def overhead_mask(tmj: dict, rgb: np.ndarray) -> np.ndarray:
    path, grass = ground_masks(rgb)
    total = np.zeros((MAP_H, MAP_W), bool)
    for o in layer_objects(tmj, "overhead"):
        m = Image.new("L", (MAP_W, MAP_H), 0)
        d = ImageDraw.Draw(m)
        if o.get("polygon"):
            pts = [(o["x"] + p["x"], o["y"] + p["y"]) for p in o["polygon"]]
            d.polygon(pts, fill=255)
        elif o.get("ellipse"):
            d.ellipse([o["x"], o["y"], o["x"] + o["width"], o["y"] + o["height"]], fill=255)
        elif o.get("width", 0) > 0:
            d.rectangle([o["x"], o["y"], o["x"] + o["width"] - 1, o["y"] + o["height"] - 1], fill=255)
        else:
            continue
        mm = np.asarray(m) > 0
        drop = props(o).get("drop", "path_grass")
        if drop in ("path", "path_grass"):
            mm &= ~path
        if drop == "path_grass":
            mm &= ~grass
        # limpa pontinhos e preenche furinhos (frutas laranja no meio da copa voltam)
        inside = np.asarray(m) > 0
        mm = ndi.binary_opening(mm, iterations=1)
        mm = ndi.binary_closing(mm, iterations=2) & inside
        mm = ndi.binary_fill_holes(mm)
        lbl, n = ndi.label(mm)
        if n > 1:  # fica só a maior parte (evita grudar pedacinhos do vizinho)
            sizes = ndi.sum(mm, lbl, range(1, n + 1))
            keep = np.zeros(n + 1, bool)
            keep[1:] = sizes >= max(200, sizes.max() * 0.15)
            mm = keep[lbl]
        total |= mm
    return total


def atlas_cache():
    cache = {}

    def get(name: str):
        for cat in ("buildings", "crops", "characters", "animals", "pets", "icons", "tiles"):
            if cat not in cache:
                p = OUT / "atlas" / f"atlas_{cat}.json"
                cache[cat] = (json.load(open(p)), Image.open(OUT / "atlas" / f"atlas_{cat}.png").convert("RGBA")) \
                    if p.exists() else ({"frames": {}}, None)
            js, im = cache[cat]
            if name in js["frames"]:
                f = js["frames"][name]["frame"]
                return im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])), js["frames"][name]["pivot"]
        raise BuildError(f"quadro não encontrado em nenhum atlas: {name}")
    return get


def building_layer(tmj: dict, upper_only: bool) -> Image.Image:
    """Desenha os objetos da camada buildings (ordenados pela base). upper_only: só a parte acima de
    overheadSplitY (o que fica por cima do jogador) -> overhead.png."""
    get = atlas_cache()
    out = Image.new("RGBA", (MAP_W, MAP_H), (0, 0, 0, 0))
    objs = sorted(layer_objects(tmj, "buildings"), key=lambda o: o["y"] + o["height"])
    for o in objs:
        p = props(o)
        fr, _ = get(p["sprite"])
        bx, by = o["x"] + o["width"] / 2, o["y"] + o["height"]
        x0, y0 = int(round(bx - fr.width / 2)), int(round(by - fr.height))
        if upper_only:
            split = int(p.get("overheadSplitY", fr.height))
            if split <= 0:
                continue
            fr = fr.crop((0, 0, fr.width, min(split, fr.height)))
        out.alpha_composite(fr, (x0, y0)) if 0 <= x0 and 0 <= y0 else out.paste(fr, (x0, y0), fr)
    return out


def validate_layout(tmj: dict):
    if tmj.get("orientation") != "orthogonal" or tmj.get("tilewidth") != TILE or tmj.get("tileheight") != TILE:
        raise BuildError("layout: precisa ser ortogonal com tiles de 32x32")
    if (tmj.get("width"), tmj.get("height")) != (81, 45):
        raise BuildError("layout: tamanho precisa ser 81x45 tiles")
    names = [l["name"] for l in tmj["layers"]]
    for n in REQUIRED_LAYERS + ["ground"]:
        if n not in names:
            raise BuildError(f"layout: falta a camada '{n}'")
    plots = layer_objects(tmj, "plots")
    if len(plots) < 20:
        raise BuildError(f"layout: precisa de pelo menos 20 canteiros, tem {len(plots)}")
    ids = set()
    for o in plots:
        p = props(o)
        for k, t in (("slotId", str), ("unlockCost", int), ("unlockLevel", int), ("startsUnlocked", bool)):
            if not isinstance(p.get(k), t):
                raise BuildError(f"layout: canteiro {o.get('name')} sem propriedade {k} ({t.__name__})")
        if p["slotId"] in ids:
            raise BuildError(f"layout: slotId repetido {p['slotId']}")
        ids.add(p["slotId"])
    if sum(1 for o in plots if props(o)["startsUnlocked"]) < 4:
        raise BuildError("layout: precisa de 4 canteiros com startsUnlocked=true")
    for o in layer_objects(tmj, "pens"):
        if props(o).get("habitat") not in ("coop", "barn", "pond"):
            raise BuildError(f"layout: cercado {o.get('name')} com habitat inválido")
    for o in layer_objects(tmj, "locked_lots"):
        p = props(o)
        if not isinstance(p.get("lotId"), str) or not isinstance(p.get("cost"), int):
            raise BuildError(f"layout: lote {o.get('name')} sem lotId/cost")
    if not any(o.get("name") == "player" and o.get("point") for o in layer_objects(tmj, "spawn")):
        raise BuildError("layout: falta o ponto 'player' na camada spawn")
    for o in layer_objects(tmj, "npc_points"):
        if props(o).get("npc") not in ("shopkeeper", "blacksmith", "scientist"):
            raise BuildError(f"layout: npc_point {o.get('name')} com npc inválido")
    bj = OUT / "atlas" / "atlas_buildings.json"
    known = set(json.load(open(bj))["frames"]) if bj.exists() else set()
    for o in layer_objects(tmj, "buildings"):
        p = props(o)
        if not isinstance(p.get("sprite"), str) or not isinstance(p.get("overheadSplitY"), int):
            raise BuildError(f"layout: prédio {o.get('name')} sem sprite/overheadSplitY")
        if known and p["sprite"] not in known:
            raise BuildError(f"layout: prédio {o.get('name')} usa sprite inexistente {p['sprite']}")
    for l in tmj["layers"]:
        for o in l.get("objects", []):
            if not (0 <= o["x"] <= MAP_W and 0 <= o["y"] <= MAP_H):
                raise BuildError(f"layout: objeto {o.get('name')} fora do mapa")


def build_map():
    print("- mapa")
    im = load_map()
    (OUT / "map").mkdir(parents=True, exist_ok=True)
    im.save(OUT / "map" / "farm.webp", "WEBP", quality=90, method=6)
    if not SRC_TMJ.exists():
        raise BuildError(f"falta {SRC_TMJ}. Rode: python tools/assets/seed_layout.py")
    tmj = json.load(open(SRC_TMJ))
    validate_layout(tmj)
    rgb = np.asarray(im)
    mask = overhead_mask(tmj, rgb)
    rgba = np.dstack([rgb, np.where(mask, 255, 0).astype(np.uint8)])
    rgba[~mask, :3] = 0
    over = Image.fromarray(rgba, "RGBA")
    # telhados e copas dos prédios/árvores da camada "buildings" (parte acima de overheadSplitY)
    over.alpha_composite(building_layer(tmj, upper_only=True))
    over.save(OUT / "map" / "overhead.png", optimize=True)
    mask = np.asarray(over)[..., 3] > 0
    out = copy.deepcopy(tmj)
    for l in out["layers"]:
        if l["type"] == "imagelayer" and l["name"] == "ground":
            l["image"] = "farm.webp"
            l["imagewidth"], l["imageheight"] = MAP_W, MAP_H
    with open(OUT / "map" / "farm_layout.tmj", "w") as fp:
        json.dump(out, fp, indent=1)
        fp.write("\n")
    n = {k: len(layer_objects(tmj, k)) for k in REQUIRED_LAYERS + ["overhead"]}
    print("  ok: " + ", ".join(f"{k}={v}" for k, v in n.items()) + f", overhead {mask.mean() * 100:.1f}% do mapa")


# ---------------------------------------------------------------------------
# Prévias
# ---------------------------------------------------------------------------
def paste_at(base: Image.Image, name: str, x: float, y: float, shadow: bool = True, get=None, flip=False):
    get = get or atlas_cache()
    fr, piv = get(name)
    if flip:
        fr = fr.transpose(Image.FLIP_LEFT_RIGHT)
    px, py = int(round(x - piv["x"] * fr.width)), int(round(y - piv["y"] * fr.height))
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        w = max(8, int(fr.width * 0.45))
        ImageDraw.Draw(sh).ellipse([x - w // 2, y - 5, x + w // 2, y + 3], fill=(0, 0, 0, 70))
        base.alpha_composite(sh)
    base.alpha_composite(fr, (max(px, 0), max(py, 0))) if px >= 0 and py >= 0 else base.paste(fr, (px, py), fr)


def previews():
    tmj = json.load(open(SRC_TMJ))
    sp = next(o for o in layer_objects(tmj, "spawn") if o["name"] == "player")
    plots = layer_objects(tmj, "plots")
    # culturas variadas nos canteiros (estágio = coluna); os 4 primeiros com terra arada/molhada
    crops = ["carrot", "pumpkin", "strawberry", "corn", "watermelon", "cabbage", "apple", "eggplant", "pineapple",
             "bell_pepper", "grape", "cauliflower", "banana", "potato", "lemon", "kale", "melon", "chili_pepper",
             "orange", "artichoke"]
    extra = []
    tiles = ["tile/soil_tilled", "tile/soil_wet", "tile/soil_tilled", "tile/soil_raw"]
    base_tiles = []
    for i, o in enumerate(plots):
        cx = o["x"] + o["width"] / 2
        base_tiles.append((tiles[i % 4] if i < 12 else None, o))
        if i < 16:
            extra.append((f"crop/{crops[i]}_{(i + 3) % 4 if i < 8 else 3}", cx, o["y"] + o["height"] - 10, False, False))
    walk = lambda n, i: f"{n}/walk_{i % 5}"
    extra += [("farmer_m/idle_down_0", sp["x"], sp["y"], True, False),
              ("farmer_f/idle_down_0", sp["x"] + 60, sp["y"] + 8, True, False),
              ("farmer_m/walk_right_1", sp["x"] + 150, sp["y"] + 20, True, False),
              ("farmer_m/walk_left_2", sp["x"] - 120, sp["y"] + 40, True, False),
              ("farmer_m/idle_up_0", 420, 300, True, False),          # atrás da casa (telhado por cima)
              ("farmer_m/water_right_0", plots[0]["x"] - 18, plots[0]["y"] + 95, True, False),
              ("farmer_f/water_side_0", plots[1]["x"] - 20, plots[1]["y"] + 95, True, False),
              ("farmer_m/plant_kneel_1", plots[2]["x"] - 14, plots[2]["y"] + 95, True, False),
              ("dog/sit_0", sp["x"] - 50, sp["y"] + 12, True, False),
              (walk("cow", 1), 1520, 1235, True, False), (walk("cow", 3), 1700, 1310, True, True),
              ("cow/graze_0", 1600, 1360, True, False),
              (walk("sheep", 2), 1820, 1225, True, False), (walk("pig", 0), 1660, 1215, True, True),
              (walk("goat", 4), 1880, 1330, True, False), (walk("alpaca", 1), 1520, 1350, True, False),
              (walk("chicken", 0), 1960, 1200, True, False), (walk("chicken", 2), 2010, 1260, True, True),
              ("chicken/graze_0", 2080, 1215, True, False), (walk("turkey", 1), 2150, 1330, True, False),
              (walk("goose", 3), 2000, 1340, True, True), (walk("rabbit", 2), 2160, 1250, True, False),
              ("duck_mallard/pose_3", 1700, 620, False, False), (walk("duck", 1), 1990, 760, True, True),
              ("shopkeeper/idle_down_0", 2150, 795, True, False), ("blacksmith/idle_down_0", 905, 500, True, False),
              ("scientist/idle_down_0", 1480, 530, True, False)]
    get = atlas_cache()
    ground = load_map().convert("RGBA")
    for t, o in base_tiles:  # terra arada por cima dos canteiros (nine-slice simples)
        if t:
            ground.alpha_composite(nine_slice(get(t)[0], int(o["width"]), int(o["height"]), 12), (int(o["x"]), int(o["y"])))
    full = composed_on(ground, tmj, extra, get)
    full.convert("RGB").save(DEBUG / "preview_composto.png")
    crop = full.crop((120, 100, 1320, 800)).convert("RGB")
    crop.resize((crop.width * 2, crop.height * 2), Image.NEAREST).save(DEBUG / "preview_on_map.png")
    right = full.crop((1380, 380, 2280, 1400)).convert("RGB")
    right.save(DEBUG / "preview_on_map_animals.png")

    # layout_overlay
    im = load_map().convert("RGBA")
    im.alpha_composite(building_layer(tmj, upper_only=False))
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    f = font(16)

    def rect(o):
        return [o["x"], o["y"], o["x"] + o["width"], o["y"] + o["height"]]

    for o in layer_objects(tmj, "buildings"):
        p = props(o)
        d.rectangle(rect(o), outline=(255, 0, 255, 255), width=2)
        sy = o["y"] + p["overheadSplitY"]
        d.line([o["x"], sy, o["x"] + o["width"], sy], fill=(255, 0, 255, 255), width=2)
        d.text((o["x"] + 4, o["y"] + 2), p["sprite"], fill=(255, 200, 255, 255), font=f, stroke_width=2,
               stroke_fill=(0, 0, 0, 255))
    for o in layer_objects(tmj, "collision"):
        d.rectangle(rect(o), fill=(255, 0, 0, 70), outline=(255, 0, 0, 220), width=2)
    for o in layer_objects(tmj, "pens"):
        d.rectangle(rect(o), fill=(0, 90, 255, 60), outline=(0, 120, 255, 255), width=3)
        d.text((o["x"] + 4, o["y"] + 4), f"{o['name']} ({props(o)['habitat']})", fill=(200, 230, 255, 255), font=f,
               stroke_width=2, stroke_fill=(0, 0, 0, 255))
    for o in layer_objects(tmj, "locked_lots"):
        d.rectangle(rect(o), outline=(255, 230, 0, 255), width=4)
        p = props(o)
        d.text((o["x"] + 4, o["y"] + o["height"] - 22), f"{p['lotId']} ${p['cost']}", fill=(255, 240, 0, 255),
               font=f, stroke_width=2, stroke_fill=(0, 0, 0, 255))
    for o in plots:
        p = props(o)
        col = (0, 255, 80, 255) if p["startsUnlocked"] else (150, 255, 150, 255)
        d.rectangle(rect(o), fill=(0, 255, 0, 50), outline=col, width=3)
        d.text((o["x"] + 4, o["y"] + 4), p["slotId"], fill=(255, 255, 255, 255), font=f, stroke_width=2,
               stroke_fill=(0, 0, 0, 255))
        txt = "LIVRE" if p["startsUnlocked"] else f"${p['unlockCost']} nv{p['unlockLevel']}"
        d.text((o["x"] + 4, o["y"] + 22), txt, fill=(255, 255, 160, 255), font=f, stroke_width=2,
               stroke_fill=(0, 0, 0, 255))
    for o in layer_objects(tmj, "spawn") + layer_objects(tmj, "npc_points"):
        x, y = o["x"], o["y"]
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(255, 255, 255, 255), outline=(0, 0, 0, 255), width=3)
        d.text((x + 12, y - 10), o["name"], fill=(255, 255, 255, 255), font=font(18), stroke_width=3,
               stroke_fill=(0, 0, 0, 255))
    im.alpha_composite(ov)
    im.convert("RGB").save(DEBUG / "layout_overlay.png")
    import extras
    extras.card_art_preview()
    extras.album_preview()
    print("  prévias: preview_composto.png, preview_on_map*.png, layout_overlay.png, cards_art_in_frames.png")


def composed_on(ground: Image.Image, tmj: dict, extra: list[tuple], get) -> Image.Image:
    base = ground.copy()
    items = []
    for o in layer_objects(tmj, "buildings"):
        items.append((o["y"] + o["height"], props(o)["sprite"], o["x"] + o["width"] / 2, o["y"] + o["height"],
                      False, False))
    for name, x, y, sh, fl in extra:
        items.append((y, name, x, y, sh, fl))
    for _, name, x, y, sh, fl in sorted(items, key=lambda t: t[0]):
        paste_at(base, name, x, y, shadow=sh, get=get, flip=fl)
    base.alpha_composite(Image.open(OUT / "map" / "overhead.png"))
    return base


def nine_slice(tile: Image.Image, w: int, h: int, m: int) -> Image.Image:
    """Estica um tile com margem m (cantos fixos) para w x h, vizinho mais próximo."""
    tw, th = tile.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    xs = [(0, m, 0, m), (m, tw - m, m, w - m), (tw - m, tw, w - m, w)]
    ys = [(0, m, 0, m), (m, th - m, m, h - m), (th - m, th, h - m, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if dx1 > dx0 and dy1 > dy0:
                part = tile.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.NEAREST)
                out.paste(part, (dx0, dy0))
    return out

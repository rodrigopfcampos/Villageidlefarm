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
REQUIRED_LAYERS = ["collision", "plots", "pens", "spawn", "locked_lots", "npc_points"]


def map_source() -> Path:
    for ext in ("png", "webp", "jpg"):
        p = CLEAN / f"mapa_do_jogo.{ext}"
        if p.exists():
            return p
    return RAW / "mapa_do_jogo.jpg"


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
    Image.fromarray(rgba, "RGBA").save(OUT / "map" / "overhead.png", optimize=True)
    out = copy.deepcopy(tmj)
    for l in out["layers"]:
        if l["type"] == "imagelayer" and l["name"] == "ground":
            l["image"] = "farm.webp"
    with open(OUT / "map" / "farm_layout.tmj", "w") as fp:
        json.dump(out, fp, indent=1)
        fp.write("\n")
    n = {k: len(layer_objects(tmj, k)) for k in REQUIRED_LAYERS + ["overhead"]}
    print("  ok: " + ", ".join(f"{k}={v}" for k, v in n.items()) + f", overhead {mask.mean() * 100:.1f}% do mapa")


# ---------------------------------------------------------------------------
# Prévias
# ---------------------------------------------------------------------------
def atlas_frame(cat: str, name: str) -> Image.Image:
    js = json.load(open(OUT / "atlas" / f"atlas_{cat}.json"))
    im = Image.open(OUT / "atlas" / f"atlas_{cat}.png")
    f = js["frames"][name]["frame"]
    return im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])), js["frames"][name]["pivot"]


def paste_at(base: Image.Image, cat: str, name: str, x: int, y: int, shadow: bool = True):
    fr, piv = atlas_frame(cat, name)
    px, py = int(round(x - piv["x"] * fr.width)), int(round(y - piv["y"] * fr.height))
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(sh)
        w = max(8, int(fr.width * 0.45))
        d.ellipse([x - w // 2, y - 5, x + w // 2, y + 3], fill=(0, 0, 0, 70))
        base.alpha_composite(sh)
    base.alpha_composite(fr, (px, py))


def previews():
    im = load_map().convert("RGBA")
    tmj = json.load(open(SRC_TMJ))
    sp = next(o for o in layer_objects(tmj, "spawn") if o["name"] == "player")
    # preview_on_map: escala final (1:1) num recorte em volta da casa/campo
    base = im.copy()
    over = Image.open(OUT / "map" / "overhead.png")
    paste_at(base, "characters", "farmer_m/idle_down_0", sp["x"], sp["y"])
    paste_at(base, "characters", "farmer_f/idle_down_0", sp["x"] + 60, sp["y"] + 10)
    paste_at(base, "characters", "farmer_m/idle_up_0", 1262, 808)  # atrás da árvore da estufa (copa por cima)
    paste_at(base, "characters", "shopkeeper/idle_down_0", 2172, 712)
    paste_at(base, "animals", "cow/idle_0", 1420, 360)
    paste_at(base, "animals", "sheep/idle_0", 1520, 420)
    paste_at(base, "animals", "chicken/idle_0", 2010, 470)
    paste_at(base, "animals", "duck/swim_0", 1760, 640, shadow=False)
    paste_at(base, "pets", "dog/sit_0", sp["x"] - 70, sp["y"] + 15)
    plots = layer_objects(tmj, "plots")
    for o, ic in zip(plots[:3], ["icon/carrot", "icon/potato", "icon/strawberry"]):
        paste_at(base, "icons", ic, int(o["x"] + o["width"] / 2), int(o["y"] + o["height"] / 2), shadow=False)
    base.alpha_composite(over)
    full = base.convert("RGB")
    crop = full.crop((80, 40, 1280, 900))
    big = crop.resize((crop.width * 2, crop.height * 2), Image.NEAREST)
    d = ImageDraw.Draw(big)
    d.text((10, 10), "preview_on_map: escala final 1:1 (ampliado 2x). Fazendeiro de costas atrás da árvore da estufa = copa no overhead.",
           fill=(255, 255, 255), font=font(22), stroke_width=3, stroke_fill=(0, 0, 0))
    big.save(DEBUG / "preview_on_map.png")
    right = full.crop((1300, 180, 2340, 820))
    right.resize((right.width * 2, right.height * 2), Image.NEAREST).save(DEBUG / "preview_on_map_animals.png")
    full.save(DEBUG / "preview_on_map_full.png")

    # layout_overlay
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    f = font(16)

    def rect(o):
        return [o["x"], o["y"], o["x"] + o["width"], o["y"] + o["height"]]

    for o in layer_objects(tmj, "overhead"):
        if o.get("polygon"):
            pts = [(o["x"] + p["x"], o["y"] + p["y"]) for p in o["polygon"]]
            d.polygon(pts, outline=(255, 0, 255, 255), width=2)
        elif o.get("ellipse"):
            d.ellipse(rect(o), outline=(255, 0, 255, 255), width=2)
        else:
            d.rectangle(rect(o), outline=(255, 0, 255, 255), width=2)
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
    for o in layer_objects(tmj, "plots"):
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
    out = im.copy()
    out.alpha_composite(ov)
    out.convert("RGB").save(DEBUG / "layout_overlay.png")
    print("  prévias: preview_on_map.png, preview_on_map_animals.png, layout_overlay.png")

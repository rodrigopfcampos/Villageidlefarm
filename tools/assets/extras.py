"""Trechos extras de assetKeys.ts calculados dos atlas e manifestos (cartas, nine-slice, prédios)
e a prévia das artes de carta dentro de cada moldura."""
from __future__ import annotations

import json

import numpy as np
import yaml
from PIL import Image, ImageDraw

from build import DEBUG, MANIFESTS, OUT, checker, font

FRAMES = ["card/frame_common", "card/frame_uncommon", "card/frame_rare", "card/frame_epic", "card/frame_legendary"]


def _atlas(cat: str):
    p = OUT / "atlas" / f"atlas_{cat}.json"
    if not p.exists():
        return None, None
    return json.load(open(p)), Image.open(OUT / "atlas" / f"atlas_{cat}.png")


def _frame(js, im, name) -> Image.Image:
    f = js["frames"][name]["frame"]
    return im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))


def card_slots() -> dict[str, dict]:
    """Abertura (miolo transparente) de cada moldura: anda do centro até achar a moldura."""
    js, im = _atlas("cards")
    out = {}
    if js is None:
        return out
    for n in FRAMES:
        if n not in js["frames"]:
            continue
        a = np.asarray(_frame(js, im, n))[..., 3]
        h, w = a.shape
        cy, cx = int(h * 0.42), w // 2
        x0 = cx
        while x0 > 0 and a[cy, x0 - 1] == 0:
            x0 -= 1
        x1 = cx
        while x1 < w - 1 and a[cy, x1 + 1] == 0:
            x1 += 1
        y0 = cy
        while y0 > 0 and a[y0 - 1, cx] == 0:
            y0 -= 1
        y1 = cy
        while y1 < h - 1 and a[y1 + 1, cx] == 0:
            y1 += 1
        out[n] = {"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1,
                  "cx": (x0 + x1 + 1) / 2, "cy": (y0 + y1 + 1) / 2, "frameW": w, "frameH": h}
    return out


def card_art_preview():
    js, im = _atlas("cards")
    if js is None:
        return
    arts = sorted(n for n in js["frames"] if n.startswith("card/art_"))
    slots = card_slots()
    if not arts or not slots:
        return
    fw = max(s["frameW"] for s in slots.values())
    fh = max(s["frameH"] for s in slots.values())
    cols, rows = len(arts), len(slots)
    sheet = Image.new("RGB", (cols * (fw + 8) + 8, rows * (fh + 8) + 8), (40, 40, 48))
    for r, (fn, s) in enumerate(slots.items()):
        frame = _frame(js, im, fn)
        for c, an in enumerate(arts):
            art = _frame(js, im, an)
            cell = checker(s["frameW"], s["frameH"], 8).convert("RGBA")
            ax = int(round(s["cx"] - art.width / 2))
            ay = int(round(s["cy"] - art.height / 2))
            cell.alpha_composite(art, (ax, ay))  # arte ATRÁS da moldura
            cell.alpha_composite(frame)
            sheet.paste(cell.convert("RGB"), (8 + c * (fw + 8), 8 + r * (fh + 8)))
    sheet.save(DEBUG / "cards_art_in_frames.png")


def _nine_slices() -> dict[str, list[int]]:
    out = {}
    for p in sorted(MANIFESTS.glob("*.yaml")):
        cfg = yaml.safe_load(open(p))
        if cfg.get("enabled", True):
            out.update(cfg.get("nine_slice") or {})
    return out


def footprints() -> dict[str, list[int]]:
    p = MANIFESTS / "buildings.yaml"
    return (yaml.safe_load(open(p)).get("footprints") or {}) if p.exists() else {}


def ts_snippets() -> str:
    lines = ["\n/** Nine-slice: margens [esquerda, direita, cima, baixo] em px do quadro (Phaser: add.nineslice). */\n",
             "export const NINE_SLICE = {\n"]
    for n, v in sorted(_nine_slices().items()):
        lines.append(f"  '{n}': [{', '.join(str(int(x)) for x in v)}],\n")
    lines.append("} as const;\n\n")
    lines.append("/** Abertura de cada moldura de carta, em px do quadro da moldura. Desenhe card/art_N ATRÁS da\n"
                 " *  moldura, centrado em (cx, cy) a partir do canto superior esquerdo da moldura. A arte (132x192)\n"
                 " *  é um pouco maior que a abertura; a moldura cobre a sobra. */\n")
    lines.append("export const CARD_ART_SLOT = {\n")
    for n, s in card_slots().items():
        lines.append(f"  '{n}': {{ x: {s['x']}, y: {s['y']}, w: {s['w']}, h: {s['h']}, cx: {s['cx']}, cy: {s['cy']} }},\n")
    lines.append("} as const;\n\n")
    js, _ = _atlas("buildings")
    lines.append("/** Prédios/árvores: [largura, altura] da base com colisão (a partir de baixo, centrada) e\n"
                 " *  overheadSplitY (linha do quadro, a partir do topo, acima da qual o sprite cobre o jogador). */\n")
    lines.append("export const BUILDING_FOOTPRINTS = {\n")
    for n, (w, h) in sorted(footprints().items()):
        H = js["frames"][n]["sourceSize"]["h"] if js and n in js["frames"] else 0
        lines.append(f"  '{n}': {{ w: {w}, h: {h}, overheadSplitY: {max(H - h, 0)} }},\n")
    lines.append("} as const;\n")
    return "".join(lines)

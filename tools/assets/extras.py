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
    out = {}
    for p in sorted(MANIFESTS.glob("*.yaml")):
        cfg = yaml.safe_load(open(p))
        if cfg.get("enabled", True):
            out.update(cfg.get("footprints") or {})
    return out


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
                 " *  overheadSplitY (linha do quadro, a partir do topo, acima da qual o sprite cobre o jogador; 0 = nunca).\n"
                 " *  dx = deslocamento horizontal da base em relação ao centro do sprite. */\n")
    lines.append("export const BUILDING_FOOTPRINTS = {\n")
    for n, v in sorted(footprints().items()):
        w, h = v[0], v[1]
        dx = v[2] if len(v) > 2 else 0
        H = js["frames"][n]["sourceSize"]["h"] if js and n in js["frames"] else 0
        split = max(H - h, 0) if h else 0
        lines.append(f"  '{n}': {{ w: {w}, h: {h}, dx: {dx}, overheadSplitY: {split} }},\n")
    lines.append("} as const;\n")
    lines.append(album_ts())
    return "".join(lines)


def album_info():
    """ALBUM_SLOTS (8 espaços de carta) e ALBUM_PARTS (setas e fitas) em px do quadro ui/album_book."""
    js, im = _atlas("ui")
    if js is None or "ui/album_book" not in js["frames"]:
        return None, None
    from numpy.lib.stride_tricks import sliding_window_view
    from scipy import ndimage as ndi
    book = np.asarray(_frame(js, im, "ui/album_book")).astype(int)
    r, g, b = book[..., 0], book[..., 1], book[..., 2]
    slot = (r > 50) & (r < 95) & (g > 35) & (g < 70) & (b < 45) & (r - b > 25) & (book[..., 3] > 0)
    slot = ndi.binary_opening(slot, iterations=2)
    lbl, n = ndi.label(slot)
    slots = []
    for s in ndi.find_objects(lbl):
        if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 5000:
            slots.append((s[1].start, s[0].start, s[1].stop - s[1].start, s[0].stop - s[0].start))
    W = book.shape[1]
    left = sorted([s for s in slots if s[0] < W / 2], key=lambda q: (q[1] // 50, q[0]))
    right = sorted([s for s in slots if s[0] >= W / 2], key=lambda q: (q[1] // 50, q[0]))
    slots = left + right
    parts = {}
    win = sliding_window_view(book[..., :3], (6, 6, 3))[..., 0, :, :, :]
    for n in js["frames"]:
        if not n.startswith("ui/album_") or n == "ui/album_book":
            continue
        part = np.asarray(_frame(js, im, n)).astype(int)
        a = part[..., 3] > 0
        ys, xs = np.where(ndi.binary_erosion(a, iterations=4))
        if not len(ys):
            continue
        py, px = ys[len(ys) // 2] - 3, xs[len(xs) // 2] - 3
        patch = part[py:py + 6, px:px + 6, :3]
        hit = np.argwhere((win == patch).all(axis=(2, 3, 4)))
        if len(hit):
            parts[n] = (int(hit[0][1] - px), int(hit[0][0] - py), part.shape[1], part.shape[0])
    return slots, parts


def album_ts() -> str:
    slots, parts = album_info()
    if slots is None:
        return ""
    out = ["\n/** Álbum: os 8 espaços de carta em px do quadro 'ui/album_book' (x, y = canto superior esquerdo).\n"
           " *  Ordem: página esquerda 1-4 (linha por linha), página direita 5-8. */\n",
           "export const ALBUM_SLOTS = [\n"]
    out += [f"  {{ x: {x}, y: {y}, w: {w}, h: {h} }},\n" for x, y, w, h in slots]
    out.append("] as const;\n\n/** Posição das setas e fitas dentro do livro (para desenhar por cima, com destaque). */\n")
    out.append("export const ALBUM_PARTS = {\n")
    out += [f"  '{n}': {{ x: {x}, y: {y}, w: {w}, h: {h} }},\n" for n, (x, y, w, h) in sorted(parts.items())]
    out.append("} as const;\n")
    return "".join(out)


def album_preview():
    slots, parts = album_info()
    if slots is None:
        return
    js, im = _atlas("ui")
    cj, ci = _atlas("cards")
    book = _frame(js, im, "ui/album_book")
    W, H = book.size
    out = Image.new("RGBA", (W, H * 2 + 10), (40, 40, 48, 255))
    out.alpha_composite(book)
    d = ImageDraw.Draw(out)
    for i, (x, y, w, h) in enumerate(slots):
        d.rectangle([x, y, x + w - 1, y + h - 1], outline=(0, 255, 0, 255), width=2)
        d.text((x + 4, y + 4), str(i + 1), fill=(255, 255, 0, 255), font=font(18), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    for n, (x, y, w, h) in parts.items():
        d.rectangle([x, y, x + w - 1, y + h - 1], outline=(255, 0, 255, 255), width=2)
    # embaixo: cartas encaixadas (arte dentro da moldura, reduzida para caber no espaço)
    out.alpha_composite(book, (0, H + 10))
    if cj:
        for i, (x, y, w, h) in enumerate(slots):
            fr = FRAMES[i % 5]
            card = _frame(cj, ci, fr)
            s = CARD_SLOT_CACHE.get(fr) or card_slots()[fr]
            art = _frame(cj, ci, f"card/art_{i + 1}")
            c = Image.new("RGBA", card.size, (0, 0, 0, 0))
            c.alpha_composite(art, (int(s["cx"] - art.width / 2), int(s["cy"] - art.height / 2)))
            c.alpha_composite(card)
            f = min(w / c.width, h / c.height)
            c = c.resize((int(c.width * f), int(c.height * f)), Image.NEAREST)
            out.alpha_composite(c, (x + (w - c.width) // 2, H + 10 + y + (h - c.height) // 2))
    out.convert("RGB").save(DEBUG / "album_preview.png")


CARD_SLOT_CACHE: dict = {}

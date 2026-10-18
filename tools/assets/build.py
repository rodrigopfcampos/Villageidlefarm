#!/usr/bin/env python3
"""Pipeline de assets do Village Idle Farm.

Uso:
    python tools/assets/build.py --all            # tudo (folhas, atlas, mapa, layout, manifest)
    python tools/assets/build.py --sheet icons    # só uma folha (e o atlas dela)
    python tools/assets/build.py --map            # só mapa/overhead/layout
    python tools/assets/build.py --keep-going     # não para na primeira folha com erro

Lê assets-src/raw/ e tools/assets/manifests/*.yaml. Escreve em apps/game/public/assets/,
packages/shared/src/generated/assetKeys.ts e tools/assets/debug/ (prévias, fora do git).
O resultado é idempotente: rodar duas vezes gera os mesmos arquivos.
"""
from __future__ import annotations

import sys as _sys
_sys.dont_write_bytecode = True
import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "assets"
MANIFESTS = TOOLS / "manifests"
DEBUG = TOOLS / "debug"
RAW = ROOT / "assets-src" / "raw"
CLEAN = ROOT / "assets-src" / "clean"
TILED = ROOT / "assets-src" / "tiled"
MAPSRC = ROOT / "assets-src" / "map"
OUT = ROOT / "apps" / "game" / "public" / "assets"
GENERATED = ROOT / "packages" / "shared" / "src" / "generated"

CATEGORIES = ["icons", "cards", "animals", "characters", "pets", "vehicles"]


class BuildError(Exception):
    pass


# ----------------------------------------------------------------------------
# Cor: sRGB -> Lab (D65)
# ----------------------------------------------------------------------------
def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float32) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]], dtype=np.float32)
    xyz = c @ m.T
    xyz /= np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
    e = 216 / 24389
    k = 24389 / 27
    f = np.where(xyz > e, np.cbrt(xyz), (k * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def load_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def border_color(rgb: np.ndarray, w: int = 6) -> np.ndarray:
    b = np.concatenate([rgb[:w].reshape(-1, 3), rgb[-w:].reshape(-1, 3),
                        rgb[:, :w].reshape(-1, 3), rgb[:, -w:].reshape(-1, 3)])
    return np.median(b, axis=0)


# ----------------------------------------------------------------------------
# Passos 2-4: fundo por flood fill (Lab) a partir das bordas + sombras
# ----------------------------------------------------------------------------
def background_mask(rgb: np.ndarray, cfg: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Devolve (bg_mask, lab, lab_bg). bg_mask=True onde é fundo (ou sombra)."""
    h, w, _ = rgb.shape
    bg_rgb = border_color(rgb)
    lab = rgb_to_lab(rgb)
    lab_bg = rgb_to_lab(bg_rgb.reshape(1, 1, 3))[0, 0]
    dE = np.linalg.norm(lab - lab_bg, axis=-1)
    tol = float(cfg.get("bg_tolerance", 14))
    cand = dE < tol
    if cfg.get("bg_not_darker") is not None:
        # só aceita como fundo o que não for bem mais escuro (protege contornos pretos)
        cand &= lab[..., 0] >= lab_bg[0] - float(cfg["bg_not_darker"])
        cand |= dE < float(cfg.get("bg_tolerance_dark", 6))
    sh = cfg.get("shadow") or {}
    if sh.get("enabled", False):
        dab = np.linalg.norm(lab[..., 1:] - lab_bg[1:], axis=-1)
        L = lab[..., 0]
        cand |= (L < lab_bg[0] + 2) & (L > float(sh.get("min_L", 5))) & (dab < float(sh.get("max_ab", 6)))
    if cfg.get("barrier_L") is not None:
        # contorno preto vira "muro": o preenchimento não atravessa, mesmo com o borrão do JPG
        barrier = lab[..., 0] < float(cfg["barrier_L"])
        g = int(cfg.get("barrier_grow", 1))
        if g:
            barrier = ndi.binary_dilation(barrier, iterations=g)
        cand &= ~barrier
    forced = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in cfg.get("exclude", []) or []:
        forced[y0:y1, x0:x1] = True
    cand |= forced
    lbl, n = ndi.label(cand)  # 4-conectado: não vaza por diagonais do contorno
    edge = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
    edge = edge[edge > 0]
    bg = np.isin(lbl, edge)
    # buracos fechados com a cor exata do fundo (ex.: espaço entre braço e corpo)
    hole_area = int(cfg.get("hole_area", 60))
    strict = float(cfg.get("hole_tolerance", 5))
    if hole_area > 0:
        inner = cand & ~bg & (dE < tol)
        il, k = ndi.label(inner)
        if k:
            areas = ndi.sum(np.ones_like(il), il, index=np.arange(1, k + 1))
            means = ndi.mean(dE, il, index=np.arange(1, k + 1))
            keep = np.zeros(k + 1, bool)
            keep[1:] = (areas >= hole_area) & (means < strict)
            bg |= keep[il]
    bg |= forced
    return bg, lab, lab_bg


def clean_sprite_mask(sprite: np.ndarray, lab: np.ndarray, lab_bg: np.ndarray, cfg: dict) -> np.ndarray:
    # remove pontinhos soltos
    speck = int(cfg.get("speck_area", 6))
    lbl, n = ndi.label(sprite, structure=np.ones((3, 3)))
    if n:
        areas = ndi.sum(np.ones_like(lbl), lbl, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = areas >= speck
        sprite = keep[lbl]
    # passo 6: auréola de 1 px do JPG (pixel de borda com cor ainda parecida com o fundo)
    halo_tol = float(cfg.get("halo_tolerance", 22))
    dE = np.linalg.norm(lab - lab_bg, axis=-1)
    for _ in range(int(cfg.get("halo_passes", 1))):
        edge = sprite & ndi.binary_dilation(~sprite, structure=np.ones((3, 3)))
        sprite = sprite & ~(edge & (dE < halo_tol))
    return sprite


# ----------------------------------------------------------------------------
# Passo 5: separar sprites, juntar pedaços, agrupar em linhas
# ----------------------------------------------------------------------------
@dataclass
class Piece:
    x0: int
    y0: int
    x1: int
    y1: int
    area: int
    labels: list = field(default_factory=list)

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2

    @property
    def cy(self):
        return (self.y0 + self.y1) / 2


def box_gap(a: Piece, b: Piece) -> float:
    dx = max(0, max(a.x0, b.x0) - min(a.x1, b.x1))
    dy = max(0, max(a.y0, b.y0) - min(a.y1, b.y1))
    return math.hypot(dx, dy)


def find_pieces(sprite: np.ndarray, cfg: dict) -> tuple[list[Piece], np.ndarray]:
    lbl, n = ndi.label(sprite, structure=np.ones((3, 3)))
    objs = ndi.find_objects(lbl)
    areas = ndi.sum(np.ones_like(lbl), lbl, index=np.arange(1, n + 1)) if n else []
    pieces = [Piece(s[1].start, s[0].start, s[1].stop, s[0].stop, int(areas[i]), [i + 1])
              for i, s in enumerate(objs) if s is not None]
    md = float(cfg.get("merge_distance", 10))
    big = float(cfg.get("merge_big_area", 400))
    # junta pedaços pequenos (asas, latido, faíscas) ao sprite mais próximo; e
    # pedaços grandes entre si só se estiverem colados (gap <= merge_distance_big)
    mdb = float(cfg.get("merge_distance_big", 2))
    def union(a: Piece, b: Piece):
        a.x0, a.y0 = min(a.x0, b.x0), min(a.y0, b.y0)
        a.x1, a.y1 = max(a.x1, b.x1), max(a.y1, b.y1)
        a.area += b.area
        a.labels += b.labels

    def merge_all(ps: list[Piece], lim: float) -> list[Piece]:
        changed = True
        while changed:
            changed = False
            for i in range(len(ps)):
                for j in range(i + 1, len(ps)):
                    if box_gap(ps[i], ps[j]) <= lim:
                        union(ps[i], ps.pop(j))
                        changed = True
                        break
                if changed:
                    break
        return ps

    def touching(a: Piece, b: Piece, lim: float) -> bool:
        if box_gap(a, b) > lim:
            return False
        r = int(math.ceil(lim)) + 1
        x0, y0 = max(min(a.x0, b.x0) - r, 0), max(min(a.y0, b.y0) - r, 0)
        x1, y1 = max(a.x1, b.x1) + r, max(a.y1, b.y1) + r
        sub = lbl[y0:y1, x0:x1]
        ma, mb = np.isin(sub, a.labels), np.isin(sub, b.labels)
        if lim < 1:
            return False
        da = ndi.distance_transform_edt(~ma)
        return bool((da[mb] <= lim).any())

    # partes grandes só se juntam se os PIXELS estiverem a <= merge_distance_big (não as caixas)
    bigs = [p for p in pieces if p.area >= big]
    changed = True
    while changed:
        changed = False
        for i in range(len(bigs)):
            for j in range(i + 1, len(bigs)):
                if touching(bigs[i], bigs[j], mdb):
                    union(bigs[i], bigs.pop(j))
                    changed = True
                    break
            if changed:
                break
    smalls = [p for p in pieces if p.area < big]
    # cada pedaço pequeno vai para o sprite grande mais próximo, medindo a distância até os
    # pixels de verdade (não até a caixa), sem efeito cascata
    loose = []
    if bigs and smalls:
        amap = np.zeros(lbl.shape, np.int32)
        for k, b in enumerate(bigs):
            amap[np.isin(lbl, b.labels)] = k + 1
        dist, (iy, ix) = ndi.distance_transform_edt(amap == 0, return_indices=True)
        for s in smalls:
            ys, xs = np.where(lbl[s.y0:s.y1, s.x0:s.x1] == s.labels[0])
            ys, xs = ys + s.y0, xs + s.x0
            j = int(np.argmin(dist[ys, xs]))
            d = dist[ys[j], xs[j]]
            if d <= md:
                union(bigs[amap[iy[ys[j], xs[j]], ix[ys[j], xs[j]]] - 1], s)
            else:
                loose.append(s)
    else:
        loose = smalls
    pieces = bigs + merge_all(loose, md)
    minA = int(cfg.get("min_piece_area", 300))
    pieces = [p for p in pieces if p.area >= minA]
    return pieces, lbl


def group_rows(pieces: list[Piece], nrows: int) -> list[list[Piece]]:
    if not pieces:
        return []
    ps = sorted(pieces, key=lambda p: p.cy)
    if nrows <= 1 or len(ps) <= 1:
        return [sorted(ps, key=lambda p: p.cx)]
    gaps = [(ps[i + 1].cy - ps[i].cy, i) for i in range(len(ps) - 1)]
    cuts = sorted(i for _, i in sorted(gaps, reverse=True)[: nrows - 1])
    rows, start = [], 0
    for c in cuts:
        rows.append(ps[start:c + 1])
        start = c + 1
    rows.append(ps[start:])
    return [sorted(r, key=lambda p: p.cx) for r in rows]


def reassign_pieces(flat: list[Piece], names: list[str], overrides: dict, lbl: np.ndarray, cfg: dict):
    """Sprites com accept_pieces: false devolvem os pedaços pequenos (faíscas de outra carta,
    por exemplo) para o sprite vizinho mais próximo."""
    big = float(cfg.get("merge_big_area", 400))
    objs = ndi.find_objects(lbl)
    for p, name in zip(flat, names):
        if (overrides.get(name) or {}).get("accept_pieces", True):
            continue
        keep, give = [], []
        for l in p.labels:
            sl = objs[l - 1]
            area = int((lbl[sl] == l).sum())
            (keep if area >= big else give).append(l)
        p.labels = keep
        boxes = [objs[l - 1] for l in keep]
        p.y0, p.y1 = min(b[0].start for b in boxes), max(b[0].stop for b in boxes)
        p.x0, p.x1 = min(b[1].start for b in boxes), max(b[1].stop for b in boxes)
        for l in give:
            sl = objs[l - 1]
            q = Piece(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, 0)
            other = min((o for o in flat if o is not p), key=lambda o: box_gap(o, q))
            other.labels.append(l)
            other.x0, other.y0 = min(other.x0, q.x0), min(other.y0, q.y0)
            other.x1, other.y1 = max(other.x1, q.x1), max(other.y1, q.y1)


def font(size: int):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def draw_boxes(rgb: np.ndarray, sprite: np.ndarray, rows: list[list[Piece]], names: list[str] | None,
               path: Path, error: str | None = None):
    im = Image.fromarray(rgb).convert("RGB")
    ov = np.asarray(im).copy()
    ov[~sprite] = (ov[~sprite] * 0.35 + np.array([255, 0, 255]) * 0.25).astype(np.uint8)
    im = Image.fromarray(ov)
    d = ImageDraw.Draw(im)
    f = font(22)
    k = 0
    for r, row in enumerate(rows):
        for c, p in enumerate(row):
            d.rectangle([p.x0, p.y0, p.x1 - 1, p.y1 - 1], outline=(0, 255, 0), width=2)
            label = f"{k}"
            if names and k < len(names):
                label += " " + names[k].split("/", 1)[-1] if names[k].startswith(("icon/", "card/")) else " " + names[k]
            d.text((p.x0 + 2, p.y0 + 1), label, fill=(255, 255, 0), font=f, stroke_width=2, stroke_fill=(0, 0, 0))
            k += 1
    if error:
        d.text((10, im.height - 40), error, fill=(255, 60, 60), font=font(28), stroke_width=2, stroke_fill=(0, 0, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)


# ----------------------------------------------------------------------------
# Passo 6 (glow) e recorte
# ----------------------------------------------------------------------------
def glow_alpha(rgb: np.ndarray, bg_rgb: np.ndarray, threshold: float) -> tuple[np.ndarray, np.ndarray]:
    """Transparência pela luminosidade sobre fundo escuro: a = max(canal - fundo)/(255 - fundo).
    A cor é recalculada para tirar a mistura com o fundo: c = bg + (orig - bg)/a."""
    c = rgb.astype(np.float32)
    bg = bg_rgb.astype(np.float32)
    a = np.max((c - bg) / (255.0 - bg), axis=-1)
    a = np.clip(a, 0, 1)
    a = np.where(a < threshold, 0, a)
    safe = np.maximum(a, 1e-3)[..., None]
    col = np.clip(bg + (c - bg) / safe, 0, 255)
    return a, col


def interior_mask(crop_rgb: np.ndarray, crop_lab: np.ndarray, solid: np.ndarray, cfg: dict) -> np.ndarray:
    """Miolo da carta: componentes grandes da cor do centro que não tocam a borda externa."""
    h, w = solid.shape
    ic = cfg.get("interior") or {}
    tol = float(ic.get("tolerance", 14))
    cy, cx = int(h * 0.42), w // 2
    ref = np.median(crop_lab[cy - 10:cy + 10, cx - 10:cx + 10].reshape(-1, 3), axis=0)
    dE = np.linalg.norm(crop_lab - ref, axis=-1)
    m = (dE < tol) & solid
    lbl, n = ndi.label(m)
    out = np.zeros_like(m)
    minA = int(ic.get("min_area", 800))
    for i, s in enumerate(ndi.find_objects(lbl)):
        if s is None:
            continue
        reg = lbl[s] == i + 1
        if reg.sum() < minA:
            continue
        if s[0].start <= 2 or s[1].start <= 2 or s[0].stop >= h - 2 or s[1].stop >= w - 2:
            continue
        out[s] |= reg
    # auréola do miolo: pixels vizinhos ainda parecidos com o roxo
    for _ in range(int(ic.get("halo_passes", 2))):
        ring = ndi.binary_dilation(out, structure=np.ones((3, 3))) & ~out & solid
        out |= ring & (dE < tol * 1.8)
    return out


# ----------------------------------------------------------------------------
# Passo 7: redução
# ----------------------------------------------------------------------------
def resize_rgba_premult(rgba: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    a = rgba[..., 3].astype(np.float32) / 255.0
    chans = []
    for i in range(3):
        ch = Image.fromarray(rgba[..., i].astype(np.float32) * a, mode="F").resize(size, Image.BOX)
        chans.append(np.asarray(ch))
    A = np.asarray(Image.fromarray(a, mode="F").resize(size, Image.BOX))
    rgb = np.stack(chans, -1) / np.maximum(A, 1e-4)[..., None]
    return np.dstack([np.clip(rgb, 0, 255), np.clip(A * 255, 0, 255)]).astype(np.float32)


def binarize_alpha(rgba: np.ndarray, thr: float = 0.5) -> np.ndarray:
    out = rgba.copy()
    out[..., 3] = np.where(rgba[..., 3] >= thr * 255, 255, 0)
    out[out[..., 3] == 0, :3] = 0
    return out


def quantize(rgba: np.ndarray, ncolors: int) -> np.ndarray:
    if ncolors <= 0:
        return rgba
    op = rgba[..., 3] > 0
    if op.sum() == 0:
        return rgba
    px = rgba[op][:, :3].astype(np.uint8)
    im = Image.fromarray(px.reshape(-1, 1, 3), "RGB")
    q = im.quantize(colors=min(ncolors, 256), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    qq = np.asarray(q.convert("RGB")).reshape(-1, 3)
    out = rgba.copy()
    out[op, :3] = qq
    return out


def estimate_pitch(crop_rgb: np.ndarray, mask: np.ndarray, lo=8.0, hi=12.0) -> float:
    g = crop_rgb.astype(np.float32).mean(-1)
    best = (1e18, 10.0)
    for p in np.arange(lo, hi + 1e-6, 0.05):
        cost = grid_cost(g, p)[0]
        if cost < best[0]:
            best = (cost, float(p))
    return best[1]


def grid_cost(g: np.ndarray, p: float):
    h, w = g.shape
    best = (1e18, 0.0, 0.0)
    for ox in np.arange(0, p, 1.0):
        for oy in np.arange(0, p, 1.0):
            xs = np.floor((np.arange(w) - ox) / p).astype(int)
            ys = np.floor((np.arange(h) - oy) / p).astype(int)
            cell = (ys[:, None] - ys.min()) * (xs.max() - xs.min() + 2) + (xs[None, :] - xs.min())
            cnt = np.bincount(cell.ravel())
            s = np.bincount(cell.ravel(), g.ravel())
            s2 = np.bincount(cell.ravel(), (g * g).ravel())
            var = (s2 - s * s / np.maximum(cnt, 1)).sum()
            if var < best[0]:
                best = (var, ox, oy)
    return best


def grid_downsample(crop_rgb: np.ndarray, mask: np.ndarray, p: float) -> np.ndarray:
    g = crop_rgb.astype(np.float32).mean(-1)
    _, ox, oy = grid_cost(g, p)
    h, w = mask.shape
    nx = int(math.ceil((w - ox) / p)) + 1
    ny = int(math.ceil((h - oy) / p)) + 1
    out = np.zeros((ny + 1, nx + 1, 4), np.float32)
    for j in range(-1, ny):
        for i in range(-1, nx):
            x0, x1 = ox + i * p, ox + (i + 1) * p
            y0, y1 = oy + j * p, oy + (j + 1) * p
            # miolo da célula (50% central) para fugir das bordas borradas do JPG
            cx0, cx1 = int(round(x0 + p * 0.25)), int(round(x1 - p * 0.25))
            cy0, cy1 = int(round(y0 + p * 0.25)), int(round(y1 - p * 0.25))
            cx0, cy0 = max(cx0, 0), max(cy0, 0)
            cx1, cy1 = min(cx1, w), min(cy1, h)
            if cx1 <= cx0 or cy1 <= cy0:
                continue
            m = mask[cy0:cy1, cx0:cx1]
            if m.mean() < 0.5:
                continue
            col = np.median(crop_rgb[cy0:cy1, cx0:cx1][m], axis=0)
            out[j + 1, i + 1] = (*col, 255)
    # recorta linhas/colunas vazias
    op = out[..., 3] > 0
    ys, xs = np.where(op)
    return out[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


# ----------------------------------------------------------------------------
# Folha completa
# ----------------------------------------------------------------------------
@dataclass
class Sprite:
    name: str
    rgba: np.ndarray       # float32 HxWx4 já na escala final
    anchor: str


def foot_anchor(alpha: np.ndarray, frac: float = 0.12) -> tuple[float, float]:
    ys, xs = np.where(alpha > 0)
    y1 = ys.max()
    h = y1 - ys.min() + 1
    band = ys >= y1 - max(2, int(h * frac))
    return float(xs[band].min() + xs[band].max() + 1) / 2.0, float(y1 + 1)


def process_sheet(cfg: dict, sheet_name: str) -> tuple[list[Sprite], dict]:
    src = cfg["source"]
    path = CLEAN / src if (CLEAN / src).exists() else RAW / src
    if not path.exists():
        raise BuildError(f"[{sheet_name}] arquivo de origem não encontrado: {src}")
    rgb = load_rgb(path)
    bg, lab, lab_bg = background_mask(rgb, cfg)
    sprite = clean_sprite_mask(~bg, lab, lab_bg, cfg)
    seg = cfg.get("segment")
    if seg:
        # separação feita com outra tolerância (ex.: cartas: o halo do fogo não pode grudar as cartas)
        seg_bg = background_mask(rgb, {**cfg, **seg})[0]
        seg_sprite = clean_sprite_mask(~seg_bg, lab, lab_bg, cfg)
    else:
        seg_bg, seg_sprite = bg, sprite
    pieces, lbl = find_pieces(seg_sprite, cfg)
    rows_expected = cfg["rows"]
    rows = group_rows(pieces, len(rows_expected))
    names = cfg["names"]
    got = [len(r) for r in rows]
    boxes_png = DEBUG / f"{sheet_name}_boxes.png"
    if got != list(rows_expected) or len(names) != sum(rows_expected):
        msg = f"contagem não bate: esperado {rows_expected} ({len(names)} nomes), encontrado {got}"
        draw_boxes(rgb, seg_sprite, rows, None, boxes_png, msg)
        raise BuildError(f"[{sheet_name}] {msg}. Veja {boxes_png}")
    draw_boxes(rgb, seg_sprite, rows, names, boxes_png)

    bg_rgb = border_color(rgb)
    flat = [p for r in rows for p in r]
    overrides = cfg.get("overrides", {}) or {}
    reassign_pieces(flat, names, overrides, lbl, cfg)
    pad = int(cfg.get("crop_pad", 4))
    H, W = sprite.shape
    raw_sprites = []
    bg_glow = None
    for p, name in zip(flat, names):
        ov = overrides.get(name, {}) or {}
        x0, y0 = max(p.x0 - pad, 0), max(p.y0 - pad, 0)
        x1, y1 = min(p.x1 + pad, W), min(p.y1 + pad, H)
        own = np.isin(lbl[y0:y1, x0:x1], p.labels)
        if seg:
            region = ndi.binary_fill_holes(ndi.binary_dilation(own, iterations=int(seg.get("grow", 5))))
            own = region & sprite[y0:y1, x0:x1]
        else:
            own &= sprite[y0:y1, x0:x1]
        own = ndi.binary_fill_holes(own) if cfg.get("fill_holes", False) else own
        rc = cfg.get("restore_enclosed")
        if rc:
            # partes escuras quase da cor do fundo (rabo da galinha preta) cercadas pelo contorno:
            # fecha o contorno, preenche, e devolve só pixels que não são fundo puro nem sombra
            r = int(rc.get("close", 2))
            st = ndi.generate_binary_structure(2, 1)
            closed = ndi.binary_closing(np.pad(own, r + 1), structure=st, iterations=r)[r + 1:-r - 1, r + 1:-r - 1]
            filled = ndi.binary_fill_holes(closed | own)
            cl = lab[y0:y1, x0:x1]
            dEc = np.linalg.norm(cl - lab_bg, axis=-1)
            dab = np.linalg.norm(cl[..., 1:] - lab_bg[1:], axis=-1)
            shadowish = (dab < float(rc.get("shadow_ab", 5))) & (cl[..., 0] < lab_bg[0] + 1)
            add = filled & ~own & (dEc >= float(rc.get("min_dE", 4.5))) & ~shadowish
            own = own | add
        crop = rgb[y0:y1, x0:x1].astype(np.float32)
        clab = lab[y0:y1, x0:x1]
        alpha = own.astype(np.float32)
        color = crop.copy()
        gcfg = cfg.get("glow") or {}
        if ov.get("glow", False):
            # modo glow: fundo recalculado com tolerância alta (só cores não mais escuras que o fundo),
            # e o que sobrar perto do sprite vira transparência parcial pela luminosidade
            if bg_glow is None:
                bg_glow = seg_bg if seg else background_mask(rgb, {**cfg, "bg_tolerance": gcfg.get("bg_tolerance", 30),
                                                                   "bg_not_darker": gcfg.get("not_darker", 4)})[0]
            own = own & ~bg_glow[y0:y1, x0:x1]
            alpha = own.astype(np.float32)
            ga, gcol = glow_alpha(rgb[y0:y1, x0:x1], bg_rgb, float(gcfg.get("threshold", 0.06)))
            others = seg_sprite[y0:y1, x0:x1] & ~np.isin(lbl[y0:y1, x0:x1], p.labels)
            gl = ~own & (ga > 0) & ~others
            near = ndi.distance_transform_edt(~own) <= float(gcfg.get("radius", 40))
            gl &= near
            alpha = np.where(gl, ga, alpha)
            color = np.where(gl[..., None], gcol, color)
        if ov.get("interior", cfg.get("interior", {}).get("enabled", False) if cfg.get("interior") else False):
            hole = interior_mask(crop, clab, own, cfg)
            alpha[hole] = 0
        rgba = np.dstack([color, alpha * 255]).astype(np.float32)
        raw_sprites.append((name, rgba, crop, own))

    sprites = scale_sprites(raw_sprites, cfg, sheet_name)
    info = {"rows": got, "bg": bg_rgb.tolist()}
    return sprites, info


def group_of(name: str, cfg: dict) -> str:
    groups = cfg.get("groups") or {}
    ent = name.split("/")[0]
    for g, gc in groups.items():
        if ent in (gc.get("entities") or [g]):
            return g
    return ent


def tight(rgba: np.ndarray) -> np.ndarray:
    ys, xs = np.where(rgba[..., 3] > 0)
    if len(ys) == 0:
        raise BuildError("sprite vazio depois do recorte")
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def scale_sprites(raw, cfg, sheet_name) -> list[Sprite]:
    sc = cfg.get("scale", {})
    mode = sc.get("mode", "fit")
    anchor = cfg.get("frame", {}).get("anchor", "center")
    nq = int(cfg.get("quantize", 0))
    keep_soft = bool(cfg.get("glow"))
    out: list[Sprite] = []
    if mode == "grid":
        pitch = sc.get("pitch", "auto")
        if pitch == "auto":
            # estima com os 4 primeiros sprites e usa a mediana
            ests = [estimate_pitch(c, o) for _, _, c, o in raw[:4]]
            pitch = float(np.median(ests))
            print(f"  [{sheet_name}] grade estimada: {pitch:.2f} px por pixel de arte ({ests})")
        for name, rgba, crop, own in raw:
            small = grid_downsample(crop, own, float(pitch))
            out.append(Sprite(name, small, anchor))
        return out

    # fatores de escala
    factors: dict[str, float] = {}
    tights = {name: tight(rgba) for name, rgba, _, _ in raw}
    if mode == "sheet_height":
        hs = [t.shape[0] for t in tights.values()]
        f = float(sc["target"]) / float(np.median(hs))
        factors = {n: f for n in tights}
    elif mode == "ref_height":
        ref = tights[sc["ref"]]
        f = float(sc["target"]) / ref.shape[0]
        factors = {n: f for n in tights}
    elif mode == "fit":
        groups: dict[str, list[str]] = {}
        for n in tights:
            groups.setdefault(group_of(n, cfg), []).append(n)
        margin = int(sc.get("margin", 2))
        for g, ns in groups.items():
            fw, fh = frame_nominal(cfg, g)
            f = min(min((fw - margin) / tights[n].shape[1], (fh - margin) / tights[n].shape[0]) for n in ns)
            for n in ns:
                factors[n] = f
    else:
        raise BuildError(f"modo de escala desconhecido: {mode}")
    for name, rgba, _, _ in raw:
        t = tights[name]
        f = factors[name]
        nw, nh = max(1, round(t.shape[1] * f)), max(1, round(t.shape[0] * f))
        small = resize_rgba_premult(t, (nw, nh))
        if keep_soft:
            # cartas: a moldura sólida fica binária, o brilho mantém transparência parcial
            a = small[..., 3]
            small[..., 3] = np.where(a < 10, 0, a)
            small[small[..., 3] == 0, :3] = 0
        else:
            small = binarize_alpha(small, float(cfg.get("alpha_threshold", 0.5)))
        small = quantize(small, nq) if not keep_soft else small
        out.append(Sprite(name, tight(small), anchor))
    return out


def frame_nominal(cfg: dict, group: str) -> tuple[int, int]:
    groups = cfg.get("groups") or {}
    if group in groups and "size" in groups[group]:
        return tuple(groups[group]["size"])
    return tuple(cfg["frame"]["size"])


# ----------------------------------------------------------------------------
# Passo 8: quadros de tamanho fixo
# ----------------------------------------------------------------------------
def make_frames(sprites: list[Sprite], cfg: dict) -> tuple[dict[str, np.ndarray], dict]:
    groups: dict[str, list[Sprite]] = {}
    for s in sprites:
        groups.setdefault(group_of(s.name, cfg), []).append(s)
    frames, meta = {}, {}
    for g, ss in groups.items():
        fw, fh = frame_nominal(cfg, g)
        anchor = ss[0].anchor
        if anchor in ("bottom", "feet"):
            need_w, need_h = 0, 0
            anchors = {}
            for s in ss:
                if anchor == "feet":
                    ax, ay = foot_anchor(s.rgba[..., 3])
                else:
                    ax, ay = s.rgba.shape[1] / 2.0, float(s.rgba.shape[0])
                anchors[s.name] = (ax, ay)
                need_w = max(need_w, 2 * math.ceil(max(ax, s.rgba.shape[1] - ax)))
                need_h = max(need_h, s.rgba.shape[0])
            FW, FH = max(fw, need_w + (need_w % 2)), max(fh, need_h)
            for s in ss:
                ax, ay = anchors[s.name]
                ox = int(round(FW / 2 - ax))
                oy = FH - s.rgba.shape[0]
                frames[s.name] = paste(s.rgba, FW, FH, ox, oy)
            meta[g] = {"w": FW, "h": FH, "pivot": [0.5, 1.0]}
        else:
            FW = max(fw, max(s.rgba.shape[1] for s in ss))
            FH = max(fh, max(s.rgba.shape[0] for s in ss))
            for s in ss:
                ox = (FW - s.rgba.shape[1]) // 2
                oy = (FH - s.rgba.shape[0]) // 2
                frames[s.name] = paste(s.rgba, FW, FH, ox, oy)
            meta[g] = {"w": FW, "h": FH, "pivot": [0.5, 0.5]}
    return frames, meta


def paste(rgba: np.ndarray, FW: int, FH: int, ox: int, oy: int) -> np.ndarray:
    out = np.zeros((FH, FW, 4), np.uint8)
    h, w = rgba.shape[:2]
    out[oy:oy + h, ox:ox + w] = np.clip(np.round(rgba), 0, 255).astype(np.uint8)
    return out


# ----------------------------------------------------------------------------
# Passo 9: atlas (JSON Hash do Phaser)
# ----------------------------------------------------------------------------
def pack_atlas(frames: dict[str, np.ndarray], pad: int = 2, extrude: int = 1, max_size: int = 2048):
    names = sorted(frames, key=lambda n: (-frames[n].shape[0], n))
    best = None
    for W in (128, 256, 512, 1024, 2048):
        if W > max_size:
            break
        x = y = shelf_h = 0
        pos = {}
        ok = True
        for n in names:
            h, w = frames[n].shape[:2]
            cw, ch = w + 2 * (pad + extrude) - pad, h + 2 * (pad + extrude) - pad
            if cw > W:
                ok = False
                break
            if x + cw > W:
                y += shelf_h
                x = shelf_h = 0
            pos[n] = (x + extrude, y + extrude)
            x += cw + pad
            shelf_h = max(shelf_h, ch + pad)
        Ht = y + shelf_h
        if not ok or Ht > max_size:
            continue
        Ht = 1 << max(0, (Ht - 1).bit_length())
        area = W * Ht
        if best is None or (area, max(W, Ht)) < (best[0], max(best[1], best[2])):
            best = (area, W, Ht, pos)
    if best is None:
        raise BuildError("atlas não cabe em 2048x2048")
    _, W, H, pos = best
    atlas = np.zeros((H, W, 4), np.uint8)
    for n, (x, y) in pos.items():
        f = frames[n]
        h, w = f.shape[:2]
        atlas[y:y + h, x:x + w] = f
        # extrusão de 1 px (evita linhas finas ao filtrar)
        for e in range(1, extrude + 1):
            atlas[y - e, x:x + w] = f[0]
            atlas[y + h - 1 + e, x:x + w] = f[-1]
            atlas[y:y + h, x - e] = f[:, 0]
            atlas[y:y + h, x + w - 1 + e] = f[:, -1]
            atlas[y - e, x - e] = f[0, 0]
            atlas[y - e, x + w - 1 + e] = f[0, -1]
            atlas[y + h - 1 + e, x - e] = f[-1, 0]
            atlas[y + h - 1 + e, x + w - 1 + e] = f[-1, -1]
    return atlas, pos


def write_atlas(cat: str, frames: dict[str, np.ndarray], fmeta: dict[str, dict], aliases: dict[str, str] | None = None):
    atlas, pos = pack_atlas(frames)
    (OUT / "atlas").mkdir(parents=True, exist_ok=True)
    png = OUT / "atlas" / f"atlas_{cat}.png"
    Image.fromarray(atlas, "RGBA").save(png, optimize=True)
    js = {"frames": {}, "meta": {"app": "village-idle-farm tools/assets/build.py", "version": "1.0",
                                 "image": f"atlas_{cat}.png", "format": "RGBA8888",
                                 "size": {"w": atlas.shape[1], "h": atlas.shape[0]}, "scale": "1"}}
    for n in sorted(frames):
        x, y = pos[n]
        h, w = frames[n].shape[:2]
        piv = fmeta[n]["pivot"]
        js["frames"][n] = {"frame": {"x": x, "y": y, "w": w, "h": h}, "rotated": False, "trimmed": False,
                           "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
                           "sourceSize": {"w": w, "h": h},
                           "pivot": {"x": piv[0], "y": piv[1]}}
    for a, t in sorted((aliases or {}).items()):
        if t not in js["frames"]:
            raise BuildError(f"alias {a} aponta para quadro inexistente {t}")
        if a in js["frames"]:
            raise BuildError(f"alias {a} repete um quadro que já existe")
        js["frames"][a] = dict(js["frames"][t])
    with open(OUT / "atlas" / f"atlas_{cat}.json", "w") as fp:
        json.dump(js, fp, indent=1, sort_keys=False)
        fp.write("\n")
    contact_sheet(cat, frames)
    return js


def checker(w: int, h: int, s: int = 8) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w]
    c = (((xx // s) + (yy // s)) % 2).astype(np.uint8)
    arr = np.where(c[..., None] == 1, np.array([200, 200, 200], np.uint8), np.array([150, 150, 150], np.uint8))
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def contact_sheet(cat: str, frames: dict[str, np.ndarray]):
    names = list(frames)
    fw = max(f.shape[1] for f in frames.values())
    fh = max(f.shape[0] for f in frames.values())
    zoom = 3 if fw <= 64 else 2 if fw <= 128 else 1
    cols = max(1, min(len(names), 1800 // (fw * zoom + 12)))
    rows = math.ceil(len(names) / cols)
    cw, ch = fw * zoom + 12, fh * zoom + 30
    sheet = Image.new("RGB", (cols * cw, rows * ch), (40, 40, 48))
    d = ImageDraw.Draw(sheet)
    f = font(12)
    for i, n in enumerate(names):
        fr = Image.fromarray(frames[n], "RGBA")
        fr = fr.resize((fr.width * zoom, fr.height * zoom), Image.NEAREST)
        bgc = checker(fr.width, fr.height, 4 * zoom).convert("RGBA")
        bgc.alpha_composite(fr)
        x, y = (i % cols) * cw + 6, (i // cols) * ch + 4
        sheet.paste(bgc.convert("RGB"), (x, y))
        d.text((x, y + fr.height + 2), n, fill=(255, 255, 255), font=f)
    sheet.save(DEBUG / f"contact_{cat}.png")


# ----------------------------------------------------------------------------
# Manifest, chaves TS
# ----------------------------------------------------------------------------
def write_manifest():
    man = {"map": {"image": "map/farm.webp", "overhead": "map/overhead.png", "layout": "map/farm_layout.tmj",
                   "width": 2576, "height": 1438},
           "atlases": [{"key": f"atlas_{c}", "png": f"atlas/atlas_{c}.png", "json": f"atlas/atlas_{c}.json"}
                       for c in CATEGORIES]}
    with open(OUT / "manifest.json", "w") as fp:
        json.dump(man, fp, indent=2)
        fp.write("\n")


def ts_list(name: str, items: list[str]) -> str:
    body = "".join(f"  '{i}',\n" for i in items)
    return f"export const {name} = [\n{body}] as const;\n"


def write_asset_keys():
    frames_by_cat = {}
    sizes = {}
    for c in CATEGORIES:
        p = OUT / "atlas" / f"atlas_{c}.json"
        if p.exists():
            js = json.load(open(p))
            frames_by_cat[c] = sorted(js["frames"])
            for n, fr in js["frames"].items():
                ent = n.split("/")[0] if c not in ("icons", "cards") else n
                if c in ("icons",):
                    ent = "icon"
                if c in ("cards",):
                    ent = "card"
                sizes.setdefault(c, {})[ent] = [fr["sourceSize"]["w"], fr["sourceSize"]["h"],
                                                 fr["pivot"]["x"], fr["pivot"]["y"]]
        else:
            frames_by_cat[c] = []
    lines = ["// GERADO por tools/assets/build.py — não edite à mão.\n",
             "// Para mudar, edite tools/assets/manifests/*.yaml e rode: python tools/assets/build.py --all\n\n",
             "export const ATLAS_KEYS = {\n" + "".join(f"  {c}: 'atlas_{c}',\n" for c in CATEGORIES) + "} as const;\n",
             "export type AtlasKey = (typeof ATLAS_KEYS)[keyof typeof ATLAS_KEYS];\n\n",
             "export const ASSET_MANIFEST_URL = 'assets/manifest.json';\n",
             "export const MAP_KEYS = { ground: 'map_ground', overhead: 'map_overhead', layout: 'map_layout' } as const;\n",
             "export const MAP_SIZE = { width: 2576, height: 1438, tile: 32 } as const;\n\n"]
    consts = {"icons": "ICON_FRAMES", "cards": "CARD_FRAMES", "animals": "ANIMAL_FRAMES",
              "characters": "CHARACTER_FRAMES", "pets": "PET_FRAMES", "vehicles": "VEHICLE_FRAMES"}
    for c in CATEGORIES:
        lines.append(ts_list(consts[c], frames_by_cat[c]))
        lines.append(f"export type {consts[c].title().replace('_', '')[:-6]}Frame = (typeof {consts[c]})[number];\n\n")
    lines.append("/** Atlas de cada quadro (para this.add.sprite(x, y, FRAME_ATLAS[f], f)). */\n")
    lines.append("export const FRAME_ATLAS: Record<string, AtlasKey> = {\n")
    for c in CATEGORIES:
        for n in frames_by_cat[c]:
            lines.append(f"  '{n}': 'atlas_{c}',\n")
    lines.append("};\n\n")
    lines.append("/** Tamanho fixo do quadro [largura, altura, pivotX, pivotY] por entidade. pivot (0.5,1) = pés. */\n")
    lines.append("export const FRAME_SIZES = {\n")
    for c in CATEGORIES:
        for ent, v in sorted(sizes.get(c, {}).items()):
            lines.append(f"  '{ent}': [{v[0]}, {v[1]}, {v[2]}, {v[3]}],\n")
    lines.append("} as const;\n")
    GENERATED.mkdir(parents=True, exist_ok=True)
    with open(GENERATED / "assetKeys.ts", "w") as fp:
        fp.write("".join(lines))


# ----------------------------------------------------------------------------
# Execução
# ----------------------------------------------------------------------------
def load_manifests() -> dict[str, dict]:
    out = {}
    for p in sorted(MANIFESTS.glob("*.yaml")):
        cfg = yaml.safe_load(open(p))
        out[cfg.get("sheet", p.stem)] = cfg
    return out


def build_sheets(selected: list[str] | None, keep_going: bool) -> list[str]:
    mans = load_manifests()
    by_cat: dict[str, list[str]] = {}
    for n, cfg in mans.items():
        by_cat.setdefault(cfg["category"], []).append(n)
    errors = []
    for cat, sheets in sorted(by_cat.items()):
        if selected and not any(s in selected for s in sheets) and cat not in selected:
            continue
        frames, fmeta, aliases = {}, {}, {}
        ok = True
        for s in sheets:
            cfg = mans[s]
            print(f"- folha {s} ({cfg['source']})")
            try:
                sprites, info = process_sheet(cfg, s)
            except BuildError as e:
                print("  ERRO:", e)
                errors.append(str(e))
                ok = False
                if not keep_going:
                    raise
                continue
            fr, gm = make_frames(sprites, cfg)
            aliases.update(cfg.get("aliases") or {})
            for n, a in fr.items():
                if n in frames:
                    raise BuildError(f"nome de quadro repetido: {n}")
                frames[n] = a
                fmeta[n] = gm[group_of(n, cfg)]
            print(f"  ok: {len(sprites)} sprites, linhas {info['rows']}, quadros "
                  + ", ".join(f"{g}={m['w']}x{m['h']}" for g, m in gm.items()))
        if ok and frames:
            write_atlas(cat, frames, fmeta, aliases)
            print(f"  atlas_{cat}: {len(frames)} quadros")
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--sheet", action="append")
    ap.add_argument("--map", action="store_true")
    ap.add_argument("--keep-going", action="store_true")
    args = ap.parse_args()
    if not (args.all or args.sheet or args.map):
        ap.print_help()
        return 1
    DEBUG.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    try:
        if args.all or args.sheet:
            errors += build_sheets(None if args.all else args.sheet, args.keep_going)
        if args.all or args.map:
            import mapbuild
            mapbuild.build_map()
        if args.all:
            stale = [p for p in (OUT / "atlas").glob("atlas_*") if p.stem not in {f"atlas_{c}" for c in CATEGORIES}]
            for p in stale:
                p.unlink()
        write_manifest()
        write_asset_keys()
        if args.all:
            import mapbuild
            mapbuild.previews()
            import validate
            validate.validate_all()
    except BuildError as e:
        print("\nFALHOU:", e, file=sys.stderr)
        return 2
    if errors:
        print("\nFALHOU em", len(errors), "folha(s):", *errors, sep="\n  ", file=sys.stderr)
        return 2
    print("\nPronto.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(TOOLS))
    sys.exit(main())

"""Confere as saídas: JSON válido, todos os quadros dentro do PNG, nomes obrigatórios, manifest e layout."""
from __future__ import annotations

import json

from PIL import Image

from build import CATEGORIES, GENERATED, OUT, BuildError

REQUIRED_FRAMES = {
    "icons": ["icon/carrot", "icon/potato", "icon/strawberry", "icon/egg", "icon/duck_egg", "icon/milk", "icon/wool",
              "icon/seed_carrot", "icon/seed_potato", "icon/seed_strawberry", "icon/seed_apple", "icon/seed_leek",
              "icon/truffle", "icon/goat_milk", "icon/alpaca_wool", "icon/rabbit_fur", "icon/goose_egg",
              "icon/turkey_feather", "icon/turkey_egg", "icon/fuel_can", "icon/feed_sack", "icon/wrench"] + [f"buff/icon_{i}" for i in range(1, 9)],
    "cards": ["card/frame_common", "card/frame_uncommon", "card/frame_rare", "card/frame_epic",
              "card/frame_legendary", "card/back"] + [f"card/art_{i}" for i in range(1, 9)],
    "characters": ["farmer_m/idle_down_0", "farmer_m/idle_up_0", "farmer_m/idle_side_0", "farmer_m/walk_down_0",
                   "farmer_m/walk_up_0", "farmer_m/walk_side_0", "farmer_m/walk_left_0",
                   "farmer_m/walk_right_0", "farmer_m/plant_kneel_0", "farmer_m/water_kneel_0", "farmer_f/idle_down_0", "farmer_f/walk_side_0",
                   "farmer_f/plant_side_0", "farmer_f/water_side_0", "farmer_f/harvest_side_0",
                   "shopkeeper/idle_down_0", "blacksmith/idle_down_0", "scientist/idle_down_0"],
    "animals": ["cow/idle_0", "chicken/idle_0", "pig/idle_0", "cow_holstein/pose_0", "chicken_brown/pose_0"]
               + [f"{a}/walk_{i}" for a in ("cow", "pig", "sheep", "goat", "alpaca", "chicken", "duck", "goose",
                                            "rabbit", "turkey") for i in range(5)],
    "buildings": ["building/house", "building/garage", "building/barn", "building/coop", "building/greenhouse",
                  "building/pier", "tree/oak", "tree/pine", "tree/bush_round", "tree/apple", "tree/palm",
                  "decor/crop_rows_1", "decor/crop_rows_2", "decor/crop_rows_3"],
    "crops": [f"crop/{c}_{i}" for c in ("carrot", "potato", "strawberry", "apple", "melon", "onion", "kale")
              for i in range(4)],
    "explore": ["explore/dest_village", "explore/dest_city", "explore/dest_port", "explore/out_total_loss",
                "explore/out_robbery", "explore/out_normal", "explore/out_good", "explore/out_great",
                "explore/out_jackpot"],
    "tiles": ["tile/soil_raw", "tile/soil_tilled", "tile/soil_wet"],
    "ui": ["ui/coin", "ui/vip_crown", "ui/xp_star", "ui/night_event", "ui/button_normal", "ui/button_hover",
           "ui/button_pressed", "ui/panel", "ui/bar_empty", "ui/bar_green", "ui/bar_gold", "ui/album_book",
           "ui/album_arrow_left", "ui/album_arrow_right", "ui/album_tab_blue", "ui/album_tab_green",
           "ui/album_tab_red", "ui/album_tab_purple"],
    "pets": ["dog/walk_side_0", "cat/walk_side_0", "parrot/idle_0"],
    "vehicles": ["cart/down_left_0"],
}


def validate_all():
    man = json.load(open(OUT / "manifest.json"))
    if set(man) != {"map", "atlases"}:
        raise BuildError("manifest.json: chaves inesperadas")
    for k in ("image", "overhead", "layout"):
        if not (OUT / man["map"][k]).exists():
            raise BuildError(f"manifest.json: arquivo do mapa não existe: {man['map'][k]}")
    for k, v in (("width", 2576), ("height", 1438)):
        if man["map"][k] != v:
            raise BuildError(f"manifest.json: map.{k} deveria ser {v}")
    im = Image.open(OUT / man["map"]["image"])
    ov = Image.open(OUT / man["map"]["overhead"])
    if im.size != (2576, 1438) or ov.size != (2576, 1438) or ov.mode != "RGBA":
        raise BuildError("mapa/overhead com tamanho ou modo errado")
    json.load(open(OUT / man["map"]["layout"]))
    keys = [a["key"] for a in man["atlases"]]
    if keys != [f"atlas_{c}" for c in CATEGORIES]:
        raise BuildError(f"manifest.json: atlas esperados {CATEGORIES}")
    total = 0
    for a, cat in zip(man["atlases"], CATEGORIES):
        js = json.load(open(OUT / a["json"]))
        png = Image.open(OUT / a["png"])
        W, H = png.size
        if W > 2048 or H > 2048:
            raise BuildError(f"{a['png']} maior que 2048")
        if js["meta"]["size"] != {"w": W, "h": H}:
            raise BuildError(f"{a['json']}: meta.size não bate com o PNG")
        if js["meta"]["image"] != a["png"].split("/")[-1]:
            raise BuildError(f"{a['json']}: meta.image errado")
        for n, f in js["frames"].items():
            fr = f["frame"]
            if fr["x"] < 0 or fr["y"] < 0 or fr["x"] + fr["w"] > W or fr["y"] + fr["h"] > H:
                raise BuildError(f"{a['json']}: quadro {n} sai do PNG")
            if "/" not in n:
                raise BuildError(f"{a['json']}: nome de quadro sem '/': {n}")
            if png.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"])).getchannel("A").getbbox() is None:
                raise BuildError(f"{a['json']}: quadro {n} está vazio")
        for n in REQUIRED_FRAMES.get(cat, []):
            if n not in js["frames"]:
                raise BuildError(f"{a['json']}: falta o quadro obrigatório {n}")
        total += len(js["frames"])
    ts = (GENERATED / "assetKeys.ts").read_text()
    if "export const ATLAS_KEYS" not in ts:
        raise BuildError("assetKeys.ts sem ATLAS_KEYS")
    print(f"- validação ok: {len(man['atlases'])} atlas, {total} quadros, manifest, mapa e layout")

"""Draws the Android launcher icons, the notification icon and the splash screens: the Awqat mark on graphite.

The mark itself is drawn by scripts/brand.py. Run after `npx cap add android` or a design change:
python3 scripts/make-android-icons.py
"""
import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
RES = HERE.parent / "android" / "app" / "src" / "main" / "res"

_spec = importlib.util.spec_from_file_location("brand", HERE / "brand.py")
brand = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(brand)

GROUND = brand.GROUND
mark_layer = brand.mark_layer
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def on_ground(size: int, scale: float, round_mask: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), GROUND + (255,))
    image.alpha_composite(mark_layer(size, scale))
    if round_mask:
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
        image.putalpha(mask.resize((size, size), Image.LANCZOS))
    return image


def main() -> None:
    for name, k in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        on_ground(round(48 * k), 0.86).convert("RGB").save(folder / "ic_launcher.png", optimize=True)
        on_ground(round(48 * k), 0.78, round_mask=True).save(folder / "ic_launcher_round.png", optimize=True)
        # Adaptive foreground: 108 dp with the mark inside the 66 dp safe zone.
        mark_layer(round(108 * k), 0.60).save(folder / "ic_launcher_foreground.png", optimize=True)
        drawable = RES / f"drawable-{name}"
        drawable.mkdir(parents=True, exist_ok=True)
        # The status bar's icon is a white silhouette; the name stays ic_stat_orb, which the app and plugins use.
        mark_layer(round(24 * k), 1.0, colour=(255, 255, 255), bold=True).save(drawable / "ic_stat_orb.png", optimize=True)
    background = RES / "values" / "ic_launcher_background.xml"
    background.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                          '    <color name="ic_launcher_background">#121219</color>\n</resources>\n')
    for splash in RES.glob("drawable*/splash.png"):
        w, h = Image.open(splash).size
        image = Image.new("RGBA", (w, h), GROUND + (255,))
        side = min(w, h) // 4
        image.alpha_composite(mark_layer(side, 0.9), ((w - side) // 2, (h - side) // 2))
        image.convert("RGB").save(splash, optimize=True)


if __name__ == "__main__":
    main()

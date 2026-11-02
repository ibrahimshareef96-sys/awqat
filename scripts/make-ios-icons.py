"""Draws the iOS app icon and launch image: the same Awqat mark on graphite as the Android icons.

Run after `npx cap add ios` or a design change: python3 scripts/make-ios-icons.py
"""
import importlib.util
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "ios" / "App" / "App" / "Assets.xcassets"

_spec = importlib.util.spec_from_file_location("android_icons", HERE / "make-android-icons.py")
android_icons = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(android_icons)


def main() -> None:
    # One 1024 px icon for every size; App Store icons carry no transparency, and iOS rounds the corners itself.
    icon = android_icons.on_ground(1024, 0.78).convert("RGB")
    icon.save(ASSETS / "AppIcon.appiconset" / "AppIcon-512@2x.png", optimize=True)
    # The launch image is drawn to fill the screen (aspect fill), so the mark sits in the middle of a square.
    side = 2732
    splash = Image.new("RGBA", (side, side), android_icons.GROUND + (255,))
    mark = side // 8
    splash.alpha_composite(android_icons.mark_layer(mark, 0.9), ((side - mark) // 2, (side - mark) // 2))
    for path in sorted((ASSETS / "Splash.imageset").glob("splash-2732x2732*.png")):
        splash.convert("RGB").save(path, optimize=True)


if __name__ == "__main__":
    main()

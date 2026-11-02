"""The Awqat mark: a pointed arch with the five prayers on the sun's path inside it, the noon one in gold.

One geometry on a 120-unit grid, drawn two ways: as SVG for the README and the brand folder, and as pixels for the
app icons (scripts/make-android-icons.py and scripts/make-ios-icons.py draw with mark_layer from here). The words are
Instrument Serif (SIL OFL 1.1, public/fonts), shaped with HarfBuzz and written as outlines, so no font is needed to
show them.

Needs Pillow, fontTools and uharfbuzz (scripts/requirements.txt). Run: python3 scripts/brand.py
Writes brand/awqat-mark.svg, brand/awqat-icon.svg, brand/awqat-banner.svg and brand/awqat-social.png.
"""
from __future__ import annotations

from math import atan2, cos, degrees, radians, sin, sqrt
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
SERIF = ROOT / "public" / "fonts" / "InstrumentSerif-Regular.ttf"
SERIF_ITALIC = ROOT / "public" / "fonts" / "InstrumentSerif-Italic.ttf"

Rgb = tuple[int, int, int]
GROUND: Rgb = (18, 18, 25)  # the app's graphite, #121219
INK: Rgb = (245, 241, 232)  # its ivory, #F5F1E8
GOLD: Rgb = (226, 204, 154)  # its one warm accent, #E2CC9A
# On a light page (GitHub's light theme) the mark is drawn in graphite with a deeper gold, so it keeps its contrast.
LIGHT_INK: Rgb = GROUND
LIGHT_GOLD: Rgb = (166, 132, 62)

GRID = 120.0
LEFT, RIGHT, SPRING, BASE = 30.0, 90.0, 56.0, 96.0
APEX = (60.0, 22.0)
ARCH_RADIUS = 40.0
STROKE = 4.0
# The sun's path: a half circle over the horizon, five dots from Fajr in the east to Isha in the west, noon on top.
PATH_CENTRE = (60.0, 82.0)
PATH_RADIUS = 22.0
ANGLES = (162.0, 126.0, 90.0, 54.0, 18.0)
DOT, NOON_DOT = 4.0, 5.5
HORIZON = (44.0, 76.0, 88.0)
HORIZON_STROKE = 2.5
HORIZON_ALPHA = 0.45

TAGLINE = "The Muslim personal OS"
LINE = "Your day, set by the five prayers."


def hex_of(rgb: Rgb) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def dots() -> list[tuple[float, float, float, bool]]:
    """(x, y, radius, is noon) for each prayer, on the grid."""
    out = []
    for angle in ANGLES:
        x = PATH_CENTRE[0] + PATH_RADIUS * cos(radians(angle))
        y = PATH_CENTRE[1] - PATH_RADIUS * sin(radians(angle))
        noon = angle == 90.0
        out.append((x, y, NOON_DOT if noon else DOT, noon))
    return out


def arc_centre(p: tuple[float, float], q: tuple[float, float], r: float,
               toward: tuple[float, float]) -> tuple[float, float]:
    """The centre of the circle of radius r through p and q that lies on the side of `toward`."""
    mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    dx, dy = q[0] - p[0], q[1] - p[1]
    half = sqrt(dx * dx + dy * dy) / 2
    h = sqrt(r * r - half * half)
    nx, ny = -dy / (2 * half), dx / (2 * half)
    one, two = (mx + h * nx, my + h * ny), (mx - h * nx, my - h * ny)
    gap = lambda c: (c[0] - toward[0]) ** 2 + (c[1] - toward[1]) ** 2  # noqa: E731
    return one if gap(one) < gap(two) else two


LEFT_ARC = ((LEFT, SPRING), APEX, arc_centre((LEFT, SPRING), APEX, ARCH_RADIUS, (RIGHT, BASE)))
RIGHT_ARC = (APEX, (RIGHT, SPRING), arc_centre(APEX, (RIGHT, SPRING), ARCH_RADIUS, (LEFT, BASE)))


def g(n: float) -> str:
    return f"{n:.2f}".rstrip("0").rstrip(".")


def mark_svg_body(ink: str | None, gold: str | None) -> str:
    """The mark's elements on the 120 grid, without the <svg> around them. With colours None, the elements carry
    classes instead (s: a stroke in ink, f: a fill in ink, n: the noon dot's gold), for a stylesheet to colour."""
    r = g(ARCH_RADIUS)
    arch = (f"M{g(LEFT)} {g(BASE)}V{g(SPRING)}A{r} {r} 0 0 1 {g(APEX[0])} {g(APEX[1])}"
            f"A{r} {r} 0 0 1 {g(RIGHT)} {g(SPRING)}V{g(BASE)}")
    stroke = f'stroke="{ink}"' if ink else 'class="s"'
    x1, x2, y = HORIZON
    parts = [f'<path d="{arch}" fill="none" {stroke} stroke-width="{g(STROKE)}" stroke-linecap="round" '
             f'stroke-linejoin="round"/>',
             f'<line x1="{g(x1)}" y1="{g(y)}" x2="{g(x2)}" y2="{g(y)}" {stroke} stroke-opacity="{HORIZON_ALPHA}" '
             f'stroke-width="{g(HORIZON_STROKE)}" stroke-linecap="round"/>']
    for x, yy, rad, noon in dots():
        fill = (f'fill="{gold}"' if gold else 'class="n"') if noon else (f'fill="{ink}"' if ink else 'class="f"')
        parts.append(f'<circle cx="{g(x)}" cy="{g(yy)}" r="{g(rad)}" {fill}/>')
    return "".join(parts)


def mark_svg() -> str:
    """The mark alone on a transparent ground: ivory on a dark page, graphite on a light one."""
    style = (f".s{{stroke:{hex_of(INK)}}}.f{{fill:{hex_of(INK)}}}.n{{fill:{hex_of(GOLD)}}}"
             f"@media (prefers-color-scheme: light){{.s{{stroke:{hex_of(LIGHT_INK)}}}.f{{fill:{hex_of(LIGHT_INK)}}}"
             f".n{{fill:{hex_of(LIGHT_GOLD)}}}}}")
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" '
            f'aria-label="Awqat"><title>Awqat</title><style>{style}</style>{mark_svg_body(None, None)}</svg>\n')


def icon_svg() -> str:
    """The app icon: the mark on graphite in a rounded square."""
    scale = 0.82
    shift = g(GRID * (1 - scale) / 2)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240" role="img" '
            f'aria-label="Awqat"><title>Awqat</title><rect width="120" height="120" rx="27" fill="{hex_of(GROUND)}"/>'
            f'<g transform="translate({shift} {shift}) scale({scale})">{mark_svg_body(hex_of(INK), hex_of(GOLD))}</g>'
            '</svg>\n')


def shaped(text: str, font_path: Path) -> tuple[list[tuple[int, float, float]], float, int]:
    """HarfBuzz's glyphs for the text: (glyph id, x, y) in font units, the advance, and units per em. Kerned, with no
    ligatures, so there is one glyph per letter and the picture can draw them letter by letter."""
    face = hb.Face(hb.Blob.from_file_path(str(font_path)))
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False, "clig": False, "dlig": False})
    if len(buf.glyph_infos) != len(text):
        raise ValueError(f"expected one glyph per letter in {text!r}")
    out, cursor = [], 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((info.codepoint, cursor + pos.x_offset, float(pos.y_offset)))
        cursor += pos.x_advance
    return out, cursor, face.upem


def text_path(text: str, font_path: Path, size: float, x: float, baseline: float) -> tuple[str, float]:
    """The text as one SVG path's d, set at a size in px from a left baseline point, and its width in px."""
    font = TTFont(str(font_path))
    order, glyphs = font.getGlyphOrder(), font.getGlyphSet()
    placed, advance, upem = shaped(text, font_path)
    s = size / upem
    pen = SVGPathPen(glyphs, ntos=lambda n: f"{n:.1f}".rstrip("0").rstrip("."))
    for gid, gx, gy in placed:
        glyphs[order[gid]].draw(TransformPen(pen, (s, 0, 0, -s, x + gx * s, baseline - gy * s)))
    return pen.getCommands(), advance * s


BANNER_W, BANNER_H = 1280, 640
MARK_AT, MARK_SIZE = (128, 182), 300
WORD_X, WORD_SIZE, WORD_BASE = 470, 196, 338
TAG_SIZE, TAG_BASE = 54, 420
LINE_SIZE, LINE_BASE = 34, 480


def banner_svg() -> str:
    """The README's banner and the repository's social picture: mark, name, tagline, on graphite."""
    word, _ = text_path("Awqat", SERIF, WORD_SIZE, WORD_X, WORD_BASE)
    tag, _ = text_path(TAGLINE, SERIF_ITALIC, TAG_SIZE, WORD_X + 6, TAG_BASE)
    line, _ = text_path(LINE, SERIF, LINE_SIZE, WORD_X + 6, LINE_BASE)
    scale = MARK_SIZE / GRID
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BANNER_W} {BANNER_H}" width="{BANNER_W}" '
            f'height="{BANNER_H}" role="img" aria-label="Awqat. {TAGLINE}. {LINE}"><title>Awqat</title>'
            f'<rect width="{BANNER_W}" height="{BANNER_H}" fill="{hex_of(GROUND)}"/>'
            f'<g transform="translate({MARK_AT[0]} {MARK_AT[1]}) scale({g(scale)})">'
            f'{mark_svg_body(hex_of(INK), hex_of(GOLD))}</g>'
            f'<path d="{word}" fill="{hex_of(INK)}"/><path d="{tag}" fill="{hex_of(GOLD)}"/>'
            f'<path d="{line}" fill="{hex_of(INK)}" fill-opacity="0.7"/></svg>\n')


def mark_layer(size: int, scale: float, colour: Rgb | None = None, bold: bool = False) -> Image.Image:
    """The mark alone on a transparent square of `size` px, filling `scale` of it, drawn 4x and scaled down.
    `colour` draws every part in one colour (Android's notification icon is a white silhouette); `bold` thickens
    the lines and dots for the smallest sizes."""
    big = size * 4
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    pen = ImageDraw.Draw(layer)
    unit = big * scale / GRID
    origin = (big - GRID * unit) / 2
    at = lambda x, y: (origin + x * unit, origin + y * unit)  # noqa: E731
    ink = (colour or INK) + (255,)
    gold = (colour or GOLD) + (255,)
    width = STROKE * unit * (1.6 if bold else 1.0)

    def cap(x: float, y: float, w: float, fill: tuple[int, int, int, int]) -> None:
        cx, cy = at(x, y)
        pen.ellipse((cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2), fill=fill)

    for p, q, c in (LEFT_ARC, RIGHT_ARC):
        cx, cy = at(*c)
        radius = ARCH_RADIUS * unit + width / 2
        start = degrees(atan2(p[1] - c[1], p[0] - c[0])) % 360
        end = degrees(atan2(q[1] - c[1], q[0] - c[0])) % 360
        pen.arc((cx - radius, cy - radius, cx + radius, cy + radius), start, end, fill=ink, width=round(width))
    for x in (LEFT, RIGHT):
        pen.line([at(x, SPRING), at(x, BASE)], fill=ink, width=round(width))
    for x, y in ((LEFT, SPRING), (RIGHT, SPRING), APEX, (LEFT, BASE), (RIGHT, BASE)):
        cap(x, y, width, ink)
    if not bold:
        x1, x2, y = HORIZON
        faint = (colour or INK) + (round(255 * HORIZON_ALPHA),)
        hw = HORIZON_STROKE * unit
        pen.line([at(x1, y), at(x2, y)], fill=faint, width=round(hw))
        cap(x1, y, hw, faint)
        cap(x2, y, hw, faint)
    for x, y, r, noon in dots():
        cx, cy = at(x, y)
        rr = r * unit * (1.35 if bold else 1.0)
        pen.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=gold if noon else ink)
    return layer.resize((size, size), Image.LANCZOS)


def draw_text(image: Image.Image, text: str, font_path: Path, size: int, x: float, baseline: float,
              fill: tuple[int, int, int, int]) -> None:
    """Pillow without raqm cannot kern, so each letter goes where HarfBuzz put it."""
    placed, _, upem = shaped(text, font_path)
    font = ImageFont.truetype(str(font_path), size)
    pen = ImageDraw.Draw(image)
    s = size / upem
    for (_, gx, gy), ch in zip(placed, text):
        pen.text((x + gx * s, baseline - gy * s), ch, font=font, fill=fill, anchor="ls")


def social_png() -> Image.Image:
    """The banner as a picture, for the repository's social preview (Settings, Social preview, on GitHub)."""
    image = Image.new("RGBA", (BANNER_W, BANNER_H), GROUND + (255,))
    image.alpha_composite(mark_layer(MARK_SIZE, 1.0), MARK_AT)
    draw_text(image, "Awqat", SERIF, WORD_SIZE, WORD_X, WORD_BASE, INK + (255,))
    draw_text(image, TAGLINE, SERIF_ITALIC, TAG_SIZE, WORD_X + 6, TAG_BASE, GOLD + (255,))
    draw_text(image, LINE, SERIF, LINE_SIZE, WORD_X + 6, LINE_BASE, INK + (179,))
    return image.convert("RGB")


def main() -> None:
    BRAND.mkdir(exist_ok=True)
    (BRAND / "awqat-mark.svg").write_text(mark_svg(), encoding="utf-8")
    (BRAND / "awqat-icon.svg").write_text(icon_svg(), encoding="utf-8")
    (BRAND / "awqat-banner.svg").write_text(banner_svg(), encoding="utf-8")
    social_png().save(BRAND / "awqat-social.png", optimize=True)


if __name__ == "__main__":
    main()

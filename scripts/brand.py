"""The Awqat mark, in the grammar Itqan Studio builds with: square modules, ink and bone, and the dusk run.

The mark is a pointed arch of square modules with five squares on the sun's path inside it, one per prayer, each one
stop of the dusk run in order: sand (Fajr), apricot (Dhuhr), coral (Asr), rose (Maghrib), orchid (Isha). It is set on
a 15 by 16 module grid and drawn two ways: as SVG for the README and the brand folder, and as pixels for the app
icons (scripts/make-android-icons.py and scripts/make-ios-icons.py draw with mark_layer from here). The words are
Geist, Geist Mono and Readex Pro (SIL OFL 1.1, brand/fonts), shaped with HarfBuzz and written as outlines, so no font
is needed to show them.

Needs Pillow, fontTools and uharfbuzz (scripts/requirements.txt). Run: python3 scripts/brand.py
Writes brand/awqat-mark.svg, brand/awqat-icon.svg, brand/awqat-banner.svg and brand/awqat-social.png.
"""
from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"
FONTS = BRAND / "fonts"
GEIST = FONTS / "Geist-Variable.ttf"
GEIST_MONO = FONTS / "GeistMono-Variable.ttf"
READEX = FONTS / "ReadexPro-Variable.ttf"

Rgb = tuple[int, int, int]
GROUND: Rgb = (11, 10, 13)  # Itqan ink, #0B0A0D
INK: Rgb = (245, 241, 234)  # Itqan bone, #F5F1EA
MUTE: Rgb = (167, 159, 168)  # #A79FA8
ROSE: Rgb = (239, 58, 120)  # Itqan rose, #EF3A78
# The dusk run, one stop per prayer from Fajr to Isha.
DUSK: tuple[Rgb, ...] = ((245, 211, 161), (248, 154, 91), (244, 102, 79), (239, 58, 120), (155, 63, 160))
# On a light page (GitHub's light theme) the arch is ink and the two palest stops are taken deeper, to keep contrast.
LIGHT_DUSK: tuple[Rgb, ...] = ((201, 138, 54), (226, 112, 40), DUSK[2], DUSK[3], DUSK[4])

GRID_W, GRID_H = 15, 16
# The arch, as (column, row, width, height) modules: a pointed apex, shoulders stepping down, two legs to the ground.
ARCH: tuple[tuple[int, int, int, int], ...] = (
    (7, 0, 1, 1),
    (6, 1, 1, 1), (8, 1, 1, 1),
    (5, 2, 1, 1), (9, 2, 1, 1),
    (4, 3, 1, 1), (10, 3, 1, 1),
    (3, 4, 1, 1), (11, 4, 1, 1),
    (2, 5, 1, 2), (12, 5, 1, 2),
    (1, 7, 1, 9), (13, 7, 1, 9),
)
# The horizon, faint, under the sun's path.
HORIZON = (4, 13, 7, 1)
HORIZON_ALPHA = 0.24
# The five prayers on the sun's path, Fajr to Isha.
PRAYERS = ((3, 11), (4, 7), (7, 6), (10, 7), (11, 11))

TAGLINE_LEAD = "The Muslim "
TAGLINE_LIT = "personal OS"
LINE = "Your day, set by the five prayers."
MAKER = "BUILT BY"
MAKER_NAME = "ITQAN"
# Itqan's own symbol (brand kit v3): the i of itqan, a rose dot over a stem, with its arcs; (column, row, width).
ITQAN_SYMBOL = ((0, 0, 1), (0, 2, 1), (0, 3, 4), (0, 4, 6), (0, 5, 1), (3, 5, 4), (0, 6, 2), (5, 6, 3), (0, 7, 4), (6, 7, 2),
                (0, 8, 1), (2, 8, 3), (6, 8, 3), (0, 9, 1), (3, 9, 2), (7, 9, 2), (0, 10, 2), (4, 10, 2), (7, 10, 2),
                (0, 11, 3), (4, 11, 2), (7, 11, 3))


def hex_of(rgb: Rgb) -> str:
    return "#{:02X}{:02X}{:02X}".format(*rgb)


def g(n: float) -> str:
    return f"{n:.2f}".rstrip("0").rstrip(".")


def mark_svg_body(arch: str | None, dusk: tuple[Rgb, ...] | None) -> str:
    """The mark's modules on its grid, without the <svg> around them. With colours None, the modules carry classes
    instead (a: the arch, h: the horizon, p1 to p5: the prayers), for a stylesheet to colour."""
    classes = arch is None or dusk is None
    arch_paint = 'class="a"' if classes else f'fill="{arch}"'
    horizon_paint = 'class="h"' if classes else f'fill="{arch}" fill-opacity="{HORIZON_ALPHA}"'
    parts = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" {arch_paint}/>' for x, y, w, h in ARCH]
    x, y, w, h = HORIZON
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" {horizon_paint}/>')
    for i, (px, py) in enumerate(PRAYERS):
        fill = f'class="p{i + 1}"' if classes else f'fill="{hex_of(dusk[i])}"'
        parts.append(f'<rect x="{px}" y="{py}" width="1" height="1" {fill}/>')
    return "".join(parts)


def mark_svg() -> str:
    """The mark alone on a transparent ground: bone on a dark page, ink on a light one."""
    dark = "".join(f".p{i + 1}{{fill:{hex_of(c)}}}" for i, c in enumerate(DUSK))
    light = "".join(f".p{i + 1}{{fill:{hex_of(c)}}}" for i, c in enumerate(LIGHT_DUSK))
    style = (f".a{{fill:{hex_of(INK)}}}.h{{fill:{hex_of(INK)};fill-opacity:{HORIZON_ALPHA}}}{dark}"
             f"@media (prefers-color-scheme: light){{.a{{fill:{hex_of(GROUND)}}}.h{{fill:{hex_of(GROUND)}}}{light}}}")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 {GRID_W + 2} {GRID_H + 2}" width="136" height="144" '
            f'shape-rendering="crispEdges" role="img" aria-label="Awqat"><title>Awqat</title><style>{style}</style>'
            f'{mark_svg_body(None, None)}</svg>\n')


def icon_svg() -> str:
    """The app icon: the mark on ink in a rounded square."""
    side = 24
    shift_x, shift_y = (side - GRID_W) / 2, (side - GRID_H) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" width="240" height="240" role="img" '
            f'aria-label="Awqat"><title>Awqat</title><rect width="{side}" height="{side}" rx="5.4" fill="{hex_of(GROUND)}"/>'
            f'<g transform="translate({g(shift_x)} {g(shift_y)})" shape-rendering="crispEdges">'
            f'{mark_svg_body(hex_of(INK), DUSK)}</g></svg>\n')


@lru_cache(maxsize=None)
def instance(font_path: Path, weight: int) -> bytes:
    """A static cut of a variable font at one weight, as font file bytes (shaping and outlines then agree)."""
    font = TTFont(str(font_path))
    axes = {a.axisTag: a for a in font["fvar"].axes}
    location = {"wght": weight}
    location.update({tag: axis.defaultValue for tag, axis in axes.items() if tag != "wght"})
    static = instantiateVariableFont(font, location)
    out = BytesIO()
    static.save(out)
    return out.getvalue()


def shaped(text: str, data: bytes) -> tuple[list[tuple[int, float, float]], float, int]:
    """HarfBuzz's glyphs for the text, in the order they are drawn left to right: (glyph id, x, y) in font units, the
    advance, and units per em. Arabic is joined as it is written."""
    face = hb.Face(hb.Blob(data))
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True})
    out, cursor = [], 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((info.codepoint, cursor + pos.x_offset, float(pos.y_offset)))
        cursor += pos.x_advance
    return out, cursor, face.upem


def text_contours(text: str, font_path: Path, weight: int, size: float, x: float, baseline: float,
                  tracking: float = 0.0) -> tuple[RecordingPen, float]:
    """The text's outlines at a size in px from a left baseline point (a recording, to draw as SVG or as pixels),
    and its width. `tracking` is letter spacing in em."""
    data = instance(font_path, weight)
    font = TTFont(BytesIO(data))
    order, glyphs = font.getGlyphOrder(), font.getGlyphSet()
    placed, advance, upem = shaped(text, data)
    s = size / upem
    # Arabic letters are often built from parts (a dot, a hamza): each part is drawn out in full.
    pen = DecomposingRecordingPen(glyphs)
    for i, (gid, gx, gy) in enumerate(placed):
        dx = x + gx * s + i * tracking * size
        glyphs[order[gid]].draw(TransformPen(pen, (s, 0, 0, -s, dx, baseline - gy * s)))
    return pen, advance * s + max(0, len(placed) - 1) * tracking * size


def svg_path(pen: RecordingPen) -> str:
    out = SVGPathPen(None, ntos=lambda n: f"{n:.1f}".rstrip("0").rstrip("."))
    pen.replay(out)
    return out.getCommands()


BANNER_W, BANNER_H = 1280, 640
MARK_X, MARK_Y, MODULE = 132, 160, 19
WORD_X, WORD_SIZE, WORD_BASE = 470, 164, 322
TAG_SIZE, TAG_BASE = 50, 410
LINE_SIZE, LINE_BASE = 30, 466
MAKER_X, MAKER_BASE, MAKER_SIZE = 132, 560, 15
ITQAN_MODULE = 1.9


def banner_parts() -> dict[str, tuple[RecordingPen, float]]:
    word, word_w = text_contours("awqat", GEIST, 600, WORD_SIZE, WORD_X, WORD_BASE, tracking=-0.05)
    arabic, _ = text_contours("أوقات", READEX, 600, WORD_SIZE * 0.5, WORD_X + word_w + 34, WORD_BASE)
    lead, lead_w = text_contours(TAGLINE_LEAD, GEIST, 500, TAG_SIZE, WORD_X + 6, TAG_BASE, tracking=-0.035)
    lit, lit_w = text_contours(TAGLINE_LIT, GEIST, 500, TAG_SIZE, WORD_X + 6 + lead_w, TAG_BASE, tracking=-0.035)
    line, _ = text_contours(LINE, GEIST, 400, LINE_SIZE, WORD_X + 8, LINE_BASE, tracking=-0.01)
    maker, maker_w = text_contours(MAKER, GEIST_MONO, 500, MAKER_SIZE, MAKER_X, MAKER_BASE, tracking=0.14)
    name, _ = text_contours(MAKER_NAME, GEIST_MONO, 500, MAKER_SIZE, MAKER_X + maker_w + 46, MAKER_BASE, tracking=0.14)
    return {"word": (word, word_w), "arabic": (arabic, 0), "lead": (lead, lead_w), "lit": (lit, lit_w), "line": (line, 0),
            "maker": (maker, maker_w), "name": (name, 0)}


def itqan_at(maker_w: float) -> tuple[float, float]:
    """Where Itqan's symbol sits: between BUILT BY and ITQAN, on their baseline."""
    return MAKER_X + maker_w + 14, MAKER_BASE - 12 * ITQAN_MODULE + 1


def banner_svg() -> str:
    """The README's banner and the repository's social picture: the mark, the name in both scripts, the tagline with
    its last words lit in the dusk run, and Itqan's maker's mark, on ink with a rose glow from the corner."""
    parts = banner_parts()
    lead_w = parts["lead"][1]
    lit_x0 = WORD_X + 6 + lead_w
    lit_x1 = lit_x0 + parts["lit"][1]
    ix, iy = itqan_at(parts["maker"][1])
    stops = "".join(f'<stop offset="{g(i / (len(DUSK) - 1))}" stop-color="{hex_of(c)}"/>' for i, c in enumerate(DUSK))
    itqan = "".join(f'<rect x="{g(ix + x * ITQAN_MODULE)}" y="{g(iy + y * ITQAN_MODULE)}" width="{g(w * ITQAN_MODULE)}" '
                    f'height="{g(ITQAN_MODULE)}" fill="{hex_of(ROSE) if (x, y) == (0, 0) else "url(#dusk)"}"/>'
                    for x, y, w in ITQAN_SYMBOL)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BANNER_W} {BANNER_H}" width="{BANNER_W}" '
            f'height="{BANNER_H}" role="img" aria-label="Awqat, أوقات. {TAGLINE_LEAD}{TAGLINE_LIT}. {LINE} Built by Itqan.">'
            f'<title>Awqat</title><defs>'
            f'<linearGradient id="dusk" gradientUnits="userSpaceOnUse" x1="{g(lit_x0)}" y1="0" x2="{g(lit_x1)}" y2="0">{stops}</linearGradient>'
            f'<radialGradient id="glow" cx="0" cy="{BANNER_H}" r="{BANNER_W * 0.62}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{hex_of(ROSE)}" stop-opacity="0.36"/>'
            f'<stop offset="0.5" stop-color="#C5397E" stop-opacity="0.09"/>'
            f'<stop offset="1" stop-color="{hex_of(DUSK[4])}" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="{BANNER_W}" height="{BANNER_H}" fill="{hex_of(GROUND)}"/>'
            f'<rect width="{BANNER_W}" height="{BANNER_H}" fill="url(#glow)"/>'
            f'<g transform="translate({MARK_X} {MARK_Y}) scale({MODULE})" shape-rendering="crispEdges">'
            f'{mark_svg_body(hex_of(INK), DUSK)}</g>'
            f'<path d="{svg_path(parts["word"][0])}" fill="{hex_of(INK)}"/>'
            f'<path d="{svg_path(parts["arabic"][0])}" fill="{hex_of(INK)}" fill-opacity="0.55"/>'
            f'<path d="{svg_path(parts["lead"][0])}" fill="{hex_of(INK)}"/>'
            f'<path d="{svg_path(parts["lit"][0])}" fill="url(#dusk)"/>'
            f'<path d="{svg_path(parts["line"][0])}" fill="{hex_of(MUTE)}"/>'
            f'<path d="{svg_path(parts["maker"][0])}" fill="{hex_of(MUTE)}"/>'
            f'<g shape-rendering="crispEdges">{itqan}</g>'
            f'<path d="{svg_path(parts["name"][0])}" fill="{hex_of(MUTE)}"/></svg>\n')


def flatten(pen: RecordingPen, steps: int = 12) -> list[list[tuple[float, float]]]:
    """The outlines as polygons: each curve cut into short straight lines."""
    contours: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for op, args in pen.value:
        if op == "moveTo":
            current = [args[0]]
        elif op == "lineTo":
            current.append(args[0])
        elif op == "qCurveTo":
            points = list(args)
            start = current[-1]
            # A run of off-curve points has implied on-curve points halfway between them.
            for i, control in enumerate(points[:-1]):
                end = points[-1] if i == len(points) - 2 else ((control[0] + points[i + 1][0]) / 2, (control[1] + points[i + 1][1]) / 2)
                for t in range(1, steps + 1):
                    u = t / steps
                    current.append(((1 - u) ** 2 * start[0] + 2 * (1 - u) * u * control[0] + u * u * end[0],
                                    (1 - u) ** 2 * start[1] + 2 * (1 - u) * u * control[1] + u * u * end[1]))
                start = end
        elif op == "curveTo":
            (c1, c2, end), start = args, current[-1]
            for t in range(1, steps + 1):
                u = t / steps
                current.append(tuple((1 - u) ** 3 * s + 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3 * e
                                     for s, a, b, e in zip(start, c1, c2, end)))
        elif op in ("closePath", "endPath"):
            if len(current) > 2:
                contours.append(current)
            current = []
    return contours


def signed_area(contour: list[tuple[float, float]]) -> float:
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(contour, contour[1:] + contour[:1])) / 2


def fill_pen(image: Image.Image, pen: RecordingPen, fill: Image.Image | Rgb, alpha: float = 1.0, k: int = 4) -> None:
    """Paints the outlines into the picture, drawn k times larger and scaled down for smooth edges. A font draws a
    letter's outside one way round and its holes the other: outsides are joined (a variable font's strokes overlap),
    then holes are cut out. `fill` is a colour, or a picture the size of `image`."""
    w, h = image.size
    contours = flatten(pen)
    if not contours:
        return
    outside = 1 if signed_area(max(contours, key=lambda c: abs(signed_area(c)))) > 0 else -1
    solid = Image.new("L", (w * k, h * k), 0)
    holes = Image.new("L", (w * k, h * k), 0)
    for contour in contours:
        target = solid if signed_area(contour) * outside > 0 else holes
        ImageDraw.Draw(target).polygon([(x * k, y * k) for x, y in contour], fill=255)
    soft = ImageChops.subtract(solid, holes).resize((w, h), Image.LANCZOS)
    if alpha < 1:
        soft = soft.point(lambda v: round(v * alpha))
    layer = fill.convert("RGBA") if isinstance(fill, Image.Image) else Image.new("RGBA", (w, h), fill + (255,))
    layer.putalpha(soft)
    image.alpha_composite(layer)


def mark_layer(size: int, scale: float, colour: Rgb | None = None, bold: bool = False) -> Image.Image:
    """The mark alone on a transparent square of `size` px, filling `scale` of it. Modules are snapped to whole pixels
    so their edges stay crisp. `colour` draws every module in one colour (Android's notification icon is a white
    silhouette); `bold` leaves out the faint horizon for the smallest sizes."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pen = ImageDraw.Draw(layer)
    module = max(1, int(size * scale / GRID_H))
    ox, oy = (size - GRID_W * module) // 2, (size - GRID_H * module) // 2

    def put(x: int, y: int, w: int, h: int, rgb: Rgb, alpha: float = 1.0) -> None:
        pen.rectangle((ox + x * module, oy + y * module, ox + (x + w) * module - 1, oy + (y + h) * module - 1),
                      fill=rgb + (round(255 * alpha),))

    for x, y, w, h in ARCH:
        put(x, y, w, h, colour or INK)
    if not bold:
        put(*HORIZON, colour or INK, HORIZON_ALPHA)
    for i, (x, y) in enumerate(PRAYERS):
        put(x, y, 1, 1, colour or DUSK[i])
    return layer


def dusk_picture(size: tuple[int, int], x0: float, x1: float) -> Image.Image:
    """The dusk run left to right between x0 and x1, as a picture to paint lit words with."""
    w, h = size
    row = Image.new("RGB", (w, 1))
    for x in range(w):
        t = min(1.0, max(0.0, (x - x0) / max(1.0, x1 - x0))) * (len(DUSK) - 1)
        i = min(len(DUSK) - 2, int(t))
        f = t - i
        row.putpixel((x, 0), tuple(round(a + (b - a) * f) for a, b in zip(DUSK[i], DUSK[i + 1])))
    return row.resize((w, h))


def glow(size: tuple[int, int]) -> Image.Image:
    """Itqan's rose glow from the bottom-left corner, as a layer to lay over the ink."""
    w, h = size
    small = Image.new("RGBA", (w // 8, h // 8))
    reach = w * 0.62 / 8
    for y in range(small.height):
        for x in range(small.width):
            d = min(1.0, ((x ** 2) + (small.height - y) ** 2) ** 0.5 / reach)
            # Rose at the corner turning orchid, fading as the square of the distance, so it has no edge.
            colour = tuple(round(r + (o - r) * d) for r, o in zip(ROSE, DUSK[4]))
            small.putpixel((x, y), colour + (round(255 * 0.36 * (1 - d) ** 2),))
    return small.resize((w, h), Image.BICUBIC)


def social_png() -> Image.Image:
    """The banner as a picture, for the repository's social preview (Settings, Social preview, on GitHub)."""
    size = (BANNER_W, BANNER_H)
    image = Image.new("RGBA", size, GROUND + (255,))
    image.alpha_composite(glow(size))
    mark = mark_layer(GRID_H * MODULE, 1.0)
    image.alpha_composite(mark, (MARK_X, MARK_Y))
    parts = banner_parts()
    fill_pen(image, parts["word"][0], INK)
    fill_pen(image, parts["arabic"][0], INK, 0.55)
    fill_pen(image, parts["lead"][0], INK)
    lit_x0 = WORD_X + 6 + parts["lead"][1]
    fill_pen(image, parts["lit"][0], dusk_picture(size, lit_x0, lit_x0 + parts["lit"][1]))
    fill_pen(image, parts["line"][0], MUTE)
    fill_pen(image, parts["maker"][0], MUTE)
    fill_pen(image, parts["name"][0], MUTE)
    ix, iy = itqan_at(parts["maker"][1])
    pen = ImageDraw.Draw(image)
    run = dusk_picture(size, ix, ix + 10 * ITQAN_MODULE)
    for x, y, w in ITQAN_SYMBOL:
        box = (round(ix + x * ITQAN_MODULE), round(iy + y * ITQAN_MODULE),
               round(ix + (x + w) * ITQAN_MODULE) - 1, round(iy + (y + 1) * ITQAN_MODULE) - 1)
        if (x, y) == (0, 0):
            pen.rectangle(box, fill=ROSE + (255,))
        else:
            image.paste(run.crop((box[0], box[1], box[2] + 1, box[3] + 1)), (box[0], box[1]))
    return image.convert("RGB")


def main() -> None:
    BRAND.mkdir(exist_ok=True)
    (BRAND / "awqat-mark.svg").write_text(mark_svg(), encoding="utf-8")
    (BRAND / "awqat-icon.svg").write_text(icon_svg(), encoding="utf-8")
    (BRAND / "awqat-banner.svg").write_text(banner_svg(), encoding="utf-8")
    social_png().save(BRAND / "awqat-social.png", optimize=True)


if __name__ == "__main__":
    main()

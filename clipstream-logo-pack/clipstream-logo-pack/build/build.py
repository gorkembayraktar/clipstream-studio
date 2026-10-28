#!/usr/bin/env python3
"""ClipStream logo pack generator (option G: sliced play).

Produces SVG (text converted to outlines), PNG and favicon.ico without any
external renderer. Run:  python3 build.py [output_dir]

Wordmark font: set FONT_BOLD / FONT_MED to Manrope ExtraBold / Medium .otf/.ttf
files to get the originally designed lettering. Default is Inter (stand-in).
"""
import json
import os
import sys

from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw

FONT_BOLD = os.environ.get("CLIPSTREAM_FONT_BOLD", "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf")
FONT_MED = os.environ.get("CLIPSTREAM_FONT_MED", "/usr/share/fonts/opentype/inter/Inter-Medium.otf")
FONT_NAME = os.environ.get("CLIPSTREAM_FONT_NAME", "Inter (stand-in for Manrope)")

OUT = sys.argv[1] if len(sys.argv) > 1 else "clipstream-logo-pack"

THEMES = {
    "light": dict(  # for LIGHT backgrounds
        top="#EE4B28", bottom="#11131A", word1="#11131A", word2="#EE4B28",
        label="#5F6373", tile="#F6F5F2"),
    "dark": dict(   # for DARK backgrounds
        top="#FF5A36", bottom="#F6F5F2", word1="#F6F5F2", word2="#FF5A36",
        label="#A3A8BA", tile="#11131A"),
}

# ---------------------------------------------------------------- geometry
# Option G mark, 120-unit design box. Two pieces of a play triangle cut by a
# diagonal; top piece nudged up-right, bottom piece down-left.
MARK_TOP = [(24, 12), (91.6, 51.6), (24, 69.6)]
MARK_TOP_T = (8, -6)
MARK_BOTTOM = [(24, 69.6), (91.6, 51.6), (106, 60), (24, 108)]
MARK_BOTTOM_T = (-3, 5)
MARK_SW = 6
MARK_VIEWBOX = (12, 0, 100, 120)  # centred on the artwork

# Tile icon (favicon / app icon), 64-unit box.
ICON_TOP = [(16, 10), (51.3, 29.4), (16, 40)]
ICON_TOP_T = (4 - 2.5, -3)
ICON_BOTTOM = [(16, 40), (51.3, 29.4), (56, 32), (16, 54)]
ICON_BOTTOM_T = (-2 - 2.5, 3)
ICON_SW = 4


def tpoly(pts, t, s=1.0, dx=0.0, dy=0.0):
    return [((x + t[0]) * s + dx, (y + t[1]) * s + dy) for x, y in pts]


def mark_shapes(th, s=1.0, dx=0.0, dy=0.0):
    return [
        dict(kind="poly", pts=tpoly(MARK_TOP, MARK_TOP_T, s, dx, dy), fill=th["top"], sw=MARK_SW * s),
        dict(kind="poly", pts=tpoly(MARK_BOTTOM, MARK_BOTTOM_T, s, dx, dy), fill=th["bottom"], sw=MARK_SW * s),
    ]


def icon_shapes(th):
    return [
        dict(kind="rrect", x=0, y=0, w=64, h=64, r=15, fill=th["tile"]),
        dict(kind="poly", pts=tpoly(ICON_TOP, ICON_TOP_T), fill=th["top"], sw=ICON_SW),
        dict(kind="poly", pts=tpoly(ICON_BOTTOM, ICON_BOTTOM_T), fill=th["bottom"], sw=ICON_SW),
    ]


# ---------------------------------------------------------------- fonts
class FlattenPen(BasePen):
    def __init__(self, gs, steps=14):
        super().__init__(gs)
        self.contours, self.cur, self.steps = [], None, steps

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self.cur.append((
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self.cur.append((
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))

    def _closePath(self):
        if self.cur:
            self.contours.append(self.cur)
        self.cur = None

    _endPath = _closePath


def fmt(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def text_shapes(font, text, size, x, baseline, fill, tracking, return_end=False):
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    sc = size / upm
    shapes = []
    cx = x
    for ch in text:
        gname = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=fmt)
        gs[gname].draw(TransformPen(pen, (sc, 0, 0, -sc, cx, baseline)))
        d = pen.getCommands()
        fp = FlattenPen(gs)
        gs[gname].draw(fp)
        contours = [[(px * sc + cx, baseline - py * sc) for px, py in c] for c in fp.contours]
        if d:
            shapes.append(dict(kind="glyph", d=d, contours=contours, fill=fill))
        cx += font["hmtx"][gname][0] * sc + tracking
    return (shapes, cx - tracking) if return_end else shapes


def baseline_for(font, size, top, line_h):
    upm = font["head"].unitsPerEm
    asc = font["hhea"].ascent * size / upm
    desc = -font["hhea"].descent * size / upm
    return top + (line_h - (asc + desc)) / 2 + asc


def lockup(th, with_label=True):
    bold, med = TTFont(FONT_BOLD), TTFont(FONT_MED)
    mark_h = 140.0
    s = mark_h / 120.0
    mark_w = MARK_VIEWBOX[2] * s
    gap = 28.0
    tx = mark_w + gap
    word_size, label_size = 96.0, 24.0
    block_h = word_size + (12 + label_size if with_label else 0)
    top = (mark_h - block_h) / 2
    shapes = mark_shapes(th, s, -MARK_VIEWBOX[0] * s, -MARK_VIEWBOX[1] * s)
    base1 = baseline_for(bold, word_size, top, word_size)
    tr = -0.045 * word_size
    a, end1 = text_shapes(bold, "clip", word_size, tx, base1, th["word1"], tr, True)
    b, end2 = text_shapes(med, "stream", word_size, end1 + tr + (bold["hmtx"][bold.getBestCmap()[ord("p")]][0] * 0), base1, th["word2"], tr, True)
    shapes += a + b
    width = end2
    if with_label:
        base2 = baseline_for(bold, label_size, top + word_size + 12, label_size)
        lab, end3 = text_shapes(bold, "STUDIO", label_size, tx + 4, base2, th["label"], 0.62 * label_size, True)
        shapes += lab
        width = max(width, end3)
    return shapes, (0, 0, width, mark_h)


# ---------------------------------------------------------------- writers
def svg_doc(shapes, vb, title, w=None):
    vx, vy, vw, vh = vb
    out_w = w or vw
    out_h = out_w * vh / vw
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s" role="img" aria-label="%s">'
        % (fmt(vx), fmt(vy), fmt(vw), fmt(vh), fmt(out_w), fmt(out_h), title),
        "<title>%s</title>" % title,
    ]
    for sh in shapes:
        if sh["kind"] == "poly":
            pts = " ".join("%s,%s" % (fmt(x), fmt(y)) for x, y in sh["pts"])
            parts.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
                         % (pts, sh["fill"], sh["fill"], fmt(sh["sw"])))
        elif sh["kind"] == "rrect":
            parts.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="%s"/>'
                         % (fmt(sh["x"]), fmt(sh["y"]), fmt(sh["w"]), fmt(sh["h"]), fmt(sh["r"]), sh["fill"]))
        elif sh["kind"] == "glyph":
            parts.append('<path d="%s" fill="%s"/>' % (sh["d"], sh["fill"]))
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


SS = 4  # supersampling


def render_png(shapes, vb, out_w, bg=None):
    vx, vy, vw, vh = vb
    scale = out_w / vw
    W, H = max(1, round(out_w)), max(1, round(vh * scale))
    big = (W * SS, H * SS)
    k = scale * SS

    def P(x, y):
        return ((x - vx) * k, (y - vy) * k)

    img = Image.new("RGBA", big, bg or (0, 0, 0, 0))
    for sh in shapes:
        mask = Image.new("L", big, 0)
        d = ImageDraw.Draw(mask)
        if sh["kind"] == "poly":
            pts = [P(x, y) for x, y in sh["pts"]]
            d.polygon(pts, fill=255)
            sw = sh["sw"] * k
            d.line(pts + [pts[0]], fill=255, width=max(1, round(sw)), joint="curve")
            r = sw / 2
            for px, py in pts:
                d.ellipse((px - r, py - r, px + r, py + r), fill=255)
        elif sh["kind"] == "rrect":
            x0, y0 = P(sh["x"], sh["y"])
            d.rounded_rectangle((x0, y0, x0 + sh["w"] * k, y0 + sh["h"] * k), radius=sh["r"] * k, fill=255)
        elif sh["kind"] == "glyph":
            for c in sh["contours"]:
                m = Image.new("L", big, 0)
                ImageDraw.Draw(m).polygon([P(x, y) for x, y in c], fill=255)
                mask = ImageChops.difference(mask, m)  # even-odd fill
        img.paste(Image.new("RGBA", big, sh["fill"]), (0, 0), mask)
    return img.resize((W, H), Image.LANCZOS)


# ---------------------------------------------------------------- build
def main():
    for sub in ("svg", "png", "build"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    files = []

    def add_svg(name, shapes, vb, title, w):
        with open(os.path.join(OUT, "svg", name + ".svg"), "w", encoding="utf-8") as f:
            f.write(svg_doc(shapes, vb, title, w))
        files.append("svg/%s.svg" % name)

    def add_png(name, shapes, vb, w, bg=None):
        render_png(shapes, vb, w, bg).save(os.path.join(OUT, "png", name + ".png"))
        files.append("png/%s.png" % name)

    for tname, th in THEMES.items():
        ms = mark_shapes(th)
        add_svg("clipstream-mark-%s" % tname, ms, MARK_VIEWBOX, "ClipStream mark", 100)
        for w in (256, 512, 1024):
            add_png("clipstream-mark-%s-%d" % (tname, w), ms, MARK_VIEWBOX, w)
        for label, suffix in ((True, ""), (False, "-nolabel")):
            sh, vb = lockup(th, label)
            add_svg("clipstream-logo%s-%s" % (suffix, tname), sh, vb, "ClipStream Studio" if label else "ClipStream", vb[2])
            add_png("clipstream-logo%s-%s-1600w" % (suffix, tname), sh, vb, 1600)
            add_png("clipstream-logo%s-%s-800w" % (suffix, tname), sh, vb, 800)
        ic = icon_shapes(th)
        add_svg("clipstream-icon-%s" % tname, ic, (0, 0, 64, 64), "ClipStream icon", 64)
    # tile icons by background
    for tname in ("dark", "light"):
        ic = icon_shapes(THEMES[tname])
        for w in (16, 32, 48, 64, 128, 180, 192, 256, 512, 1024):
            add_png("clipstream-icon-%s-%d" % (tname, w), ic, (0, 0, 64, 64), w)
    # favicon.ico from the dark tile (works on light and dark browser tabs)
    ic = icon_shapes(THEMES["dark"])
    base = render_png(ic, (0, 0, 64, 64), 256)
    base.save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    files.append("favicon.ico")
    base.save(os.path.join(OUT, "png", "apple-touch-icon.png")) if False else None
    render_png(ic, (0, 0, 64, 64), 180).save(os.path.join(OUT, "png", "apple-touch-icon.png"))
    files.append("png/apple-touch-icon.png")

    # keep the generator with the pack so it can be re-run with Manrope
    with open(__file__, "r", encoding="utf-8") as src, open(os.path.join(OUT, "build", "build.py"), "w", encoding="utf-8") as dst:
        dst.write(src.read())
    with open(os.path.join(OUT, "build", "FILES.json"), "w") as f:
        json.dump(sorted(files), f, indent=2)
    print("wrote", len(files), "files to", OUT, "| font:", FONT_NAME)


if __name__ == "__main__":
    main()

# ClipStream Studio — logo pack

Concept: a play triangle sliced by a diagonal cut. The top piece is the clip, the bottom piece is the stream. (Design option "G".)

Bu paket ClipStream Studio logosunun SVG, PNG ve favicon dosyalarını içerir. Açık ve koyu tema ayrı dosyalardır.

## Pick the right file (read this first)

The pack has two themes. Choose by the background the logo sits on, not by the app's theme name.

| Background | Theme | Use |
|---|---|---|
| Light (white, off-white, light grey) | `light` | `*-light.*` |
| Dark (ink, black, dark grey) | `dark` | `*-dark.*` |

Logo files with the `STUDIO` label are the default. Use the `-nolabel` files where space is tight or the product name is already shown next to the logo.

## Files

`svg/` is the source of truth; text is already converted to outlines, so no font is needed.

| File | What it is |
|---|---|
| `svg/clipstream-logo-light.svg` / `-dark.svg` | Horizontal logo: mark + "clipstream" + STUDIO |
| `svg/clipstream-logo-nolabel-light.svg` / `-dark.svg` | Horizontal logo without STUDIO |
| `svg/clipstream-mark-light.svg` / `-dark.svg` | Mark only, transparent background |
| `svg/clipstream-icon-dark.svg` / `-light.svg` | Square tile icon (rounded corners), for avatars, app icons, favicons |
| `png/*-1600w.png`, `*-800w.png` | Logo PNGs, transparent background |
| `png/clipstream-mark-*-{256,512,1024}.png` | Mark PNGs, transparent background |
| `png/clipstream-icon-{dark,light}-{16..1024}.png` | Tile icon PNGs at common sizes |
| `png/apple-touch-icon.png` | 180x180 dark tile |
| `favicon.ico` | 16, 32, 48 px, dark tile |
| `logo-spec.json` | The same rules as this file, machine readable |
| `build/build.py` | Regenerates everything (see "Regenerating") |

Defaults for common jobs:
- Website header on a light page: `svg/clipstream-logo-light.svg`
- Website header on a dark page: `svg/clipstream-logo-dark.svg`
- Browser tab: `favicon.ico`, plus `svg/clipstream-icon-dark.svg` as `<link rel="icon" type="image/svg+xml">`
- Social avatar / app icon: `png/clipstream-icon-dark-512.png`
- Slide or document on white: `png/clipstream-logo-light-1600w.png`

## Colors

| Role | Light theme | Dark theme |
|---|---|---|
| Top piece of the mark, "stream" | `#EE4B28` | `#FF5A36` |
| Bottom piece of the mark, "clip" | `#11131A` | `#F6F5F2` |
| STUDIO label | `#5F6373` | `#A3A8BA` |
| Tile / page background | `#F6F5F2` | `#11131A` |

## Rules

1. Use the files as they are. Do not recolor, outline, add shadows or gradients, rotate, stretch or skew.
2. Keep clear space around the logo of at least 25% of the logo's height on every side.
3. Minimum sizes: mark 16 px high, logo 120 px wide (use `-nolabel` below 200 px wide), STUDIO label is unreadable below that.
4. Do not place the light-theme logo on dark backgrounds or the reverse; contrast drops. The dark tile icon works on both.
5. Do not redraw the mark or retype the wordmark. Always use the supplied files.
6. The light tile icon has no outline; on a pure white page add your own border if its edge must be visible.

## Wordmark font note

The wordmark lettering in this pack is set in Inter (ExtraBold for "clip", Medium for "stream", ExtraBold for STUDIO). The approved design used Manrope, which could not be downloaded when the pack was built, so letter shapes differ slightly from the design preview. The mark, colors and layout are unchanged.

## Regenerating (optional)

`build/build.py` needs Python 3 with `fonttools` and `Pillow`. To rebuild with Manrope:

```
CLIPSTREAM_FONT_BOLD=/path/Manrope-ExtraBold.ttf \
CLIPSTREAM_FONT_MED=/path/Manrope-Medium.ttf \
CLIPSTREAM_FONT_NAME=Manrope \
python3 build/build.py out-dir
```

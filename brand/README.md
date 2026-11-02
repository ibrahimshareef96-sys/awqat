# Awqat brand

Awqat is built by [Itqan Studio](https://itqanstudio.com) and wears Itqan's grammar: ink and bone, square modules,
Geist, and the dusk run. Everything here is drawn by `scripts/brand.py`; change the script, not the files.

## The mark

A pointed arch of square modules, with five squares on the sun's path inside it: one per prayer, each one stop of the
dusk run in order. The faint bar under them is the horizon.

| Prayer | Colour | Hex |
|---|---|---|
| Fajr | sand | `#F5D3A1` |
| Dhuhr | apricot | `#F89A5B` |
| Asr | coral | `#F4664F` |
| Maghrib | rose | `#EF3A78` |
| Isha | orchid | `#9B3FA0` |

The grid is 15 by 16 modules. Draw it with `shape-rendering="crispEdges"` and snap modules to whole pixels; never
round the corners, blur the modules, or reorder the colours.

## Colour

- Ink `#0B0A0D`: the ground of the icon, the banner and the app.
- Bone `#F5F1EA`: the arch, words on ink, the app's text.
- Rose `#EF3A78`: the one action on a screen (the microphone while it listens).
- The dusk run, sand to orchid: the five prayers, and at most one lit phrase per picture.

On a light page the arch is ink and the two palest stops are taken deeper (`#C98A36`, `#E27028`), so they keep their
contrast.

## Type

- Geist 600, tracked tight, for the name `awqat` and headlines; Geist 400 and 500 for lines under it.
- Geist Mono for labels (BUILT BY ITQAN).
- Readex Pro 600 for the Arabic name `أوقات`.

All three are under the SIL Open Font License 1.1 (`fonts/OFL-*.txt`). They are used to draw the brand pictures only;
the app keeps Instrument Serif and its painted skies, so its look stays calm and its own.

## Files

| File | What |
|---|---|
| `awqat-mark.svg` | The mark alone, bone on dark pages and ink on light ones |
| `awqat-icon.svg` | The app icon: the mark on ink |
| `awqat-banner.svg` | The README banner |
| `awqat-social.png` | The same as a picture, for GitHub's social preview |

The app icons and splash screens are drawn from the same mark by `scripts/make-android-icons.py` and
`scripts/make-ios-icons.py`.

# Appearance gains seven accent colours and four built-in textures

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `ui`, `web`

[中文版](2026-10-20-frost-accent-and-textures.zh.md)

Frost gains seven accent presets, and Appearance offers four built-in textures. A texture follows light and dark by itself, and only its id is stored: the picture's URL is resolved at render time.

## Details

- **Accents.** Ink green, autumn teal, warm sky, celadon, plum smoke, reed and frost blue join Frost's preset list. Light values are the theme kit's own; dark values lift each by the same rule Frost's presets follow (about +24% lightness). Every preset clears 4.5:1 for its label and 3:1 as a mark in both modes.
- **Textures.** Distant mountains, landscape, Pamir and Sayram arrive as four 1600×900 webp files with alpha, one light and one dark each, chosen by the active mode. The stored value is the preset id, never image bytes.
- **Default look.** The artwork is 16:9 and drawn for a bottom-anchored full-width layer, so the preset uses `cover` with `center bottom`. Its transparency has its own default of 25: the image already carries alpha, and the picture path's 80 would fade a texture to nothing.
- **Unchanged.** The theme contract is still 249 tokens. This adds presets and a background capability; components read tokens exactly as before.

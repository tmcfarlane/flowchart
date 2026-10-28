# Generated Draw font

`NotoSans-Regular.ttf` is the unmodified Noto Sans Regular font distributed by Debian's `fonts-noto-core` package. Its embedded copyright is Copyright 2015 Google LLC. `LICENSE` retains the upstream SIL Open Font License and the distribution's provenance notice.

Generate the pure metrics table and embedded WOFF data from these checked-in bytes:

```sh
python scripts/generate-draw-font.py
```

The generator requires Python fontTools. The application needs no font parser or new runtime dependency. The 2,840 mapped glyphs use their real font advances and horizontal ink bounds. Generated SVG text disables kerning and optional ligatures so its advance policy matches the backend. NFC-equivalent text shares its measurement. The line height and baseline contain this font's mapped ascent and descent range.

Unmapped characters reserve two em of horizontal space per codepoint and use the browser's fallback font. This is conservative for the verified CJK and emoji examples. It does not promise identical shaping, glyph availability, or appearance for every unsupported script across systems. External Excalidraw applications may map sans text to their own font. The embedded SVG font keeps this editor's previews and SVG exports self-contained.

Only elements marked with `customData.flowchartFont: "noto-sans-v1"` and sans font family 2 use this policy. Other native and imported text keeps its current font behavior.

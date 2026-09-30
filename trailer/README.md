# Flowchart AI trailer

A 56-second product trailer for [Flowchart AI](https://flowchart.zeroclickdev.ai), made with
[Remotion](https://www.remotion.dev). It lives in its own folder with its own dependencies: the
app's build, tests and Vercel deploy ignore it (see the root `.vercelignore`).

| Output | Composition | Spec |
| --- | --- | --- |
| `out/flowchart-ai-trailer.mp4` | `Trailer` | 1920×1080, 60 fps, H.264 High + AAC 320 kb/s, −14 LUFS |
| `out/flowchart-ai-trailer-vertical.mp4` | `TrailerVertical` | 1080×1920, 60 fps, same audio, every scene recomposed for portrait |
| `out/flowchart-ai-trailer-poster.png` | `Poster` | 1920×1080 still |
| `out/og-image.png`, `out/og-image-mcp.png` | `OgImage`, `OgImageMcp` | 1200×630 Open Graph cards for the website (`npm run render:og`) |

Scenes (bars of 2 s at 120 BPM, all timing in `src/timeline.ts`):

| Time | Scene |
| --- | --- |
| 0:00 | Hook: "Describe your idea…" is typed; the caret becomes the pen |
| 0:04 | Logo reveal: the gear is drawn, FLOWCHART AI and the tagline |
| 0:10 | Generate: a prompt in the app's welcome card, then the chart builds on the beat |
| 0:20 | MCP: an agent calls `create_flowchart`, the link opens, `update_flowchart` lands live in the open tab |
| 0:36 | Montage: Azure icons, presentation mode, export, Share panel, dark mode |
| 0:46 | Close: logo, tagline, URL, "Free & open source · by ZeroClickDev", MCP endpoint |

## Setup

Node 22.18 or newer (the scripts import `src/timeline.ts` directly), and `ffmpeg`/`ffprobe` on
the `PATH` for captures and QA.

```sh
cd trailer
npm install
```

## Preview

```sh
npm run studio
```

Opens Remotion Studio with the `Trailer`, `TrailerVertical`, `Poster`, `OgImage` and `OgImageMcp`
compositions. Copy and timing are in `src/timeline.ts`; colours and type come from the app's CSS via
`src/theme.ts`.

## Render

```sh
npm run render           # out/flowchart-ai-trailer.mp4
npm run render:vertical  # out/flowchart-ai-trailer-vertical.mp4
npm run render:poster    # out/flowchart-ai-trailer-poster.png
npm run render:og        # out/og-image.png, out/og-image-mcp.png (website Open Graph cards)
npm run render:all       # music, all three, then QA
npm run qa               # specs, duration, loudness
npm run qa:frames        # the same, plus small review JPEGs in out/review
```

Each render first runs `npm run assets`, which copies the app's logos, Azure icons and fonts into
`public/` (the repo stays the source of truth) and renders the soundtrack if it is missing. The
videos are rendered muted, then `scripts/mux-audio.mjs` adds `public/audio/trailer-mix.wav` as AAC
with a proper priming edit list (Remotion's own AAC track plays about 43 ms late).
Single frames for review: `node scripts/qa/stills.mjs Trailer 600,1500` (writes PNGs to `out/frames`).

## Web copies for the site

The website serves smaller copies from the app's `public/media/` (used by `/mcp`, the Open Graph
tags in `index.html` and `mcp.html`, and `llms.txt`). The `OgImage` and `OgImageMcp` stills
(1200×630, `src/OgImage.tsx`) render with `npm run render:og`. From `trailer/`:

```sh
# Trailers: H.264 High 4.2, 60 fps, AAC 160 kb/s, moov atom first. Use the same for the vertical cut.
ffmpeg -i out/flowchart-ai-trailer.mp4 -map 0:v:0 -map 0:a:0 -c:v libx264 -preset veryslow -crf 19 \
  -profile:v high -level:v 4.2 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -g 240 -c:a aac_at -b:a 160k -map_metadata -1 -movflags +faststart ../public/media/flowchart-ai-trailer.mp4

# Posters and Open Graph images: JPEG without chroma subsampling, so small text stays sharp.
ffmpeg -i out/flowchart-ai-trailer-poster.png -q:v 3 -pix_fmt yuvj444p ../public/media/flowchart-ai-trailer-poster.jpg
npx remotion still src/index.ts TrailerVertical out/poster-vertical.png --frame=3200
ffmpeg -i out/poster-vertical.png -q:v 3 -pix_fmt yuvj444p ../public/media/flowchart-ai-trailer-poster-vertical.jpg
ffmpeg -i out/og-image.png -q:v 2 -pix_fmt yuvj444p ../public/media/og-image.jpg
ffmpeg -i out/og-image-mcp.png -q:v 2 -pix_fmt yuvj444p ../public/media/og-image-mcp.jpg

# README teaser: the MCP update moment, 7.8 s, 720 px, 25 fps.
ffmpeg -ss 25.6 -t 7.8 -i out/flowchart-ai-trailer.mp4 -filter_complex \
  "[0:v]crop=1840:944:40:108,fps=25,scale=720:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
  -loop 0 ../docs/screenshots/trailer-teaser.gif
```

`aac_at` is the macOS AudioToolbox encoder; elsewhere use `-c:a aac`. For a video attachment on a
free GitHub plan (10 MB limit), the same command with `-crf 21` gives about 9.2 MB.

## Re-capture the app

The MCP scene, the montage and the poster use real captures of the app. To refresh them after a UI
change, start the app's dev server in the repo root, then run the capture:

```sh
# repo root
npm run dev              # http://localhost:3004

# trailer/
npm run capture                   # layouts, landscape and portrait
npm run capture -- landscape      # or just one of: layouts | landscape | portrait
```

The script drives the app's MCP server like an agent would (`create_flowchart`, `get_flowchart`,
`update_flowchart`), opens the returned edit link in headless Chromium at 2× DPI, records the live
agent update and presentation mode frame by frame, and takes the Share, Export, light/dark and icon
picker stills. The browser sees the local server as `https://flowchart.zeroclickdev.ai`, and the
chart as `/f/hDZT5de3oe`; nothing is sent to the real site. It writes `public/captures/` (including
`agent-update.png`, the poster's still) and `src/data/captures.json`.

Options: `APP_URL` (default `http://localhost:3004`), `CHART_ID` (the 10-character id shown),
`KEEP_FRAMES=1` (keep the raw frames in `.capture-tmp`). The demo chart and the agent's edit are
in `src/data/demo-chart.json`; the generated chart in the Generate scene is
`src/data/generate-chart.json` (its layouts come from the `layouts` target).

## Regenerate the music

```sh
npm run music             # public/audio/trailer-mix.wav
npm run music -- --stems  # also writes per-bus stems (git-ignored)
```

The score and every sound effect are synthesised by `scripts/audio/` from the same cue list the
picture uses, so changing a cue in `src/timeline.ts` and re-running `npm run music` keeps the
sound in sync. The mix is normalised to −14 LUFS integrated with a true-peak ceiling below −1 dBTP.
See [AUDIO_LICENSE.md](AUDIO_LICENSE.md).

## Licenses

- Remotion is free for individuals and companies of up to 3 people; larger companies need a
  company license. See [remotion.dev/license](https://www.remotion.dev/license).
- Music and sound effects: original, generated by code in this folder (MIT, see `AUDIO_LICENSE.md`).
- Inter and JetBrains Mono: SIL Open Font License (license files are copied to `public/fonts`).
- Logos and Azure icons are the app's own assets, copied from the repo by `npm run assets`.

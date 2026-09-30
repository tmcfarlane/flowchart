# Trailer audio: source and license

**File:** `public/audio/trailer-mix.wav` (48 kHz, 16-bit, stereo, 56 s), muxed into the rendered
MP4s as AAC.

## How it was made

The music and every sound effect are synthesised from scratch by the scripts in `scripts/audio/`
(`npm run music`). No samples, loops, sound libraries, presets, recordings or AI audio generators
are used. Nothing third-party is in the file.

- **Score** (`render-audio.mjs`): an original 120 BPM electronic cue in D major, one chord per
  2-second bar (Dmaj9, Gmaj7, A6, Bm7), arranged to the picture: a quiet pad intro, a pre-drop
  into the chart build, a breakdown under the agent conversation, a lift for the feature montage,
  and a held final chord under the logo. The three-note brand motif (F♯5, A5, D6) plays when
  the logo's pointer lands and again on the close.
- **Instruments** (`instruments.mjs`): detuned band-limited saw pads, a plucked saw/pulse
  arpeggio, sub-and-saw bass, and drums built from sine sweeps and filtered noise (kick, clap,
  hats, shaker). Risers, swells and impacts are filtered noise with gliding tones; the bells are
  two-operator FM.
- **Sound design**: key ticks, UI clicks, pops, whooshes and bells are placed on the exact frames
  of the on-screen events (typing, clicks, nodes appearing, tool calls, the live update) by
  reading the same cue list the video uses, `src/timeline.ts`.
- **Mix and master** (`dsp.mjs`): state-variable filters, a Freeverb-style reverb (an original
  implementation of Jezar's public-domain algorithm), ping-pong delay, kick sidechain ducking,
  glue compression, a look-ahead limiter, and loudness measured per ITU-R BS.1770-4. The master
  is normalised to −14 LUFS integrated with the true peak kept below −1 dBTP, then written with
  TPDF dither.

Every random source is seeded, so re-running `npm run music` reproduces the same file.

## License

The music and sound effects are original works created for Flowchart AI by ZeroClickDev and are
released under the repository's [MIT License](../LICENSE). They may be used, modified and
redistributed with the trailer or on their own under those terms. There are no third-party
rights to clear.

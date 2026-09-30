#!/usr/bin/env node
// Muxes the soundtrack into a rendered video: the video stream is copied untouched and
// public/audio/trailer-mix.wav is encoded as AAC-LC 320 kb/s.
//
// Why not Remotion's own audio track: it starts with ~2048 samples of AAC encoder padding
// and no edit list to skip them, so the sound plays ~43 ms (2.5 frames) behind the picture.
// ffmpeg's MP4 muxer records the encoder delay in an edit list, which players honour, so
// every click and hit lands on its frame.
//
// Usage: node scripts/mux-audio.mjs out/flowchart-ai-trailer.mp4 [more.mp4 ...]

import { execFileSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIX = join(ROOT, 'public', 'audio', 'trailer-mix.wav')

const videos = process.argv.slice(2)
if (!videos.length) throw new Error('Usage: node scripts/mux-audio.mjs <video.mp4> [...]')
if (!existsSync(MIX)) throw new Error('public/audio/trailer-mix.wav is missing: run `npm run music` first')

for (const video of videos) {
  const tmp = video.replace(/\.mp4$/, '.mux-tmp.mp4')
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-i', video,
      '-i', MIX,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '320k',
      '-movflags', '+faststart',
      tmp,
    ],
    { stdio: 'inherit' },
  )
  renameSync(tmp, video)
  console.log(`[mux] ${video}: soundtrack muxed (AAC 320 kb/s)`)
}

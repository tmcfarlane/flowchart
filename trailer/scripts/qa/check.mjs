#!/usr/bin/env node
// Checks the rendered deliverables: container/stream specs, duration against the timeline,
// loudness (EBU R128 integrated + true peak) and the poster size. With --frames it also
// writes small review JPEGs at every scene midpoint and cut to out/review/.
//
// Usage: node scripts/qa/check.mjs [--frames]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FPS, SCENES, TOTAL_FRAMES } from '../../src/timeline.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'out')
const DURATION = TOTAL_FRAMES / FPS
const LOUDNESS = { target: -14, tolerance: 1, truePeakMax: -1 }

const videos = [
  { file: 'flowchart-ai-trailer.mp4', width: 1920, height: 1080 },
  { file: 'flowchart-ai-trailer-vertical.mp4', width: 1080, height: 1920 },
]
const poster = { file: 'flowchart-ai-trailer-poster.png', width: 1920, height: 1080 }

let failures = 0
const check = (ok, label, detail) => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}
const mb = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`

function probe(path) {
  const json = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' })
  return JSON.parse(json)
}

function loudnessOf(path) {
  let text
  try {
    text = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${path}" -map 0:a:0 -af ebur128=peak=true -f null - 2>&1`], { encoding: 'utf8' })
  } catch (err) {
    text = String(err.stdout ?? '')
  }
  const summary = text.slice(text.lastIndexOf('Summary:'))
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1])
  const range = Number(/LRA:\s+(-?[\d.]+) LU/.exec(summary)?.[1])
  const truePeak = Number(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1])
  return { integrated, range, truePeak }
}

console.log(`timeline: ${TOTAL_FRAMES} frames @ ${FPS} fps = ${DURATION.toFixed(2)} s`)
check(DURATION >= 45 && DURATION <= 60, 'timeline length is 45-60 s', `${DURATION.toFixed(2)} s`)

for (const v of videos) {
  const path = join(OUT, v.file)
  if (!existsSync(path)) {
    check(false, `${v.file} exists`)
    continue
  }
  const { streams, format } = probe(path)
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  const [num, den] = String(video?.r_frame_rate ?? '0/1').split('/').map(Number)
  const fps = num / den
  const duration = Number(format.duration)
  console.log(`\n${v.file}: ${mb(path)}, ${video?.width}x${video?.height} ${video?.codec_name} ${video?.profile} ${video?.pix_fmt} ${fps} fps, ${duration.toFixed(3)} s`)
  check(video?.codec_name === 'h264', 'video is H.264', video?.codec_name)
  check(video?.width === v.width && video?.height === v.height, `resolution ${v.width}x${v.height}`, `${video?.width}x${video?.height}`)
  check(Math.abs(fps - FPS) < 0.01, `${FPS} fps`, `${fps}`)
  check(Math.abs(duration - DURATION) < 0.1, 'duration matches the timeline', `${duration.toFixed(3)} s`)
  check(!!audio, 'has an audio stream', audio ? `${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels} ch ${Math.round(Number(audio.bit_rate) / 1000)} kb/s` : 'none')
  if (audio) {
    check(audio.codec_name === 'aac', 'audio is AAC', audio.codec_name)
    // Encoder padding without an edit list shows up as a longer audio track (and late sound).
    const audioDuration = Number(audio.duration)
    check(Math.abs(audioDuration - Number(video.duration)) < 0.005, 'audio starts and ends with the picture', `audio ${audioDuration.toFixed(3)} s, video ${Number(video.duration).toFixed(3)} s`)
    const l = loudnessOf(path)
    console.log(`     loudness: ${l.integrated} LUFS integrated, LRA ${l.range} LU, true peak ${l.truePeak} dBTP`)
    check(Math.abs(l.integrated - LOUDNESS.target) <= LOUDNESS.tolerance, `integrated loudness ${LOUDNESS.target} ±${LOUDNESS.tolerance} LUFS`, `${l.integrated}`)
    check(l.truePeak <= LOUDNESS.truePeakMax, `true peak ≤ ${LOUDNESS.truePeakMax} dBTP`, `${l.truePeak}`)
  }
}

const posterPath = join(OUT, poster.file)
if (existsSync(posterPath)) {
  const s = probe(posterPath).streams[0]
  console.log(`\n${poster.file}: ${mb(posterPath)}, ${s.width}x${s.height}`)
  check(s.width === poster.width && s.height === poster.height, `poster ${poster.width}x${poster.height}`)
} else {
  check(false, `${poster.file} exists`)
}

if (process.argv.includes('--frames')) {
  // Scene midpoints plus a moment just after each cut, as small JPEGs for review.
  const reviewDir = join(OUT, 'review')
  mkdirSync(reviewDir, { recursive: true })
  const moments = []
  for (const [name, s] of Object.entries(SCENES)) {
    moments.push({ name: `${name}-mid`, frame: s.from + Math.floor(s.duration / 2) })
    if (s.from > 0) moments.push({ name: `${name}-cut`, frame: s.from + 6 })
  }
  for (const v of videos) {
    const path = join(OUT, v.file)
    if (!existsSync(path)) continue
    const tag = v.height > v.width ? 'vertical' : 'landscape'
    for (const m of moments) {
      const out = join(reviewDir, `${tag}-${String(m.frame).padStart(4, '0')}-${m.name}.jpg`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', (m.frame / FPS).toFixed(4), '-i', path, '-frames:v', '1', '-vf', `scale=${tag === 'vertical' ? '-2:1280' : '1280:-2'}`, '-q:v', '3', out])
    }
  }
  console.log(`\nreview frames: ${reviewDir}`)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)

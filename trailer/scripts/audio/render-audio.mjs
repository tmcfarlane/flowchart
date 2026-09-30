#!/usr/bin/env node
// Composes, mixes and masters the trailer soundtrack: an original 120 BPM electronic score
// in D major plus UI sound design, placed from the same timeline the video uses
// (src/timeline.ts), normalised to -14 LUFS with a true-peak ceiling.
//
// Output: public/audio/trailer-mix.wav (48 kHz, 16-bit, stereo)
// Usage:  node scripts/audio/render-audio.mjs [--stems]

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SR, SVF, Stereo, db, integratedLufs, limit, mulberry32, pingPong, reverb, toDb, truePeakDb, wav16 } from './dsp.mjs'
import { bass, bell, clap, hat, impact, keyTick, kick, pad, pluck, pop, riser, shaker, swell, uiClick, whoosh } from './instruments.mjs'
import { CLOSE, FPS, GENERATE, HOOK, LOGO, MCP, MONTAGE, TOTAL_FRAMES, TRANSITIONS, nodeAppearFrame } from '../../src/timeline.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'public', 'audio')
const DUR = TOTAL_FRAMES / FPS
const TARGET_LUFS = -14
const CEILING_DB = -1.8

const s = (frame) => frame / FPS
const bar = (b) => b * 2
const beat = (b) => b * 0.5
const log = (...a) => console.log('[audio]', ...a)

// ---------------------------------------------------------------------------
// Harmony: one chord per bar (28 bars at 120 BPM)
// ---------------------------------------------------------------------------
const CH = {
  D: { root: 38, pad: [54, 57, 61, 64], arp: [62, 66, 69, 73, 74, 78] }, // Dmaj9
  G: { root: 31, pad: [55, 59, 62, 66], arp: [62, 67, 71, 74, 78, 79] }, // Gmaj7
  A: { root: 33, pad: [57, 61, 64, 66], arp: [61, 64, 69, 73, 76, 78] }, // A6
  Bm: { root: 35, pad: [54, 57, 59, 62], arp: [62, 66, 71, 73, 74, 78] }, // Bm7
}
// hook | logo | generate (pre-drop, drop) | mcp (breakdown, groove) | montage | close
const PROG = ['D', 'D', 'G', 'D', 'A', 'Bm', 'G', 'D', 'G', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G', 'A', 'D', 'G', 'A', 'Bm', 'G', 'A', 'D', 'G', 'D', 'D', 'D']
const GROOVE = new Set([7, 8, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])

// Buses
const bus = {
  pads: new Stereo(DUR),
  bass: new Stereo(DUR),
  arp: new Stereo(DUR),
  kick: new Stereo(DUR),
  perc: new Stereo(DUR),
  fx: new Stereo(DUR),
  bells: new Stereo(DUR),
  pops: new Stereo(DUR),
  sfx: new Stereo(DUR),
}
const kicks = []

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------
for (let b = 0; b < PROG.length; b++) {
  const ch = CH[PROG[b]]
  const t = bar(b)
  // Pads: always on, brighter as the film opens up; the last bars ring out.
  const vel = b < 2 ? 0.6 : b < 7 ? 0.8 : b >= 23 ? 1.0 : 0.9
  const cutoff = b < 2 ? [380, 1100] : b < 7 ? [600, 1700] : b >= 25 ? [500, 1400] : [900, 2600]
  const dur = b === 27 ? 1.2 : b === 26 ? 2.0 : 2.0
  pad(bus.pads, t, dur, ch.pad, { vel, cutoff, attack: b === 0 ? 1.8 : 0.35, release: b >= 25 ? 2.6 : 1.1, seed: b + 1 })

  // Bass
  if (GROOVE.has(b)) {
    bass(bus.bass, t, 0.22, ch.root, { vel: 1 })
    for (let q = 0; q < 4; q++) bass(bus.bass, t + beat(q) + 0.25, 0.2, ch.root + (q === 3 ? 12 : 0), { vel: 0.85 })
  } else if ((b >= 5 && b <= 6) || b === 10 || b === 11) {
    // Pre-drop and breakdown: held roots, felt more than heard
    bass(bus.bass, t, 1.9, ch.root, { vel: 0.4 })
  } else if (b === 23) {
    bass(bus.bass, t, 1.6, ch.root, { vel: 0.7 })
  }

  // Arpeggio (16ths; 8ths when it is introduced and when it winds down)
  const pattern = [0, 2, 4, 5, 3, 1, 4, 2, 0, 3, 5, 4, 2, 1, 3, 4]
  const arpOn = b >= 3 && b <= 25
  if (arpOn) {
    const sixteenths = b >= 5 && b <= 22
    const brightness = b <= 4 ? 0.25 : b <= 6 ? 0.3 + 0.25 * (b - 5) : b === 10 || b === 11 ? 0.45 : b >= 23 ? 0.35 : 0.9
    const avel = b <= 4 ? 0.45 : b <= 6 ? 0.55 : b >= 23 ? 0.5 : 0.72
    for (let st = 0; st < 16; st += sixteenths ? 1 : 2) {
      const note = ch.arp[pattern[st] % ch.arp.length]
      const accent = st % 4 === 0 ? 1 : 0.72
      pluck(bus.arp, t + st * 0.125, note, { vel: avel * accent, bright: brightness, pan: st % 2 ? 0.35 : -0.35 })
    }
  }

  // Drums
  if (GROOVE.has(b)) {
    for (let q = 0; q < 4; q++) {
      kick(bus.kick, t + beat(q), { vel: q === 0 ? 1 : 0.92 })
      kicks.push(t + beat(q))
      hat(bus.perc, t + beat(q) + 0.25, { vel: 0.8, pan: 0.2 })
      if (q === 1 || q === 3) clap(bus.perc, t + beat(q), { vel: 0.9, pan: -0.05 })
    }
    if (b >= 14) for (let st = 0; st < 16; st++) shaker(bus.perc, t + st * 0.125 + (st % 2 ? 0.012 : 0), { vel: st % 4 === 2 ? 0.8 : 0.45, pan: -0.3 })
    if (b === 9 || b === 17 || b === 22) hat(bus.perc, t + beat(3) + 0.25, { vel: 0.9, open: true, pan: 0.25 })
  } else if (b === 5 || b === 6) {
    for (let q = 0; q < 4; q++) hat(bus.perc, t + beat(q) + 0.25, { vel: 0.45 + 0.1 * (b - 5), pan: 0.2 })
  }
}
// Montage lift: sparkle arp an octave up on the off-sixteenths, open hats on the offbeats.
for (let b = 18; b <= 22; b++) {
  const ch = CH[PROG[b]]
  for (let st = 1; st < 16; st += 2) {
    pluck(bus.arp, bar(b) + st * 0.125, ch.arp[(st * 3) % ch.arp.length] + 12, { vel: 0.32, bright: 1, pan: st % 4 === 1 ? 0.6 : -0.6, decay: 0.12 })
  }
  for (let q = 0; q < 4; q++) hat(bus.perc, bar(b) + beat(q) + 0.25, { vel: 0.35, open: true, pan: -0.25 })
}
// The close lands on a single kick with the impact.
kick(bus.kick, bar(23), { vel: 1 })
kicks.push(bar(23))

// Builds and hits, aligned to scene changes
riser(bus.fx, 4.0, s(LOGO.drawEnd), { vel: 0.35, from: 900, to: 6000, tone: false }) // the pen drawing the logo
swell(bus.fx, bar(3), 0.9, { vel: 0.6, note: 62 })
riser(bus.fx, 8.6, 10.0, { vel: 0.45 })
riser(bus.fx, 12.4, 14.0, { vel: 0.7 })
swell(bus.fx, 14.0, 1.0, { vel: 0.7, note: 66 })
riser(bus.fx, 22.6, 24.0, { vel: 0.55 })
riser(bus.fx, s(MCP.toolUpdateDone), s(MCP.updateLands), { vel: 0.4, from: 1200, to: 9000, tone: false })
riser(bus.fx, 34.6, 36.0, { vel: 0.65 })
riser(bus.fx, 44.8, 46.0, { vel: 0.75 })
swell(bus.fx, 46.0, 1.1, { vel: 0.8, note: 62 })
impact(bus.fx, bar(3), { vel: 0.55, air: 0.6 })
impact(bus.fx, 14.0, { vel: 0.9 })
impact(bus.fx, 24.0, { vel: 0.7 })
impact(bus.fx, 36.0, { vel: 0.8 })
for (const c of MONTAGE.cuts.slice(1)) impact(bus.fx, s(c), { vel: 0.45, air: 0.5 })
impact(bus.fx, s(CLOSE.hit), { vel: 1.0 })

// Brand motif: F#5 A5 D6 (the pointer landing in the logo)
const motif = (t0, step, vel) => {
  bell(bus.bells, t0, 78, { vel: vel * 0.8, pan: -0.25 })
  bell(bus.bells, t0 + step, 81, { vel: vel * 0.85, pan: 0.2 })
  bell(bus.bells, t0 + step * 2, 86, { vel, pan: 0, decay: 2.2 })
  bell(bus.bells, t0 + step * 2, 74, { vel: vel * 0.5, ratio: 2, index: 1.2, decay: 2.4 })
}
motif(bar(3) - 0.5, 0.25, 0.9)
motif(s(CLOSE.hit), s(22) / 2, 1.0)

// ---------------------------------------------------------------------------
// Sound design from the picture's own cues
// ---------------------------------------------------------------------------
HOOK.typing.forEach((f, i) => keyTick(bus.sfx, s(f), { vel: 0.95, seed: 100 + i }))
uiClick(bus.sfx, s(LOGO.pointerIn), { vel: 0.5 })

GENERATE.typing.forEach((f, i) => keyTick(bus.sfx, s(f), { vel: 0.7, seed: 400 + i }))
uiClick(bus.sfx, s(GENERATE.click), { vel: 1 })
const popNotes = [74, 78, 81, 86, 78, 81, 86, 90, 83, 86, 91]
GENERATE.order.forEach((_, i) => pop(bus.pops, s(nodeAppearFrame(i)), popNotes[i % popNotes.length], { vel: 0.9, pan: -0.4 + (0.8 * i) / GENERATE.order.length }))
whoosh(bus.sfx, s(GENERATE.fitStart) - 0.05, 0.9, { vel: 0.35, up: false, lo: 300, hi: 2400, panFrom: 0.4, panTo: -0.4 })

for (const cut of TRANSITIONS) whoosh(bus.sfx, s(cut) - 0.42, 0.5, { vel: 0.45, up: true })

// MCP conversation
const msgPop = (f, note) => pop(bus.sfx, s(f), note, { vel: 0.35 })
msgPop(MCP.user1 + 4, 81)
uiClick(bus.sfx, s(MCP.toolCreate), { vel: 0.3 })
MCP.toolCreateArgs.forEach((f) => keyTick(bus.sfx, s(f), { vel: 0.25, seed: f }))
bell(bus.bells, s(MCP.toolCreateDone), 81, { vel: 0.45, pan: -0.3, decay: 0.8 })
bell(bus.bells, s(MCP.toolCreateDone) + 0.09, 88, { vel: 0.4, pan: -0.3, decay: 1.0 })
msgPop(MCP.assistantLink + 4, 86)
uiClick(bus.sfx, s(MCP.linkClick), { vel: 1 })
MCP.user2Typing.forEach((f, i) => keyTick(bus.sfx, s(f), { vel: 0.65, seed: 700 + i }))
uiClick(bus.sfx, s(MCP.send), { vel: 0.8 })
uiClick(bus.sfx, s(MCP.toolGet), { vel: 0.25 })
bell(bus.bells, s(MCP.toolGetDone), 86, { vel: 0.25, pan: -0.3, decay: 0.6 })
uiClick(bus.sfx, s(MCP.toolUpdate), { vel: 0.3 })
MCP.toolUpdateArgs.forEach((f) => keyTick(bus.sfx, s(f), { vel: 0.25, seed: f }))
bell(bus.bells, s(MCP.toolUpdateDone), 81, { vel: 0.45, pan: -0.3, decay: 0.8 })
bell(bus.bells, s(MCP.toolUpdateDone) + 0.09, 88, { vel: 0.4, pan: -0.3, decay: 1.0 })
// The open tab updates: a bright chord where the mint glow appears
for (const [dt, note] of [[0, 86], [0.06, 90], [0.12, 93], [0.18, 98]]) bell(bus.bells, s(MCP.updateLands) + dt, note, { vel: 0.7, pan: 0.35, decay: 1.8 })
whoosh(bus.sfx, s(MCP.pullBackStart), 0.7, { vel: 0.25, up: true, panFrom: 0.5, panTo: -0.2 })
whoosh(bus.sfx, s(MCP.clientsIn) - 0.3, 0.7, { vel: 0.22, up: false, panFrom: -0.2, panTo: 0.3 })

// Montage
const rain = mulberry32(2024)
for (let i = 0; i < 44; i++) {
  const t = s(MONTAGE.cuts[0]) + 0.05 + (i / 44) ** 0.8 * 1.15 + rain() * 0.05
  pop(bus.pops, t, [86, 88, 90, 93, 95, 98][Math.floor(rain() * 6)], { vel: 0.25 + rain() * 0.2, pan: rain() * 1.6 - 0.8 })
}
for (const press of [12, 75]) {
  const t = s(MONTAGE.cuts[1] + press - 8)
  uiClick(bus.sfx, t, { vel: 0.45 })
  whoosh(bus.sfx, t + 0.02, 0.5, { vel: 0.22, up: false, lo: 400, hi: 2800, panFrom: 0.3, panTo: -0.3 })
}
MONTAGE.exportHovers.forEach((f) => keyTick(bus.sfx, s(f) - 0.05, { vel: 0.45, seed: f }))
uiClick(bus.sfx, s(MONTAGE.shareClick), { vel: 0.9 })
bell(bus.bells, s(MONTAGE.shareClick) + 0.05, 86, { vel: 0.35, decay: 0.7 })
bell(bus.bells, s(MONTAGE.shareClick) + 0.13, 93, { vel: 0.3, decay: 0.9 })
uiClick(bus.sfx, s(MONTAGE.darkClick), { vel: 0.9 })
whoosh(bus.sfx, s(MONTAGE.darkClick) + 0.02, 0.45, { vel: 0.4, up: true, lo: 200, hi: 4200 })

// Close
pop(bus.sfx, s(CLOSE.urlIn), 86, { vel: 0.35 })

// ---------------------------------------------------------------------------
// Mix
// ---------------------------------------------------------------------------
function sidechain(buffer, depth, release = 0.13) {
  const g = new Float32Array(buffer.length).fill(1)
  for (const t of kicks) {
    const i0 = Math.round(t * SR)
    for (let k = 0; k < Math.round(release * 6 * SR) && i0 + k < buffer.length; k++) {
      const tt = k / SR
      const duck = depth * Math.min(1, tt / 0.004) * Math.exp(-tt / release)
      g[i0 + k] = Math.min(g[i0 + k], 1 - duck)
    }
  }
  for (let i = 0; i < buffer.length; i++) {
    buffer.L[i] *= g[i]
    buffer.R[i] *= g[i]
  }
}

sidechain(bus.pads, 0.4)
sidechain(bus.bass, 0.7, 0.11)
sidechain(bus.arp, 0.3)

// Balanced from stem loudness: kick and bass lead, pads/arp ~6-8 LU under, UI sounds clearly audible.
const levels = { pads: 1.35, bass: 1.0, arp: 1.3, kick: 0.5, perc: 0.55, fx: 0.5, bells: 0.75, pops: 0.5, sfx: 1.1 }
const sends = { pads: 0.25, arp: 0.3, perc: 0.18, fx: 0.3, bells: 0.55, pops: 0.25, sfx: 0.06 }

const dry = new Stereo(DUR)
const revIn = new Stereo(DUR)
const delayIn = new Stereo(DUR)
for (const [name, level] of Object.entries(levels)) {
  dry.mixIn(bus[name], level)
  if (sends[name]) revIn.mixIn(bus[name], level * sends[name])
}
delayIn.mixIn(bus.arp, levels.arp * 0.22)
delayIn.mixIn(bus.bells, levels.bells * 0.3)
log('reverb and delay…')
const rev = reverb(revIn, { room: 0.86, damp: 0.4, width: 1 })
sidechain(rev, 0.25)
const dly = pingPong(delayIn, { time: 0.375, feedback: 0.38 })
const master = new Stereo(DUR)
master.mixIn(dry, 1)
master.mixIn(rev, 1)
master.mixIn(dly, 0.55)

// Master: 25 Hz high-pass, gentle glue compression, fade to silence at the end.
const hpL = new SVF()
const hpR = new SVF()
hpL.set(25, 0.7)
hpR.set(25, 0.7)
let env = 0
const thr = db(-16)
const att = Math.exp(-1 / (0.012 * SR))
const rel = Math.exp(-1 / (0.18 * SR))
for (let i = 0; i < master.length; i++) {
  hpL.run(master.L[i])
  hpR.run(master.R[i])
  let l = hpL.hp
  let r = hpR.hp
  const lvl = Math.max(Math.abs(l), Math.abs(r))
  env = lvl > env ? lvl + (env - lvl) * att : lvl + (env - lvl) * rel
  const over = env / thr
  const gain = over > 1 ? over ** (1 / 2.2 - 1) : 1
  const t = i / SR
  const fade = t > DUR - 2.6 ? Math.max(0, (DUR - t) / 2.6) ** 1.6 : 1
  master.L[i] = l * gain * fade
  master.R[i] = r * gain * fade
}

// Loudness: iterate gain -> limiter -> measure until on target.
let gainDb = 0
const measure = (g) => {
  const b = new Stereo(DUR)
  b.mixIn(master, db(g))
  limit(b, CEILING_DB)
  return { b, lufs: integratedLufs(b) }
}
let result = measure(gainDb)
for (let k = 0; k < 6 && Math.abs(result.lufs - TARGET_LUFS) > 0.05; k++) {
  gainDb += TARGET_LUFS - result.lufs
  result = measure(gainDb)
}
const tp = truePeakDb(result.b)
log(`integrated ${result.lufs.toFixed(2)} LUFS, true peak ${tp.toFixed(2)} dBTP, gain ${gainDb.toFixed(2)} dB`)

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'trailer-mix.wav'), wav16(result.b))
if (process.argv.includes('--stems')) {
  for (const [name, b] of Object.entries(bus)) writeFileSync(join(OUT, `stem-${name}.wav`), wav16(b))
}
log('wrote', join(OUT, 'trailer-mix.wav'), `(${DUR}s)`, 'peak sample', toDb(Math.max(...[result.b.L, result.b.R].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)))).toFixed(2), 'dBFS')

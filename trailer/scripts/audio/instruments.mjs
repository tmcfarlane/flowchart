// Instruments and sound effects for the trailer score. Each function renders one event
// into a Stereo buffer at time t (seconds). All synthesis is original: oscillators,
// filtered noise and FM; no samples.

import { SR, SVF, adsr, hz, mulberry32, panGains, polyblep } from './dsp.mjs'

const TAU = Math.PI * 2
const idx = (t) => Math.round(t * SR)

function write(buf, i, l, r) {
  if (i >= 0 && i < buf.length) {
    buf.L[i] += l
    buf.R[i] += r
  }
}

/** Warm detuned-saw pad, one voice per note, soft filter opening. */
export function pad(buf, t0, dur, notes, { vel = 1, attack = 0.45, release = 1.1, cutoff = [700, 2200], seed = 1 } = {}) {
  const rand = mulberry32(seed)
  const detunes = [-0.09, 0, 0.085]
  const pans = [-0.55, 0, 0.55]
  const total = dur + release * 4
  const start = idx(t0)
  const n = idx(total)
  for (const note of notes) {
    const f = hz(note)
    const filters = [new SVF(), new SVF()]
    const highpass = [new SVF(), new SVF()]
    highpass[0].set(170, 0.7)
    highpass[1].set(170, 0.7)
    const phases = detunes.map(() => rand())
    const lfoPhase = rand() * TAU
    for (let k = 0; k < n; k++) {
      const t = k / SR
      const env = adsr(t, dur, attack, 1.5, 0.85, release)
      if (t > dur && env < 1e-4) break
      let l = 0
      let r = 0
      for (let v = 0; v < 3; v++) {
        const fv = f * 2 ** (detunes[v] / 12)
        const dt = fv / SR
        let p = phases[v] + dt
        if (p >= 1) p -= 1
        phases[v] = p
        const s = 2 * p - 1 - polyblep(p, dt)
        const [gl, gr] = panGains(pans[v])
        l += s * gl
        r += s * gr
      }
      const open = Math.min(1, t / (attack * 2.5))
      const fc = cutoff[0] + (cutoff[1] - cutoff[0]) * open + 180 * Math.sin(lfoPhase + t * 0.9)
      filters[0].set(fc, 0.6)
      filters[1].set(fc, 0.6)
      const g = env * vel * 0.05
      highpass[0].run(filters[0].run(l))
      highpass[1].run(filters[1].run(r))
      write(buf, start + k, highpass[0].hp * g, highpass[1].hp * g)
    }
  }
}

/** Plucky synth for arpeggios: saw + pulse through a snappy low-pass. */
export function pluck(buf, t, note, { vel = 1, bright = 1, pan = 0, decay = 0.2 } = {}) {
  const f = hz(note)
  const dt = f / SR
  const filter = new SVF()
  const [gl, gr] = panGains(pan)
  const n = idx(decay * 6 + 0.02)
  let p1 = 0
  let p2 = 0.37
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    p1 += dt
    if (p1 >= 1) p1 -= 1
    p2 += dt * 1.003
    if (p2 >= 1) p2 -= 1
    const saw = 2 * p1 - 1 - polyblep(p1, dt)
    const sq = (p2 < 0.3 ? 1 : -1) + polyblep(p2, dt) - polyblep((p2 + 0.7) % 1, dt)
    const env = Math.min(1, tt / 0.002) * Math.exp(-tt / decay)
    filter.set(260 + bright * 4200 * Math.exp(-tt / 0.07), 0.9)
    const y = filter.run(saw * 0.7 + sq * 0.3) * env * vel * 0.2
    write(buf, start + k, y * gl, y * gr)
  }
}

/** Sub + filtered saw bass with a touch of drive. */
export function bass(buf, t, dur, note, { vel = 1 } = {}) {
  const f = hz(note)
  const filter = new SVF()
  filter.set(420, 0.8)
  const n = idx(dur + 0.12)
  let ps = 0
  let pw = 0
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    ps += f / SR
    if (ps >= 1) ps -= 1
    pw += (2 * f) / SR
    if (pw >= 1) pw -= 1
    const saw = 2 * pw - 1 - polyblep(pw, (2 * f) / SR)
    const env = adsr(tt, dur, 0.006, 0.4, 0.8, 0.05)
    const y = Math.tanh((Math.sin(TAU * ps) * 0.72 + filter.run(saw) * 0.5) * 1.4) * env * vel * 0.3
    write(buf, start + k, y, y)
  }
}

export function kick(buf, t, { vel = 1 } = {}) {
  const rand = mulberry32(Math.round(t * 1000) + 7)
  const hp = new SVF()
  hp.set(3000, 0.7)
  const n = idx(0.55)
  let phase = 0
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    const f = 43 + 105 * Math.exp(-tt / 0.028) + 22 * Math.exp(-tt / 0.12)
    phase += f / SR
    const body = Math.sin(TAU * phase) * Math.min(1, tt / 0.0012) * Math.exp(-tt / 0.28)
    hp.run(rand() * 2 - 1)
    const click = hp.hp * Math.exp(-tt / 0.0025) * 0.35
    const y = Math.tanh((body + click) * 1.5) * vel * 0.72
    write(buf, start + k, y, y)
  }
}

export function clap(buf, t, { vel = 1, pan = 0 } = {}) {
  const rand = mulberry32(Math.round(t * 997) + 3)
  const bp = new SVF()
  bp.set(1350, 1.1)
  const [gl, gr] = panGains(pan)
  const n = idx(0.32)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    let env = 0
    for (const o of [0, 0.011, 0.022]) if (tt >= o) env = Math.max(env, Math.exp(-(tt - o) / 0.006))
    if (tt > 0.028) env = Math.max(env, 0.55 * Math.exp(-(tt - 0.028) / 0.085))
    bp.run(rand() * 2 - 1)
    const y = bp.bp * env * vel * 0.9
    write(buf, start + k, y * gl, y * gr)
  }
}

export function hat(buf, t, { vel = 1, open = false, pan = 0 } = {}) {
  const rand = mulberry32(Math.round(t * 1543) + 11)
  const f = new SVF()
  f.set(7600, 0.8)
  const [gl, gr] = panGains(pan)
  const decay = open ? 0.15 : 0.028
  const n = idx(decay * 6)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    f.run(rand() * 2 - 1)
    const y = f.hp * Math.exp(-tt / decay) * vel * 0.35
    write(buf, start + k, y * gl, y * gr)
  }
}

export function shaker(buf, t, { vel = 1, pan = 0 } = {}) {
  const rand = mulberry32(Math.round(t * 2311) + 5)
  const f = new SVF()
  f.set(5600, 1.8)
  const [gl, gr] = panGains(pan)
  const n = idx(0.12)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    f.run(rand() * 2 - 1)
    const env = Math.min(1, tt / 0.006) * Math.exp(-tt / 0.038)
    const y = f.bp * env * vel * 0.4
    write(buf, start + k, y * gl, y * gr)
  }
}

/** Filtered-noise riser with a gliding tone, ending exactly at t1. */
export function riser(buf, t0, t1, { vel = 1, from = 350, to = 7000, tone = true } = {}) {
  const rl = mulberry32(Math.round(t0 * 100) + 1)
  const rr = mulberry32(Math.round(t0 * 100) + 2)
  const fl = new SVF()
  const fr = new SVF()
  const start = idx(t0)
  const n = idx(t1 - t0)
  let ph = 0
  for (let k = 0; k < n; k++) {
    const x = k / n
    const fc = from * (to / from) ** x
    fl.set(fc, 1.6)
    fr.set(fc * 1.04, 1.6)
    fl.run(rl() * 2 - 1)
    fr.run(rr() * 2 - 1)
    const amp = x * x * vel * 0.5
    ph += (220 * 2 ** (x * 1.6)) / SR
    const s = tone ? Math.sin(TAU * ph) * 0.12 * x * x * vel : 0
    write(buf, start + k, fl.bp * amp + s, fr.bp * amp + s)
  }
}

/** Reverse swell: rises exponentially into tEnd, then stops. */
export function swell(buf, tEnd, dur, { vel = 1, note = 62 } = {}) {
  const rand = mulberry32(Math.round(tEnd * 131))
  const f = new SVF()
  f.set(2400, 0.7)
  const start = idx(tEnd - dur)
  const n = idx(dur)
  const fr = hz(note)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    const x = tt / dur
    const amp = Math.exp((x - 1) * 5) * vel
    f.run(rand() * 2 - 1)
    const tone = Math.sin(TAU * fr * tt) * 0.3 + Math.sin(TAU * fr * 1.5 * tt) * 0.15
    const y = (f.lp * 0.5 + tone) * amp * 0.3 * Math.min(1, (n - k) / 240)
    write(buf, start + k, y, y)
  }
}

/** Soft sub impact with an airy transient. */
export function impact(buf, t, { vel = 1, air = 1 } = {}) {
  const rand = mulberry32(Math.round(t * 777))
  const lp = new SVF()
  lp.set(2200, 0.7)
  const n = idx(2.2)
  let ph = 0
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    ph += (33 + 44 * Math.exp(-tt / 0.1)) / SR
    const sub = Math.sin(TAU * ph) * Math.exp(-tt / 0.9) * Math.min(1, tt / 0.002)
    lp.run(rand() * 2 - 1)
    const noise = lp.lp * Math.exp(-tt / 0.22) * 0.5 * air
    const y = Math.tanh((sub * 0.9 + noise) * 1.2) * vel * 0.6
    write(buf, start + k, y, y)
  }
}

/** FM bell: glassy, bright, short. The brand's sonic motif uses it. */
export function bell(buf, t, note, { vel = 1, ratio = 2, index = 1.5, decay = 1.4, pan = 0 } = {}) {
  // Harmonic FM body (in tune for melodies) plus a faint inharmonic shimmer partial.
  const fc = hz(note)
  const fm = fc * ratio
  const [gl, gr] = panGains(pan)
  const n = idx(decay * 5)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    const I = index * Math.exp(-tt / 0.25)
    const env = Math.min(1, tt / 0.002) * Math.exp(-tt / decay)
    const body = Math.sin(TAU * fc * tt + I * Math.sin(TAU * fm * tt))
    const shimmer = 0.12 * Math.sin(TAU * fc * 3.5 * tt) * Math.exp(-tt / 0.18)
    const octave = 0.15 * Math.sin(TAU * fc * 2 * tt) * Math.exp(-tt / 0.5)
    const y = (body + shimmer + octave) * env * vel * 0.16
    write(buf, start + k, y * gl, y * gr)
  }
}

/** Soft marimba-like pop for nodes appearing. */
export function pop(buf, t, note, { vel = 1, pan = 0 } = {}) {
  const f = hz(note)
  const [gl, gr] = panGains(pan)
  const n = idx(0.6)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    const env = Math.min(1, tt / 0.0015)
    const y = (Math.sin(TAU * f * tt) * Math.exp(-tt / 0.16) + 0.3 * Math.sin(TAU * f * 3.98 * tt) * Math.exp(-tt / 0.025)) * env * vel * 0.3
    write(buf, start + k, y * gl, y * gr)
  }
}

// ---------------------------------------------------------------------------
// UI sound effects
// ---------------------------------------------------------------------------
export function keyTick(buf, t, { vel = 1, seed = 1 } = {}) {
  const rand = mulberry32(seed)
  const bp = new SVF()
  bp.set(2600 + rand() * 1600, 1.4)
  const pan = (rand() - 0.5) * 0.3
  const [gl, gr] = panGains(pan)
  const body = 150 + rand() * 50
  const n = idx(0.06)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    bp.run(rand() * 2 - 1)
    const click = bp.bp * Math.exp(-tt / 0.0035) * 1.2
    const thock = Math.sin(TAU * body * tt) * Math.exp(-tt / 0.012) * 0.35
    const y = (click + thock) * vel * (0.75 + rand() * 0.25) * 0.5
    write(buf, start + k, y * gl, y * gr)
  }
}

export function uiClick(buf, t, { vel = 1, pan = 0 } = {}) {
  const rand = mulberry32(Math.round(t * 911))
  const hp = new SVF()
  hp.set(2500, 0.8)
  const [gl, gr] = panGains(pan)
  const n = idx(0.09)
  const start = idx(t)
  for (let k = 0; k < n; k++) {
    const tt = k / SR
    hp.run(rand() * 2 - 1)
    const tick = hp.hp * Math.exp(-tt / 0.0014) * 0.9
    const ring = Math.sin(TAU * 2100 * tt) * Math.exp(-tt / 0.01) * 0.25
    const body = Math.sin(TAU * 230 * tt) * Math.exp(-tt / 0.022) * 0.45
    const y = (tick + ring + body) * vel * 0.55
    write(buf, start + k, y * gl, y * gr)
  }
}

/** Air whoosh: band-passed noise sweeping up or down, panning across. */
export function whoosh(buf, t0, dur, { vel = 1, up = true, panFrom = -0.5, panTo = 0.5, lo = 250, hi = 3200 } = {}) {
  const rand = mulberry32(Math.round(t0 * 313) + 9)
  const f = new SVF()
  const start = idx(t0)
  const n = idx(dur)
  for (let k = 0; k < n; k++) {
    const x = k / n
    const fc = up ? lo * (hi / lo) ** x : hi * (lo / hi) ** x
    f.set(fc, 1.3)
    f.run(rand() * 2 - 1)
    const env = Math.sin(Math.PI * x) ** 1.6
    const [gl, gr] = panGains(panFrom + (panTo - panFrom) * x)
    const y = f.bp * env * vel * 0.9
    write(buf, start + k, y * gl, y * gr)
  }
}

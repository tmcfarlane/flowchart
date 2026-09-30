// Small, dependency-free DSP toolkit for the trailer score and sound design.
// Everything is deterministic (seeded noise), so re-running produces the same file.

export const SR = 48000

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)
export const db = (x) => 10 ** (x / 20)
export const toDb = (x) => 20 * Math.log10(Math.max(1e-12, x))

/** A stereo float buffer. */
export class Stereo {
  constructor(seconds) {
    this.length = Math.ceil(seconds * SR)
    this.L = new Float32Array(this.length)
    this.R = new Float32Array(this.length)
  }
  mixIn(other, gain = 1, gainR = gain) {
    for (let i = 0; i < this.length; i++) {
      this.L[i] += other.L[i] * gain
      this.R[i] += other.R[i] * gainR
    }
  }
}

/** Equal-power pan: -1 left, 0 centre, 1 right. */
export const panGains = (pan) => {
  const a = ((pan + 1) * Math.PI) / 4
  return [Math.cos(a), Math.sin(a)]
}

/** PolyBLEP residual for band-limited saw/square. */
export function polyblep(t, dt) {
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

/** Zavalishin TPT state-variable filter (per-sample cutoff changes are safe). */
export class SVF {
  constructor() {
    this.ic1 = 0
    this.ic2 = 0
  }
  set(cutoff, q = 0.707) {
    const fc = Math.min(cutoff, SR * 0.45)
    this.g = Math.tan((Math.PI * fc) / SR)
    this.k = 1 / q
    this.a1 = 1 / (1 + this.g * (this.g + this.k))
    this.a2 = this.g * this.a1
    this.a3 = this.g * this.a2
  }
  run(x) {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.lp = v2
    this.bp = v1
    this.hp = x - this.k * v1 - v2
    return v2
  }
}

/** One-pole smoothing / DC blocking helpers. */
export class OnePole {
  constructor(cutoff) {
    this.a = Math.exp((-2 * Math.PI * cutoff) / SR)
    this.z = 0
  }
  lp(x) {
    this.z = x * (1 - this.a) + this.z * this.a
    return this.z
  }
}

/** Linear attack, exponential decay to sustain, exponential release. */
export function adsr(t, dur, a, d, s, r) {
  if (t < 0) return 0
  let v
  if (t < a) v = t / a
  else v = s + (1 - s) * Math.exp(-(t - a) / Math.max(1e-4, d))
  if (t > dur) {
    const atRelease = dur < a ? dur / a : s + (1 - s) * Math.exp(-(dur - a) / Math.max(1e-4, d))
    v = atRelease * Math.exp(-(t - dur) / Math.max(1e-4, r))
  }
  return v
}

// ---------------------------------------------------------------------------
// Freeverb (Jezar), tuned for 48 kHz
// ---------------------------------------------------------------------------
class Comb {
  constructor(size) {
    this.buf = new Float32Array(size)
    this.i = 0
    this.store = 0
  }
  run(x, feedback, damp) {
    const out = this.buf[this.i]
    this.store = out * (1 - damp) + this.store * damp
    this.buf[this.i] = x + this.store * feedback
    if (++this.i >= this.buf.length) this.i = 0
    return out
  }
}
class Allpass {
  constructor(size) {
    this.buf = new Float32Array(size)
    this.i = 0
  }
  run(x) {
    const b = this.buf[this.i]
    const out = -x + b
    this.buf[this.i] = x + b * 0.5
    if (++this.i >= this.buf.length) this.i = 0
    return out
  }
}

export function reverb(input, { room = 0.84, damp = 0.35, width = 1, preDelay = 0.012 } = {}) {
  const scale = SR / 44100
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  const aps = [556, 441, 341, 225]
  const spread = 23
  const cl = combs.map((n) => new Comb(Math.round(n * scale)))
  const cr = combs.map((n) => new Comb(Math.round((n + spread) * scale)))
  const al = aps.map((n) => new Allpass(Math.round(n * scale)))
  const ar = aps.map((n) => new Allpass(Math.round((n + spread) * scale)))
  const out = new Stereo(input.length / SR)
  const pd = Math.round(preDelay * SR)
  const feedback = room * 0.28 + 0.7
  const wet1 = width / 2 + 0.5
  const wet2 = (1 - width) / 2
  for (let i = 0; i < input.length; i++) {
    const j = i - pd
    const x = j >= 0 ? (input.L[j] + input.R[j]) * 0.015 : 0
    let l = 0
    let r = 0
    for (let c = 0; c < 8; c++) {
      l += cl[c].run(x, feedback, damp)
      r += cr[c].run(x, feedback, damp)
    }
    for (let a = 0; a < 4; a++) {
      l = al[a].run(l)
      r = ar[a].run(r)
    }
    out.L[i] = l * wet1 + r * wet2
    out.R[i] = r * wet1 + l * wet2
  }
  return out
}

/** Ping-pong delay (wet only). */
export function pingPong(input, { time = 0.375, feedback = 0.35, tone = 3500 } = {}) {
  const n = Math.round(time * SR)
  const bl = new Float32Array(n)
  const br = new Float32Array(n)
  const out = new Stereo(input.length / SR)
  const fl = new OnePole(tone)
  const fr = new OnePole(tone)
  let idx = 0
  for (let i = 0; i < input.length; i++) {
    const dl = bl[idx]
    const dr = br[idx]
    const mono = (input.L[i] + input.R[i]) * 0.5
    bl[idx] = fl.lp(mono + dr * feedback)
    br[idx] = fr.lp(dl * feedback)
    out.L[i] = dl
    out.R[i] = dr
    if (++idx >= n) idx = 0
  }
  return out
}

// ---------------------------------------------------------------------------
// Loudness (ITU-R BS.1770-4 / EBU R128) and true peak
// ---------------------------------------------------------------------------
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

function kWeight(x) {
  // Coefficients from BS.1770 for 48 kHz
  const s = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585)
  return biquad(s, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621)
}

export function integratedLufs(buf) {
  const L = kWeight(buf.L)
  const R = kWeight(buf.R)
  const block = Math.round(0.4 * SR)
  const hop = Math.round(0.1 * SR)
  const powers = []
  for (let start = 0; start + block <= buf.length; start += hop) {
    let sum = 0
    for (let i = start; i < start + block; i++) sum += L[i] * L[i] + R[i] * R[i]
    powers.push(sum / block)
  }
  const lk = (p) => -0.691 + 10 * Math.log10(Math.max(1e-12, p))
  const abs = powers.filter((p) => lk(p) > -70)
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
  const rel = lk(mean(abs)) - 10
  const gated = abs.filter((p) => lk(p) > rel)
  return lk(mean(gated))
}

/** 4x oversampled peak estimate (windowed-sinc interpolation). */
export function truePeakDb(buf) {
  const taps = 48
  const kernels = [1, 2, 3].map((phase) => {
    const k = new Float32Array(taps)
    for (let n = 0; n < taps; n++) {
      const t = n - taps / 2 + phase / 4
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (n + 0.5)) / taps))
      k[n] = sinc * w
    }
    return k
  })
  let peak = 0
  for (const x of [buf.L, buf.R]) {
    for (let i = taps; i < x.length - taps; i++) {
      const a = Math.abs(x[i])
      if (a > peak) peak = a
      if (a < peak * 0.5) continue
      for (const k of kernels) {
        let s = 0
        for (let n = 0; n < taps; n++) s += x[i - taps / 2 + n] * k[n]
        if (Math.abs(s) > peak) peak = Math.abs(s)
      }
    }
  }
  return toDb(peak)
}

/** Look-ahead brickwall limiter (stereo-linked) with smooth release. */
export function limit(buf, ceilingDb = -1.5, { lookahead = 0.005, release = 0.12 } = {}) {
  const ceiling = db(ceilingDb)
  const la = Math.round(lookahead * SR)
  const n = buf.length
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i]))
    need[i] = p > ceiling ? ceiling / p : 1
  }
  // Minimum over the look-ahead window (monotonic deque)
  const minAhead = new Float32Array(n)
  const dq = []
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop()
    dq.push(i)
    while (dq[0] > i + la) dq.shift()
    minAhead[i] = need[dq[0]]
  }
  const rel = Math.exp(-1 / (release * SR))
  const att = Math.exp(-1 / (lookahead * SR * 0.5))
  let g = 1
  for (let i = 0; i < n; i++) {
    const target = minAhead[i]
    g = target < g ? target + (g - target) * att : target + (g - target) * rel
    const gg = Math.min(g, need[i])
    buf.L[i] *= gg
    buf.R[i] *= gg
  }
}

/** 16-bit PCM WAV with TPDF dither. */
export function wav16(buf) {
  const n = buf.length
  const data = Buffer.alloc(44 + n * 4)
  data.write('RIFF', 0)
  data.writeUInt32LE(36 + n * 4, 4)
  data.write('WAVE', 8)
  data.write('fmt ', 12)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(2, 22)
  data.writeUInt32LE(SR, 24)
  data.writeUInt32LE(SR * 4, 28)
  data.writeUInt16LE(4, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(n * 4, 40)
  const rand = mulberry32(99)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (const ch of [buf.L, buf.R]) {
      const d = (rand() - rand()) / 32768
      const v = Math.max(-1, Math.min(1, ch[i] + d))
      data.writeInt16LE(Math.round(v * 32767), o)
      o += 2
    }
  }
  return data
}

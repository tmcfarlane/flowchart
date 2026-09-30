// Single source of truth for timing and copy. Imported by the Remotion scenes and by
// scripts/audio/render-audio.mjs (Node type stripping), so every sound lands on the
// frame its picture does. Keep this file free of imports and non-erasable TS syntax.

export const FPS = 60
export const BPM = 120
export const BEAT = (60 / BPM) * FPS // 30 frames
export const BAR = BEAT * 4 // 120 frames = 2 s

export const SCENES = {
  hook: { from: 0, duration: 2 * BAR },
  logo: { from: 2 * BAR, duration: 3 * BAR },
  generate: { from: 5 * BAR, duration: 5 * BAR },
  mcp: { from: 10 * BAR, duration: 8 * BAR },
  montage: { from: 18 * BAR, duration: 5 * BAR },
  close: { from: 23 * BAR, duration: 5 * BAR },
} as const

export type SceneName = keyof typeof SCENES
export const TOTAL_FRAMES = SCENES.close.from + SCENES.close.duration // 3360 = 56 s

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
export const COPY = {
  hook: 'Describe your idea…',
  name: 'FLOWCHART AI',
  tagline: 'Describe your idea. Get a flowchart.',
  generatePrompt: 'CI/CD pipeline to AKS with a rollback if checks fail',
  generateLoading: 'Thinking about your flowchart...',
  generateCaption: ['Plain English in.', 'Flowchart out.'],
  mcpIntro: 'Or let your own AI agent draw it.',
  mcpUpdatePrompt: 'Add a welcome email step after payment.',
  mcpCaption: 'Your agent draws. You iterate.',
  mcpClients: ['Claude', 'ChatGPT', 'VS Code', 'Cursor', 'OpenCode'],
  mcpAny: 'Works with any MCP client',
  mcpEndpoint: 'https://flowchart.zeroclickdev.ai/api/mcp',
  montage: [
    '663+ official Azure icons',
    'Present it step by step',
    'Export PNG, SVG or GIF',
    'Share a link. Edit together.',
    'Light or dark, one click',
  ],
  url: 'flowchart.zeroclickdev.ai',
  credit: 'Free & open source · by ZeroClickDev',
} as const

// ---------------------------------------------------------------------------
// Deterministic typing
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type TypingOptions = {
  perChar: number
  jitter: number
  seed: number
  /** Extra frames before the character at this index. */
  pauses?: Record<number, number>
}

/** Frame at which each character of `text` appears. */
export function typingFrames(text: string, start: number, opts: TypingOptions): number[] {
  const rand = mulberry32(opts.seed)
  const frames: number[] = []
  let t = start
  for (let i = 0; i < text.length; i++) {
    if (i > 0) {
      const ch = text[i]
      const prev = text[i - 1]
      let step = opts.perChar + (rand() * 2 - 1) * opts.jitter
      if (prev === ' ') step += opts.perChar * 0.35
      if (ch === ' ') step *= 0.8
      t += Math.max(1, step)
    }
    t += opts.pauses?.[i] ?? 0
    frames.push(Math.round(t))
  }
  return frames
}

export const visibleChars = (frames: number[], frame: number) => {
  let n = 0
  while (n < frames.length && frames[n] <= frame) n++
  return n
}

// ---------------------------------------------------------------------------
// Scene cues (absolute frames)
// ---------------------------------------------------------------------------
const H = SCENES.hook.from
export const HOOK = {
  typing: typingFrames(COPY.hook, H + 30, { perChar: 4.6, jitter: 1.6, seed: 7, pauses: { 9: 3, 18: 12 } }),
  textOut: H + 200,
  caretFlyStart: H + 204,
  caretFlyEnd: H + 240,
}

const L = SCENES.logo.from
export const LOGO = {
  drawStart: L,
  drawEnd: L + 96,
  fillStart: L + 64,
  fillEnd: L + 112,
  pointerIn: L + 92,
  wordmarkIn: L + 120,
  taglineIn: L + 196,
  exitStart: L + 330,
}

const G = SCENES.generate.from
export const GENERATE = {
  canvasIn: G,
  cardIn: G + 12,
  typing: typingFrames(COPY.generatePrompt, G + 50, { perChar: 2.05, jitter: 0.8, seed: 21 }),
  cursorIn: G + 148,
  click: G + 180, // 13.0 s, on the beat
  loadingEnd: G + 222,
  cardOut: G + 218,
  buildStart: G + 240, // 14.0 s, bar 8 downbeat: the drop
  buildStep: BEAT / 2, // one node per eighth note
  order: ['push', 'note', 'build', 'tests', 'fix', 'registry', 'staging', 'smoke', 'rollback', 'prod', 'monitor'],
  fitStart: G + 400,
  fitEnd: G + 470,
  pillIn: G + 410,
  captionIn: G + 452,
}
export const nodeAppearFrame = (index: number) => GENERATE.buildStart + index * GENERATE.buildStep

const M = SCENES.mcp.from
export const MCP = {
  chatIn: M,
  user1: M + 18,
  toolCreate: M + 64,
  toolCreateArgs: [M + 76, M + 84, M + 92, M + 100, M + 108],
  toolCreateDone: M + 150,
  assistantLink: M + 172,
  cursorIn: M + 206,
  linkClick: M + 240, // 24.0 s
  browserIn: M + 240,
  pageLoaded: M + 286,
  fragmentDropped: M + 300,
  user2Typing: typingFrames(COPY.mcpUpdatePrompt, M + 356, { perChar: 2.0, jitter: 0.7, seed: 5 }),
  send: M + 450,
  toolGet: M + 462,
  toolGetDone: M + 484,
  toolUpdate: M + 494,
  toolUpdateArgs: [M + 504, M + 511, M + 518, M + 525],
  toolUpdateDone: M + 540, // 29.0 s
  updateLands: M + 570, // 29.5 s: the open tab shows the agent's change (on the beat)
  pushInStart: M + 470,
  pullBackStart: M + 660,
  captionIn: M + 676,
  clientsIn: M + 810, // 33.5 s
  clientStep: 22,
}

const MO = SCENES.montage.from
export const MONTAGE = {
  cuts: [0, 1, 2, 3, 4].map((i) => MO + i * BAR),
  exportHovers: [MO + 2 * BAR + BEAT, MO + 2 * BAR + 2 * BEAT, MO + 2 * BAR + 3 * BEAT],
  shareClick: MO + 3 * BAR + 2 * BEAT,
  darkClick: MO + 4 * BAR + BEAT,
}

const C = SCENES.close.from
export const CLOSE = {
  hit: C,
  taglineIn: C + 72,
  urlIn: C + 132,
  creditIn: C + 170,
  mcpIn: C + 214,
}

/** Scene boundaries that get a transition sound. */
export const TRANSITIONS = [SCENES.generate.from, SCENES.mcp.from, SCENES.montage.from, SCENES.close.from]

import React from 'react'
import { interpolate } from 'remotion'
import { C, EASE, FONT } from '../theme'
import { clamp01, ease, measureText } from './util'

// A neutral "any MCP client" chat. Deliberately generic: no vendor's UI, name or logo.
// Text is wrapped with canvas metrics so every item has a known height and the log can
// scroll smoothly as the conversation grows.

export type ChatItem =
  | { kind: 'user'; at: number; text: string }
  | { kind: 'assistant'; at: number; text: string; link?: string }
  | {
      kind: 'tool'
      at: number
      name: string
      args: { at: number; text: string }[]
      doneAt: number
      result: string
      compact?: boolean
    }

export type ChatMetrics = {
  width: number
  pad: number
  text: number
  mono: number
  gap: number
}

function wrap(text: string, font: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (measureText(next, font) <= maxWidth || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Hard-wraps monospace text at a character count (keeps long URLs/JSON intact). */
function wrapMono(text: string, cols: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let rest = raw
    while (rest.length > cols) {
      let cut = rest.lastIndexOf(' ', cols)
      if (cut < cols * 0.5) cut = cols
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut).replace(/^ /, '')
    }
    out.push(rest)
  }
  return out
}

type Laid = { item: ChatItem; lines: string[]; argLines: string[][]; resultLines: string[]; full: (f: number) => number }

function layoutItems(items: ChatItem[], m: ChatMetrics): Laid[] {
  const inner = m.width - m.pad * 2
  const textFont = `450 ${m.text}px Inter`
  const lineH = m.text * 1.42
  const monoLineH = m.mono * 1.5
  const cols = Math.floor((inner - m.mono * 2.4) / measureText('M', `400 ${m.mono}px 'JetBrains Mono'`))
  return items.map((item) => {
    if (item.kind === 'user') {
      const lines = wrap(item.text, textFont, inner * 0.82 - m.text * 1.6)
      const h = lines.length * lineH + m.text * 1.3
      return { item, lines, argLines: [], resultLines: [], full: () => h }
    }
    if (item.kind === 'assistant') {
      const lines = wrap(item.text, textFont, inner)
      const h = lines.length * lineH + (item.link ? m.text * 2.6 : 0)
      return { item, lines, argLines: [], resultLines: [], full: () => h }
    }
    const argLines = item.args.map((a) => wrapMono(a.text, cols))
    const resultLines = wrapMono(item.result, cols)
    const header = m.text * 2.3
    return {
      item,
      lines: [],
      argLines,
      resultLines,
      full: (f: number) => {
        let h = header
        if (!item.compact) {
          item.args.forEach((a, i) => {
            h += argLines[i].length * monoLineH * ease(f, a.at, a.at + 10)
          })
          h += (resultLines.length * monoLineH + m.mono * 0.9) * ease(f, item.doneAt, item.doneAt + 14)
          h += m.mono * 0.9
        }
        return h
      },
    }
  })
}


/** Positions of every chat item at `frame` (chat-local px), plus the scroll offset. */
export function layoutChat(items: ChatItem[], m: ChatMetrics, height: number, frame: number) {
  const laid = layoutItems(items, m)
  const headerH = m.text * 3.1
  const composerH = m.text * 3.6
  const viewH = height - headerH - composerH
  const lineH = m.text * 1.42
  const monoLineH = m.mono * 1.5
  // Stack visible items; entering items grow in, so the log scrolls smoothly.
  let y = m.pad
  const placed = laid.map((l) => {
    const k = ease(l.item.at <= frame ? frame : -1, l.item.at, l.item.at + 16)
    const h = l.full(frame) * k
    const top = y
    y += h + (k > 0 ? m.gap * k : 0)
    return { ...l, top, k, h }
  })
  const scroll = Math.max(0, y - viewH + m.pad * 0.5)
  return { laid, placed, scroll, headerH, composerH, viewH, lineH, monoLineH }
}

/** Where the link chip of assistant item `index` sits (chat-local px). */
export function linkChipCenter(items: ChatItem[], m: ChatMetrics, height: number, frame: number, index: number) {
  const { placed, scroll, headerH, lineH } = layoutChat(items, m, height, frame)
  const p = placed[index]
  const lines = p.lines.length
  return { x: m.pad + m.text * 6, y: headerH - scroll + p.top + lines * lineH + m.text * 0.45 + m.text * 0.95 }
}

const Spinner: React.FC<{ frame: number; size: number }> = ({ frame, size }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" style={{ transform: `rotate(${frame * 9}deg)` }}>
    <circle cx="10" cy="10" r="7.5" fill="none" stroke="rgba(120, 252, 214, 0.18)" strokeWidth="2.4" />
    <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" stroke={C.mint} strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)

const Check: React.FC<{ size: number; k: number }> = ({ size, k }) => (
  <svg width={size} height={size} viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="9" fill="rgba(120, 252, 214, 0.16)" />
    <path d="M5.8 10.4l2.8 2.8 5.6-6" fill="none" stroke={C.mintBright} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="14" strokeDashoffset={14 * (1 - k)} />
  </svg>
)

export type AgentChatProps = {
  frame: number
  items: ChatItem[]
  metrics: ChatMetrics
  height: number
  clientName: string
  clientNameKey?: number
  endpoint: string
  composer: { text: string; caret: boolean; sendAt?: number }
  highlightLink?: number // 0..1 hover on the link chip
}

export const AgentChat: React.FC<AgentChatProps> = ({ frame, items, metrics: m, height, clientName, endpoint, composer, highlightLink = 0 }) => {
  const { laid, placed, scroll, headerH, composerH, viewH, lineH, monoLineH } = layoutChat(items, m, height, frame)
  return (
    <div
      style={{
        width: m.width,
        height,
        background: '#141716',
        border: `1px solid ${C.hairline}`,
        borderRadius: 18,
        boxShadow: '0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.3)',
        overflow: 'hidden',
        fontFamily: FONT.sans,
        position: 'relative',
      }}
    >
      <div
        style={{
          height: headerH,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${m.pad}px`,
          borderBottom: `1px solid ${C.hairline}`,
          background: 'rgba(255, 255, 255, 0.015)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: m.text * 0.55 }}>
          <div
            style={{
              width: m.text * 1.35,
              height: m.text * 1.35,
              borderRadius: m.text * 0.4,
              background: 'rgba(255, 255, 255, 0.06)',
              border: `1px solid ${C.hairline}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={m.text * 0.8} height={m.text * 0.8} viewBox="0 0 16 16" fill="none" stroke="rgba(231,236,235,0.75)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4.5l3.5 3.5L3 11.5" />
              <path d="M8.5 11.5H13" />
            </svg>
          </div>
          <span style={{ fontSize: m.text * 0.95, fontWeight: 600, color: C.text }}>{clientName}</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: m.text * 0.45,
            padding: `${m.text * 0.28}px ${m.text * 0.6}px`,
            borderRadius: 999,
            background: 'rgba(120, 252, 214, 0.08)',
            border: '1px solid rgba(120, 252, 214, 0.18)',
          }}
        >
          <span style={{ width: m.text * 0.36, height: m.text * 0.36, borderRadius: '50%', background: C.mintBright, boxShadow: '0 0 8px rgba(0, 255, 182, 0.8)' }} />
          <span style={{ fontSize: m.mono * 0.9, fontWeight: 700, letterSpacing: '0.06em', color: C.mint }}>MCP</span>
          <span style={{ fontFamily: FONT.mono, fontSize: m.mono * 0.9, color: 'rgba(231, 236, 235, 0.7)' }}>{endpoint.replace('https://', '')}</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: headerH, height: viewH, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: m.pad, right: m.pad, top: -scroll }}>
          {placed.map(({ item, lines, argLines, resultLines, top, k }, i) => {
            if (k <= 0) return null
            const common: React.CSSProperties = {
              position: 'absolute',
              top,
              left: 0,
              right: 0,
              opacity: clamp01(k * 1.3),
              transform: `translateY(${(1 - k) * 14}px)`,
            }
            if (item.kind === 'user') {
              return (
                <div key={i} style={{ ...common, display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.07)',
                      border: `1px solid ${C.hairline}`,
                      borderRadius: m.text * 0.8,
                      padding: `${m.text * 0.62}px ${m.text * 0.8}px`,
                      fontSize: m.text,
                      lineHeight: `${lineH}px`,
                      color: C.text,
                      maxWidth: '82%',
                    }}
                  >
                    {lines.map((line, li) => (
                      <div key={li} style={{ whiteSpace: 'nowrap' }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )
            }
            if (item.kind === 'assistant') {
              return (
                <div key={i} style={{ ...common, fontSize: m.text, lineHeight: `${lineH}px`, color: 'rgba(231, 236, 235, 0.88)' }}>
                  {lines.map((line, li) => (
                    <div key={li} style={{ whiteSpace: 'nowrap' }}>
                      {line}
                    </div>
                  ))}
                  {item.link && (
                    <div
                      style={{
                        marginTop: m.text * 0.45,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: m.text * 0.45,
                        padding: `${m.text * 0.34}px ${m.text * 0.7}px`,
                        borderRadius: m.text * 0.55,
                        background: `rgba(120, 252, 214, ${0.1 + 0.1 * highlightLink})`,
                        border: `1px solid rgba(120, 252, 214, ${0.25 + 0.25 * highlightLink})`,
                        color: highlightLink > 0.5 ? C.mintBright : C.mint,
                        fontFamily: FONT.mono,
                        fontSize: m.mono,
                        whiteSpace: 'nowrap',
                        textDecoration: highlightLink > 0.5 ? 'underline' : 'none',
                      }}
                    >
                      <svg width={m.mono} height={m.mono} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6.5 9.5l3-3" />
                        <path d="M7.2 4.3l1.1-1.1a2.6 2.6 0 013.7 3.7l-1.1 1.1" />
                        <path d="M8.8 11.7l-1.1 1.1a2.6 2.6 0 01-3.7-3.7l1.1-1.1" />
                      </svg>
                      {item.link}
                    </div>
                  )}
                </div>
              )
            }
            const done = frame >= item.doneAt
            const doneK = ease(frame, item.doneAt, item.doneAt + 14)
            return (
              <div
                key={i}
                style={{
                  ...common,
                  height: laid[i].full(frame),
                  background: 'rgba(255, 255, 255, 0.025)',
                  border: `1px solid ${done ? `rgba(120, 252, 214, ${0.08 + 0.12 * doneK})` : C.hairline}`,
                  borderRadius: m.text * 0.65,
                  overflow: 'hidden',
                }}
              >
                <div style={{ height: m.text * 2.3, display: 'flex', alignItems: 'center', gap: m.text * 0.55, padding: `0 ${m.text * 0.75}px` }}>
                  {done ? <Check size={m.text * 1.1} k={doneK} /> : <Spinner frame={frame} size={m.text * 1.05} />}
                  <span style={{ fontFamily: FONT.mono, fontSize: m.mono * 1.05, fontWeight: 600, color: C.text }}>{item.name}</span>
                  <span style={{ fontSize: m.mono * 0.92, color: C.textDim }}>flowchart</span>
                  {item.compact && done && (
                    <span style={{ marginLeft: 'auto', fontFamily: FONT.mono, fontSize: m.mono * 0.95, color: C.textMuted, opacity: doneK }}>{item.result}</span>
                  )}
                </div>
                {!item.compact && (
                  <div style={{ padding: `0 ${m.text * 0.75}px`, fontFamily: FONT.mono, fontSize: m.mono, lineHeight: `${monoLineH}px` }}>
                    {item.args.map((a, ai) =>
                      frame >= a.at ? (
                        <div key={ai} style={{ opacity: ease(frame, a.at, a.at + 10), color: 'rgba(231, 236, 235, 0.62)' }}>
                          {argLines[ai].map((line, li) => (
                            <div key={li} style={{ whiteSpace: 'pre' }}>
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : null,
                    )}
                    {done && (
                      <div
                        style={{
                          marginTop: m.mono * 0.6,
                          paddingTop: m.mono * 0.3,
                          borderTop: `1px solid ${C.hairline}`,
                          opacity: doneK,
                          color: C.mint,
                        }}
                      >
                        {resultLines.map((line, li) => (
                          <div key={li} style={{ whiteSpace: 'pre' }}>
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: m.pad,
          right: m.pad,
          bottom: m.pad * 0.8,
          height: composerH - m.pad * 0.9,
          borderRadius: m.text * 0.75,
          background: 'rgba(255, 255, 255, 0.04)',
          border: `1px solid ${composer.text ? 'rgba(120, 252, 214, 0.28)' : C.hairline}`,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${m.text * 0.5}px 0 ${m.text * 0.85}px`,
          gap: m.text * 0.5,
        }}
      >
        <div style={{ flex: 1, fontSize: m.text, color: composer.text ? C.text : C.textDim, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {composer.text || 'Message your agent…'}
          {composer.caret && composer.text && (
            <span style={{ display: 'inline-block', width: 2, height: m.text * 1.1, marginLeft: 2, background: C.text, verticalAlign: 'text-bottom' }} />
          )}
        </div>
        <SendButton frame={frame} size={m.text * 1.75} active={!!composer.text} sendAt={composer.sendAt} />
      </div>
    </div>
  )
}

const SendButton: React.FC<{ frame: number; size: number; active: boolean; sendAt?: number }> = ({ frame, size, active, sendAt }) => {
  const press = sendAt === undefined ? 0 : interpolate(frame, [sendAt - 3, sendAt, sendAt + 8], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.standard })
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: active ? C.mintGradient : 'rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${1 - 0.1 * press})`,
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 16 16" fill="none" stroke={active ? C.bg : 'rgba(231,236,235,0.5)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 13V3" />
        <path d="M3.5 7.5L8 3l4.5 4.5" />
      </svg>
    </div>
  )
}

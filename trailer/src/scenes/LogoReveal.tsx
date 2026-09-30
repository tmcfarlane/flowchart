import React from 'react'
import { AbsoluteFill, interpolate, spring } from 'remotion'
import { COPY, LOGO } from '../timeline'
import { C, EASE, FONT } from '../theme'
import { GEAR_TURN, logoDrawBox } from '../layout'
import { Logo, logoPenPoint, useLogo } from '../components/Logo'
import { DotGrid } from '../components/flow/FlowCanvas'
import { clamp01, ease, useAbsFrame, useLayout } from '../components/util'

export function lockup(portrait: boolean) {
  return portrait
    ? { logo: 250, logoCy: 850, word: 76, wordCy: 1062, tag: 31, tagCy: 1146 }
    : { logo: 196, logoCy: 432, word: 100, wordCy: 622, tag: 33, tagCy: 718 }
}

export const Wordmark: React.FC<{ frame: number; start: number; size: number; tracking?: number; glow?: number }> = ({
  frame,
  start,
  size,
  tracking,
  glow = 1,
}) => {
  const letters = COPY.name.split('')
  const trackT = ease(frame, start, start + 80)
  const em = tracking ?? interpolate(trackT, [0, 1], [0.42, 0.18])
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        fontFamily: FONT.sans,
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1,
        color: C.text,
        textShadow: `0 0 ${size * 0.3}px rgba(120, 252, 214, ${0.32 * glow}), 0 0 ${size * 0.08}px rgba(120, 252, 214, ${0.25 * glow})`,
        whiteSpace: 'pre',
      }}
    >
      {letters.map((ch, i) => {
        const k = ease(frame, start + i * 2.5, start + i * 2.5 + 28)
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: i < letters.length - 1 ? `${em}em` : 0,
              opacity: k,
              transform: `translateY(${(1 - k) * size * 0.22}px)`,
              filter: k < 1 ? `blur(${(1 - k) * 8}px)` : undefined,
            }}
          >
            {ch}
          </span>
        )
      })}
    </div>
  )
}

export const LogoReveal: React.FC<{ from: number }> = ({ from }) => {
  const frame = useAbsFrame(from)
  const { W, H, portrait } = useLayout()
  const fps = 60
  const data = useLogo()
  const box = logoDrawBox(portrait)
  const L = lockup(portrait)

  const draw = ease(frame, LOGO.drawStart, LOGO.drawEnd, EASE.inOut)
  const fill = ease(frame, LOGO.fillStart, LOGO.fillEnd, EASE.standard)
  const turn = interpolate(ease(frame, LOGO.fillStart + 8, LOGO.fillStart + 96, EASE.out), [0, 1], [GEAR_TURN, 0])
  const pointerSpring = spring({ frame: frame - LOGO.pointerIn, fps, config: { damping: 11, stiffness: 170, mass: 0.7 } })
  const pointer = clamp01(pointerSpring * 1.4)
  const glow = interpolate(frame, [LOGO.fillStart, LOGO.fillEnd + 20, LOGO.fillEnd + 90], [0, 1, 0.55], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  // Draw large in the middle, then settle into the lockup as the name arrives.
  const settle = ease(frame, LOGO.wordmarkIn - 8, LOGO.wordmarkIn + 40, EASE.inOut)
  const size = interpolate(settle, [0, 1], [box.size, L.logo])
  const cy = interpolate(settle, [0, 1], [box.cy, L.logoCy])
  const push = interpolate(frame, [LOGO.wordmarkIn, LOGO.exitStart], [1, 1.035], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const exit = ease(frame, LOGO.exitStart, LOGO.exitStart + 28, EASE.in)

  // Glowing pen tip riding the outline while it draws (continues the hook's caret).
  let pen: { x: number; y: number } | null = null
  if (data && draw > 0 && draw < 0.84) {
    const p = logoPenPoint(data, Math.min(1, draw / 0.82))
    const a = (GEAR_TURN * Math.PI) / 180
    const vx = p.x - 220.5
    const vy = p.y - 223
    const rx = vx * Math.cos(a) - vy * Math.sin(a) + 220.5
    const ry = vx * Math.sin(a) + vy * Math.cos(a) + 223
    pen = { x: box.x + (rx / 441) * box.size, y: box.y + (ry / 446) * box.h }
  }

  const taglineK = ease(frame, LOGO.taglineIn, LOGO.taglineIn + 30)
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <DotGrid id="logo-grid" viewport={{ x: W / 2, y: H / 2, zoom: 1.5 }} width={W} height={H} opacity={0.55 * (1 - exit)} />
      <AbsoluteFill style={{ opacity: 1 - exit, transform: `scale(${push * (1 - 0.03 * exit)})` }}>
        <div
          style={{
            position: 'absolute',
            left: W / 2 - size / 2,
            top: cy - (size * 446) / 441 / 2,
          }}
        >
          <Logo size={size} draw={draw} fill={fill} pointer={pointer} pointerScale={0.6 + 0.4 * pointerSpring} rotate={turn} glow={glow} strokeWidth={4} />
        </div>
        {pen && (
          <div
            style={{
              position: 'absolute',
              left: pen.x - 5,
              top: pen.y - 5,
              width: 10,
              height: 10,
              borderRadius: 5,
              background: C.mintBright,
              boxShadow: '0 0 22px rgba(120, 252, 214, 0.9)',
              opacity: 1 - clamp01((draw - 0.74) / 0.1),
            }}
          />
        )}
        <div style={{ position: 'absolute', left: 0, right: 0, top: L.wordCy - L.word / 2 }}>
          <Wordmark frame={frame} start={LOGO.wordmarkIn} size={L.word} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: L.tagCy - L.tag * 0.6,
            textAlign: 'center',
            fontFamily: FONT.sans,
            fontSize: L.tag,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: C.textMuted,
            opacity: taglineK,
            transform: `translateY(${(1 - taglineK) * 14}px)`,
          }}
        >
          Describe your idea. <span style={{ color: C.text }}>Get a flowchart.</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

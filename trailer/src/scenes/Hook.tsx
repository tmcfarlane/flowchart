import React from 'react'
import { AbsoluteFill, interpolate } from 'remotion'
import { HOOK, COPY, visibleChars } from '../timeline'
import { C, EASE, FONT } from '../theme'
import { hookType, penStart } from '../layout'
import { DotGrid } from '../components/flow/FlowCanvas'
import { caretOpacity, clamp01, ease, measureText, useAbsFrame, useLayout } from '../components/util'

export const Hook: React.FC<{ from: number }> = ({ from }) => {
  const frame = useAbsFrame(from)
  const { W, H, portrait } = useLayout()
  const { size, y } = hookType(portrait)
  const n = visibleChars(HOOK.typing, frame)
  const typed = COPY.hook.slice(0, n)
  const lastKey = HOOK.typing[HOOK.typing.length - 1]

  const font = `600 ${size}px Inter`
  const spacing = -0.02 * size
  const fullW = measureText(COPY.hook, font, spacing)
  const typedW = measureText(typed, font, spacing)
  const left = W / 2 - fullW / 2

  // Caret: a mint bar at the end of the text, then it lifts off and becomes the pen
  // that draws the logo.
  const flyT = ease(frame, HOOK.caretFlyStart, HOOK.caretFlyEnd, EASE.inOut)
  const target = penStart(portrait)
  const barH = size * 0.92
  const caretX0 = left + typedW + size * 0.06
  const caretY0 = y
  const cx = interpolate(flyT, [0, 1], [caretX0, target.x])
  const cy = interpolate(flyT, [0, 1], [caretY0, target.y]) - Math.sin(flyT * Math.PI) * (portrait ? 60 : 40)
  const cw = interpolate(flyT, [0, 0.6, 1], [5, 9, 10])
  const ch = interpolate(flyT, [0, 0.6, 1], [barH, 12, 10])
  const blink = frame < HOOK.caretFlyStart ? caretOpacity(frame, lastKey) : 1

  const textOut = ease(frame, HOOK.textOut, HOOK.textOut + 22, EASE.in)
  const gridIn = ease(frame, from, from + 90, EASE.standard)

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <DotGrid id="hook-grid" viewport={{ x: W / 2, y: H / 2, zoom: 1.5 }} width={W} height={H} opacity={0.55 * gridIn} />
      <div
        style={{
          position: 'absolute',
          left,
          top: y,
          transform: `translateY(-50%) translateY(${-10 * textOut}px)`,
          opacity: 1 - textOut,
          fontFamily: FONT.sans,
          fontSize: size,
          fontWeight: 600,
          letterSpacing: `${spacing}px`,
          color: C.text,
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}
      >
        {typed}
      </div>
      <div
        style={{
          position: 'absolute',
          left: cx - cw / 2,
          top: cy - ch / 2,
          width: cw,
          height: ch,
          borderRadius: interpolate(flyT, [0, 0.5, 1], [2, 6, 5]),
          background: flyT > 0.4 ? C.mintBright : C.mint,
          opacity: blink,
          boxShadow: `0 0 ${12 + 10 * flyT}px rgba(120, 252, 214, ${0.55 + 0.35 * clamp01(flyT)})`,
        }}
      />
    </AbsoluteFill>
  )
}

import React from 'react'
import { AbsoluteFill, interpolate, spring } from 'remotion'
import { COPY, GENERATE, nodeAppearFrame, visibleChars } from '../timeline'
import { C, EASE, SPRING } from '../theme'
import generateLR from '../data/generate-lr.json'
import generateTB from '../data/generate-tb.json'
import { FlowCanvas, fitTransform, type Viewport } from '../components/flow/FlowCanvas'
import type { Chart, ChartEdge } from '../components/flow/Nodes'
import { Toolbar } from '../components/app/Toolbar'
import { AiPill, Controls, MiniMap } from '../components/app/AppChrome'
import { WelcomePrompt } from '../components/app/WelcomePrompt'
import { Cursor, cursorAt } from '../components/Cursor'
import { Caption, Scrim, cameraPath, cameraTransform, caretOpacity, clamp01, ease, useAbsFrame, useLayout, type Camera } from '../components/util'

// The in-app AI flow, rebuilt from the app's CSS: the welcome prompt, a typed idea, then
// the chart (real server layout for this prompt) building node by node on the beat.

const screens = {
  landscape: { w: 1600, h: 900, scale: 1.2, chart: generateLR as unknown as Chart },
  // A tall browser window wide enough for the real toolbar (1088 CSS px), shown ~1:1.
  portrait: { w: 1120, h: 1991, scale: 1080 / 1120, chart: generateTB as unknown as Chart },
}

export const Generate: React.FC<{ from: number }> = ({ from }) => {
  const frame = useAbsFrame(from)
  const { W, H, portrait } = useLayout()
  const S = portrait ? screens.portrait : screens.landscape
  const chart = S.chart
  const fps = 60
  const viewport: Viewport = fitTransform(chart, S.w, S.h)

  const order = GENERATE.order as readonly string[]
  const appear = (id: string) => nodeAppearFrame(order.indexOf(id))
  const nodeProgress = (id: string) => {
    const t0 = appear(id)
    return frame < t0 ? 0 : spring({ frame: frame - t0, fps, config: SPRING.node })
  }
  const edgeProgress = (edge: ChartEdge) => {
    const ts = appear(edge.source)
    const tt = appear(edge.target)
    const start = tt > ts ? Math.max(ts + 6, tt - 12) : ts + 6
    const end = tt > ts ? tt + 2 : ts + 22
    return ease(frame, start, end, EASE.inOut)
  }

  // Screen-space centre of a node (app CSS px)
  const center = (id: string) => {
    const n = chart.nodes.find((x) => x.id === id)!
    return {
      x: viewport.x + (n.position.x + n.width / 2) * viewport.zoom,
      y: viewport.y + (n.position.y + n.height / 2) * viewport.zoom,
    }
  }

  // --- Welcome prompt ------------------------------------------------------------
  const typedCount = visibleChars(GENERATE.typing, frame)
  const typed = COPY.generatePrompt.slice(0, typedCount)
  const lastKey = GENERATE.typing[GENERATE.typing.length - 1]
  const cardIn = spring({ frame: frame - GENERATE.cardIn, fps, config: { damping: 16, stiffness: 160, mass: 0.9 } })
  const cardOut = ease(frame, GENERATE.cardOut, GENERATE.cardOut + 20, EASE.in)
  // The press registers, then the card switches to the app's loading state.
  const loading = frame >= GENERATE.click + 10 ? { message: COPY.generateLoading, progress: interpolate(frame, [GENERATE.click + 10, GENERATE.cardOut + 20], [2, 46], { extrapolateRight: 'clamp' }) } : null
  const pressed = interpolate(frame, [GENERATE.click - 3, GENERATE.click, GENERATE.click + 6], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const cardW = 500
  const cardCx = S.w / 2
  const cardCy = S.h / 2
  // Card geometry (CSS px, from AIChat.css): header 65, padding 24, heading 49, chips 104,
  // divider 27, textarea 96, button 42, dismiss 44, padding 24. Loading state: 139.
  const fullH = 65 + 24 + 49 + 104 + 27 + 96 + 42 + 44 + 24
  const cardH = loading ? 139 : fullH
  const cardTop = cardCy - fullH / 2
  const buttonY = cardTop + 65 + 24 + 49 + 104 + 27 + 96 + 21
  const textareaY = cardTop + 65 + 24 + 49 + 104 + 27 + 40

  // --- Camera (whole app screen, Screen Studio style) ------------------------------
  // During the build the camera trails the newest nodes (centroid of the last three),
  // so it never runs ahead of what has appeared.
  const mid = { x: S.w / 2, y: S.h / 2 }
  const last = center(order[order.length - 1])
  const buildZoom = portrait ? 1.45 : 1.5
  const buildKeys: [number, Camera][] = order.map((_, i) => {
    const group = order.slice(Math.max(0, i - 2), i + 1).map(center)
    const cx = group.reduce((a, p) => a + p.x, 0) / group.length
    const cy = group.reduce((a, p) => a + p.y, 0) / group.length
    return [nodeAppearFrame(i) + 10, portrait ? { zoom: buildZoom, fx: mid.x, fy: cy + 60 } : { zoom: buildZoom, fx: cx + 120, fy: mid.y }]
  })
  const cardZoom = portrait ? 1.75 : 1.34
  const cam = cameraPath(frame, [
    [GENERATE.canvasIn, { zoom: 1.0, fx: mid.x, fy: mid.y }],
    [GENERATE.typing[0] - 4, { zoom: cardZoom, fx: cardCx, fy: textareaY - 20 }],
    [GENERATE.click + 4, { zoom: cardZoom, fx: cardCx, fy: textareaY + 10 }],
    [GENERATE.cardOut, { zoom: cardZoom * 0.96, fx: cardCx, fy: cardCy }],
    [GENERATE.buildStart - 2, buildKeys[0][1]],
    ...buildKeys,
    [GENERATE.fitStart, portrait ? { zoom: buildZoom, fx: mid.x, fy: last.y - 120 } : { zoom: buildZoom, fx: last.x - 200, fy: mid.y }],
    [GENERATE.fitEnd, { zoom: 1.0, fx: mid.x, fy: mid.y }],
    [GENERATE.fitEnd + 140, { zoom: 1.03, fx: mid.x, fy: mid.y + (portrait ? -10 : 6) }],
  ])
  const T = cameraTransform(cam, S.w, S.h, S.scale, W, H)

  // --- Cursor ---------------------------------------------------------------------
  const cursorKeys = [
    { frame: GENERATE.cursorIn, x: cardCx + 150, y: buttonY + 120 },
    { frame: GENERATE.click - 6, x: cardCx + 34, y: buttonY + 4 },
    { frame: GENERATE.click + 24, x: cardCx + 60, y: buttonY + 40 },
  ]
  const cur = cursorAt(frame, cursorKeys)
  const cursorOpacity = ease(frame, GENERATE.cursorIn, GENERATE.cursorIn + 10) * (1 - ease(frame, GENERATE.click + 8, GENERATE.click + 18))

  const chromeIn = ease(frame, GENERATE.canvasIn, GENERATE.canvasIn + 26)
  const pillIn = ease(frame, GENERATE.pillIn, GENERATE.pillIn + 24)
  const minimapIn = ease(frame, GENERATE.pillIn + 10, GENERATE.pillIn + 34)
  const visibleNode = (id: string) => clamp01(nodeProgress(id))
  const sceneIn = ease(frame, from, from + 16, EASE.standard) * (1 - ease(frame, from + 600 - 14, from + 600, EASE.in))
  const captionOut = GENERATE.captionIn + 142

  return (
    <AbsoluteFill style={{ background: C.bg, opacity: sceneIn }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: S.w,
          height: S.h,
          transformOrigin: '0 0',
          transform: `translate(${T.tx}px, ${T.ty}px) scale(${T.s})`,
        }}
      >
        <FlowCanvas
          id="gen"
          chart={chart}
          viewport={viewport}
          width={S.w}
          height={S.h}
          nodeProgress={nodeProgress}
          edgeProgress={edgeProgress}
          frame={frame}
          gridOpacity={chromeIn}
        />
        <div style={{ position: 'absolute', left: 15, bottom: 15, opacity: chromeIn }}>
          <Controls />
        </div>
        <div style={{ position: 'absolute', right: 15, bottom: 15, opacity: minimapIn }}>
          <MiniMap chart={chart} visible={visibleNode} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 16,
            transform: `translateX(-50%) translateY(${(1 - chromeIn) * -16}px)`,
            opacity: chromeIn,
          }}
        >
          <Toolbar />
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 30,
            transform: `translateX(-50%) translateY(${(1 - pillIn) * 20}px)`,
            opacity: pillIn,
          }}
        >
          <AiPill />
        </div>
        {frame < GENERATE.cardOut + 22 && (
          <div
            style={{
              position: 'absolute',
              left: cardCx - cardW / 2,
              top: loading ? cardCy - cardH / 2 : cardTop,
              width: cardW,
              opacity: clamp01(cardIn * 1.5) * (1 - cardOut),
              transform: `scale(${(0.9 + 0.1 * cardIn) * (1 - 0.04 * cardOut)})`,
            }}
          >
            <WelcomePrompt
              typed={typed}
              caret={frame < GENERATE.click && caretOpacity(frame, lastKey) > 0.5}
              pressed={pressed}
              loading={loading}
            />
          </div>
        )}
        {cursorOpacity > 0 && <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[GENERATE.click]} opacity={cursorOpacity} scale={0.9} />}
      </div>
      <Scrim size={portrait ? 520 : 360} opacity={ease(frame, GENERATE.captionIn - 20, GENERATE.captionIn + 10) * (1 - ease(frame, captionOut - 10, captionOut))} />
      <div style={{ position: 'absolute', left: portrait ? 72 : 120, bottom: portrait ? 190 : 104 }}>
        <Caption lines={COPY.generateCaption} frame={frame} start={GENERATE.captionIn} end={captionOut} size={portrait ? 64 : 60} accentLast />
      </div>
    </AbsoluteFill>
  )
}

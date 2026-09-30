import React from 'react'
import { Img, staticFile } from 'remotion'
import { C, FONT } from '../../theme'
import type { Chart } from '../flow/Nodes'

// Bottom "FlowChart" pill, zoom controls and minimap, as rendered by App.tsx in dark mode.

export const AiPill: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 18px',
      background: 'linear-gradient(135deg, rgba(15, 18, 17, 0.95) 0%, rgba(30, 33, 32, 0.95) 100%)',
      border: '1px solid rgba(120, 252, 214, 0.2)',
      borderRadius: 50,
      boxShadow: '0 8px 26px rgba(0, 0, 0, 0.4), 0 0 18px rgba(120, 252, 214, 0.15)',
      fontFamily: FONT.sans,
      ...style,
    }}
  >
    <Img src={staticFile('brand/logo_color.svg')} style={{ width: 18, height: 18 }} />
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.3,
        background: C.mintTextGradient,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
    >
      FlowChart
    </span>
  </div>
)

const controlBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  color: C.text,
}

export const Controls: React.FC = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(39, 39, 42, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    }}
  >
    <div style={controlBtn}>
      <svg width="12" height="12" viewBox="0 0 32 32" fill="currentColor">
        <path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" />
      </svg>
    </div>
    <div style={controlBtn}>
      <svg width="12" height="12" viewBox="0 0 32 5" fill="currentColor">
        <path d="M0 0h32v4.2H0z" />
      </svg>
    </div>
    <div style={controlBtn}>
      <svg width="12" height="12" viewBox="0 0 32 30" fill="currentColor">
        <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
      </svg>
    </div>
    <div style={{ ...controlBtn, borderBottom: 'none' }}>
      <svg width="12" height="12" viewBox="0 0 25 32" fill="currentColor">
        <path d="M21.333 10.667H19.81V7.619C19.81 3.429 16.38 0 12.19 0 8 0 4.571 3.429 4.571 7.619v3.048H3.048A3.056 3.056 0 000 13.714v15.238A3.056 3.056 0 003.048 32h18.285a3.056 3.056 0 003.048-3.048V13.714a3.056 3.056 0 00-3.048-3.047zM12.19 24.533a3.056 3.056 0 01-3.047-3.047 3.056 3.056 0 013.047-3.048 3.056 3.056 0 013.048 3.048 3.056 3.056 0 01-3.048 3.047zm4.724-13.866H7.467V7.619c0-2.59 2.133-4.724 4.723-4.724 2.591 0 4.724 2.133 4.724 4.724v3.048z" />
      </svg>
    </div>
  </div>
)

/** Minimap: nodes in mint on #1a1d1c, 120x90, like the app's <MiniMap>. */
export const MiniMap: React.FC<{ chart: Chart; visible?: (id: string) => number }> = ({ chart, visible = () => 1 }) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of chart.nodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + n.width)
    maxY = Math.max(maxY, n.position.y + n.height)
  }
  const pad = 60
  const bw = maxX - minX + pad * 2
  const bh = maxY - minY + pad * 2
  const scale = Math.min(120 / bw, 90 / bh)
  const ox = (120 - bw * scale) / 2
  const oy = (90 - bh * scale) / 2
  return (
    <div
      style={{
        width: 120,
        height: 90,
        background: C.surface,
        border: '1px solid rgba(120, 252, 214, 0.2)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        opacity: 0.7,
        overflow: 'hidden',
      }}
    >
      <svg width={120} height={90}>
        {chart.nodes.map((n) => (
          <rect
            key={n.id}
            x={ox + (n.position.x - minX + pad) * scale}
            y={oy + (n.position.y - minY + pad) * scale}
            width={n.width * scale}
            height={n.height * scale}
            rx={2}
            fill={C.mint}
            stroke="rgba(120, 252, 214, 0.5)"
            opacity={visible(n.id)}
          />
        ))}
      </svg>
    </div>
  )
}

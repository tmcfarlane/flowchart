import React from 'react'
import { C, FONT } from '../theme'

// Minimal, generic browser frame around real captures of the app.

export const BrowserWindow: React.FC<{
  width: number
  contentHeight: number
  barHeight: number
  url: React.ReactNode
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ width, contentHeight, barHeight, url, children, style }) => {
  const u = barHeight / 40
  return (
    <div
      style={{
        width,
        height: contentHeight + barHeight,
        borderRadius: 14 * u,
        overflow: 'hidden',
        background: C.bg,
        border: `1px solid rgba(255, 255, 255, 0.1)`,
        boxShadow: '0 40px 100px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 60px rgba(120, 252, 214, 0.05)',
        ...style,
      }}
    >
      <div
        style={{
          height: barHeight,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${14 * u}px`,
          gap: 8 * u,
          background: '#1a1d1c',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
          position: 'relative',
        }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 12 * u, height: 12 * u, borderRadius: '50%', background: c, opacity: 0.9 }} />
        ))}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            height: 26 * u,
            maxWidth: '64%',
            minWidth: '46%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7 * u,
            padding: `0 ${14 * u}px`,
            borderRadius: 8 * u,
            background: 'rgba(255, 255, 255, 0.06)',
            fontFamily: FONT.sans,
            fontSize: 13.5 * u,
            color: 'rgba(231, 236, 235, 0.55)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <svg width={11 * u} height={11 * u} viewBox="0 0 16 16" fill="rgba(231,236,235,0.55)">
            <path d="M4 7V5a4 4 0 118 0v2h.5A1.5 1.5 0 0114 8.5v5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13.5v-5A1.5 1.5 0 013.5 7H4zm2 0h4V5a2 2 0 10-4 0v2z" />
          </svg>
          {url}
        </div>
      </div>
      <div style={{ position: 'relative', width, height: contentHeight, overflow: 'hidden', background: C.bg }}>{children}</div>
    </div>
  )
}

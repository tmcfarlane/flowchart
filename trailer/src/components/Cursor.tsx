import React from 'react'
import { C } from '../theme'
import { clamp01 } from './util'

// Pointer overlay. Headless captures don't include the mouse, so interactions get an
// explicit, restrained cursor with a mint click ripple.

export type CursorKey = { frame: number; x: number; y: number }

export function cursorAt(frame: number, keys: CursorKey[]): { x: number; y: number } {
  if (frame <= keys[0].frame) return keys[0]
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (frame <= b.frame) {
      const t = clamp01((frame - a.frame) / Math.max(1, b.frame - a.frame))
      // ease in-out with a slight overshoot-free settle
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
    }
  }
  return keys[keys.length - 1]
}

export const Cursor: React.FC<{
  x: number
  y: number
  frame: number
  clicks?: number[]
  opacity?: number
  scale?: number
}> = ({ x, y, frame, clicks = [], opacity = 1, scale = 1 }) => {
  const click = clicks.map((c) => frame - c).find((d) => d >= -3 && d < 30)
  const press = click === undefined ? 0 : click < 0 ? (click + 3) / 3 : click < 6 ? 1 - click / 6 : 0
  const ripple = click === undefined || click < 0 ? null : click / 30
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity, pointerEvents: 'none', zIndex: 50 }}>
      {ripple !== null && (
        <div
          style={{
            position: 'absolute',
            left: -22 * scale,
            top: -22 * scale,
            width: 44 * scale,
            height: 44 * scale,
            borderRadius: '50%',
            border: `2px solid ${C.mint}`,
            opacity: (1 - ripple) * 0.9,
            transform: `scale(${0.4 + ripple * 1.1})`,
          }}
        />
      )}
      <svg
        width={26 * scale}
        height={34 * scale}
        viewBox="0 0 26 34"
        style={{
          position: 'absolute',
          left: -3 * scale,
          top: -2 * scale,
          transform: `scale(${1 - 0.12 * press})`,
          transformOrigin: '3px 2px',
          filter: 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.55))',
        }}
      >
        <path
          d="M3 2 L3 26 L9.2 20.4 L13.6 30.6 L17.8 28.8 L13.5 18.8 L21.8 18.8 Z"
          fill="#0f1211"
          stroke="#ffffff"
          strokeWidth={1.8}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

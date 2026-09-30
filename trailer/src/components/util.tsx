import React from 'react'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, EASE, FONT } from '../theme'

export const useLayout = () => {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  return { W: width, H: height, portrait }
}

/** Absolute timeline frame inside a <Sequence from={from}>. */
export const useAbsFrame = (from: number) => useCurrentFrame() + from

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

let canvas: HTMLCanvasElement | null = null
/** Text width with the loaded web fonts (canvas metrics, includes letter-spacing). */
export function measureText(text: string, font: string, letterSpacingPx = 0) {
  canvas ??= document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacingPx}px`
  return ctx.measureText(text).width
}

export const ease = (frame: number, start: number, end: number, easing = EASE.out) =>
  interpolate(frame, [start, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing })

/** Maps a point of an app "screen" (CSS px) through a camera into the video frame. */
export type Camera = { zoom: number; fx: number; fy: number }

export function cameraTransform(cam: Camera, screenW: number, screenH: number, scale: number, W: number, H: number) {
  const s = scale * cam.zoom
  // Keep the screen covering the frame when zoomed in.
  const halfW = W / 2 / s
  const halfH = H / 2 / s
  const fx = screenW * s <= W ? screenW / 2 : Math.min(screenW - halfW, Math.max(halfW, cam.fx))
  const fy = screenH * s <= H ? screenH / 2 : Math.min(screenH - halfH, Math.max(halfH, cam.fy))
  return { s, tx: W / 2 - fx * s, ty: H / 2 - fy * s }
}

export const lerpCam = (a: Camera, b: Camera, t: number): Camera => ({
  zoom: a.zoom + (b.zoom - a.zoom) * t,
  fx: a.fx + (b.fx - a.fx) * t,
  fy: a.fy + (b.fy - a.fy) * t,
})

/** Piecewise camera path: keys [frame, camera], eased between keys. */
export function cameraPath(frame: number, keys: [number, Camera][], easing = EASE.inOut): Camera {
  if (frame <= keys[0][0]) return keys[0][1]
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, c0] = keys[i]
    const [f1, c1] = keys[i + 1]
    if (frame <= f1) return lerpCam(c0, c1, easing(clamp01((frame - f0) / Math.max(1, f1 - f0))))
  }
  return keys[keys.length - 1][1]
}

/** Blinking text caret (mint, like the app's focus accent). */
export const caretOpacity = (frame: number, typingUntil: number) => {
  if (frame <= typingUntil + 6) return 1
  const t = (frame - typingUntil) % 64
  if (t < 30) return 1
  if (t < 36) return 1 - (t - 30) / 6
  if (t < 58) return 0
  return (t - 58) / 6
}

export type CaptionProps = {
  lines: readonly string[]
  frame: number
  start: number
  end?: number
  size?: number
  accentLast?: boolean
  align?: 'left' | 'center'
  style?: React.CSSProperties
}

/** Headline caption: words rise in with a short stagger, leave with a quick fade. */
export const Caption: React.FC<CaptionProps> = ({ lines, frame, start, end, size = 56, accentLast = false, align = 'left', style }) => {
  const out = end === undefined ? 0 : ease(frame, end - 10, end, EASE.in)
  let wordIndex = 0
  return (
    <div
      style={{
        fontFamily: FONT.sans,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '-0.025em',
        lineHeight: 1.08,
        color: C.text,
        textAlign: align,
        opacity: 1 - out,
        transform: `translateY(${-8 * out}px)`,
        ...style,
      }}
    >
      {lines.map((line, li) => {
        const accent = accentLast && li === lines.length - 1
        return (
          <div key={li} style={{ whiteSpace: 'nowrap' }}>
            {line.split(' ').map((word, wi) => {
              const k = ease(frame, start + wordIndex * 3, start + wordIndex * 3 + 22)
              wordIndex++
              return (
                <span
                  key={wi}
                  style={{
                    display: 'inline-block',
                    opacity: k,
                    transform: `translateY(${(1 - k) * 18}px)`,
                    filter: k < 1 ? `blur(${(1 - k) * 6}px)` : undefined,
                    marginRight: '0.26em',
                    color: accent ? C.mint : undefined,
                  }}
                >
                  {word}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/** Soft charcoal scrim so captions read over UI. */
export const Scrim: React.FC<{ from?: 'bottom' | 'top'; size: number; opacity: number }> = ({ from = 'bottom', size, opacity }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      [from]: 0,
      height: size,
      opacity,
      background: `linear-gradient(to ${from === 'bottom' ? 'top' : 'bottom'}, rgba(15, 18, 17, 0.94) 0%, rgba(15, 18, 17, 0.72) 45%, rgba(15, 18, 17, 0) 100%)`,
      pointerEvents: 'none',
    }}
  />
)

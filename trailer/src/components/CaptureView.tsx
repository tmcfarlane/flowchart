import React from 'react'
import { Freeze, Img, OffthreadVideo, staticFile } from 'remotion'

// A real capture of the app (still or frame-accurate recording) with a camera.
// Camera focus is given in the capture's own CSS pixels.

export type CaptureCamera = { zoom: number; fx: number; fy: number }

export type CaptureSource = { kind: 'image'; src: string } | { kind: 'video'; src: string; sourceFrame: number }

export const CaptureView: React.FC<{
  width: number
  height: number
  capture: { w: number; h: number }
  source: CaptureSource
  camera?: CaptureCamera
  style?: React.CSSProperties
  children?: React.ReactNode
}> = ({ width, height, capture, source, camera = { zoom: 1, fx: capture.w / 2, fy: capture.h / 2 }, style, children }) => {
  const base = Math.max(width / capture.w, height / capture.h)
  const s = base * camera.zoom
  // Keep the capture covering the pane.
  const halfW = width / 2 / s
  const halfH = height / 2 / s
  const fx = Math.min(capture.w - halfW, Math.max(halfW, camera.fx))
  const fy = Math.min(capture.h - halfH, Math.max(halfH, camera.fy))
  const tx = width / 2 - fx * s
  const ty = height / 2 - fy * s

  const media =
    source.kind === 'image' ? (
      <Img src={staticFile(source.src)} style={{ width: capture.w, height: capture.h, display: 'block' }} />
    ) : (
      <Freeze frame={source.sourceFrame}>
        <OffthreadVideo src={staticFile(source.src)} muted style={{ width: capture.w, height: capture.h, display: 'block' }} />
      </Freeze>
    )

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', ...style }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: capture.w,
          height: capture.h,
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${s})`,
        }}
      >
        {media}
        {children}
      </div>
    </div>
  )
}

/** Maps a timeline frame to a source frame so that `sourceAnchor` plays at `timelineAnchor`.
 * Before the anchor window the first `loop` frames repeat (the edges' dash animation loops
 * every 30 frames, so the idle state keeps moving seamlessly). */
export function sourceFrameFor(frame: number, timelineAnchor: number, sourceAnchor: number, total: number, loop = 30) {
  const k = frame - timelineAnchor + sourceAnchor
  if (k < 0) return ((k % loop) + loop) % loop
  return Math.min(k, total - 1)
}

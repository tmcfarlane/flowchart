import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, staticFile } from 'remotion'
import { BAR, COPY, MONTAGE } from '../timeline'
import { C, EASE } from '../theme'
import captures from '../data/captures.json'
import rainIcons from '../data/rain-icons.json'
import { CaptureView, type CaptureCamera } from '../components/CaptureView'
import { Cursor, cursorAt } from '../components/Cursor'
import { Caption, Scrim, ease, useAbsFrame, useLayout } from '../components/util'

type Cap = (typeof captures)['landscape']
type Box = { x: number; y: number; width: number; height: number }
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

function hash(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 663+ icons: a wall of the app's real Azure icon tiles, stacking in on the beat. */
const IconWall: React.FC<{ frame: number; start: number }> = ({ frame, start }) => {
  const { W, H } = useLayout()
  const pitch = 132
  const tile = 118
  const cols = Math.ceil(W / pitch) + 1
  const rows = Math.ceil(H / pitch) + 1
  const x0 = (W - (cols * pitch - (pitch - tile))) / 2
  const y0 = (H - (rows * pitch - (pitch - tile))) / 2
  const fps = 60
  const zoom = interpolate(frame, [start, start + BAR], [1.1, 1.0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE.out })
  const tiles: React.ReactNode[] = []
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = rainIcons[i % rainIcons.length]
      i++
      const h = hash(c, r)
      const delay = start + (rows - 1 - r) * 3.2 + h * 12
      const p = frame < delay ? 0 : spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 190, mass: 0.75 } })
      if (p <= 0) continue
      const fall = (1 - p) * (y0 + r * pitch + tile + 80)
      const lit = hash(r + 7, c + 3) > 0.9 ? ease(frame, start + 64 + h * 30, start + 74 + h * 30) : 0
      tiles.push(
        <div
          key={`${r}-${c}`}
          style={{
            position: 'absolute',
            left: x0 + c * pitch,
            top: y0 + r * pitch - fall,
            width: tile,
            height: tile,
            borderRadius: 14,
            background: lit ? `rgba(120, 252, 214, ${0.05 + 0.05 * lit})` : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${lit ? `rgba(120, 252, 214, ${0.1 + 0.9 * lit})` : 'rgba(255, 255, 255, 0.1)'}`,
            boxShadow: lit ? `0 4px 12px rgba(120, 252, 214, ${0.2 * lit})` : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `rotate(${(h - 0.5) * 16 * (1 - p)}deg)`,
          }}
        >
          <Img src={staticFile(`icons/${id}.svg`)} style={{ width: 64, height: 64, objectFit: 'contain' }} />
        </div>,
      )
    }
  }
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>{tiles}</AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(15,18,17,0) 35%, rgba(15,18,17,0.7) 100%)' }} />
    </AbsoluteFill>
  )
}

export const Montage: React.FC<{ from: number }> = ({ from }) => {
  const frame = useAbsFrame(from)
  const { W, H, portrait } = useLayout()
  const cap: Cap = portrait ? (captures.portrait as unknown as Cap) : captures.landscape
  const dir = portrait ? 'portrait' : 'landscape'
  const capture = { w: cap.viewport.width, h: cap.viewport.height }
  const beat = Math.min(4, Math.max(0, Math.floor((frame - from) / BAR)))
  const t0 = MONTAGE.cuts[beat]
  const local = frame - t0
  // Snappy cut: each shot lands with a short settle.
  const settle = 1 + 0.025 * (1 - ease(frame, t0, t0 + 14))

  // Map capture CSS px to frame px for the cursor (base cover scale + camera).
  const toFrame = (cam: CaptureCamera, p: { x: number; y: number }) => {
    const base = Math.max(W / capture.w, H / capture.h)
    const s = base * cam.zoom
    const halfW = W / 2 / s
    const halfH = H / 2 / s
    const fx = Math.min(capture.w - halfW, Math.max(halfW, cam.fx))
    const fy = Math.min(capture.h - halfH, Math.max(halfH, cam.fy))
    return { x: W / 2 + (p.x - fx) * s, y: H / 2 + (p.y - fy) * s }
  }

  let shot: React.ReactNode = null
  let cursor: React.ReactNode = null
  if (beat === 0) {
    shot = <IconWall frame={frame} start={t0} />
  } else if (beat === 1) {
    const cam: CaptureCamera = {
      zoom: interpolate(local, [0, BAR], portrait ? [1.25, 1.32] : [1.0, 1.06]),
      fx: capture.w / 2,
      fy: portrait ? capture.h / 2 + 60 : capture.h / 2 + 50,
    }
    shot = <CaptureView width={W} height={H} capture={capture} camera={cam} source={{ kind: 'video', src: cap.present.file, sourceFrame: Math.min(cap.present.frames - 1, local + 8) }} />
  } else if (beat === 2) {
    const dd = cap.stills.exportDropdown as Box
    const c = mid(dd)
    const cam: CaptureCamera = portrait
      ? { zoom: interpolate(local, [0, BAR], [2.0, 2.1]), fx: c.x - 60, fy: c.y + 150 }
      : { zoom: interpolate(local, [0, BAR], [2.05, 2.15]), fx: c.x - 120, fy: c.y + 40 }
    const hover = MONTAGE.exportHovers.filter((f) => frame >= f).length
    const file = ['export-open', 'export-hover-png', 'export-hover-svg', 'export-hover-gif'][hover]
    shot = <CaptureView width={W} height={H} capture={capture} camera={cam} source={{ kind: 'image', src: `captures/${dir}/${file}.png` }} />
    const opts = [cap.stills.export_png, cap.stills.export_svg, cap.stills.export_gif] as Box[]
    const keys = [
      { frame: t0, x: c.x + 150, y: c.y + 120 },
      ...opts.map((b, k) => ({ frame: MONTAGE.exportHovers[k] - 4, x: b.x + 70, y: b.y + b.height / 2 })),
    ].map((k) => ({ ...k, ...toFrame(cam, k) }))
    const cur = cursorAt(frame, keys)
    cursor = <Cursor x={cur.x} y={cur.y} frame={frame} scale={portrait ? 1.5 : 1.3} opacity={ease(frame, t0 + 2, t0 + 10)} />
  } else if (beat === 3) {
    const panel = cap.stills.sharePanel as Box
    const c = mid(panel)
    const cam: CaptureCamera = portrait
      ? { zoom: interpolate(local, [0, BAR], [1.95, 2.02]), fx: c.x - 40, fy: c.y + 60 }
      : { zoom: interpolate(local, [0, BAR], [2.0, 2.08]), fx: c.x, fy: c.y + 30 }
    const copied = frame >= MONTAGE.shareClick + 2
    shot = <CaptureView width={W} height={H} capture={capture} camera={cam} source={{ kind: 'image', src: `captures/${dir}/${copied ? 'share-copied' : 'share-open'}.png` }} />
    const btn = mid(cap.stills.copyMcp as Box)
    const keys = [
      { frame: t0 + 4, x: btn.x - 170, y: btn.y + 110 },
      { frame: MONTAGE.shareClick - 6, x: btn.x, y: btn.y },
      { frame: MONTAGE.shareClick + 40, x: btn.x + 16, y: btn.y + 22 },
    ].map((k) => ({ ...k, ...toFrame(cam, k) }))
    const cur = cursorAt(frame, keys)
    cursor = <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[MONTAGE.shareClick]} scale={portrait ? 1.5 : 1.3} opacity={ease(frame, t0 + 4, t0 + 12)} />
  } else {
    const toggle = mid(cap.stills.darkToggle as Box)
    const zoom = interpolate(local, [0, BAR], [1.0, 1.05])
    // Top-aligned so the toolbar (and the toggle being clicked) stays in frame.
    const cam: CaptureCamera = { zoom, fx: capture.w / 2, fy: 0 }
    const reveal = ease(frame, MONTAGE.darkClick + 2, MONTAGE.darkClick + 26, EASE.inOut)
    const origin = toFrame(cam, toggle)
    const radius = reveal * Math.hypot(Math.max(origin.x, W - origin.x), Math.max(origin.y, H - origin.y)) * 1.05
    shot = (
      <AbsoluteFill>
        <CaptureView width={W} height={H} capture={capture} camera={cam} source={{ kind: 'image', src: `captures/${dir}/mode-light.png` }} />
        <AbsoluteFill style={{ clipPath: `circle(${radius}px at ${origin.x}px ${origin.y}px)` }}>
          <CaptureView width={W} height={H} capture={capture} camera={cam} source={{ kind: 'image', src: `captures/${dir}/mode-dark.png` }} />
        </AbsoluteFill>
      </AbsoluteFill>
    )
    const keys = [
      { frame: t0 + 2, x: toggle.x + 150, y: toggle.y + 170 },
      { frame: MONTAGE.darkClick - 6, x: toggle.x, y: toggle.y },
      { frame: MONTAGE.darkClick + 50, x: toggle.x + 30, y: toggle.y + 60 },
    ].map((k) => ({ ...k, ...toFrame(cam, k) }))
    const cur = cursorAt(frame, keys)
    cursor = <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[MONTAGE.darkClick]} scale={portrait ? 1.5 : 1.25} opacity={ease(frame, t0 + 2, t0 + 10) * (1 - ease(frame, MONTAGE.darkClick + 40, MONTAGE.darkClick + 56))} />
  }

  const captionStart = t0 + (beat === 0 ? 30 : 8)
  const captionEnd = t0 + BAR - 4
  const scrimK = ease(frame, t0, t0 + 10)
  // The presentation's own controls sit at the bottom, so that caption goes on top.
  const top = beat === 1
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${settle})` }}>{shot}</AbsoluteFill>
      {cursor}
      <Scrim from={top ? 'top' : 'bottom'} size={portrait ? 560 : 380} opacity={scrimK} />
      <div
        style={{
          position: 'absolute',
          left: portrait ? 72 : 120,
          right: portrait ? 72 : undefined,
          ...(top ? { top: portrait ? 150 : 96 } : { bottom: portrait ? 170 : 100 }),
        }}
      >
        <Caption key={beat} lines={[COPY.montage[beat]]} frame={frame} start={captionStart} end={beat === 4 ? undefined : captionEnd} size={portrait ? 64 : 58} />
      </div>
    </AbsoluteFill>
  )
}

import React, { useEffect, useMemo, useState } from 'react'
import { continueRender, delayRender, staticFile } from 'remotion'

// Renders the app's real logo (public/logo/logo_color.svg, copied verbatim) from its own
// path data, so it can be stroke-drawn and built up without redrawing the mark.

type LogoData = {
  viewBox: [number, number, number, number]
  gear: string
  gearParts: string[]
  pointer: string
  pointerFill: string
  pointerOpacity: number
  stops: { offset: string; color: string }[]
  gradient: { x1: string; y1: string; x2: string; y2: string }
  lengths: number[]
}

let cache: LogoData | null = null
let pending: Promise<LogoData> | null = null

function measure(d: string): number {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('style', 'position:absolute;width:0;height:0;visibility:hidden')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  document.body.appendChild(svg)
  const length = path.getTotalLength()
  svg.remove()
  return length
}

function loadLogo(): Promise<LogoData> {
  if (cache) return Promise.resolve(cache)
  if (pending) return pending
  pending = fetch(staticFile('brand/logo_color.svg'))
    .then((r) => r.text())
    .then((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const root = doc.documentElement
      const [gearEl, pointerEl] = Array.from(doc.querySelectorAll('path'))
      const gear = gearEl.getAttribute('d')!
      const gearParts = gear.split(/(?=M)/).filter(Boolean)
      const gradientEl = doc.querySelector('linearGradient')!
      const data: LogoData = {
        viewBox: root.getAttribute('viewBox')!.split(/\s+/).map(Number) as LogoData['viewBox'],
        gear,
        gearParts,
        pointer: pointerEl.getAttribute('d')!,
        pointerFill: pointerEl.getAttribute('fill') ?? 'white',
        pointerOpacity: Number(pointerEl.getAttribute('opacity') ?? 1),
        stops: Array.from(doc.querySelectorAll('stop')).map((s) => ({
          offset: s.getAttribute('offset')!,
          color: s.getAttribute('stop-color')!,
        })),
        gradient: {
          x1: gradientEl.getAttribute('x1') ?? '0%',
          y1: gradientEl.getAttribute('y1') ?? '0%',
          x2: gradientEl.getAttribute('x2') ?? '100%',
          y2: gradientEl.getAttribute('y2') ?? '100%',
        },
        lengths: gearParts.map(measure),
      }
      cache = data
      return data
    })
  return pending
}

export function useLogo(): LogoData | null {
  const [data, setData] = useState<LogoData | null>(cache)
  const [handle] = useState(() => (cache ? null : delayRender('Loading logo SVG')))
  useEffect(() => {
    if (cache) return
    loadLogo().then((d) => {
      setData(d)
      if (handle !== null) continueRender(handle)
    })
  }, [handle])
  return data
}

/** Pen-tip position along the outer gear outline, in viewBox units. */
export function logoPenPoint(data: LogoData, progress: number): { x: number; y: number } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('style', 'position:absolute;width:0;height:0;visibility:hidden')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', data.gearParts[0])
  svg.appendChild(path)
  document.body.appendChild(svg)
  const p = path.getPointAtLength(data.lengths[0] * Math.max(0, Math.min(1, progress)))
  svg.remove()
  return { x: p.x, y: p.y }
}

let idCounter = 0

export type LogoProps = {
  size: number
  /** 0..1 outline drawing progress (outer gear, then inner ring). */
  draw?: number
  /** 0..1 gradient fill of the gear. */
  fill?: number
  /** 0..1 opacity of the pointer; `pointerScale` scales it about its center. */
  pointer?: number
  pointerScale?: number
  rotate?: number
  /** 0..1 mint glow around the mark. */
  glow?: number
  strokeWidth?: number
  style?: React.CSSProperties
}

export const Logo: React.FC<LogoProps> = ({
  size,
  draw = 1,
  fill = 1,
  pointer = 1,
  pointerScale = 1,
  rotate = 0,
  glow = 0,
  strokeWidth = 5,
  style,
}) => {
  const data = useLogo()
  const id = useMemo(() => `logo-grad-${++idCounter}`, [])
  if (!data) return null
  const [vx, vy, vw, vh] = data.viewBox
  const height = (size * vh) / vw
  const drawOuter = Math.min(1, draw / 0.82)
  const drawInner = Math.max(0, (draw - 0.55) / 0.45)
  const showStroke = draw < 1 || fill < 1
  // Pointer bounds (from the path data) so it scales about its own center
  const pcx = 234
  const pcy = 235
  return (
    <svg
      width={size}
      height={height}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      style={{
        overflow: 'visible',
        filter: glow > 0 ? `drop-shadow(0 0 ${18 * glow}px rgba(120, 252, 214, ${0.45 * glow}))` : undefined,
        ...style,
      }}
    >
      <defs>
        <linearGradient id={id} x1={data.gradient.x1} y1={data.gradient.y1} x2={data.gradient.x2} y2={data.gradient.y2}>
          {data.stops.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
      </defs>
      <g transform={`rotate(${rotate} ${vw / 2} ${vh / 2})`}>
        {fill > 0 && <path d={data.gear} fill={`url(#${id})`} opacity={fill} />}
        {showStroke &&
          data.gearParts.map((d, i) => {
            const L = data.lengths[i]
            const p = i === 0 ? drawOuter : drawInner
            if (p <= 0) return null
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={`url(#${id})`}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${L} ${L}`}
                strokeDashoffset={L * (1 - p)}
                opacity={1 - fill * 0.85}
              />
            )
          })}
      </g>
      {pointer > 0 && (
        <path
          d={data.pointer}
          fill={data.pointerFill}
          opacity={data.pointerOpacity * pointer}
          transform={`translate(${pcx} ${pcy}) scale(${pointerScale}) translate(${-pcx} ${-pcy})`}
        />
      )}
    </svg>
  )
}

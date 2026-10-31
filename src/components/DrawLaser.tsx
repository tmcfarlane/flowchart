import { memo, useEffect, useState } from 'react'

/** How long a laser point stays visible after it is drawn. */
export const LASER_DECAY_MS = 1000

export interface LaserPoint { x: number; y: number; t: number }
export interface LaserTrace { id: number; points: LaserPoint[]; finished: boolean }

/**
 * Drop fully decayed points. One decayed point is kept in front of the first
 * live one as the start of its segment, and the newest is always kept so a
 * resting pointer still shows its dot and a resumed trail connects to it.
 */
export function pruneLaserPoints(points: LaserPoint[], now: number): LaserPoint[] {
  const firstLive = points.findIndex(point => now - point.t < LASER_DECAY_MS)
  if (firstLive === -1) return points.slice(-1)
  return firstLive <= 1 ? points : points.slice(firstLive - 1)
}

const HEAD_WIDTH = 5
const TAIL_WIDTH = 0.5

/**
 * Comet-style laser: every segment thins out as it ages, so the trail shortens
 * behind a moving pointer instead of persisting until release. It owns its own
 * animation clock so only this layer re-renders each frame.
 */
function DrawLaser({ traces, zoom }: { traces: LaserTrace[]; zoom: number }) {
  const [now, setNow] = useState(() => performance.now())
  const active = traces.length > 0

  useEffect(() => {
    if (!active) return
    let frame = requestAnimationFrame(function tick() {
      setNow(performance.now())
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [active])

  return <>
    {traces.map(trace => {
      const head = trace.points[trace.points.length - 1]
      return <g key={trace.id} className={trace.finished ? 'draw-laser-trace is-fading' : 'draw-laser-trace'} stroke="#ff5555" fill="#ff5555" strokeLinecap="round" pointerEvents="none">
        {trace.points.slice(1).map((point, index) => {
          const life = 1 - (now - point.t) / LASER_DECAY_MS
          if (life <= 0) return null
          const previous = trace.points[index]
          return <line key={point.t + ':' + index} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} strokeWidth={(TAIL_WIDTH + (HEAD_WIDTH - TAIL_WIDTH) * life) / zoom} />
        })}
        {!trace.finished && head && <circle cx={head.x} cy={head.y} r={HEAD_WIDTH / 2 / zoom} stroke="none" />}
      </g>
    })}
  </>
}

export default memo(DrawLaser)

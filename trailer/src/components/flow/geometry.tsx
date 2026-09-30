import React from 'react'
import type { Chart, ChartEdge, ChartNode, HandleSide } from './Nodes'

// Edge geometry mirrors React Flow 11: handles sit 4px outside the node box (8px handles
// at -4px), bezier curvature 0.25, ArrowClosed marker (20x20, markerUnits=strokeWidth).

export type Point = { x: number; y: number }

export function handlePoint(node: ChartNode, side: HandleSide): Point {
  const { x, y } = node.position
  const { width: w, height: h } = node
  switch (side) {
    case 'top':
      return { x: x + w / 2, y: y - 4 }
    case 'bottom':
      return { x: x + w / 2, y: y + h + 4 }
    case 'left':
      return { x: x - 4, y: y + h / 2 }
    default:
      return { x: x + w + 4, y: y + h / 2 }
  }
}

function controlOffset(distance: number, curvature: number) {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance)
}

function control(side: HandleSide, x1: number, y1: number, x2: number, y2: number, c = 0.25): Point {
  switch (side) {
    case 'left':
      return { x: x1 - controlOffset(x1 - x2, c), y: y1 }
    case 'right':
      return { x: x1 + controlOffset(x2 - x1, c), y: y1 }
    case 'top':
      return { x: x1, y: y1 - controlOffset(y1 - y2, c) }
    default:
      return { x: x1, y: y1 + controlOffset(y2 - y1, c) }
  }
}

export type EdgeGeometry = {
  d: string
  source: Point
  target: Point
  c1: Point
  c2: Point
  label: Point
  length: number
  angle: number
}

const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d

export function edgeGeometry(chart: Chart, edge: ChartEdge): EdgeGeometry | null {
  const s = chart.nodes.find((n) => n.id === edge.source)
  const t = chart.nodes.find((n) => n.id === edge.target)
  if (!s || !t) return null
  const sSide = edge.sourceHandle ?? 'bottom'
  const tSide = edge.targetHandle ?? 'top'
  const source = handlePoint(s, sSide)
  const target = handlePoint(t, tSide)
  const c1 = control(sSide, source.x, source.y, target.x, target.y)
  const c2 = control(tSide, target.x, target.y, source.x, source.y)
  let length = 0
  let prev = source
  for (let i = 1; i <= 48; i++) {
    const k = i / 48
    const p = { x: cubic(source.x, c1.x, c2.x, target.x, k), y: cubic(source.y, c1.y, c2.y, target.y, k) }
    length += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  const label = {
    x: source.x * 0.125 + c1.x * 0.375 + c2.x * 0.375 + target.x * 0.125,
    y: source.y * 0.125 + c1.y * 0.375 + c2.y * 0.375 + target.y * 0.125,
  }
  const angle = Math.atan2(target.y - c2.y, target.x - c2.x)
  return {
    d: `M${source.x},${source.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${target.x},${target.y}`,
    source,
    target,
    c1,
    c2,
    label,
    length,
    angle,
  }
}

export const EDGE_COLOR = '#78fcd6'

/** ArrowClosed polyline (-5,-4 0,0 -5,4) at 2px per unit (markerUnits=strokeWidth, stroke 2). */
export const Arrowhead: React.FC<{ at: Point; angle: number; opacity?: number; scale?: number; color?: string }> = ({
  at,
  angle,
  opacity = 1,
  scale = 1,
  color = EDGE_COLOR,
}) => (
  <g transform={`translate(${at.x} ${at.y}) rotate(${(angle * 180) / Math.PI}) scale(${2 * scale})`} opacity={opacity}>
    <polyline
      points="-5,-4 0,0 -5,4 -5,-4"
      fill={color}
      stroke={color}
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </g>
)

import React from 'react'
import { C, FONT } from '../../theme'
import { Arrowhead, EDGE_COLOR, edgeGeometry } from './geometry'
import { NodeView, type Chart, type ChartEdge } from './Nodes'

export type Viewport = { x: number; y: number; zoom: number }

/** React Flow 11 getTransformForBounds, used by the app to fit shared charts. */
export function fitTransform(
  chart: Chart,
  width: number,
  height: number,
  opts: { top?: number; bottom?: number; side?: number; minZoom?: number; maxZoom?: number; padding?: number } = {},
): Viewport {
  const { top = 128, bottom = 96, side = 48, minZoom = 0.1, maxZoom = 1.2, padding = 0.04 } = opts
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
  const w = Math.max(200, width - side * 2)
  const h = Math.max(200, height - top - bottom)
  const bw = maxX - minX
  const bh = maxY - minY
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(w / (bw * (1 + padding)), h / (bh * (1 + padding)))))
  return {
    x: w / 2 - (minX + bw / 2) * zoom + side,
    y: h / 2 - (minY + bh / 2) * zoom + top,
    zoom,
  }
}

/** The app's dot grid: <Background variant=Dots gap={18} size={1} color="rgba(231,236,235,0.18)" />. */
export const DotGrid: React.FC<{ viewport: Viewport; width: number; height: number; opacity?: number; id: string }> = ({
  viewport,
  width,
  height,
  opacity = 1,
  id,
}) => {
  const gap = 18 * viewport.zoom
  const r = 0.5 * viewport.zoom
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity }}>
      <pattern
        id={id}
        x={viewport.x % gap}
        y={viewport.y % gap}
        width={gap}
        height={gap}
        patternUnits="userSpaceOnUse"
        patternTransform={`translate(-${r},-${r})`}
      >
        <circle cx={r} cy={r} r={r} fill={C.gridDot} />
      </pattern>
      <rect width={width} height={height} fill={`url(#${id})`} />
    </svg>
  )
}

export type FlowCanvasProps = {
  id: string
  chart: Chart
  viewport: Viewport
  width: number
  height: number
  /** Spring-like appearance per node: 0 hidden, 1 settled (may overshoot). */
  nodeProgress?: (id: string) => number
  /** 0..1 draw progress per edge. */
  edgeProgress?: (edge: ChartEdge) => number
  /** 0..1 mint "changed by agent" glow per node. */
  nodeGlow?: (id: string) => number
  frame: number
  grid?: boolean
  gridOpacity?: number
  background?: boolean
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  id,
  chart,
  viewport,
  width,
  height,
  nodeProgress = () => 1,
  edgeProgress = () => 1,
  nodeGlow,
  frame,
  grid = true,
  gridOpacity = 1,
  background = true,
}) => {
  // .react-flow__edge.animated: stroke-dasharray 5, dashdraw 0.5s linear infinite (offset 0 -> -10)
  const dashOffset = -((frame % 30) / 30) * 10
  const edges = chart.edges
    .map((e) => ({ edge: e, g: edgeGeometry(chart, e), p: clamp01(edgeProgress(e)) }))
    .filter((e) => e.g && e.p > 0)
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: background ? C.bg : undefined }}>
      {grid && <DotGrid id={`${id}-grid`} viewport={viewport} width={width} height={height} opacity={gridOpacity} />}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={1} height={1}>
          <defs>
            {edges
              .filter(({ p }) => p < 1)
              .map(({ edge, g, p }) => (
                <mask key={edge.id} id={`${id}-m-${edge.id}`} maskUnits="userSpaceOnUse" x={-20000} y={-20000} width={40000} height={40000}>
                  <path
                    d={g!.d}
                    fill="none"
                    stroke="white"
                    strokeWidth={8}
                    strokeLinecap="butt"
                    strokeDasharray={`${g!.length * p} ${g!.length * 2}`}
                  />
                </mask>
              ))}
          </defs>
          {edges.map(({ edge, g, p }) => {
            const dashed = edge.style !== 'default' && edge.style !== 'step'
            const tip = p < 1 ? pointAt(g!, p) : null
            return (
              <g key={edge.id}>
                <path
                  d={g!.d}
                  fill="none"
                  stroke={EDGE_COLOR}
                  strokeWidth={2}
                  strokeDasharray={dashed ? '5 5' : undefined}
                  strokeDashoffset={dashed ? dashOffset : undefined}
                  mask={p < 1 ? `url(#${id}-m-${edge.id})` : undefined}
                />
                {tip && (
                  <circle cx={tip.x} cy={tip.y} r={3} fill={C.mintBright} style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,182,0.9))' }} />
                )}
                <Arrowhead at={g!.target} angle={g!.angle} opacity={clamp01((p - 0.86) / 0.14)} />
              </g>
            )
          })}
        </svg>
        {edges
          .filter(({ edge, p }) => edge.label && p > 0.55)
          .map(({ edge, g, p }) => {
            const k = clamp01((p - 0.55) / 0.45)
            return (
              <div
                key={edge.id}
                style={{
                  position: 'absolute',
                  left: g!.label.x,
                  top: g!.label.y,
                  transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * k})`,
                  opacity: k,
                  background: 'rgba(15, 18, 17, 0.95)',
                  border: '1px solid rgba(120, 252, 214, 0.2)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
                  color: C.text,
                  fontFamily: FONT.sans,
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
              >
                {edge.label}
              </div>
            )
          })}
        {chart.nodes.map((node) => {
          const p = nodeProgress(node.id)
          if (p <= 0.001) return null
          const glow = nodeGlow?.(node.id) ?? 0
          return (
            <div
              key={node.id}
              style={{
                position: 'absolute',
                left: node.position.x,
                top: node.position.y,
                width: node.width,
                height: node.height,
                opacity: clamp01(p * 1.6),
                transform: `translateY(${(1 - Math.min(p, 1)) * 14}px) scale(${0.84 + 0.16 * p})`,
                transformOrigin: '50% 50%',
                filter: glow > 0 ? `drop-shadow(0 0 ${18 * glow}px rgba(0, 255, 182, ${0.95 * glow}))` : undefined,
              }}
            >
              <NodeView node={node} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function pointAt(g: NonNullable<ReturnType<typeof edgeGeometry>>, p: number) {
  // Walk the cubic to the arc-length fraction p.
  const target = g.length * p
  let acc = 0
  let prev = g.source
  for (let i = 1; i <= 64; i++) {
    const k = i / 64
    const q = {
      x: (1 - k) ** 3 * g.source.x + 3 * (1 - k) ** 2 * k * g.c1.x + 3 * (1 - k) * k ** 2 * g.c2.x + k ** 3 * g.target.x,
      y: (1 - k) ** 3 * g.source.y + 3 * (1 - k) ** 2 * k * g.c1.y + 3 * (1 - k) * k ** 2 * g.c2.y + k ** 3 * g.target.y,
    }
    const seg = Math.hypot(q.x - prev.x, q.y - prev.y)
    if (acc + seg >= target) {
      const f = seg > 0 ? (target - acc) / seg : 0
      return { x: prev.x + (q.x - prev.x) * f, y: prev.y + (q.y - prev.y) * f }
    }
    acc += seg
    prev = q
  }
  return g.target
}

import { memo, useId } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export interface DrawSceneSvgProps {
  elements: readonly Record<string, unknown>[]
  files: Record<string, Record<string, unknown>>
  darkMode?: boolean
  /** Actual SVG surface color, used for contrast when it differs from the app theme. */
  backgroundColor?: string
  selectedIds?: ReadonlySet<string>
  showFrames?: boolean
}

type ElementRecord = Record<string, unknown>
type Point = readonly [number, number]

const number = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const string = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const pointsOf = (element: ElementRecord): Point[] => Array.isArray(element.points)
  ? element.points.filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2 && typeof point[0] === 'number' && typeof point[1] === 'number').map(point => [point[0], point[1]])
  : []
const color = (value: unknown, fallback = 'none') => {
  const candidate = string(value, fallback)
  return /[;<>]|url\s*\(/i.test(candidate) ? fallback : candidate
}
const ink = (value: unknown, dark: boolean) => {
  const candidate = color(value, '#1e1e1e')
  if (dark && ['#000', '#000000', '#1e1e1e', '#111827', '#0f1211', '#1e293b', '#0f172a', '#1f2937', '#334155'].includes(candidate.toLowerCase())) return '#dcece6'
  if (dark && candidate.toLowerCase() === '#087f5b') return '#78fcd6'
  return candidate
}
const safeId = (value: unknown) => {
  const text = String(value)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `${text.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36)}-${(hash >>> 0).toString(36)}`
}
const dash = (style: unknown, width: number) => style === 'dashed' ? `${width * 5} ${width * 3}` : style === 'dotted' ? `${Math.max(0.5, width / 5)} ${width * 3}` : undefined

/** Shared rendering coordinates: path points may extend left/up from their origin. */
export function drawElementCenter(element: ElementRecord): { x: number; y: number } {
  const x = number(element.x), y = number(element.y)
  const points = pointsOf(element)
  if (points.length && ['line', 'arrow', 'freedraw'].includes(string(element.type))) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]) }
    return { x: x + (minX + maxX) / 2, y: y + (minY + maxY) / 2 }
  }
  return { x: x + number(element.width) / 2, y: y + number(element.height) / 2 }
}

function pathForPoints(points: readonly Point[], curved: boolean): string {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} l 0.01 0`
  if (!curved || points.length === 2) return points.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')
  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const previous = points[Math.max(0, i - 1)], start = points[i], end = points[i + 1], next = points[Math.min(points.length - 1, i + 2)]
    path += ` C ${start[0] + (end[0] - previous[0]) / 6} ${start[1] + (end[1] - previous[1]) / 6} ${end[0] - (next[0] - start[0]) / 6} ${end[1] - (next[1] - start[1]) / 6} ${end[0]} ${end[1]}`
  }
  return path
}

function pressureOutline(points: readonly Point[], pressures: readonly number[], width: number): string {
  if (!points.length) return ''
  if (points.length === 1) return ''
  const left: Point[] = [], right: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)]
    const dx = next[0] - previous[0], dy = next[1] - previous[1], length = Math.hypot(dx, dy) || 1
    const pressure = Math.max(0, Math.min(1, pressures[i] ?? 0.5))
    const radius = width * (0.3 + pressure * 1.4) / 2
    left.push([points[i][0] - dy / length * radius, points[i][1] + dx / length * radius])
    right.push([points[i][0] + dy / length * radius, points[i][1] - dx / length * radius])
  }
  return `${pathForPoints([...left, ...right.reverse()], false)} Z`
}

function roundedRectangle(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  return `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`
}

function primitivePath(element: ElementRecord): string {
  const width = number(element.width), height = number(element.height)
  if (element.type === 'diamond') return `M ${width / 2} 0 L ${width} ${height / 2} L ${width / 2} ${height} L 0 ${height / 2} Z`
  if (element.type === 'ellipse') return `M ${width} ${height / 2} A ${width / 2} ${height / 2} 0 1 0 0 ${height / 2} A ${width / 2} ${height / 2} 0 1 0 ${width} ${height / 2} Z`
  const rounded = element.roundness !== null && element.roundness !== undefined && element.roundness !== false
  return roundedRectangle(width, height, rounded ? Math.min(18, Math.min(width, height) * 0.13) : 0)
}

function jitter(seed: number) {
  let state = seed >>> 0
  return () => {
    state = Math.imul(state ^ state >>> 15, 1 | state)
    state ^= state + Math.imul(state ^ state >>> 7, 61 | state)
    return ((state ^ state >>> 14) >>> 0) / 4294967296 - 0.5
  }
}

/** Stable, intentionally subtle sketch outlines; saved geometry remains exact. */
function sketchPath(element: ElementRecord): string {
  const width = number(element.width), height = number(element.height)
  const random = jitter(number(element.seed, safeId(element.id).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)))
  const amount = Math.min(3, number(element.roughness)) * 0.85
  const p = (x: number, y: number): Point => [x + random() * amount, y + random() * amount]
  if (element.type === 'ellipse') {
    const positions: Point[] = []
    for (let i = 0; i <= 24; i++) {
      const angle = i / 24 * Math.PI * 2
      positions.push(p(width / 2 + Math.cos(angle) * width / 2, height / 2 + Math.sin(angle) * height / 2))
    }
    return `${pathForPoints(positions, true)} Z`
  }
  if (element.type === 'diamond') return `${pathForPoints([p(width / 2, 0), p(width, height / 2), p(width / 2, height), p(0, height / 2), p(width / 2, 0)], false)} Z`
  // Rounded corners retain their exact base outline; the second pass supplies the sketch texture.
  if (element.roundness) return primitivePath(element)
  return `${pathForPoints([p(0, 0), p(width, 0), p(width, height), p(0, height), p(0, 0)], false)} Z`
}

function darkSurface(background: string | undefined, fallback: boolean): boolean {
  if (!background) return fallback
  if (background === 'white' || background === 'transparent') return false
  if (background === 'black') return true
  const hex = background.match(/^#([a-f0-9]{3}|[a-f0-9]{6})$/i)?.[1]
  if (!hex) return fallback
  const value = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  const channels = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 0.45
}

function FillPattern({ id, style, paint, width }: { id: string; style: string; paint: string; width: number }) {
  return <defs><pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
    {style === 'zigzag' ? <path d="M 0 4 L 4 0 L 8 4 L 12 0" fill="none" stroke={paint} strokeWidth={Math.max(0.75, width * 0.6)} /> : <>
      <path d="M 0 0 V 8" stroke={paint} strokeWidth={Math.max(0.75, width * 0.6)} />
      {style === 'cross-hatch' && <path d="M 0 0 H 8" stroke={paint} strokeWidth={Math.max(0.75, width * 0.6)} />}
    </>}
  </pattern></defs>
}

function Arrowhead({ kind, stroke, width }: { kind: string; stroke: string; width: number }) {
  const s = Math.max(8, width * 4)
  if (kind === 'bar') return <path d={`M ${-s * 0.35} ${-s * 0.55} V ${s * 0.55}`} fill="none" stroke={stroke} strokeWidth={width} />
  if (kind === 'dot' || kind === 'dot_outline' || kind === 'circle' || kind === 'circle_outline') return <circle cx={-s * 0.38} cy={0} r={s * 0.38} fill={kind.endsWith('_outline') ? 'none' : stroke} stroke={stroke} strokeWidth={width} />
  if (kind === 'diamond' || kind === 'diamond_outline') return <path d={`M 0 0 L ${-s * 0.6} ${-s * 0.45} L ${-s * 1.2} 0 L ${-s * 0.6} ${s * 0.45} Z`} fill={kind.endsWith('_outline') ? 'none' : stroke} stroke={stroke} strokeWidth={width} />
  if (kind === 'crowfoot_one') return <path d={`M ${-s * 0.45} ${-s * 0.55} V ${s * 0.55}`} fill="none" stroke={stroke} strokeWidth={width} />
  if (kind.startsWith('crowfoot')) return <>
    <path d={`M ${-s} ${-s * 0.55} L 0 0 L ${-s} ${s * 0.55} M ${-s} 0 H 0`} fill="none" stroke={stroke} strokeWidth={width} />
    {(kind === 'crowfoot_one_or_many' || kind === 'crowfoot_zero_or_many') && <circle cx={-s * 1.25} r={s * 0.25} fill="none" stroke={stroke} strokeWidth={width} />}
  </>
  return <path d={`M ${-s} ${-s * 0.5} L 0 0 L ${-s} ${s * 0.5}${kind.startsWith('triangle') ? ' Z' : ''}`} fill={kind === 'triangle' ? stroke : 'none'} stroke={stroke} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
}

function lineBreaks(text: string, width: number, fontSize: number, autoResize: unknown): string[] {
  const raw = text.split('\n')
  if (autoResize === true || width <= 0) return raw
  const maximum = Math.max(1, Math.floor(width / (fontSize * 0.54)))
  return raw.flatMap(line => {
    if (line.length <= maximum) return [line]
    const words = line.split(/(\s+)/)
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      if (current && current.length + word.length > maximum) { lines.push(current.trimEnd()); current = word.trimStart() }
      else current += word
    }
    if (current || !lines.length) lines.push(current)
    return lines
  })
}

function fontFamily(value: unknown): string {
  if (value === 1 || value === 5 || value === 'handwritten') return '"Segoe Print", "Comic Sans MS", cursive'
  if (value === 3 || value === 8 || value === 'monospace') return 'ui-monospace, "SFMono-Regular", Consolas, monospace'
  if (value === 'serif') return 'Georgia, "Times New Roman", serif'
  return 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
}

function ElementGraphic({ element, files, prefix, darkMode }: { element: ElementRecord; files: DrawSceneSvgProps['files']; prefix: string; darkMode: boolean }) {
  const type = string(element.type), width = number(element.width), height = number(element.height)
  const strokeWidth = Math.max(0.2, number(element.strokeWidth, 2)), stroke = ink(element.strokeColor, darkMode)
  const background = color(element.backgroundColor, 'transparent')
  const pattern = `${prefix}-fill-${safeId(element.id)}`
  const fillStyle = string(element.fillStyle, 'solid')
  const patterned = background !== 'transparent' && background !== 'none' && fillStyle !== 'solid'
  const fill = patterned ? `url(#${pattern})` : background === 'transparent' ? 'none' : background
  const shapeStyle = { stroke, strokeWidth, strokeDasharray: dash(element.strokeStyle, strokeWidth), strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (['rectangle', 'diamond', 'ellipse'].includes(type)) {
    const path = primitivePath(element)
    return <>
      {patterned && <FillPattern id={pattern} style={fillStyle} paint={background} width={strokeWidth} />}
      <path d={path} fill={fill} {...shapeStyle} />
      {number(element.roughness) > 0 && <path d={sketchPath(element)} fill="none" {...shapeStyle} opacity={0.65} />}
      <path d={path} fill="transparent" stroke="transparent" strokeWidth={Math.max(10, strokeWidth)} pointerEvents="all" />
    </>
  }
  if (type === 'frame') return <>
    {patterned && <FillPattern id={pattern} style={fillStyle} paint={background} width={strokeWidth} />}
    <rect width={width} height={height} rx={4} fill={fill} stroke={darkMode ? '#5d786f' : '#8ba49b'} strokeWidth={1} strokeDasharray="6 4" />
    <text x={0} y={-9} fontSize={13} fontFamily={fontFamily(2)} fill={darkMode ? '#a9c0b7' : '#526b61'}>{string(element.name, 'Frame')}</text>
    <rect width={width} height={height} fill="transparent" stroke="transparent" strokeWidth={10} pointerEvents="stroke" />
  </>
  if (type === 'line' || type === 'arrow') {
    const points = pointsOf(element)
    const curved = element.elbowed !== true && (element.routing === 'curved' || element.curved === true || !!element.roundness)
    const path = pathForPoints(points, curved)
    const start = typeof element.startArrowhead === 'string' ? element.startArrowhead : null
    const end = typeof element.endArrowhead === 'string' ? element.endArrowhead : type === 'arrow' && element.endArrowhead !== null ? 'arrow' : null
    const startId = `${prefix}-start-${safeId(element.id)}`, endId = `${prefix}-end-${safeId(element.id)}`
    const marker = (id: string, kind: string) => <marker id={id} markerWidth={32 + strokeWidth * 5} markerHeight={32 + strokeWidth * 5} refX={0} refY={0} viewBox="-24 -18 48 36" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><Arrowhead kind={kind} stroke={stroke} width={strokeWidth} /></marker>
    return <>
      <defs>{start && marker(startId, start)}{end && marker(endId, end)}</defs>
      <path d={path} fill="none" {...shapeStyle} markerStart={start ? `url(#${startId})` : undefined} markerEnd={end ? `url(#${endId})` : undefined} />
      <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(14, strokeWidth * 3)} pointerEvents="stroke" />
    </>
  }
  if (type === 'freedraw') {
    const points = pointsOf(element)
    const pressures = Array.isArray(element.pressures) ? element.pressures.map(p => number(p, 0.5)) : []
    const outline = pressures.length === points.length && points.length > 1 ? pressureOutline(points, pressures, strokeWidth) : ''
    if (points.length === 1) return <circle cx={points[0][0]} cy={points[0][1]} r={strokeWidth / 2} fill={stroke} />
    const path = pathForPoints(points, true)
    return <>
      {outline ? <path d={outline} fill={stroke} stroke={stroke} strokeWidth={0.3} strokeLinejoin="round" /> : <path d={path} fill="none" {...shapeStyle} />}
      <path d={path} fill="none" stroke="transparent" strokeWidth={Math.max(12, strokeWidth * 3)} pointerEvents="stroke" />
    </>
  }
  if (type === 'text') {
    const size = Math.max(1, number(element.fontSize, 20)), lineHeight = size * Math.max(0.8, number(element.lineHeight, 1.25))
    const text = string(element.text, string(element.originalText))
    const lines = lineBreaks(text, width, size, element.autoResize)
    const alignment = string(element.textAlign, 'left')
    const x = alignment === 'center' ? width / 2 : alignment === 'right' ? width : 0
    const totalHeight = lines.length * lineHeight
    const top = element.verticalAlign === 'middle' ? (height - totalHeight) / 2 : element.verticalAlign === 'bottom' ? height - totalHeight : 0
    return <>
      <rect width={Math.max(1, width)} height={Math.max(height, totalHeight)} fill="transparent" pointerEvents="all" />
      <text x={x} y={top + size * 0.84} fill={stroke} fontFamily={fontFamily(element.fontFamily)} fontSize={size} textAnchor={alignment === 'center' ? 'middle' : alignment === 'right' ? 'end' : 'start'} style={{ whiteSpace: 'pre', userSelect: 'none' }}>
        {lines.map((line, index) => <tspan key={index} x={x} dy={index ? lineHeight : 0}>{line || '\u00a0'}</tspan>)}
      </text>
    </>
  }
  if (type === 'image') {
    const fileId = string(element.fileId), file = Object.prototype.hasOwnProperty.call(files, fileId) ? files[fileId] : undefined
    const href = file && typeof file.dataURL === 'string' && /^data:image\//i.test(file.dataURL) ? file.dataURL : undefined
    if (!href) return <><rect width={width} height={height} rx={6} fill={darkMode ? '#283b34' : '#edf4f0'} stroke={stroke} strokeDasharray="4 4" /><text x={width / 2} y={height / 2} fill={stroke} fontSize={13} textAnchor="middle">Image unavailable</text></>
    const scale = Array.isArray(element.scale) ? element.scale : [1, 1]
    const flipX = number(scale[0], 1) < 0, flipY = number(scale[1], 1) < 0
    const transform = `translate(${flipX ? width : 0} ${flipY ? height : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`
    const crop = object(element.crop) ? element.crop : null
    return <g transform={transform}>
      {crop && number(crop.width) > 0 && number(crop.height) > 0 ? <svg width={width} height={height} viewBox={`${number(crop.x)} ${number(crop.y)} ${number(crop.width)} ${number(crop.height)}`} preserveAspectRatio="none" overflow="hidden"><image href={href} x={0} y={0} width={number(crop.naturalWidth, number(crop.x) + number(crop.width))} height={number(crop.naturalHeight, number(crop.y) + number(crop.height))} preserveAspectRatio="none" /></svg> : <image href={href} width={width} height={height} preserveAspectRatio="none" />}
      <rect width={width} height={height} fill="transparent" pointerEvents="all" />
    </g>
  }
  // Persisted unsupported records remain visible and selectable instead of disappearing.
  return <><rect width={width} height={height} fill="transparent" stroke={stroke} strokeDasharray="4 4" /><text x={8} y={20} fill={stroke} fontFamily={fontFamily(2)} fontSize={13}>{string(element.type, 'Object')}</text></>
}

/** Our SVG renderer: element geometry stays editable, and exported SVG includes its assets and paint definitions. */
function DrawSceneSvg({ elements, files, darkMode = false, backgroundColor, selectedIds, showFrames = true }: DrawSceneSvgProps) {
  const prefix = `draw-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const surfaceIsDark = darkSurface(backgroundColor, darkMode)
  const live = elements.filter(element => !element.isDeleted)
  const frames = new Map(live.filter(element => element.type === 'frame').map(element => [string(element.id), element]))
  const clipId = (id: string) => `${prefix}-frame-${safeId(id)}`
  const clipChain = (element: ElementRecord): string[] => {
    const chain: string[] = [], visited = new Set<string>([string(element.id)])
    let id = string(element.frameId)
    while (id && frames.has(id) && !visited.has(id)) {
      visited.add(id); chain.push(id); id = string(frames.get(id)!.frameId)
    }
    return chain
  }
  return <g data-draw-scene="true">
    <defs>{[...frames.entries()].map(([id, frame]) => {
      const center = drawElementCenter(frame)
      return <clipPath key={id} id={clipId(id)} clipPathUnits="userSpaceOnUse"><rect x={number(frame.x)} y={number(frame.y)} width={number(frame.width)} height={number(frame.height)} transform={`rotate(${number(frame.angle) * 180 / Math.PI} ${center.x} ${center.y})`} /></clipPath>
    })}</defs>
    {live.map(element => {
      if (element.type === 'frame' && !showFrames) return null
      const id = string(element.id), center = drawElementCenter(element)
      const style: CSSProperties = { cursor: element.locked ? 'not-allowed' : undefined }
      let graphic: ReactNode = <g transform={`rotate(${number(element.angle) * 180 / Math.PI} ${center.x} ${center.y}) translate(${number(element.x)} ${number(element.y)})`}><ElementGraphic element={element} files={files} prefix={prefix} darkMode={surfaceIsDark} /></g>
      for (const frameId of clipChain(element)) graphic = <g key={frameId} clipPath={`url(#${clipId(frameId)})`}>{graphic}</g>
      return <g key={id} data-element-id={id} data-element-type={string(element.type)} data-selected={selectedIds?.has(id) ? 'true' : undefined} aria-label={string(element.text, string(element.name, string(element.type, 'Drawing object')))} role="img" opacity={Math.max(0, Math.min(100, number(element.opacity, 100))) / 100} style={style}>{graphic}</g>
    })}
  </g>
}

export default memo(DrawSceneSvg)

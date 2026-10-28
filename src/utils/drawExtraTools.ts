import type { ArchitectureScene } from '../shared/architectureScene'
import { createElement, newDrawId, rerouteBindings, type DrawElement, type Point } from './drawScene'

export type PaintTarget = 'strokeColor' | 'backgroundColor'
export type RecognizedShape = 'rectangle' | 'ellipse' | 'diamond' | 'line'

export function safeEmbedUrl(input: string): string {
  const raw = input.trim()
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Enter an HTTPS web address.')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Enter an HTTPS web address.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Embeds require an HTTPS address without credentials.')
  return url.href
}

export function recognizeStroke(points: Point[]): RecognizedShape | null {
  if (points.length < 3) return null
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys)
  const diagonal = Math.hypot(width, height)
  if (diagonal < 24) return null
  const first = points[0], last = points[points.length - 1]
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < diagonal * 0.22
  if (!closed) {
    const dx = last.x - first.x, dy = last.y - first.y, length = Math.hypot(dx, dy)
    if (length < diagonal * 0.72) return null
    const maxError = Math.max(...points.map(p => Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / length))
    return maxError < diagonal * 0.09 ? 'line' : null
  }
  if (width < 24 || height < 24) return null
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const normalized = points.map(p => ({ x: Math.abs((p.x - cx) / (width / 2)), y: Math.abs((p.y - cy) / (height / 2)) }))
  const fit = (measure: (p: { x: number; y: number }) => number) => normalized.reduce((sum, p) => sum + Math.abs(measure(p) - 1), 0) / normalized.length
  const candidates = [
    { type: 'rectangle' as const, error: fit(p => Math.max(p.x, p.y)) },
    { type: 'ellipse' as const, error: fit(p => Math.hypot(p.x, p.y)) },
    { type: 'diamond' as const, error: fit(p => p.x + p.y) },
  ].sort((a, b) => a.error - b.error)
  return candidates[0].error < 0.24 && candidates[1].error - candidates[0].error > 0.035 ? candidates[0].type : null
}

interface MermaidNode { id: string; label: string; shape: 'rectangle' | 'ellipse' | 'diamond' }
interface MermaidEdge { from: string; to: string; label?: string; arrow: boolean }
const id = '[A-Za-z][A-Za-z0-9_]*'
const nodePattern = new RegExp(`^(${id})(?:\\[([^\\[\\]]+)\\]|\\(([^()]+)\\)|\\{([^{}]+)\\})?$`)
const edgePattern = new RegExp(`^(${id}(?:\\[[^\\[\\]]+\\]|\\([^()]+\\)|\\{[^{}]+\\})?)\\s*(-->|---)(?:\\|([^|]+)\\|)?\\s*(${id}(?:\\[[^\\[\\]]+\\]|\\([^()]+\\)|\\{[^{}]+\\})?)$`)

export function mermaidToScene(source: string): ArchitectureScene {
  if (source.length > 10000) throw new Error('Mermaid input is too long.')
  const lines = source.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const header = /^(flowchart|graph)\s+(TB|TD|LR)$/i.exec(lines.shift() ?? '')
  if (!header) throw new Error('Use flowchart or graph with TB, TD, or LR.')
  const nodes = new Map<string, MermaidNode>(), edges: MermaidEdge[] = []
  const parseNode = (raw: string): MermaidNode => {
    const match = nodePattern.exec(raw)
    if (!match) throw new Error(`Unsupported Mermaid node: ${raw}`)
    const [, key, rectangle, ellipse, diamond] = match
    const label = rectangle ?? ellipse ?? diamond ?? key
    if (!label.trim() || /[<>`]/.test(label)) throw new Error('Mermaid labels must be plain text.')
    const shape: MermaidNode['shape'] = ellipse ? 'ellipse' : diamond ? 'diamond' : 'rectangle'
    const previous = nodes.get(key)
    if (previous && (previous.label !== key || previous.shape !== 'rectangle') && (label !== key || shape !== 'rectangle') && (previous.label !== label || previous.shape !== shape)) throw new Error(`Conflicting Mermaid node: ${key}`)
    const node = label === key && shape === 'rectangle' && previous ? previous : { id: key, label: label.trim(), shape }
    nodes.set(key, node)
    return node
  }
  for (const line of lines) {
    if (line.includes(';') || line.startsWith('%%')) throw new Error(`Unsupported Mermaid syntax: ${line}`)
    const edge = edgePattern.exec(line)
    if (edge) {
      const from = parseNode(edge[1]), to = parseNode(edge[4])
      if (edge[3] && /[<>`]/.test(edge[3])) throw new Error('Mermaid labels must be plain text.')
      edges.push({ from: from.id, to: to.id, label: edge[3]?.trim(), arrow: edge[2] === '-->' })
    } else parseNode(line)
    if (nodes.size > 80 || edges.length > 120) throw new Error('Mermaid supports at most 80 nodes and 120 links.')
  }
  if (!nodes.size) throw new Error('Add at least one Mermaid node.')
  const direction = header[2].toUpperCase() === 'LR' ? 'LR' : 'TB'
  const edgeLabelWidth = (label: string) => Math.max(28, Array.from(label).length * 14 + 12)
  const horizontalStep = 170 + Math.max(90, ...edges.map(edge => edge.label ? edgeLabelWidth(edge.label) + 70 : 0))
  const depths = new Map([...nodes.keys()].map(key => [key, 0]))
  for (let pass = 0; pass < nodes.size; pass++) for (const edge of edges) {
    const next = Math.min(nodes.size - 1, (depths.get(edge.from) ?? 0) + 1)
    if (next > (depths.get(edge.to) ?? 0)) depths.set(edge.to, next)
  }
  const columns = new Map<number, number>(), positions = new Map<string, Point>()
  for (const node of nodes.values()) {
    const depth = depths.get(node.id) ?? 0, row = columns.get(depth) ?? 0
    columns.set(depth, row + 1)
    positions.set(node.id, direction === 'LR' ? { x: depth * horizontalStep, y: row * 130 } : { x: row * 230, y: depth * 140 })
  }
  const ids = new Map([...nodes.keys()].map(key => [key, newDrawId('mermaid')]))
  const elements: DrawElement[] = []
  for (const node of nodes.values()) {
    const p = positions.get(node.id)!, shape = createElement(node.shape, p, { x: p.x + 170, y: p.y + 76 }, { id: ids.get(node.id)!, backgroundColor: '#e3faf1' })
    const label = createElement('text', { x: p.x + 12, y: p.y + 24 }, { x: p.x + 158, y: p.y + 52 }, { text: node.label, originalText: node.label, containerId: shape.id, fontSize: 17, textAlign: 'center', strokeColor: '#16372e' })
    elements.push({ ...shape, boundElements: [{ id: label.id, type: 'text' }] }, label)
  }
  for (const edge of edges) {
    const from = positions.get(edge.from)!, to = positions.get(edge.to)!
    const start = direction === 'LR' ? { x: from.x + 170, y: from.y + 38 } : { x: from.x + 85, y: from.y + 76 }
    const end = direction === 'LR' ? { x: to.x, y: to.y + 38 } : { x: to.x + 85, y: to.y }
    const line = createElement('arrow', start, end, { startBinding: { elementId: ids.get(edge.from)!, focus: 0, gap: 0 }, endBinding: { elementId: ids.get(edge.to)!, focus: 0, gap: 0 }, endArrowhead: edge.arrow ? 'arrow' : null })
    elements.push(line)
    if (edge.label) {
      const halfWidth = edgeLabelWidth(edge.label) / 2
      elements.push(createElement('text', { x: (start.x + end.x) / 2 - halfWidth, y: (start.y + end.y) / 2 - 18 }, { x: (start.x + end.x) / 2 + halfWidth, y: (start.y + end.y) / 2 + 6 }, { text: edge.label, originalText: edge.label, fontSize: 14, textAlign: 'center', containerId: line.id }))
    }
  }
  return rerouteBindings({ version: 1, elements, files: {}, appState: { viewBackgroundColor: '#ffffff' } })
}

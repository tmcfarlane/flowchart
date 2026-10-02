// The card renders public diagram data locally. Dynamic content is text only:
// never innerHTML, SVG images, foreignObject, links, remote assets or style data.
const SVG_NS = 'http://www.w3.org/2000/svg'
export const MAX_PREVIEW_NODES = 60
export const MAX_PREVIEW_EDGES = 120
export const MAX_PREVIEW_ZOOM = 6
const TYPES = new Set(['step', 'decision', 'note', 'image', 'service', 'database', 'queue', 'cache', 'apiGateway', 'externalActor', 'container'])

type PreviewNode = { id: string; type: string; label: string; x: number; y: number; width: number; height: number; parentNode?: string }
type PreviewEdge = { source: string; target: string; label: string; dashed: boolean }
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max).replace(/[\u0000-\u001f\u007f]/g, ' ') : ''

function element<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const item = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value))
  return item
}

function lines(label: string, maxChars: number, maxLines = 4): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const output: string[] = []
  let current = ''
  for (const word of words) {
    const chunks = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, 'gu')) ?? [] : [word]
    for (const chunk of chunks) {
      if (current && current.length + chunk.length + 1 > maxChars) { output.push(current); current = chunk }
      else current += (current ? ' ' : '') + chunk
    }
  }
  if (current) output.push(current)
  if (output.length > maxLines) return [...output.slice(0, maxLines - 1), output[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + '…']
  return output.length ? output : [label]
}

function label(parent: SVGElement, value: string, x: number, y: number, width: number, className = 'node-label', centered = true) {
  const item = element('text', { x, y, class: className, 'text-anchor': centered ? 'middle' : 'start' })
  const parts = lines(value, Math.max(8, Math.floor(width / 7.2)), centered ? 4 : 2)
  for (const [index, part] of parts.entries()) {
    const line = element('tspan', { x, dy: index ? 16 : 0 })
    line.textContent = part
    item.appendChild(line)
  }
  parent.appendChild(item)
}

const GLYPHS: Record<string, string> = { image: '✦', service: '◈', database: '▤', queue: '≋', cache: 'ϟ', apiGateway: '⇄', externalActor: '○' }

function drawNode(svg: SVGSVGElement, node: PreviewNode) {
  const { x, y, width: w, height: h, type } = node
  const group = element('g', { 'data-preview-node': type, class: `preview-node node-${type}` })
  const nodeTitle = element('title')
  nodeTitle.textContent = node.label
  group.appendChild(nodeTitle)
  let shape: SVGElement
  if (type === 'decision') shape = element('polygon', { points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}` })
  else if (type === 'apiGateway') shape = element('polygon', { points: `${x + 18},${y} ${x + w - 18},${y} ${x + w},${y + h / 2} ${x + w - 18},${y + h} ${x + 18},${y + h} ${x},${y + h / 2}` })
  else if (type === 'database') shape = element('path', { d: `M ${x},${y + 14} C ${x},${y - 5} ${x + w},${y - 5} ${x + w},${y + 14} L ${x + w},${y + h - 14} C ${x + w},${y + h + 5} ${x},${y + h + 5} ${x},${y + h - 14} Z M ${x},${y + 14} C ${x},${y + 33} ${x + w},${y + 33} ${x + w},${y + 14}` })
  else shape = element('rect', { x, y, width: w, height: h, rx: type === 'container' ? 14 : type === 'note' ? 3 : 12 })
  group.appendChild(shape)
  if (type === 'container') {
    label(group, node.label, x + 16, y + 25, Math.max(50, w - 32), 'container-label', false)
  } else {
    const glyph = GLYPHS[type]
    if (glyph) {
      const icon = element('text', { x: x + w / 2, y: y + (type === 'database' ? 41 : 27), class: 'node-glyph', 'text-anchor': 'middle' })
      icon.textContent = glyph
      group.appendChild(icon)
    }
    const chars = Math.max(8, Math.floor((type === 'decision' ? w * 0.57 : w - 26) / 7.2))
    const count = Math.min(4, lines(node.label, chars).length)
    const centerY = y + h / 2 + (glyph ? 12 : 0)
    label(group, node.label, x + w / 2, centerY - (count - 1) * 8 + 4, type === 'decision' ? w * 0.57 : w - 26)
  }
  svg.appendChild(group)
}

function connection(svg: SVGSVGElement, edge: PreviewEdge, source: PreviewNode, target: PreviewNode) {
  const sx = source.x + source.width / 2, sy = source.y + source.height / 2
  const tx = target.x + target.width / 2, ty = target.y + target.height / 2
  let startX = sx, startY = sy, endX = tx, endY = ty, d = ''
  if (source.id === target.id) {
    startX = source.x + source.width; startY = sy - 12; endX = startX; endY = sy + 12
    d = `M ${startX},${startY} C ${startX + 45},${startY - 35} ${endX + 45},${endY + 35} ${endX},${endY}`
  } else if (Math.abs(tx - sx) > Math.abs(ty - sy)) {
    startX += (tx >= sx ? 1 : -1) * source.width / 2
    endX -= (tx >= sx ? 1 : -1) * target.width / 2
    const middle = (startX + endX) / 2
    d = `M ${startX},${startY} C ${middle},${startY} ${middle},${endY} ${endX},${endY}`
  } else {
    startY += (ty >= sy ? 1 : -1) * source.height / 2
    endY -= (ty >= sy ? 1 : -1) * target.height / 2
    const middle = (startY + endY) / 2
    d = `M ${startX},${startY} C ${startX},${middle} ${endX},${middle} ${endX},${endY}`
  }
  svg.appendChild(element('path', { d, class: edge.dashed ? 'preview-edge dashed' : 'preview-edge', 'marker-end': 'url(#diagram-arrow)', 'data-preview-edge': 'true' }))
  if (edge.label) label(svg, edge.label, (startX + endX) / 2, (startY + endY) / 2 - 6, 120, 'edge-label')
}

export interface PreviewController { zoom: (factor: number) => number }

export function renderDiagramPreview(svg: SVGSVGElement, note: HTMLElement, raw: unknown): PreviewController | undefined {
  svg.replaceChildren()
  svg.style.width = svg.style.height = '100%'
  const chart = object(raw)
  const rawNodes = Array.isArray(chart?.nodes) ? chart.nodes.slice(0, 500) : []
  const rawEdges = Array.isArray(chart?.edges) ? chart.edges.slice(0, 1000) : []
  const allNodes: PreviewNode[] = []
  const ids = new Set<string>()
  rawNodes.forEach((value, index) => {
    const item = object(value)
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id) || typeof item.type !== 'string' || !TYPES.has(item.type)) return
    const position = object(item.position)
    allNodes.push({
      id: item.id, type: item.type, label: text(item.label),
      x: number(position?.x, (index % 4) * 210, -1_000_000, 1_000_000), y: number(position?.y, Math.floor(index / 4) * 150, -1_000_000, 1_000_000),
      width: number(item.width, item.type === 'decision' ? 160 : 180, 20, 5000), height: number(item.height, item.type === 'decision' ? 160 : 90, 20, 5000),
      ...(typeof item.parentNode === 'string' ? { parentNode: item.parentNode } : {}),
    })
    ids.add(item.id)
  })
  if (!allNodes.length) {
    svg.style.display = 'none'
    note.textContent = 'The diagram preview is unavailable. Use the view link to see the chart.'
    return
  }
  svg.style.display = 'block'
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const nodes = allNodes.slice(0, MAX_PREVIEW_NODES).map((node) => {
    let x = node.x, y = node.y, parent = node.parentNode
    const visited = new Set([node.id])
    while (parent && !visited.has(parent) && visited.size <= 500) {
      visited.add(parent)
      const ancestor = byId.get(parent)
      if (!ancestor) break
      x += ancestor.x; y += ancestor.y; parent = ancestor.parentNode
    }
    return { ...node, x: Math.max(-1_000_000, Math.min(1_000_000, x)), y: Math.max(-1_000_000, Math.min(1_000_000, y)) }
  })
  const shown = new Map(nodes.map((node) => [node.id, node]))
  const edges: PreviewEdge[] = []
  for (const value of rawEdges) {
    const item = object(value)
    if (!item || typeof item.source !== 'string' || typeof item.target !== 'string' || !shown.has(item.source) || !shown.has(item.target)) continue
    if (edges.length === MAX_PREVIEW_EDGES) break
    edges.push({ source: item.source, target: item.target, label: text(item.label, 200), dashed: item.commStyle === 'async' || item.style === 'animated' })
  }
  const minX = Math.min(...nodes.map((node) => node.x)) - 32
  const minY = Math.min(...nodes.map((node) => node.y)) - 32
  const width = Math.max(100, Math.max(...nodes.map((node) => node.x + node.width)) - minX + 56)
  const height = Math.max(100, Math.max(...nodes.map((node) => node.y + node.height)) - minY + 56)
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`)
  const heading = element('title', { id: 'diagram-title' })
  heading.textContent = text(chart?.title, 200) || 'Diagram preview'
  svg.appendChild(heading)
  const description = element('desc', { id: 'diagram-description' })
  description.textContent = `Preview of ${nodes.length} nodes and ${edges.length} connections. Open the browser editor for the full diagram and image artwork.`
  svg.appendChild(description)
  svg.setAttribute('aria-labelledby', 'diagram-title')
  svg.setAttribute('aria-describedby', 'diagram-description')
  const defs = element('defs')
  const marker = element('marker', { id: 'diagram-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
  marker.appendChild(element('path', { d: 'M 0 0 L 10 5 L 0 10 Z', class: 'preview-arrow' }))
  defs.appendChild(marker)
  svg.appendChild(defs)
  for (const node of nodes.filter((item) => item.type === 'container')) drawNode(svg, node)
  for (const item of edges) connection(svg, item, shown.get(item.source)!, shown.get(item.target)!)
  for (const node of nodes.filter((item) => item.type !== 'container')) drawNode(svg, node)
  const capped = nodes.length < rawNodes.length || edges.length < rawEdges.length
  note.textContent = capped ? `Showing ${nodes.length} of ${rawNodes.length} nodes and ${edges.length} of ${rawEdges.length} connections. Open the editor for the full chart.` : `${nodes.length} nodes · ${edges.length} connections. Illustrations appear as local type glyphs in this preview.`
  let scale = 1
  return { zoom: (factor) => {
    scale = factor === 0 ? 1 : Math.max(1, Math.min(MAX_PREVIEW_ZOOM, scale * factor))
    svg.style.width = svg.style.height = `${scale * 100}%`
    return scale
  } }
}

import type { Edge, Node } from 'reactflow'
import {
  COMM_STYLES, CONTAINER_KINDS, EDGE_PROTOCOLS, EDGE_STYLES, HANDLE_POSITIONS, ICON_NODE_TYPES, LIMITS,
  canonicalEdgeStyle, isNodeType, type ChartEdge, type ChartNode,
} from '../shared/flowTypes'
import { getIconId, getIconUrl } from './azureIconIds'
import { chartToFlow } from './sharedFlow'

export const MAX_DIAGRAM_IMPORT_BYTES = 10 * 1024 * 1024
export type ImportedDiagramMode = 'flowchart' | 'architecture'
export interface ImportedDiagram { flow: { nodes: ChartNode[]; edges: ChartEdge[] }; mode: ImportedDiagramMode }

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const issue = (message: string): never => { throw new Error(message) }
function id(value: unknown, field: string, max: number = LIMITS.maxIdLength): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return issue(`${field} must be a nonempty string of at most ${max} characters.`)
  return value
}
function text(value: unknown, field: string, max: number, fallback = ''): string {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || value.length > max) return issue(`${field} must be text of at most ${max} characters.`)
  return value
}
function finite(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return issue(`${field} must be a finite number between ${min} and ${max}.`)
  return value
}
function optionalEnum<T extends string>(value: unknown, field: string, values: readonly T[]): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) return issue(`${field} must be one of: ${values.join(', ')}.`)
  return value as T
}

const BASE64_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/i
const GENERATED_IMAGE_PATH = /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\?key=[A-Za-z0-9_-]{43}$/

function localImagePath(value: string): boolean {
  if (GENERATED_IMAGE_PATH.test(value)) return true
  if (!/^\/(?:assets|icons)\//.test(value) || /[?#]/.test(value) || /%(?:2f|5c)/i.test(value)) return false
  try {
    const decoded = decodeURIComponent(value)
    // Refuse paths the browser would normalize outside the image directories.
    if (/[\\\u0000-\u001f\u007f?#]/.test(decoded) || /%/.test(decoded) || decoded.slice(1).split('/').some((part) => part === '.' || part === '..' || part === '')) return false
    return /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(decoded)
  } catch { return false }
}

/** Matches image rendering rules without importing the server's Zod dependency. */
function safeImageUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > MAX_DIAGRAM_IMPORT_BYTES || /[\u0000-\u001f\u007f]/.test(value)) return issue(`${field} is not a supported image URL.`)
  // Exact registry URLs also cover development asset names containing spaces.
  if (getIconId(value)) return value
  const base64 = value.match(BASE64_IMAGE)
  if (base64?.[1]) return value
  const svg = value.match(/^data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,(.+)$/i)
  if (svg) {
    try {
      const decoded = decodeURIComponent(svg[1]).trim()
      if (/^(?:<\?xml\b[^?]*\?>\s*)?<svg\b[^>]*(?:\/>|>[\s\S]*<\/svg>)$/i.test(decoded)) return value
    } catch { /* Fall through to the field error. */ }
  }
  if (/[\s\\]/.test(value)) return issue(`${field} must not contain whitespace or backslashes.`)
  if (localImagePath(value)) return value
  if (/^https:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password) {
        if (typeof window !== 'undefined' && parsed.origin === window.location.origin && !localImagePath(value.slice(parsed.origin.length))) return issue(`${field} must refer to an image asset on this website.`)
        return value
      }
    } catch { /* Fall through to the field error. */ }
  }
  return issue(`${field} must be an HTTPS image URL, a local image asset, or a supported embedded image.`)
}

/**
 * Both editor exports (node.data / edge.data) and Explorer/API documents use
 * this parser. It returns an all-or-nothing, allowlisted graph, never arbitrary
 * React Flow props or callbacks from an imported file.
 */
export function parseDiagramJson(input: string, options: { requireEdgeIds?: boolean } = {}): ImportedDiagram {
  if (input.length > MAX_DIAGRAM_IMPORT_BYTES || new TextEncoder().encode(input).byteLength > MAX_DIAGRAM_IMPORT_BYTES) return issue('This diagram file is too large to import (maximum 10 MB).')
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { return issue('This file does not contain valid JSON.') }
  if (!object(parsed)) return issue('The file content is not a valid flowchart format.')
  if (!Array.isArray(parsed.nodes)) return issue('Missing or invalid "nodes" array in the JSON file.')
  if (!Array.isArray(parsed.edges)) return issue('Missing or invalid "edges" array in the JSON file.')
  if (parsed.nodes.length > LIMITS.maxNodes || parsed.edges.length > LIMITS.maxEdges) return issue(`A diagram can contain at most ${LIMITS.maxNodes} nodes and ${LIMITS.maxEdges} connections.`)
  const isEditorExport = options.requireEdgeIds || parsed.version === 2 || parsed.nodes.some((node) => object(node) && node.data !== undefined)

  const nodes: ChartNode[] = parsed.nodes.map((raw: unknown, index: number) => {
    const ref = `Node ${index + 1}`
    if (!object(raw)) return issue(`${ref} must be an object.`)
    const nodeId = id(raw.id, `${ref} id`)
    if (raw.data !== undefined && !object(raw.data)) return issue(`${ref} data must be an object.`)
    if (raw.style !== undefined && !object(raw.style)) return issue(`${ref} style must be an object.`)
    const data = object(raw.data) ? raw.data : {}
    const style = object(raw.style) ? raw.style : {}
    const type = raw.type ?? 'step'
    if (!isNodeType(type)) return issue(`${ref} has an unsupported node type.`)
    if (!object(raw.position)) return issue(`${ref} needs a position with numeric x and y coordinates.`)
    const node: ChartNode = {
      id: nodeId, type, label: text(data.label ?? raw.label, `${ref} label`, LIMITS.maxLabelLength),
      position: { x: finite(raw.position.x, `${ref} position.x`, -LIMITS.maxCoordinate, LIMITS.maxCoordinate), y: finite(raw.position.y, `${ref} position.y`, -LIMITS.maxCoordinate, LIMITS.maxCoordinate) },
    }
    for (const key of ['width', 'height'] as const) {
      const value = style[key] ?? raw[key]
      if (value !== undefined && value !== null) node[key] = finite(value, `${ref} ${key}`, LIMITS.minNodeSize, LIMITS.maxNodeSize)
    }
    const explicitIcon = data.icon ?? raw.icon
    if (explicitIcon !== undefined && explicitIcon !== null && explicitIcon !== '') {
      const icon = id(explicitIcon, `${ref} icon`, 120)
      if (!getIconUrl(icon)) return issue(`${ref} uses an unknown local icon. Choose an icon from the library.`)
      node.icon = icon
    } else {
      const image = safeImageUrl(data.imageUrl ?? raw.imageUrl, `${ref} imageUrl`)
      const icon = image ? getIconId(image) : undefined
      if (icon) node.icon = icon
      else if (image) node.imageUrl = image
    }
    if ((node.icon || node.imageUrl) && !ICON_NODE_TYPES.includes(node.type)) return issue(`${ref} can show an image only when its type is image or an architecture node.`)
    if (node.type === 'image' && !node.icon && !node.imageUrl) return issue(`${ref} needs a local icon or image URL.`)
    if (raw.parentNode !== undefined && raw.parentNode !== null && raw.parentNode !== '') node.parentNode = id(raw.parentNode, `${ref} parentNode`)
    const kind = optionalEnum(data.containerKind ?? raw.containerKind, `${ref} containerKind`, CONTAINER_KINDS)
    if (kind && node.type !== 'container') return issue(`${ref} can set containerKind only for a container.`)
    if (node.type === 'container') node.containerKind = kind ?? 'group'
    return node
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) return issue('Every node must have a unique id.')
  for (const node of nodes) {
    let parent = node.parentNode
    const visited = new Set([node.id])
    while (parent) {
      if (visited.has(parent)) return issue('Containers cannot contain themselves or form a parent cycle.')
      visited.add(parent)
      const container = byId.get(parent)
      if (!container || container.type !== 'container') return issue(`Node ${JSON.stringify(node.id)} must refer to an existing container in parentNode.`)
      parent = container.parentNode
    }
  }

  const taken = new Set<string>()
  // Reserve supplied ids first so generated BaseFlow ids cannot collide with a
  // later explicitly named connection or another parallel connection.
  for (const [index, raw] of parsed.edges.entries()) {
    if (!object(raw)) return issue(`Connection ${index + 1} must be an object.`)
    if (raw.id === undefined || raw.id === null) { if (isEditorExport) return issue(`Connection ${index + 1} needs a nonempty id.`); continue }
    const edgeId = id(raw.id, `Connection ${index + 1} id`, LIMITS.maxEdgeIdLength)
    if (taken.has(edgeId)) return issue('Every connection must have a unique id.')
    taken.add(edgeId)
  }
  const edges: ChartEdge[] = parsed.edges.map((raw: unknown, index: number) => {
    if (!object(raw)) return issue(`Connection ${index + 1} must be an object.`)
    const ref = `Connection ${index + 1}`
    const source = id(raw.source, `${ref} source`), target = id(raw.target, `${ref} target`)
    if (!byId.has(source) || !byId.has(target)) return issue(`${ref} must connect two existing nodes.`)
    if (raw.data !== undefined && !object(raw.data)) return issue(`${ref} data must be an object.`)
    const data = object(raw.data) ? raw.data : {}
    let edgeId = typeof raw.id === 'string' ? raw.id : ''
    if (!edgeId) {
      const base = `e${source}-${target}`.slice(0, LIMITS.maxEdgeIdLength - 6)
      edgeId = base
      let suffix = 2
      while (taken.has(edgeId)) edgeId = `${base}-${suffix++}`
      taken.add(edgeId)
    }
    if (raw.animated !== undefined && typeof raw.animated !== 'boolean') return issue(`${ref} animated must be true or false.`)
    if (raw.type !== undefined && raw.type !== null && (typeof raw.type !== 'string' || !['default', 'step', 'smoothstep'].includes(raw.type))) return issue(`${ref} has an unsupported connection type.`)
    const commStyle = optionalEnum(data.commStyle ?? raw.commStyle, `${ref} commStyle`, COMM_STYLES)
    const protocol = optionalEnum(data.protocol ?? raw.protocol, `${ref} protocol`, EDGE_PROTOCOLS)
    if (object(raw.style) && !isEditorExport) return issue(`${ref} style must be one of: ${EDGE_STYLES.join(', ')}.`)
    const style = object(raw.style) ? (raw.type === 'step' || raw.type === 'smoothstep' ? 'step' : raw.animated ? 'animated' : 'default')
      : raw.style !== undefined && raw.style !== null ? optionalEnum(raw.style, `${ref} style`, EDGE_STYLES)
        : raw.type === 'step' || raw.type === 'smoothstep' ? 'step' : raw.animated ? 'animated' : isEditorExport ? 'default' : undefined
    const edge: ChartEdge = { id: edgeId, source, target, style: canonicalEdgeStyle(style, commStyle) }
    if (raw.label !== undefined && raw.label !== null) edge.label = text(raw.label, `${ref} label`, LIMITS.maxEdgeLabelLength)
    const sourceHandle = optionalEnum(raw.sourceHandle, `${ref} sourceHandle`, HANDLE_POSITIONS)
    const targetHandle = optionalEnum(raw.targetHandle, `${ref} targetHandle`, HANDLE_POSITIONS)
    if (sourceHandle) edge.sourceHandle = sourceHandle
    if (targetHandle) edge.targetHandle = targetHandle
    if (protocol) edge.protocol = protocol
    if (commStyle) edge.commStyle = commStyle
    return edge
  })
  // Preserve the legacy importer behavior for absent/unknown mode values.
  return { flow: { nodes, edges }, mode: parsed.mode === 'architecture' ? 'architecture' : 'flowchart' }
}

/** Compatibility surface used by Toolbar and the welcome import control. App installs real callbacks. */
export function parseFlowJson(text: string): { nodes: Node[]; edges: Edge[]; mode: ImportedDiagramMode } {
  const imported = parseDiagramJson(text, { requireEdgeIds: true })
  const flow = chartToFlow(imported.flow, {
    onLabelChange: () => {},
    edgeProps: (style, metadata) => ({ type: style === 'step' ? 'smoothstep' : 'default', animated: metadata?.commStyle === 'async' || style === 'animated', data: { ...metadata } }),
  })
  return { ...flow, mode: imported.mode }
}

import {
  NODE_TYPES, ICON_NODE_TYPES, HANDLE_POSITIONS, EDGE_STYLES, CONTAINER_KINDS, EDGE_PROTOCOLS, COMM_STYLES, LIMITS,
  type DraftNode, type ChartEdge,
} from './flowTypes.js'
import { resolveIconRef } from './icons.js'

export interface AIProposal {
  summary: string
  nodes: Array<DraftNode & { position: { x: number; y: number } }>
  edges: ChartEdge[]
}

export interface AIProposalValidationOptions {
  /** Existing artwork ids whose omitted source is restored by the client. */
  preservedImageNodeIds?: readonly string[]
}

type CanvasImageNode = { id: string; type: string; imageUrl?: string; icon?: string }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The AI returned an invalid diagram.')
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`The AI returned an invalid ${label}.`)
  return value
}

function labelText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`The AI returned an invalid ${label}.`)
  return value
}

function option<T extends string>(value: unknown, choices: readonly T[], label: string): T | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`The AI returned an invalid ${label}.`)
  return value as T
}

function dimension(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < LIMITS.minNodeSize || value > LIMITS.maxNodeSize) {
    throw new Error('The AI returned an invalid node size.')
  }
  return value
}

function supportsImages(type: string): boolean {
  return ICON_NODE_TYPES.some((supported) => supported === type)
}

/** Existing canvas artwork follows the embedded formats accepted by imports. */
function isSafeExistingEmbeddedImage(url: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(url)) return false
  const base64 = url.match(/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/i)
  if (base64?.[1]) return true
  const svg = url.match(/^data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,(.+)$/i)
  if (!svg) return false
  try {
    const decoded = decodeURIComponent(svg[1]).trim()
    return /^(?:<\?xml\b[^?]*\?>\s*)?<svg\b[^>]*(?:\/>|>[\s\S]*<\/svg>)$/i.test(decoded)
  } catch { return false }
}

function isSupportedImageUrl(url: string, existingUpload = false): boolean {
  // Imported uploads remain local, including formats the model cannot supply
  // and larger images whose bytes were omitted from the AI request.
  if (existingUpload && /^data:/i.test(url)) return isSafeExistingEmbeddedImage(url)
  const inlineImage = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)
  const localAsset = /^\/(assets|icons)\//.test(url) || /^\/api\/images\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\?key=[A-Za-z0-9_-]{43}$/i.test(url)
  let secureRemote = false
  try { const parsed = new URL(url); secureRemote = parsed.protocol === 'https:' && !!parsed.hostname && !parsed.username && !parsed.password } catch { /* Relative assets are checked separately. */ }
  return url.length <= LIMITS.maxImageUrlLength && (inlineImage || localAsset || secureRemote) && !/[\s\\\u0000-\u001f\u007f]/.test(url)
}

/** Validate model output before it reaches React Flow, on both server and client. */
export function normalizeAIProposal(value: unknown, allowEmpty = false, options: AIProposalValidationOptions = {}): AIProposal {
  const input = record(value)
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges) || (!allowEmpty && !input.nodes.length) ||
      input.nodes.length > LIMITS.maxNodes || input.edges.length > LIMITS.maxEdges) {
    throw new Error('The AI returned an invalid diagram structure.')
  }
  const ids = new Set<string>()
  const preservedImages = new Set(options.preservedImageNodeIds ?? [])
  const nodes: AIProposal['nodes'] = input.nodes.map((value) => {
    const n = record(value)
    const id = text(n.id, LIMITS.maxIdLength, 'node id')
    if (ids.has(id)) throw new Error('The AI returned duplicate node ids.')
    ids.add(id)
    const type = option(n.type, NODE_TYPES, 'node type')
    if (!type) throw new Error('The AI omitted a node type.')
    const pos = record(n.position)
    if (typeof pos.x !== 'number' || typeof pos.y !== 'number' || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) ||
        Math.abs(pos.x) > LIMITS.maxCoordinate || Math.abs(pos.y) > LIMITS.maxCoordinate) {
      throw new Error('The AI returned invalid node positions.')
    }
    const node: AIProposal['nodes'][number] = {
      id, type, label: labelText(n.label, LIMITS.maxLabelLength, 'node label'), position: { x: pos.x, y: pos.y },
      width: dimension(n.width), height: dimension(n.height),
    }
    if (n.parentNode != null) node.parentNode = text(n.parentNode, LIMITS.maxIdLength, 'container reference')
    node.containerKind = option(n.containerKind, CONTAINER_KINDS, 'container kind')
    if (node.containerKind && type !== 'container') throw new Error('The AI returned a container kind on a non-container node.')
    if (n.icon != null) {
      if (!supportsImages(type)) throw new Error(`The AI returned an icon on a ${type} node, which does not display icons.`)
      const ref = text(n.icon, 200, 'icon reference')
      const icon = resolveIconRef(ref, { suggest: false }).icon
      if (!icon) throw new Error('The AI returned an unknown local icon reference.')
      node.icon = icon.id
    }
    // Match shared chart validation: a canonical local icon takes precedence.
    if (!node.icon && n.imageUrl != null && n.imageUrl !== '') {
      if (!supportsImages(type)) throw new Error(`The AI returned an image on a ${type} node, which does not display images.`)
      const url = text(n.imageUrl, LIMITS.maxImageUrlLength, 'image URL')
      if (!isSupportedImageUrl(url)) {
        throw new Error('The AI returned an unsupported image URL.')
      }
      node.imageUrl = url
    }
    if (type === 'image' && !node.icon && !node.imageUrl && !preservedImages.has(id)) {
      throw new Error('The AI returned an image node without an image or local icon.')
    }
    return node
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    let parent = node.parentNode
    const visited = new Set([node.id])
    while (parent) {
      if (visited.has(parent) || byId.get(parent)?.type !== 'container') throw new Error('The AI returned an invalid container hierarchy.')
      visited.add(parent)
      parent = byId.get(parent)?.parentNode
    }
  }
  const edgeIds = new Set<string>()
  const edges: ChartEdge[] = input.edges.map((value, index) => {
    const e = record(value)
    const id = e.id == null ? `ai-edge-${index}` : text(e.id, LIMITS.maxEdgeIdLength, 'connection id')
    if (edgeIds.has(id)) throw new Error('The AI returned duplicate connection ids.')
    edgeIds.add(id)
    const source = text(e.source, LIMITS.maxIdLength, 'connection source')
    const target = text(e.target, LIMITS.maxIdLength, 'connection target')
    if (!ids.has(source) || !ids.has(target)) throw new Error('The AI returned a connection to a missing node.')
    return {
      id, source, target,
      label: e.label == null || e.label === '' ? undefined : labelText(e.label, LIMITS.maxEdgeLabelLength, 'connection label'),
      style: option(e.style, EDGE_STYLES, 'connection style'),
      sourceHandle: option(e.sourceHandle, HANDLE_POSITIONS, 'connection handle'),
      targetHandle: option(e.targetHandle, HANDLE_POSITIONS, 'connection handle'),
      protocol: option(e.protocol, EDGE_PROTOCOLS, 'connection protocol'),
      commStyle: option(e.commStyle, COMM_STYLES, 'communication style'),
    }
  })
  return { summary: typeof input.summary === 'string' ? input.summary.slice(0, 2000) : 'Diagram ready to review', nodes, edges }
}

export function parseAIProposal(content: string, finishReason?: string, allowEmpty = false, options: AIProposalValidationOptions = {}): AIProposal {
  if (finishReason === 'length') throw new Error('The response was cut off. Try a smaller change or fewer steps.')
  const match = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  try {
    return normalizeAIProposal(JSON.parse(match ? match[1] : content), allowEmpty, options)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The AI returned an unreadable diagram. Please try again.')
    throw error
  }
}

/** Binary uploads stay in the canvas, rather than being sent in the AI prompt. */
export function contextForAI<T extends { nodes: Array<{ imageUrl?: string }>; edges: unknown[] }>(chart: T): T {
  return { ...chart, nodes: chart.nodes.map((node) => ({ ...node, imageUrl: /^data:/i.test(node.imageUrl ?? '') ? undefined : node.imageUrl })) }
}

function existingArtwork(node: CanvasImageNode): Pick<CanvasImageNode, 'icon' | 'imageUrl'> | undefined {
  if (!supportsImages(node.type)) return undefined
  if (node.icon) {
    const icon = resolveIconRef(node.icon, { suggest: false }).icon
    return icon ? { icon: icon.id } : undefined
  }
  return node.imageUrl && isSupportedImageUrl(node.imageUrl, true) ? { imageUrl: node.imageUrl } : undefined
}

/** Bind source omission to actual original artwork, across compatible type changes. */
export function getPreservedImageNodeIds(nodes: readonly CanvasImageNode[]): string[] {
  return nodes.filter((node) => existingArtwork(node)).map((node) => node.id)
}

export function preserveCanvasImages(proposal: AIProposal, original: readonly CanvasImageNode[]): AIProposal {
  const byId = new Map(original.map((node) => [node.id, node]))
  return { ...proposal, nodes: proposal.nodes.map((node) => {
    const old = byId.get(node.id)
    if (!old || !supportsImages(node.type) || node.imageUrl || node.icon) return node
    const artwork = existingArtwork(old)
    return artwork ? { ...node, ...artwork } : node
  }) }
}

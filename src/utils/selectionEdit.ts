import type { Edge, Node } from 'reactflow'
import { canonicalEdgeStyle, COMM_STYLES, CONTAINER_KINDS, EDGE_PROTOCOLS, isHandlePosition, isNodeType, type ChartEdge, type ChartNode, type EdgeStyle, type EdgeProtocol, type CommStyle } from '../shared/flowTypes'
import type { PatchResult } from '../shared/patch'
import { getAzureIconId, getAzureIconUrl } from './azureIconIds'
import type { SelectionEditChange, SelectionEditPreview } from '../components/AISelectionEditDialog'

const has = (values: readonly string[], value: unknown): value is string => typeof value === 'string' && values.includes(value)

/** Exact authored graph fields, without flowToChart's export rounding. */
export function selectionEditChart(nodes: readonly Node[], edges: readonly Edge[]): { nodes: ChartNode[]; edges: ChartEdge[] } {
  return {
    nodes: nodes.map(node => {
      const icon = typeof node.data?.icon === 'string' ? node.data.icon : typeof node.data?.imageUrl === 'string' ? getAzureIconId(node.data.imageUrl) : undefined
      return {
        id: node.id, type: isNodeType(node.type) ? node.type : 'step', label: String(node.data?.label ?? ''), position: { ...node.position },
        ...(typeof node.style?.width === 'number' ? { width: node.style.width } : {}),
        ...(typeof node.style?.height === 'number' ? { height: node.style.height } : {}),
        ...(icon ? { icon } : typeof node.data?.imageUrl === 'string' && node.data.imageUrl ? { imageUrl: node.data.imageUrl } : {}),
        ...(node.parentNode ? { parentNode: node.parentNode } : {}),
        ...(node.type === 'container' && has(CONTAINER_KINDS, node.data?.containerKind) ? { containerKind: node.data.containerKind as ChartNode['containerKind'] } : {}),
      }
    }),
    edges: edges.map(edge => {
      const protocol = has(EDGE_PROTOCOLS, edge.data?.protocol) ? edge.data.protocol as EdgeProtocol : undefined
      const commStyle = has(COMM_STYLES, edge.data?.commStyle) ? edge.data.commStyle as CommStyle : undefined
      const style = canonicalEdgeStyle(edge.type === 'smoothstep' || edge.type === 'step' ? 'step' : edge.animated ? 'animated' : 'default', commStyle)
      return {
        id: edge.id, source: edge.source, target: edge.target, style,
        ...(typeof edge.label === 'string' && edge.label ? { label: edge.label } : {}),
        ...(isHandlePosition(edge.sourceHandle) ? { sourceHandle: edge.sourceHandle } : {}),
        ...(isHandlePosition(edge.targetHandle) ? { targetHandle: edge.targetHandle } : {}),
        ...(protocol ? { protocol } : {}), ...(commStyle ? { commStyle } : {}),
      }
    }),
  }
}

function authoredNode(node: Node) {
  return { id: node.id, type: node.type, position: node.position, parentNode: node.parentNode, extent: node.extent, style: node.style, data: node.data, hidden: node.hidden, zIndex: node.zIndex }
}
function authoredEdge(edge: Edge) {
  const { selected: _selected, ...authored } = edge
  return authored
}
export const authoredGraphSignature = (nodes: readonly Node[], edges: readonly Edge[]) => JSON.stringify([nodes.map(authoredNode), edges.map(authoredEdge)])

export interface SelectionEditSnapshot {
  nodeIds: string[]
  dependencyIds: string[]
  nodes: string
  edges: string
  epoch: number
}

/** Freeze selected targets plus incident connections and hierarchy dependencies.
 * Selection, measurement and unrelated edits do not invalidate a proposal. */
export function captureSelectionEditSnapshot(nodes: readonly Node[], edges: readonly Edge[], nodeIds: readonly string[], epoch: number): SelectionEditSnapshot {
  const selected = new Set(nodeIds), dependencies = new Set(nodeIds)
  if (!selected.size || nodes.filter(node => selected.has(node.id)).length !== selected.size) throw new Error('Select at least one existing node to edit with AI.')
  for (const edge of edges) if (selected.has(edge.source) || selected.has(edge.target)) { dependencies.add(edge.source); dependencies.add(edge.target) }
  const descendants = new Set(nodeIds)
  let foundDescendant = true
  while (foundDescendant) {
    foundDescendant = false
    for (const node of nodes) if (node.parentNode && descendants.has(node.parentNode) && !descendants.has(node.id)) {
      descendants.add(node.id)
      dependencies.add(node.id)
      foundDescendant = true
    }
  }
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) if (dependencies.has(node.id) && node.parentNode && !dependencies.has(node.parentNode)) { dependencies.add(node.parentNode); grew = true }
  }
  const dependencyIds = [...dependencies].sort()
  return {
    nodeIds: [...selected].sort(), dependencyIds, epoch,
    nodes: JSON.stringify(dependencyIds.map(id => nodes.find(node => node.id === id)).map(node => node ? authoredNode(node) : null)),
    edges: JSON.stringify(edges.filter(edge => selected.has(edge.source) || selected.has(edge.target)).map(authoredEdge).sort((a, b) => a.id.localeCompare(b.id))),
  }
}
export function selectionEditSnapshotIsCurrent(snapshot: SelectionEditSnapshot, nodes: readonly Node[], edges: readonly Edge[], epoch: number): boolean {
  if (snapshot.epoch !== epoch) return false
  try {
    const current = captureSelectionEditSnapshot(nodes, edges, snapshot.nodeIds, epoch)
    return snapshot.nodes === current.nodes && snapshot.edges === current.edges && JSON.stringify(snapshot.dependencyIds) === JSON.stringify(current.dependencyIds)
  } catch { return false }
}

export function selectionEditContext(nodes: readonly Node[], edges: readonly Edge[], snapshot: SelectionEditSnapshot) {
  const ids = new Set(snapshot.dependencyIds), selected = new Set(snapshot.nodeIds)
  const chart = selectionEditChart(nodes.filter(node => ids.has(node.id)), edges.filter(edge => selected.has(edge.source) || selected.has(edge.target)))
  if (chart.nodes.length > 200 || chart.edges.length > 400) throw new Error('This selection has too much nearby context. Select fewer nodes and try again.')
  return {
    nodes: chart.nodes.map(node => {
      const { imageUrl, ...rest } = node
      return { ...rest, ...(imageUrl && !imageUrl.startsWith('data:') && imageUrl.length <= 2000 ? { imageUrl } : {}) }
    }),
    edges: chart.edges,
  }
}

interface MergeDeps {
  onLabelChange: (id: string, label: string) => void
  edgeProps: (style: EdgeStyle, options?: { protocol?: EdgeProtocol; commStyle?: CommStyle }) => Partial<Edge>
}
const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)

/** Apply canonical differences sparsely to the original editor objects. Unknown
 * metadata, exact geometry and custom appearance remain intact when untouched. */
export function mergeSelectionEditResult(nodes: Node[], edges: Edge[], result: PatchResult, deps: MergeDeps): { nodes: Node[]; edges: Edge[] } {
  const before = selectionEditChart(nodes, edges), originalNodes = new Map(nodes.map(node => [node.id, node])), originalEdges = new Map(edges.map(edge => [edge.id, edge]))
  const beforeNodes = new Map(before.nodes.map(node => [node.id, node])), beforeEdges = new Map(before.edges.map(edge => [edge.id, edge]))
  const nextNodes: Node[] = result.nodes.map(node => {
    const original = originalNodes.get(node.id), previous = beforeNodes.get(node.id)
    if (!node.position) throw new Error('AI edits must include positions for new or moved nodes.')
    if (original && previous && !different(previous, node)) return original
    if (!original || !previous) {
      return { id: node.id, type: node.type, position: { ...node.position }, parentNode: node.parentNode, extent: node.parentNode ? 'parent' : undefined,
        data: { label: node.label, ...(node.icon ? { icon: node.icon, imageUrl: getAzureIconUrl(node.icon) } : node.imageUrl ? { imageUrl: node.imageUrl } : {}), ...(node.containerKind ? { containerKind: node.containerKind } : {}), onLabelChange: deps.onLabelChange },
        style: node.width !== undefined || node.height !== undefined ? { ...(node.width !== undefined ? { width: node.width } : {}), ...(node.height !== undefined ? { height: node.height } : {}) } : undefined }
    }
    const next: Node = { ...original, data: { ...original.data } }
    if (different(previous.type, node.type)) next.type = node.type
    if (different(previous.label, node.label)) next.data.label = node.label
    if (different(previous.position, node.position)) next.position = { ...node.position }
    if (different(previous.parentNode, node.parentNode)) { next.parentNode = node.parentNode; next.extent = node.parentNode ? 'parent' : undefined }
    for (const field of ['width', 'height'] as const) if (different(previous[field], node[field])) {
      next.style = { ...next.style }
      if (node[field] === undefined) delete next.style[field]
      else next.style[field] = node[field]
    }
    if (different(previous.icon, node.icon) || different(previous.imageUrl, node.imageUrl)) {
      if (node.icon) { next.data.icon = node.icon; next.data.imageUrl = getAzureIconUrl(node.icon) }
      else { delete next.data.icon; if (node.imageUrl) next.data.imageUrl = node.imageUrl; else delete next.data.imageUrl }
    }
    if (different(previous.containerKind, node.containerKind)) { if (node.containerKind) next.data.containerKind = node.containerKind; else delete next.data.containerKind }
    return next
  })
  const nextEdges: Edge[] = result.edges.map(edge => {
    if (!edge.id) throw new Error('AI edits must supply an ID for each connection.')
    const original = originalEdges.get(edge.id), previous = beforeEdges.get(edge.id)
    if (original && previous && !different(previous, edge)) return original
    if (!original || !previous) {
      const { style, protocol, commStyle, ...fields } = edge
      return { ...fields, id: edge.id, ...deps.edgeProps(style ?? 'default', { protocol, commStyle }) }
    }
    const next: Edge = { ...original }
    for (const key of ['source', 'target', 'label', 'sourceHandle', 'targetHandle'] as const) if (different(previous[key], edge[key])) {
      if (edge[key] === undefined) delete next[key]
      else Object.assign(next, { [key]: edge[key] })
    }
    if (different(previous.style, edge.style) || different(previous.protocol, edge.protocol) || different(previous.commStyle, edge.commStyle)) {
      const rendered = deps.edgeProps(edge.style ?? 'default', { protocol: edge.protocol, commStyle: edge.commStyle })
      if (different(previous.style, edge.style)) next.type = rendered.type
      next.animated = rendered.animated
      next.style = { ...original.style }
      if (rendered.style?.strokeDasharray) next.style.strokeDasharray = rendered.style.strokeDasharray
      else delete next.style.strokeDasharray
      next.data = { ...original.data, protocol: edge.protocol, commStyle: edge.commStyle }
    }
    return next
  })
  return { nodes: nextNodes, edges: nextEdges }
}

const label = (value: unknown) => value === undefined ? 'default' : typeof value === 'string' ? value : JSON.stringify(value)
export function selectionEditPreview(beforeNodes: Node[], beforeEdges: Edge[], nodes: Node[], edges: Edge[], summary: string): SelectionEditPreview {
  const before = selectionEditChart(beforeNodes, beforeEdges), after = selectionEditChart(nodes, edges), changes: SelectionEditChange[] = []
  for (const kind of ['node', 'edge'] as const) {
    const previous = kind === 'node' ? before.nodes : before.edges, next = kind === 'node' ? after.nodes : after.edges
    const previousById = new Map(previous.map(item => [item.id, item])), nextById = new Map(next.map(item => [item.id, item]))
    for (const item of next) {
      const old = previousById.get(item.id)
      if (old && !different(old, item)) continue
      const details = old ? Object.keys(item).concat(Object.keys(old)).filter((key, index, all) => key !== 'id' && all.indexOf(key) === index && different(Reflect.get(old, key), Reflect.get(item, key))).map(key => `${key}: ${label(Reflect.get(old, key))} → ${label(Reflect.get(item, key))}`) : []
      changes.push({ kind, action: old ? 'updated' : 'added', id: item.id, label: item.label || (kind === 'edge' ? `${(item as ChartEdge).source} → ${(item as ChartEdge).target}` : item.id), details })
    }
    for (const item of previous) if (!nextById.has(item.id)) changes.push({ kind, action: 'removed', id: item.id, label: item.label || item.id, details: [] })
  }
  return { summary, beforeNodes, beforeEdges, nodes, edges, changes }
}

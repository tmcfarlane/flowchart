// Converts between shared chart documents (src/shared/flowTypes.ts) and the
// React Flow nodes/edges the editor works with. The conversion round-trips:
// flowToChart(chartToFlow(chart)) canonicalizes to the same document, so
// applying a remote chart never looks like a local edit.

import type { Edge, Node } from 'reactflow'
import {
  COMM_STYLES,
  CONTAINER_KINDS,
  EDGE_PROTOCOLS,
  isHandlePosition,
  isNodeType,
  canonicalEdgeStyle,
  type ChartEdge,
  type ChartNode,
  type CommStyle,
  type ContainerKind,
  type EdgeProtocol,
  type EdgeStyle,
} from '../shared/flowTypes'
import { getAzureIconId, getAzureIconUrl } from './azureIconIds'
import { sortParentsFirst } from './nesting'

export interface ChartToFlowDeps {
  onLabelChange: (nodeId: string, label: string) => void
  /** The editor's edge styling (App's getEdgeStyleProps), so shared edges look hand-made. */
  edgeProps: (style: EdgeStyle, options?: { protocol?: EdgeProtocol; commStyle?: CommStyle }) => Partial<Edge>
}

export interface ChartContentShape {
  nodes: ChartNode[]
  edges: ChartEdge[]
}

const round = (value: number) => Math.round(value * 100) / 100

export function chartToFlow(chart: ChartContentShape, deps: ChartToFlowDeps): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = sortParentsFirst(chart.nodes).map((node) => {
    const imageUrl = node.icon ? getAzureIconUrl(node.icon) : node.imageUrl
    const style = node.width || node.height ? { width: node.width, height: node.height } : undefined
    return {
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      parentNode: node.parentNode,
      extent: node.parentNode ? ('parent' as const) : undefined,
      data: {
        label: node.label,
        imageUrl,
        icon: node.icon,
        containerKind: node.type === 'container' ? node.containerKind ?? 'group' : undefined,
        onLabelChange: deps.onLabelChange,
      },
      style,
    }
  })

  const edges: Edge[] = chart.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    ...deps.edgeProps(canonicalEdgeStyle(edge.style, edge.commStyle), {
      protocol: edge.protocol,
      commStyle: edge.commStyle,
    }),
  }))

  return { nodes, edges }
}

function edgeStyleOf(edge: Edge): EdgeStyle {
  if (edge.type === 'smoothstep' || edge.type === 'step') return 'step'
  if (edge.data?.commStyle) return 'default'
  return edge.animated ? 'animated' : 'default'
}

const isProtocol = (v: unknown): v is EdgeProtocol => typeof v === 'string' && (EDGE_PROTOCOLS as readonly string[]).includes(v)
const isCommStyle = (v: unknown): v is CommStyle => typeof v === 'string' && (COMM_STYLES as readonly string[]).includes(v)
const isContainerKind = (v: unknown): v is ContainerKind =>
  typeof v === 'string' && (CONTAINER_KINDS as readonly string[]).includes(v)

/** Serialize the editor state as a shared chart document. */
export function flowToChart(nodes: Node[], edges: Edge[]): ChartContentShape {
  const chartNodes: ChartNode[] = nodes.map((node) => {
    const type = isNodeType(node.type) ? node.type : 'step'
    const out: ChartNode = {
      id: node.id,
      type,
      label: typeof node.data?.label === 'string' ? node.data.label : String(node.data?.label ?? ''),
      position: { x: round(node.position.x), y: round(node.position.y) },
    }
    const width = node.style?.width
    const height = node.style?.height
    if (typeof width === 'number' && width > 0) out.width = round(width)
    if (typeof height === 'number' && height > 0) out.height = round(height)
    const icon =
      typeof node.data?.icon === 'string'
        ? node.data.icon
        : typeof node.data?.imageUrl === 'string'
          ? getAzureIconId(node.data.imageUrl)
          : undefined
    if (icon) out.icon = icon
    else if (typeof node.data?.imageUrl === 'string' && node.data.imageUrl) out.imageUrl = node.data.imageUrl
    if (node.parentNode) out.parentNode = node.parentNode
    if (type === 'container') out.containerKind = isContainerKind(node.data?.containerKind) ? node.data.containerKind : 'group'
    return out
  })

  const chartEdges: ChartEdge[] = edges.map((edge) => {
    const out: ChartEdge = { id: edge.id, source: edge.source, target: edge.target }
    if (typeof edge.label === 'string' && edge.label) out.label = edge.label
    const commStyle = isCommStyle(edge.data?.commStyle) ? edge.data.commStyle : undefined
    out.style = canonicalEdgeStyle(edgeStyleOf(edge), commStyle)
    if (isHandlePosition(edge.sourceHandle)) out.sourceHandle = edge.sourceHandle
    if (isHandlePosition(edge.targetHandle)) out.targetHandle = edge.targetHandle
    if (isProtocol(edge.data?.protocol)) out.protocol = edge.data.protocol
    if (commStyle) out.commStyle = commStyle
    return out
  })

  return { nodes: chartNodes, edges: chartEdges }
}

function nodeKey(n: ChartNode): unknown[] {
  return [
    n.id,
    n.type,
    n.label,
    round(n.position.x),
    round(n.position.y),
    n.width === undefined ? null : round(n.width),
    n.height === undefined ? null : round(n.height),
    n.icon ?? null,
    n.icon ? null : n.imageUrl ?? null,
    n.parentNode ?? null,
    n.type === 'container' ? n.containerKind ?? 'group' : null,
  ]
}

function edgeKey(e: ChartEdge): unknown[] {
  return [
    e.id,
    e.source,
    e.target,
    e.label || null,
    canonicalEdgeStyle(e.style, e.commStyle),
    e.sourceHandle ?? null,
    e.targetHandle ?? null,
    e.protocol ?? null,
    e.commStyle ?? null,
  ]
}

/** Stable string for "did anything that is saved change?" checks. */
export function contentFingerprint(content: ChartContentShape): string {
  return JSON.stringify([content.nodes.map(nodeKey), content.edges.map(edgeKey)])
}

/** Ids of nodes that are new or changed between two documents (for highlighting agent edits). */
export function changedNodeIds(before: ChartContentShape, after: ChartContentShape): Set<string> {
  const previous = new Map(before.nodes.map((n) => [n.id, JSON.stringify(nodeKey(n))]))
  const changed = new Set<string>()
  for (const node of after.nodes) {
    if (previous.get(node.id) !== JSON.stringify(nodeKey(node))) changed.add(node.id)
  }
  return changed
}

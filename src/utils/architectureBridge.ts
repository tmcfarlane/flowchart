// Only imported by the lazy Architecture editor. Native elements own drawing
// geometry; customData links the subset that also has semantic graph meaning.
import { convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { Node, Edge } from 'reactflow'
import { flowToChart } from './sharedFlow'
import { getAbsolutePosition } from './nesting'
import type { ChartNode, ChartEdge } from '../shared/flowTypes'

interface BridgeData { kind: 'node' | 'edge' | 'icon'; id: string; snapshot?: ChartNode | ChartEdge }
export const bridgeData = (element: ExcalidrawElement): BridgeData | undefined => element.customData?.flowchart as BridgeData | undefined
const shapeId = (id: string) => `fc-node-${id}`
const edgeId = (id: string) => `fc-edge-${id}`
export const graphSignature = (nodes: Node[], edges: Edge[]) => JSON.stringify(flowToChart(nodes, edges))

function endpoint(shape: ExcalidrawElement, handle: ChartEdge['sourceHandle'], fallback: 'top' | 'bottom') {
  const side = handle ?? fallback
  const local = side === 'left' ? [-shape.width / 2, 0] : side === 'right' ? [shape.width / 2, 0] : side === 'top' ? [0, -shape.height / 2] : [0, shape.height / 2]
  const cos = Math.cos(shape.angle), sin = Math.sin(shape.angle)
  return { x: shape.x + shape.width / 2 + local[0] * cos - local[1] * sin, y: shape.y + shape.height / 2 + local[0] * sin + local[1] * cos }
}

function arrowGeometry(source: ExcalidrawElement, target: ExcalidrawElement, edge: ChartEdge) {
  const start = endpoint(source, edge.sourceHandle, 'bottom')
  const end = endpoint(target, edge.targetHandle, 'top')
  const dx = end.x - start.x, dy = end.y - start.y
  const points = edge.style === 'step'
    ? [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]]
    : [[0, 0], [dx, dy]]
  return {
    x: start.x, y: start.y, width: Math.abs(dx), height: Math.abs(dy),
    points: points as Extract<ExcalidrawElement, { type: 'arrow' }>['points'],
    startBinding: { elementId: source.id, focus: 0, gap: 1 },
    endBinding: { elementId: target.id, focus: 0, gap: 1 },
  }
}

function setBoundLabel(output: ExcalidrawElement[], container: ExcalidrawElement, label: string, fontSize: number) {
  const index = output.findIndex(e => e.type === 'text' && e.containerId === container.id)
  const previous = output[index]
  if (!label) {
    if (previous) output[index] = newElementWith(previous, { isDeleted: true })
    return
  }
  if (previous?.type === 'text') {
    output[index] = newElementWith(previous, {
      text: label, originalText: label, isDeleted: false,
      x: container.x + container.width / 2 - previous.width / 2,
      y: container.y + container.height / 2 - previous.height / 2,
    })
    return
  }
  const text = convertToExcalidrawElements([{ type: 'text', text: label, x: container.x + container.width / 2, y: container.y + container.height / 2, fontSize, fontFamily: 2 }], { regenerateIds: false })[0]
  if (text?.type === 'text') output.push(newElementWith(text, { containerId: container.id, x: text.x - text.width / 2, y: text.y - text.height / 2, verticalAlign: 'middle', textAlign: 'center' }))
}

const CONTAINER_GROUP_PREFIX = 'fc-container-'

/** Native groups make semantic container contents move together, while graph
 * parentNode retains the distinction from user-created groups and frames. */
function withContainerGroups(elements: ExcalidrawElement[], nodes: ChartNode[], edges: ChartEdge[]) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const edgeMap = new Map(edges.map(edge => [edge.id, edge]))
  const containerGroups = (nodeId: string): string[] => {
    const groups: string[] = []
    const visited = new Set<string>()
    let node = nodeMap.get(nodeId)
    while (node && !visited.has(node.id)) {
      visited.add(node.id)
      if (node.type === 'container') groups.push(`${CONTAINER_GROUP_PREFIX}${node.id}`)
      node = node.parentNode ? nodeMap.get(node.parentNode) : undefined
    }
    // Excalidraw orders nested groups from innermost to outermost.
    return groups
  }
  const groupsByElement = new Map<string, string[]>()
  for (const element of elements) {
    const metadata = bridgeData(element)
    if (metadata?.kind === 'node' || metadata?.kind === 'icon') groupsByElement.set(element.id, containerGroups(metadata.id))
    else if (metadata?.kind === 'edge') {
      const edge = edgeMap.get(metadata.id)
      if (!edge) { groupsByElement.set(element.id, []); continue }
      const targetGroups = new Set(containerGroups(edge.target))
      groupsByElement.set(element.id, containerGroups(edge.source).filter(group => targetGroups.has(group)))
    }
  }
  return elements.map(element => {
    const groups = element.type === 'text' && element.containerId ? groupsByElement.get(element.containerId) : groupsByElement.get(element.id)
    if (!groups) return element
    const groupIds = [...(element.groupIds ?? []).filter(group => !group.startsWith(CONTAINER_GROUP_PREFIX)), ...groups]
    return JSON.stringify(groupIds) === JSON.stringify(element.groupIds) ? element : newElementWith(element, { groupIds })
  })
}

/** Add/update semantic shapes without touching freeform elements or their styles. */
export function mergeGraphElements(elements: readonly ExcalidrawElement[], nodes: Node[], edges: Edge[], darkMode: boolean): OrderedExcalidrawElement[] {
  const chart = flowToChart(nodes, edges)
  const nodeMap = new Map(chart.nodes.map(n => [n.id, n]))
  const edgeMap = new Map(chart.edges.map(e => [e.id, e]))
  const previousShapes = new Map(elements.filter(e => bridgeData(e)?.kind === 'node').map(e => [bridgeData(e)!.id, e]))
  const previousEdges = new Map(elements.filter(e => bridgeData(e)?.kind === 'edge').map(e => [bridgeData(e)!.id, e]))
  const output: ExcalidrawElement[] = [...elements]
  const movedShapes = new Set<string>()
  const removed = new Set<string>()
  for (const element of elements) {
    const metadata = bridgeData(element)
    if (metadata?.kind === 'node' && !nodeMap.has(metadata.id)) removed.add(element.id)
    if (metadata?.kind === 'edge' && !edgeMap.has(metadata.id)) removed.add(element.id)
  }
  for (let i = 0; i < output.length; i++) {
    const element = output[i]
    if (removed.has(element.id) || (element.type === 'text' && element.containerId && removed.has(element.containerId))) output[i] = newElementWith(element, { isDeleted: true })
  }
  const fresh: ExcalidrawElementSkeleton[] = []
  for (const node of chart.nodes) {
    const previous = previousShapes.get(node.id)
    const source = nodes.find(n => n.id === node.id)!
    const position = getAbsolutePosition(source, nodes)
    const width = node.width ?? (node.type === 'decision' ? 160 : node.type === 'container' ? 420 : 180)
    const height = node.height ?? (node.type === 'decision' ? 160 : node.type === 'container' ? 300 : 90)
    const metadata: BridgeData = { kind: 'node', id: node.id, snapshot: node }
    if (!previous) {
      fresh.push({ id: shapeId(node.id), type: node.type === 'decision' ? 'diamond' : node.type === 'externalActor' ? 'ellipse' : 'rectangle', x: position.x, y: position.y, width, height,
        label: { text: node.label, fontSize: 18, fontFamily: 2 }, strokeColor: darkMode ? '#78fcd6' : '#087f5b', backgroundColor: node.type === 'note' ? '#fff3bf' : 'transparent', strokeStyle: node.type === 'container' ? 'dashed' : 'solid', roughness: 0, roundness: { type: 3 }, customData: { flowchart: metadata } })
    } else if (previous.isDeleted || JSON.stringify(bridgeData(previous)?.snapshot) !== JSON.stringify(node)) {
      const index = output.findIndex(e => e.id === previous.id)
      if (previous.x !== position.x || previous.y !== position.y || previous.width !== width || previous.height !== height) movedShapes.add(previous.id)
      output[index] = newElementWith(previous, { x: position.x, y: position.y, width, height, isDeleted: false, customData: { ...previous.customData, flowchart: metadata } })
      setBoundLabel(output, output[index], node.label, 18)
    }
  }
  if (fresh.length) output.push(...convertToExcalidrawElements(fresh, { regenerateIds: false }))
  const shapes = new Map(output.filter(e => !e.isDeleted && bridgeData(e)?.kind === 'node').map(e => [bridgeData(e)!.id, e]))
  for (const edge of chart.edges) {
    const source = shapes.get(edge.source), target = shapes.get(edge.target)
    if (!source || !target) continue
    const previous = previousEdges.get(edge.id)
    const metadata: BridgeData = { kind: 'edge', id: edge.id, snapshot: edge }
    const label = [edge.label, edge.protocol].filter(Boolean).join(' · ')
    const strokeStyle = edge.commStyle ? edge.commStyle === 'async' ? 'dashed' : 'solid' : edge.style === 'animated' ? 'dashed' : 'solid'
    if (!previous) {
      // Binding skeletons by `start`/`end` only resolves elements in the same
      // conversion batch. Existing shapes are already in the scene, so supply
      // their native bindings directly rather than creating unbound arrows.
      const converted = convertToExcalidrawElements([{ id: edgeId(edge.id), type: 'arrow', ...arrowGeometry(source, target, edge), label: label ? { text: label, fontSize: 14, fontFamily: 2 } : undefined, strokeColor: darkMode ? '#78fcd6' : '#087f5b', strokeStyle, roughness: 0, customData: { flowchart: metadata } }], { regenerateIds: false })
      output.push(...converted)
    } else if (previous.type === 'arrow' && (previous.isDeleted || movedShapes.has(source.id) || movedShapes.has(target.id) || JSON.stringify(bridgeData(previous)?.snapshot) !== JSON.stringify(edge))) {
      const index = output.findIndex(e => e.id === previous.id)
      const oldEdge = bridgeData(previous)?.snapshot as ChartEdge | undefined
      const reroute = previous.isDeleted || movedShapes.has(source.id) || movedShapes.has(target.id) || oldEdge?.source !== edge.source || oldEdge?.target !== edge.target || oldEdge?.sourceHandle !== edge.sourceHandle || oldEdge?.targetHandle !== edge.targetHandle || oldEdge?.style !== edge.style
      output[index] = newElementWith(previous, { ...(reroute ? arrowGeometry(source, target, edge) : {}), strokeStyle, customData: { ...previous.customData, flowchart: metadata }, isDeleted: false })
      setBoundLabel(output, output[index], label, 14)
    }
  }
  // Conversion restores reciprocal boundElements for newly created connectors.
  const bound = new Map<string, Array<{ id: string; type: 'arrow' | 'text' }>>()
  for (const element of output) {
    if (element.isDeleted) continue
    if (element.type === 'text' && element.containerId) bound.set(element.containerId, [...(bound.get(element.containerId) ?? []), { id: element.id, type: 'text' }])
    if (element.type === 'arrow') for (const binding of [element.startBinding, element.endBinding]) if (binding) bound.set(binding.elementId, [...(bound.get(binding.elementId) ?? []), { id: element.id, type: 'arrow' }])
  }
  return withContainerGroups(output.map(e => ({ ...e, boundElements: bound.get(e.id) ?? null })), chart.nodes, chart.edges) as OrderedExcalidrawElement[]
}

/** Reconcile semantic shapes edited in the native editor back into the graph. */
export function graphFromElements(elements: readonly ExcalidrawElement[], nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[]; elements: readonly ExcalidrawElement[] } {
  const alive = elements.filter(e => !e.isDeleted)
  const semantic = alive.filter(e => bridgeData(e)?.kind === 'node')
  const allSemanticIds = new Set(elements.filter(e => bridgeData(e)?.kind === 'node').map(e => bridgeData(e)!.id))
  const byId = new Map(nodes.map(n => [n.id, n]))
  const nextNodes = nodes.filter(n => !allSemanticIds.has(n.id))
  const snapshotMap = new Map<string, ChartNode | ChartEdge>()
  for (const shape of semantic) {
    const metadata = bridgeData(shape)!
    const existing = byId.get(metadata.id)
    const snapshot = metadata.snapshot as ChartNode | undefined
    if (!existing && !snapshot) continue
    const labelElement = alive.find(e => e.type === 'text' && e.containerId === shape.id)
    const hadBoundLabel = elements.some(e => e.type === 'text' && e.containerId === shape.id)
    const label = labelElement?.type === 'text' ? labelElement.text : hadBoundLabel ? '' : existing?.data.label ?? snapshot?.label ?? ''
    const previousParentId = existing ? existing.parentNode : snapshot?.parentNode
    const parent = semantic.find(e => bridgeData(e)?.id === previousParentId)
    const parentId = parent ? previousParentId : undefined
    const position = { x: shape.x - (parent?.x ?? 0), y: shape.y - (parent?.y ?? 0) }
    const node: Node = { ...existing, id: metadata.id, type: existing?.type ?? snapshot?.type ?? 'service', position, parentNode: parentId, extent: parentId ? 'parent' : undefined, data: { ...snapshot, ...existing?.data, label }, style: { ...existing?.style, width: shape.width, height: shape.height } }
    nextNodes.push(node)
    snapshotMap.set(shape.id, flowToChart([node], []).nodes[0])
  }
  const allEdgeIds = new Set(elements.filter(e => bridgeData(e)?.kind === 'edge').map(e => bridgeData(e)!.id))
  const nextEdges = edges.filter(e => !allEdgeIds.has(e.id) && nextNodes.some(n => n.id === e.source) && nextNodes.some(n => n.id === e.target))
  for (const element of alive) {
    const metadata = bridgeData(element)
    if (metadata?.kind !== 'edge' || element.type !== 'arrow') continue
    const existing = edges.find(e => e.id === metadata.id)
    const snapshot = metadata.snapshot as ChartEdge | undefined
    const source = semantic.find(e => e.id === element.startBinding?.elementId)
    const target = semantic.find(e => e.id === element.endBinding?.elementId)
    const sourceId = source ? bridgeData(source)!.id : existing?.source ?? snapshot?.source
    const targetId = target ? bridgeData(target)!.id : existing?.target ?? snapshot?.target
    if (!sourceId || !targetId || !nextNodes.some(n => n.id === sourceId) || !nextNodes.some(n => n.id === targetId)) continue
    const labelElement = alive.find(e => e.type === 'text' && e.containerId === element.id)
    const protocol = existing ? existing.data?.protocol : snapshot?.protocol
    const hadBoundLabel = elements.some(e => e.type === 'text' && e.containerId === element.id)
    const displayedLabel = labelElement?.type === 'text' ? labelElement.text : hadBoundLabel ? undefined : existing?.label ?? snapshot?.label
    const label = typeof displayedLabel === 'string' && protocol ? displayedLabel.replace(new RegExp(`(?: · )?${protocol}$`), '') : displayedLabel
    const edge: Edge = { ...existing, id: metadata.id, source: sourceId, target: targetId, label, animated: existing?.animated ?? snapshot?.style === 'animated', type: existing?.type ?? (snapshot?.style === 'step' ? 'smoothstep' : 'default'), data: { ...existing?.data, protocol, commStyle: existing ? existing.data?.commStyle : snapshot?.commStyle } }
    nextEdges.push(edge)
    snapshotMap.set(element.id, flowToChart([], [edge]).edges[0])
  }
  return { nodes: nextNodes, edges: nextEdges, elements: elements.map(e => snapshotMap.has(e.id) ? { ...e, customData: { ...e.customData, flowchart: { ...bridgeData(e), snapshot: snapshotMap.get(e.id) } } } : e) }
}

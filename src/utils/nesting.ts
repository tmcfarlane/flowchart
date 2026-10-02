// Helpers for React Flow parent/child nesting (containers).
// Kept pure so ordering, coordinate, and paste id-remapping rules are unit-testable.

import type { Node as FlowNode, Edge, XYPosition } from 'reactflow'

interface Nestable {
  id: string
  parentNode?: string
  position: XYPosition
}

/**
 * Resolve a node's absolute canvas position. Children of containers store
 * positions relative to their parent; this walks the parent chain.
 * Tolerates missing parents and cycles.
 */
export function getAbsolutePosition<T extends Nestable>(node: T, nodes: T[]): XYPosition {
  let x = node.position.x
  let y = node.position.y
  const visited = new Set<string>([node.id])
  let parentId = node.parentNode
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}

/**
 * Order nodes so every parent precedes its children, as React Flow requires
 * (this also renders containers behind their children). Preserves the
 * original relative order otherwise. Tolerates missing parents and cycles.
 */
export function sortParentsFirst<T extends { id: string; parentNode?: string }>(nodes: T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const emitted = new Set<string>()
  const result: T[] = []

  const emit = (node: T, stack: Set<string>) => {
    if (emitted.has(node.id) || stack.has(node.id)) return
    stack.add(node.id)
    const parent = node.parentNode ? byId.get(node.parentNode) : undefined
    if (parent) emit(parent, stack)
    stack.delete(node.id)
    if (!emitted.has(node.id)) {
      emitted.add(node.id)
      result.push(node)
    }
  }

  for (const node of nodes) emit(node, new Set())
  return result
}

/**
 * Assign fresh sequential ids to clipboard content for pasting. Ids are derived
 * by enumeration from `startCounter` (never from parsing existing ids, which may
 * be non-numeric). Remaps edge endpoints and parentNode references; a parentNode
 * pointing outside the clipboard is dropped (the copy flow flattens those
 * children to absolute positions at copy time).
 */
export function remapPastedNodes(
  clipboardNodes: FlowNode[],
  clipboardEdges: Edge[],
  startCounter: number,
): { nodes: FlowNode[]; edges: Edge[]; nextCounter: number } {
  const idMapping = new Map<string, string>()
  clipboardNodes.forEach((node, i) => {
    idMapping.set(node.id, (startCounter + i).toString())
  })

  const nodes = clipboardNodes.map((node) => {
    const newParent = node.parentNode ? idMapping.get(node.parentNode) : undefined
    return {
      ...node,
      id: idMapping.get(node.id)!,
      parentNode: newParent,
      extent: newParent ? node.extent : undefined,
      selected: false,
    }
  })

  const connections = new Map<string, number>()
  const edges = clipboardEdges
    .filter((edge) => idMapping.has(edge.source) && idMapping.has(edge.target))
    .map((edge) => {
      const source = idMapping.get(edge.source)!
      const target = idMapping.get(edge.target)!
      const base = `e${source}-${target}`
      const ordinal = connections.get(base) ?? 0
      connections.set(base, ordinal + 1)
      return {
        ...edge,
        id: ordinal ? `${base}-${ordinal}` : base,
        source, target, selected: false,
      }
    })

  return { nodes, edges, nextCounter: startCounter + clipboardNodes.length }
}

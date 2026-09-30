// Incremental chart edits used by update_flowchart (MCP) and PATCH /api/flows/:id.
// Operations apply in order and all-or-nothing: the first failing operation
// aborts the batch with a message that names it.

import { ICON_NODE_TYPES, LIMITS, type ChartEdge, type ChartNode, type DraftNode, type Position } from './flowTypes.js'
import {
  edgeFromInput,
  nodeFromInput,
  unknownNodeMessage,
  type EdgeDraft,
  type Operation,
  type ValidationIssue,
} from './flowSchema.js'

export interface PatchResult {
  ok: boolean
  nodes: DraftNode[]
  edges: EdgeDraft[]
  issues: ValidationIssue[]
  /** Nodes that need a (new) position from the layout engine. */
  needsPlacement: Set<string>
  /** Human-readable summary, e.g. 'added node "pay"'. */
  summary: string[]
}

function listEdgeIds(edges: EdgeDraft[], max = 25): string {
  const ids = edges.map((e) => e.id).filter((id): id is string => !!id)
  if (ids.length === 0) return 'The chart has no edges.'
  const shown = ids.slice(0, max).map((id) => JSON.stringify(id))
  return `Existing edge ids: ${shown.join(', ')}${ids.length > max ? `, ... (${ids.length} total)` : ''}.`
}

function absolutePosition(node: DraftNode, byId: Map<string, DraftNode>): Position {
  let x = node.position?.x ?? 0
  let y = node.position?.y ?? 0
  const seen = new Set([node.id])
  let parentId = node.parentNode
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position?.x ?? 0
    y += parent.position?.y ?? 0
    parentId = parent.parentNode
  }
  return { x, y }
}

export function applyOperations(
  currentNodes: ReadonlyArray<ChartNode | DraftNode>,
  currentEdges: ReadonlyArray<ChartEdge | EdgeDraft>,
  operations: Operation[],
): PatchResult {
  const nodes: DraftNode[] = currentNodes.map((n) => ({ ...n, position: n.position ? { ...n.position } : undefined }))
  let edges: EdgeDraft[] = currentEdges.map((e) => ({ ...e }))
  const needsPlacement = new Set<string>()
  const summary: string[] = []

  const fail = (index: number, op: Operation, message: string): PatchResult => ({
    ok: false,
    nodes,
    edges,
    issues: [{ path: `operations[${index}] (${op.op})`, message }],
    needsPlacement,
    summary,
  })

  const nodeIndex = () => new Map(nodes.map((n) => [n.id, n]))

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    const byId = nodeIndex()
    const knownIds = nodes.map((n) => n.id)

    switch (op.op) {
      case 'add_node': {
        const node = nodeFromInput(op.node)
        if (byId.has(node.id)) {
          return fail(i, op, `a node with id ${JSON.stringify(node.id)} already exists. Use update_node to change it, or choose a new id.`)
        }
        if (node.parentNode !== undefined && !byId.has(node.parentNode)) {
          return fail(i, op, `node.parentNode: ${unknownNodeMessage(node.parentNode, knownIds)}`)
        }
        if (nodes.length + 1 > LIMITS.maxNodes) {
          return fail(i, op, `the chart would exceed ${LIMITS.maxNodes} nodes.`)
        }
        nodes.push(node)
        if (!node.position) needsPlacement.add(node.id)
        summary.push(`added node ${JSON.stringify(node.id)}`)
        break
      }

      case 'update_node': {
        const node = byId.get(op.id)
        if (!node) return fail(i, op, unknownNodeMessage(op.id, knownIds))
        const c = op.changes
        if (Object.keys(c).length === 0) return fail(i, op, 'changes is empty; include at least one field to change.')

        if (c.type !== undefined && c.type !== node.type && node.type === 'container') {
          const kids = nodes.filter((n) => n.parentNode === node.id).map((n) => n.id)
          if (kids.length) {
            return fail(
              i,
              op,
              `container ${JSON.stringify(node.id)} still holds ${kids.map((k) => JSON.stringify(k)).join(', ')}. Move or remove those nodes before changing its type.`,
            )
          }
        }
        if (c.label !== undefined) node.label = c.label
        if (c.type !== undefined && c.type !== node.type) {
          node.type = c.type
          // Drop fields the new type can't use, unless this same change sets them.
          if (!ICON_NODE_TYPES.includes(c.type)) {
            if (c.icon === undefined) delete node.icon
            if (c.imageUrl === undefined) delete node.imageUrl
          }
          if (c.type !== 'container' && c.containerKind === undefined) delete node.containerKind
        }
        if (c.width !== undefined) {
          if (c.width === null) delete node.width
          else node.width = c.width
        }
        if (c.height !== undefined) {
          if (c.height === null) delete node.height
          else node.height = c.height
        }
        if (c.icon !== undefined) {
          if (c.icon === null || c.icon.trim() === '') delete node.icon
          else {
            node.icon = c.icon.trim()
            delete node.imageUrl
          }
        }
        if (c.imageUrl !== undefined) {
          if (c.imageUrl === null || c.imageUrl.trim() === '') delete node.imageUrl
          else node.imageUrl = c.imageUrl.trim()
        }
        if (c.containerKind !== undefined) {
          if (c.containerKind === null) delete node.containerKind
          else node.containerKind = c.containerKind
        }
        if (c.parentNode !== undefined && c.parentNode !== (node.parentNode ?? null)) {
          if (c.parentNode === null) {
            // Move out to the top level, keeping the node where it appears on screen.
            if (node.position) node.position = absolutePosition(node, byId)
            delete node.parentNode
          } else {
            if (!byId.has(c.parentNode)) return fail(i, op, `changes.parentNode: ${unknownNodeMessage(c.parentNode, knownIds)}`)
            node.parentNode = c.parentNode
            if (c.position === undefined) {
              delete node.position
              needsPlacement.add(node.id)
            }
          }
        }
        if (c.position !== undefined) {
          if (c.position === null) {
            delete node.position
            needsPlacement.add(node.id)
          } else {
            node.position = { x: c.position.x, y: c.position.y }
            needsPlacement.delete(node.id)
          }
        }
        summary.push(`updated node ${JSON.stringify(node.id)}`)
        break
      }

      case 'remove_node': {
        const node = byId.get(op.id)
        if (!node) return fail(i, op, unknownNodeMessage(op.id, knownIds))
        // Children of a removed container survive at their on-screen position.
        for (const child of nodes) {
          if (child.parentNode === node.id) {
            if (child.position) child.position = absolutePosition(child, byId)
            delete child.parentNode
          }
        }
        const before = edges.length
        edges = edges.filter((e) => e.source !== node.id && e.target !== node.id)
        nodes.splice(nodes.indexOf(node), 1)
        needsPlacement.delete(node.id)
        const removedEdges = before - edges.length
        summary.push(
          `removed node ${JSON.stringify(node.id)}${removedEdges ? ` and ${removedEdges} connected edge${removedEdges > 1 ? 's' : ''}` : ''}`,
        )
        break
      }

      case 'add_edge': {
        const edge = edgeFromInput(op.edge)
        for (const end of ['source', 'target'] as const) {
          if (!byId.has(edge[end])) return fail(i, op, `edge.${end}: ${unknownNodeMessage(edge[end], knownIds)}`)
        }
        if (edge.id !== undefined && edges.some((e) => e.id === edge.id)) {
          return fail(i, op, `an edge with id ${JSON.stringify(edge.id)} already exists. Omit the id to have one generated.`)
        }
        if (edges.length + 1 > LIMITS.maxEdges) return fail(i, op, `the chart would exceed ${LIMITS.maxEdges} edges.`)
        edges.push(edge)
        summary.push(`added edge ${edge.source} -> ${edge.target}`)
        break
      }

      case 'update_edge': {
        const edge = edges.find((e) => e.id === op.id)
        if (!edge) return fail(i, op, `no edge with id ${JSON.stringify(op.id)}. ${listEdgeIds(edges)}`)
        const c = op.changes
        if (Object.keys(c).length === 0) return fail(i, op, 'changes is empty; include at least one field to change.')
        for (const end of ['source', 'target'] as const) {
          const value = c[end]
          if (value !== undefined && !byId.has(value)) return fail(i, op, `changes.${end}: ${unknownNodeMessage(value, knownIds)}`)
        }
        if (c.source !== undefined && c.source !== edge.source) {
          edge.source = c.source
          delete edge.sourceHandle
        }
        if (c.target !== undefined && c.target !== edge.target) {
          edge.target = c.target
          delete edge.targetHandle
        }
        if (c.label !== undefined) {
          if (c.label === null || c.label === '') delete edge.label
          else edge.label = c.label
        }
        if (c.style !== undefined) edge.style = c.style
        for (const key of ['sourceHandle', 'targetHandle', 'protocol', 'commStyle'] as const) {
          const value = c[key]
          if (value === undefined) continue
          if (value === null) delete edge[key]
          else (edge as unknown as Record<string, unknown>)[key] = value
        }
        summary.push(`updated edge ${JSON.stringify(edge.id)}`)
        break
      }

      case 'remove_edge': {
        const index = edges.findIndex((e) => e.id === op.id)
        if (index < 0) return fail(i, op, `no edge with id ${JSON.stringify(op.id)}. ${listEdgeIds(edges)}`)
        edges.splice(index, 1)
        summary.push(`removed edge ${JSON.stringify(op.id)}`)
        break
      }
    }
  }

  return { ok: true, nodes, edges, issues: [], needsPlacement, summary }
}

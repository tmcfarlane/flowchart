// Validates AI edits against a frozen, explicit selection. Shared by the API
// and browser; no provider, storage, layout or Node-only modules are imported.
import { z } from 'zod'
import { LIMITS, type ChartEdge, type ChartNode } from './flowTypes.js'
import { OperationSchema, validateChart } from './flowSchema.js'
import { applyOperations, type PatchResult } from './patch.js'

const id = z.string().min(1).max(LIMITS.maxIdLength).regex(/^[^\u0000-\u001f\u007f]+$/)
const edgeId = z.string().min(1).max(LIMITS.maxEdgeIdLength).regex(/^[^\u0000-\u001f\u007f]+$/)
export const SelectionEditScopeSchema = z.strictObject({
  nodeIds: z.array(id).min(1).max(200),
  edgeIds: z.array(edgeId).max(400),
  snapshotId: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(),
}).superRefine((scope, ctx) => {
  if (new Set(scope.nodeIds).size !== scope.nodeIds.length) ctx.addIssue({ code: 'custom', message: 'Selected node IDs must be unique.' })
  if (new Set(scope.edgeIds).size !== scope.edgeIds.length) ctx.addIssue({ code: 'custom', message: 'Editable connection IDs must be unique.' })
})
export type SelectionEditScope = z.infer<typeof SelectionEditScopeSchema>

export const SelectionEditProposalSchema = z.strictObject({
  summary: z.string().trim().min(1).max(2000),
  operations: z.array(OperationSchema).max(LIMITS.maxOperations),
})
export type SelectionEditProposal = z.infer<typeof SelectionEditProposalSchema>
export type SelectionEditValidation =
  | { ok: true; proposal: SelectionEditProposal; result: PatchResult }
  | { ok: false; error: string }

/** Scope is checked independently before any upstream model call. Nearby
 * context never becomes writable merely because it appears in the request. */
export function selectionScopeError(
  nodes: ReadonlyArray<ChartNode>,
  edges: ReadonlyArray<ChartEdge>,
  unknownScope: unknown,
): string | undefined {
  const parsed = SelectionEditScopeSchema.safeParse(unknownScope)
  if (!parsed.success) return 'Select at least one node and capture a valid edit scope before asking AI to edit.'
  const scope = parsed.data
  const nodeIds = new Set(nodes.map(node => node.id)), selected = new Set(scope.nodeIds)
  const edgeIds = new Map(edges.map(edge => [edge.id, edge]))
  if (nodeIds.size !== nodes.length || edgeIds.size !== edges.length) return 'The diagram contains duplicate IDs. Fix them before asking AI to edit.'
  if (scope.nodeIds.some(nodeId => !nodeIds.has(nodeId))) return 'A selected node is missing from the captured diagram.'
  for (const approvedId of scope.edgeIds) {
    const edge = edgeIds.get(approvedId)
    if (!edge || (!selected.has(edge.source) && !selected.has(edge.target))) return 'Only connections touching selected nodes can be included in the edit scope.'
  }
  if (edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) return 'The captured diagram has a connection with a missing endpoint.'
  return undefined
}

// Property order and absent optional fields do not change semantic equality.
function stable(value: unknown): string {
  const order = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(order)
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, order(entry)]))
    return input
  }
  return JSON.stringify(order(value)) ?? 'undefined'
}

type PositionedNode = Pick<ChartNode, 'id' | 'parentNode'> & { position?: ChartNode['position'] }
function ancestorIds(node: PositionedNode, byId: ReadonlyMap<string, PositionedNode>): string[] {
  const ancestors: string[] = [], seen = new Set([node.id])
  let parent = node.parentNode
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    ancestors.push(parent)
    parent = byId.get(parent)?.parentNode
  }
  return ancestors
}
function absolutePosition(node: PositionedNode, byId: ReadonlyMap<string, PositionedNode>) {
  const position = { x: node.position?.x ?? 0, y: node.position?.y ?? 0 }
  for (const parentId of ancestorIds(node, byId)) {
    const parent = byId.get(parentId)
    position.x += parent?.position?.x ?? 0
    position.y += parent?.position?.y ?? 0
  }
  return position
}
const sameCoordinate = (before: number, after: number) => Math.abs(before - after) <= Number.EPSILON * Math.max(1, Math.abs(before), Math.abs(after)) * 8

/** Apply all-or-nothing, then inspect side effects as well as explicit targets.
 * The caller retains its original document and uses only the accepted sparse
 * operations. `result` is useful for preview/diff; it never runs auto-layout. */
export function validateSelectionEdit(
  nodes: ReadonlyArray<ChartNode>,
  edges: ReadonlyArray<ChartEdge>,
  unknownScope: SelectionEditScope,
  unknownProposal: unknown,
): SelectionEditValidation {
  const error = selectionScopeError(nodes, edges, unknownScope)
  if (error) return { ok: false, error }
  const scope = SelectionEditScopeSchema.parse(unknownScope)
  const parsed = SelectionEditProposalSchema.safeParse(unknownProposal)
  if (!parsed.success) return { ok: false, error: 'AI returned an invalid edit proposal. Please try again.' }
  const proposal = parsed.data
  const selected = new Set(scope.nodeIds), approvedEdges = new Set(scope.edgeIds)
  const originalNodes = new Map(nodes.map(node => [node.id, node])), originalEdges = new Map(edges.map(edge => [edge.id, edge]))
  const addedNodes = new Set(proposal.operations.flatMap(operation => operation.op === 'add_node' ? [operation.node.id] : []))
  const writableEndpoints = new Set([...selected, ...addedNodes])
  const allowedEndpoints = new Set(writableEndpoints)
  for (const edge of edges) if (approvedEdges.has(edge.id)) { allowedEndpoints.add(edge.source); allowedEndpoints.add(edge.target) }
  const reject = (message: string): SelectionEditValidation => ({ ok: false, error: message })

  for (const operation of proposal.operations) {
    switch (operation.op) {
      case 'add_node':
        if (originalNodes.has(operation.node.id)) return reject('A new node must use a new ID; existing selected nodes must be updated in place.')
        if (!operation.node.position) return reject('New nodes need explicit positions. AI edits cannot relayout the diagram.')
        if (operation.node.parentNode && !writableEndpoints.has(operation.node.parentNode)) return reject('A new node can be placed only in a selected or newly added container.')
        break
      case 'update_node': {
        if (!selected.has(operation.id)) return reject('AI proposed changing a node outside the captured selection.')
        const parent = operation.changes.parentNode
        if (parent && parent !== originalNodes.get(operation.id)?.parentNode && !writableEndpoints.has(parent)) return reject('Moving a node into an unselected container is outside the edit scope.')
        break
      }
      case 'remove_node':
        if (!selected.has(operation.id)) return reject('AI proposed deleting a node outside the captured selection.')
        break
      case 'add_edge':
        if (!operation.edge.id) return reject('New connections need explicit IDs.')
        if (!allowedEndpoints.has(operation.edge.source) || !allowedEndpoints.has(operation.edge.target) || (!writableEndpoints.has(operation.edge.source) && !writableEndpoints.has(operation.edge.target))) return reject('New connections can touch only selected/new nodes and explicitly included neighboring endpoints.')
        break
      case 'update_edge': {
        if (!approvedEdges.has(operation.id)) return reject('AI proposed changing a connection that was not included in the edit scope.')
        const current = originalEdges.get(operation.id)!
        const source = operation.changes.source ?? current.source, target = operation.changes.target ?? current.target
        if (!allowedEndpoints.has(source) || !allowedEndpoints.has(target) || (!writableEndpoints.has(source) && !writableEndpoints.has(target))) return reject('A connection cannot be retargeted outside the explicitly included endpoints.')
        break
      }
      case 'remove_edge':
        if (!approvedEdges.has(operation.id)) return reject('AI proposed deleting a connection that was not included in the edit scope.')
        break
    }
  }

  const result = applyOperations(nodes, edges, proposal.operations)
  if (!result.ok) return reject(result.issues[0]?.message ?? 'AI returned an edit that cannot be applied.')
  if (result.needsPlacement.size || result.nodes.some(node => !node.position)) return reject('AI edits require explicit positions and cannot trigger automatic layout.')
  const afterNodes = new Map(result.nodes.map(node => [node.id, node])), afterEdges = new Map(result.edges.map(edge => [edge.id, edge]))
  for (const original of nodes) {
    if (selected.has(original.id)) continue
    const after = afterNodes.get(original.id)
    if (!after || stable(after) !== stable(original)) return reject('This edit would change an unselected node, including its container relationship. Include it in the selection first.')
    const beforeWorld = absolutePosition(original, originalNodes), afterWorld = absolutePosition(after, afterNodes)
    if (!sameCoordinate(beforeWorld.x, afterWorld.x) || !sameCoordinate(beforeWorld.y, afterWorld.y)) return reject('This edit would move an unselected descendant through its container. Include the affected children in the selection first.')
    const beforeAncestors = ancestorIds(original, originalNodes), afterAncestors = ancestorIds(after, afterNodes)
    if (afterAncestors.some(parentId => !beforeAncestors.includes(parentId))) return reject('This edit would place an unselected descendant under a new ancestor extent and could clamp it. Include the affected children in the selection first.')
    const ancestors = new Set([...beforeAncestors, ...afterAncestors])
    for (const parentId of ancestors) {
      const beforeParent = originalNodes.get(parentId), afterParent = afterNodes.get(parentId)
      // Removing a selected ancestor may safely detach a selected intermediate
      // container at the same absolute position. Existing ancestors whose size
      // changes can instead clamp any unselected descendant via React Flow's
      // parent extent, even when its raw coordinates have not changed.
      if (beforeParent && afterParent && (beforeParent.width !== afterParent.width || beforeParent.height !== afterParent.height)) return reject('This edit would resize an ancestor of an unselected node and could move or clamp it. Include the affected children in the selection first.')
    }
  }
  for (const original of edges) {
    if (!approvedEdges.has(original.id) && stable(afterEdges.get(original.id)) !== stable(original)) return reject('This edit would change or delete a connection outside the approved scope. Include that connection first.')
  }

  // Uploaded image bytes are deliberately omitted from AI context. An existing
  // image with unchanged appearance may still be renamed; never fabricate an
  // image for a new node or after an explicit icon/image removal.
  const imageEdits = new Set(proposal.operations.flatMap(operation => operation.op === 'update_node' && ('icon' in operation.changes || 'imageUrl' in operation.changes || (operation.changes.type !== undefined && operation.changes.type !== originalNodes.get(operation.id)?.type)) ? [operation.id] : []))
  const validationNodes = result.nodes.map(node => {
    const old = originalNodes.get(node.id)
    return node.type === 'image' && !node.icon && !node.imageUrl && old?.type === 'image' && !old.icon && !old.imageUrl && !imageEdits.has(node.id)
      ? { ...node, imageUrl: '/assets/omitted-selection-image' }
      : node
  })
  const validated = validateChart(validationNodes, result.edges, { refStyle: 'id' })
  if (validated.issues.length) return reject(validated.issues[0].message)
  return { ok: true, proposal, result }
}

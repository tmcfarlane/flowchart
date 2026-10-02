import type { Node } from 'reactflow'
import { isNodeType, LIMITS, NODE_TYPE_INFO } from '../shared/flowTypes'

export type SelectionArrangeAction =
  | 'align-left' | 'align-center' | 'align-right'
  | 'align-top' | 'align-middle' | 'align-bottom'
  | 'distribute-horizontal' | 'distribute-vertical'

export interface ArrangementEligibility {
  enabled: boolean
  reason?: string
}

export interface SelectionArrangementAvailability {
  align: ArrangementEligibility
  horizontal: ArrangementEligibility
  vertical: ArrangementEligibility
}

export interface SelectionArrangementOptions<T extends Node = Node> {
  getNodeDimensions?: (node: T) => { width: number; height: number }
}

export interface SelectionArrangementResult<T extends Node = Node> {
  nodes: T[]
  changed: boolean
  error?: string
}

const distributionSelectionReason = 'Select at least three nodes to distribute the spaces between them.'

interface SizedNode<T extends Node> {
  node: T
  width: number
  height: number
}

type Selection<T extends Node> = { selected: SizedNode<T>[]; error?: undefined } | { error: string; selected?: undefined }

function dimensions<T extends Node>(node: T, options: SelectionArrangementOptions<T>) {
  const measuredWidth = node.width ?? (typeof node.style?.width === 'number' ? node.style.width : undefined)
  const measuredHeight = node.height ?? (typeof node.style?.height === 'number' ? node.style.height : undefined)
  const fallback = measuredWidth === undefined || measuredHeight === undefined
    ? options.getNodeDimensions?.(node) ?? NODE_TYPE_INFO[isNodeType(node.type) ? node.type : 'step'].defaultSize
    : undefined
  const width = measuredWidth ?? fallback?.width
  const height = measuredHeight ?? fallback?.height
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0 || width > LIMITS.maxNodeSize || height > LIMITS.maxNodeSize) return undefined
  return { width, height }
}

function boundedPosition(position: { x: number; y: number }) {
  return Number.isFinite(position.x) && Number.isFinite(position.y)
    && Math.abs(position.x) <= LIMITS.maxCoordinate && Math.abs(position.y) <= LIMITS.maxCoordinate
}

function selection<T extends Node>(nodes: T[], options: SelectionArrangementOptions<T>): Selection<T> {
  const selected = nodes.filter((node) => node.selected)
  if (selected.length < 2) return { error: 'Select at least two nodes to align them.' }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) return { error: 'Resolve duplicate node IDs before arranging this selection.' }
  const selectedIds = new Set(selected.map((node) => node.id))
  for (const node of selected) {
    const visited = new Set([node.id])
    let parentId = node.parentNode
    while (parentId) {
      if (visited.has(parentId)) return { error: 'Resolve the container hierarchy cycle before arranging this selection.' }
      if (selectedIds.has(parentId)) return { error: 'Select siblings without also selecting their container or ancestor.' }
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent || parent.type !== 'container') return { error: 'Restore the missing container before arranging this selection.' }
      parentId = parent.parentNode
    }
  }
  if (selected.some((node) => (node.parentNode || undefined) !== (selected[0].parentNode || undefined))) {
    return { error: 'Select nodes in the same container, or select only nodes outside containers.' }
  }
  const sized: SizedNode<T>[] = []
  for (const node of selected) {
    const size = dimensions(node, options)
    if (!size || !boundedPosition(node.position)) return { error: 'Give selected nodes finite positions and valid dimensions before arranging them.' }
    if (node.extent === 'parent') {
      const parent = node.parentNode ? byId.get(node.parentNode) : undefined
      const parentSize = parent ? dimensions(parent, options) : undefined
      if (!parentSize || node.position.x < 0 || node.position.y < 0
        || node.position.x + size.width > parentSize.width || node.position.y + size.height > parentSize.height) {
        return { error: 'Keep selected nodes inside their container, or resize the container before arranging them.' }
      }
    }
    sized.push({ node, ...size })
  }
  return { selected: sized }
}

function distribution<T extends Node>(selected: SizedNode<T>[], axis: 'x' | 'y') {
  if (selected.length < 3) return { error: distributionSelectionReason }
  // Array order breaks coordinate ties deterministically without changing node order in the document.
  const ordered = selected.map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.node.position[axis] - b.node.position[axis] || a.index - b.index)
  const sizeKey: 'width' | 'height' = axis === 'x' ? 'width' : 'height'
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const occupiedBeforeLast = ordered.slice(0, -1).reduce((sum, entry) => sum + entry[sizeKey], 0)
  const gap = (last.node.position[axis] - first.node.position[axis] - occupiedBeforeLast) / (ordered.length - 1)
  if (gap < 0) return { error: `Move the end nodes farther apart to distribute ${axis === 'x' ? 'horizontally' : 'vertically'} without overlap.` }
  return { ordered, gap, sizeKey }
}

/** Preflight selection and gap eligibility without changing the canvas. Final positions are also bounded by the transform. */
export function getSelectionArrangementAvailability<T extends Node>(nodes: T[], options: SelectionArrangementOptions<T> = {}): SelectionArrangementAvailability {
  const prepared = selection(nodes, options)
  if (prepared.error !== undefined) {
    const unavailable = { enabled: false, reason: prepared.error }
    const distributionUnavailable = nodes.filter((node) => node.selected).length < 2
      ? { enabled: false, reason: distributionSelectionReason } : unavailable
    return { align: unavailable, horizontal: distributionUnavailable, vertical: distributionUnavailable }
  }
  const horizontal = distribution(prepared.selected, 'x')
  const vertical = distribution(prepared.selected, 'y')
  return {
    align: { enabled: true },
    horizontal: horizontal.error ? { enabled: false, reason: horizontal.error } : { enabled: true },
    vertical: vertical.error ? { enabled: false, reason: vertical.error } : { enabled: true },
  }
}

/** Align sibling bounds or distribute equal gaps. Positions remain relative to the existing parent. */
export function arrangeSelectedNodes<T extends Node>(nodes: T[], action: SelectionArrangeAction, options: SelectionArrangementOptions<T> = {}): SelectionArrangementResult<T> {
  if ((action === 'distribute-horizontal' || action === 'distribute-vertical') && nodes.filter((node) => node.selected).length < 3) {
    return { nodes, changed: false, error: distributionSelectionReason }
  }
  const prepared = selection(nodes, options)
  if (prepared.error !== undefined) return { nodes, changed: false, error: prepared.error }
  const selected = prepared.selected
  const positions = new Map<string, { x: number; y: number }>()
  if (action === 'distribute-horizontal' || action === 'distribute-vertical') {
    const axis = action === 'distribute-horizontal' ? 'x' : 'y'
    const result = distribution(selected, axis)
    if (result.error !== undefined) return { nodes, changed: false, error: result.error }
    let cursor = result.ordered[0].node.position[axis]
    for (let index = 1; index < result.ordered.length - 1; index += 1) {
      cursor += result.ordered[index - 1][result.sizeKey] + result.gap
      const node = result.ordered[index].node
      positions.set(node.id, { ...node.position, [axis]: cursor })
    }
  } else {
    const left = Math.min(...selected.map(({ node }) => node.position.x))
    const right = Math.max(...selected.map(({ node, width }) => node.position.x + width))
    const top = Math.min(...selected.map(({ node }) => node.position.y))
    const bottom = Math.max(...selected.map(({ node, height }) => node.position.y + height))
    for (const { node, width, height } of selected) {
      const position = { ...node.position }
      switch (action) {
        case 'align-left': position.x = left; break
        case 'align-center': position.x = (left + right - width) / 2; break
        case 'align-right': position.x = right - width; break
        case 'align-top': position.y = top; break
        case 'align-middle': position.y = (top + bottom - height) / 2; break
        case 'align-bottom': position.y = bottom - height; break
        default: return { nodes, changed: false, error: 'Choose a supported alignment or distribution action.' }
      }
      positions.set(node.id, position)
    }
  }
  if ([...positions.values()].some((position) => !boundedPosition(position))) {
    return { nodes, changed: false, error: 'This arrangement would exceed the canvas coordinate limit. Move the selection closer to the origin.' }
  }
  let changed = false
  const arranged = nodes.map((node) => {
    const position = positions.get(node.id)
    if (!position || (position.x === node.position.x && position.y === node.position.y)) return node
    changed = true
    return { ...node, position }
  })
  return { nodes: changed ? arranged : nodes, changed }
}

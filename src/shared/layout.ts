// Server-side layout for charts created or edited by agents.
//
// - Full layout (ELK "layered", hierarchical so containers wrap their children)
//   when a chart arrives without positions or when relayout is requested.
// - Incremental placement for nodes added later, next to their connections,
//   so a layout the user arranged by hand in the browser stays put.
// - Container fitting and connection-handle selection.
//
// Positions follow React Flow: top-left corners, relative to the parent
// container for nested nodes.

import * as ElkModule from 'elkjs/lib/elk.bundled.js'
import type { ELK, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js'
import {
  NODE_TYPE_INFO,
  estimateNodeSize,
  type ChartEdge,
  type ChartNode,
  type DraftNode,
  type HandlePosition,
  type LayoutDirection,
  type Position,
} from './flowTypes.js'

export const CONTAINER_PADDING = { top: 56, right: 28, bottom: 28, left: 28 } as const
export const CONTAINER_MIN_SIZE = { width: 240, height: 160 } as const

const ROOT_ID = '__flowchart_root__'
const GAP_MAIN = 60 // between consecutive steps along the flow direction
const GAP_CROSS = 50 // between siblings side by side
const OVERLAP_MARGIN = 16

type ElkCtor = new (args?: Record<string, unknown>) => ELK

function elkConstructor(): ElkCtor {
  // elkjs ships CommonJS; depending on the loader the constructor sits at
  // `default` or `default.default`.
  const mod = ElkModule as unknown as { default?: unknown }
  const inner = (mod.default as { default?: unknown } | undefined)?.default
  for (const candidate of [mod.default, inner, mod]) {
    if (typeof candidate === 'function') return candidate as ElkCtor
  }
  throw new Error('elkjs failed to load')
}

let elkInstance: ELK | undefined
function getElk(): ELK {
  if (!elkInstance) elkInstance = new (elkConstructor())()
  return elkInstance
}

export function nodeSize(node: Pick<DraftNode, 'type' | 'label' | 'width' | 'height'>): { width: number; height: number } {
  if (node.type === 'container') {
    const d = NODE_TYPE_INFO.container.defaultSize
    return { width: node.width ?? d.width, height: node.height ?? d.height }
  }
  if (node.width && node.height) return { width: node.width, height: node.height }
  const est = estimateNodeSize(node.type, node.label)
  return { width: node.width ?? est.width, height: node.height ?? est.height }
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const cx = (b: Box) => b.x + b.w / 2
const cy = (b: Box) => b.y + b.h / 2

function overlaps(a: Box, b: Box, margin = OVERLAP_MARGIN): boolean {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y
}

function parentsFirst<T extends { id: string; parentNode?: string }>(nodes: T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const done = new Set<string>()
  const out: T[] = []
  const visit = (n: T, stack: Set<string>) => {
    if (done.has(n.id) || stack.has(n.id)) return
    stack.add(n.id)
    const parent = n.parentNode ? byId.get(n.parentNode) : undefined
    if (parent) visit(parent, stack)
    stack.delete(n.id)
    if (!done.has(n.id)) {
      done.add(n.id)
      out.push(n)
    }
  }
  nodes.forEach((n) => visit(n, new Set()))
  return out
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

function isAncestor(ancestorId: string, nodeId: string, byId: Map<string, DraftNode>): boolean {
  const seen = new Set<string>()
  let current = byId.get(nodeId)?.parentNode
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = byId.get(current)?.parentNode
  }
  return false
}

// ---------------------------------------------------------------------------
// Full layout (ELK)
// ---------------------------------------------------------------------------

/** Above these sizes ELK uses cheaper crossing minimization (see elkOptions). */
const LARGE_LAYOUT_NODES = 150
const LARGE_LAYOUT_EDGES = 300

function elkOptions(direction: LayoutDirection, nodeCount = 0, edgeCount = 0): LayoutOptions {
  // Chosen by comparing option sets on typical flowcharts: DEPTH_FIRST cycle
  // breaking keeps retry loops from flipping the chart upside down, and
  // favorStraightEdges keeps the happy path in one column. Model-order options
  // are avoided because they crash ELK on hierarchical (container) graphs.
  const options: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': direction === 'LR' ? 'RIGHT' : 'DOWN',
    'elk.spacing.nodeNode': String(GAP_CROSS + 10),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(GAP_MAIN),
    'elk.spacing.edgeNode': '24',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.spacing.componentComponent': '90',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.favorStraightEdges': 'true',
    'elk.separateConnectedComponents': 'true',
    'elk.randomSeed': '7',
  }
  // ELK runs on the request thread and its cost grows quickly with size
  // (seconds for hundreds of densely connected nodes). Big graphs get cheaper
  // crossing minimization, which is 2-3x faster.
  if (nodeCount > LARGE_LAYOUT_NODES || edgeCount > LARGE_LAYOUT_EDGES) {
    options['elk.layered.thoroughness'] = '1'
    options['elk.layered.crossingMinimization.greedySwitch.type'] = 'OFF'
  }
  return options
}

export async function layoutWithElk(
  nodes: DraftNode[],
  edges: ReadonlyArray<Pick<ChartEdge, 'source' | 'target'>>,
  direction: LayoutDirection = 'TB',
): Promise<ChartNode[]> {
  if (nodes.length === 0) return []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const childrenOf = new Map<string, DraftNode[]>()
  for (const node of nodes) {
    const key = node.parentNode && byId.has(node.parentNode) ? node.parentNode : ROOT_ID
    const list = childrenOf.get(key) ?? []
    list.push(node)
    childrenOf.set(key, list)
  }

  const options = elkOptions(direction, nodes.length, edges.length)
  const visited = new Set<string>()
  const toElk = (node: DraftNode): ElkNode => {
    visited.add(node.id)
    const kids = (childrenOf.get(node.id) ?? []).filter((k) => !visited.has(k.id))
    if (node.type === 'container' && kids.length > 0) {
      const p = CONTAINER_PADDING
      return {
        id: node.id,
        layoutOptions: {
          ...options,
          'elk.padding': `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`,
        },
        children: kids.map(toElk),
      }
    }
    const size = nodeSize(node)
    return { id: node.id, width: size.width, height: size.height }
  }

  const layoutEdges = edges
    .filter(
      (e) =>
        e.source !== e.target &&
        byId.has(e.source) &&
        byId.has(e.target) &&
        !isAncestor(e.source, e.target, byId) &&
        !isAncestor(e.target, e.source, byId),
    )
    .map((e, i) => ({ id: `layout-edge-${i}`, sources: [e.source], targets: [e.target] }))

  const graph: ElkNode = {
    id: ROOT_ID,
    layoutOptions: { ...options, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' },
    children: (childrenOf.get(ROOT_ID) ?? []).map(toElk),
    edges: layoutEdges,
  }

  const result = await getElk().layout(graph)

  const placed = new Map<string, ChartNode>()
  const visit = (elkNode: ElkNode) => {
    for (const child of elkNode.children ?? []) {
      const source = byId.get(child.id)
      if (!source) continue
      const node: ChartNode = {
        ...source,
        position: { x: Math.round(child.x ?? 0), y: Math.round(child.y ?? 0) },
      }
      if (source.type === 'container') {
        const hasKids = (child.children?.length ?? 0) > 0
        const fallback = nodeSize(source)
        node.width = Math.max(CONTAINER_MIN_SIZE.width, Math.round(hasKids ? child.width ?? fallback.width : fallback.width))
        node.height = Math.max(CONTAINER_MIN_SIZE.height, Math.round(hasKids ? child.height ?? fallback.height : fallback.height))
      } else {
        const size = nodeSize(source)
        node.width = size.width
        node.height = size.height
      }
      placed.set(child.id, node)
      visit(child)
    }
  }
  visit(result)

  return nodes.map((n) => placed.get(n.id) ?? { ...n, position: n.position ?? { x: 0, y: 0 } })
}

// ---------------------------------------------------------------------------
// Incremental placement
// ---------------------------------------------------------------------------

/**
 * Give every node without a position a spot next to its connections (below
 * its predecessor in TB, to its right in LR), avoiding overlaps with siblings.
 */
export function placeNodes(
  nodesIn: DraftNode[],
  edges: ReadonlyArray<Pick<ChartEdge, 'source' | 'target'>>,
  direction: LayoutDirection = 'TB',
): DraftNode[] {
  const nodes: DraftNode[] = nodesIn.map((n) => ({ ...n, position: n.position ? { ...n.position } : undefined }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const todo = parentsFirst(nodes.filter((n) => !n.position))
  const horizontal = direction === 'LR'

  const boxOf = (n: DraftNode): Box => {
    const abs = absolutePosition(n, byId)
    const size = nodeSize(n)
    return { x: abs.x, y: abs.y, w: size.width, h: size.height }
  }

  for (const node of todo) {
    const size = nodeSize(node)
    if (node.type !== 'container') {
      node.width = size.width
      node.height = size.height
    }
    const parent = node.parentNode ? byId.get(node.parentNode) : undefined
    const parentAbs = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 }
    const siblings = nodes.filter(
      (n) => n !== node && n.position && (n.parentNode ?? null) === (node.parentNode ?? null),
    )
    const obstacles = siblings.map(boxOf)

    const positionedNeighbor = (ids: string[]) =>
      ids.map((id) => byId.get(id)).find((n): n is DraftNode => !!n && !!n.position && n.id !== node.id)
    const pred = positionedNeighbor(edges.filter((e) => e.target === node.id).map((e) => e.source))
    const succ = positionedNeighbor(edges.filter((e) => e.source === node.id).map((e) => e.target))

    let base: Position
    if (pred) {
      const p = boxOf(pred)
      base = horizontal
        ? { x: p.x + p.w + GAP_MAIN, y: cy(p) - size.height / 2 }
        : { x: cx(p) - size.width / 2, y: p.y + p.h + GAP_MAIN }
    } else if (succ) {
      const s = boxOf(succ)
      base = horizontal
        ? { x: s.x - GAP_MAIN - size.width, y: cy(s) - size.height / 2 }
        : { x: cx(s) - size.width / 2, y: s.y - GAP_MAIN - size.height }
    } else if (obstacles.length) {
      const minX = Math.min(...obstacles.map((b) => b.x))
      const minY = Math.min(...obstacles.map((b) => b.y))
      const maxX = Math.max(...obstacles.map((b) => b.x + b.w))
      const maxY = Math.max(...obstacles.map((b) => b.y + b.h))
      base = horizontal ? { x: maxX + GAP_MAIN, y: minY } : { x: minX, y: maxY + GAP_MAIN }
    } else if (parent) {
      base = { x: parentAbs.x + CONTAINER_PADDING.left, y: parentAbs.y + CONTAINER_PADDING.top }
    } else {
      base = { x: 0, y: 0 }
    }

    const minX = parent ? parentAbs.x + CONTAINER_PADDING.left : -Infinity
    const minY = parent ? parentAbs.y + CONTAINER_PADDING.top : -Infinity
    const crossStep = (horizontal ? size.height : size.width) + GAP_CROSS
    const mainStep = (horizontal ? size.width : size.height) + GAP_MAIN
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, 7, 8]

    // Collect a few nearby free spots, then pick the one whose new edges cross
    // the fewest existing edges (e.g. inserting a step between two others).
    const free: Position[] = []
    for (let row = 0; row < 30 && free.length < 6; row++) {
      for (const k of offsets) {
        const candidate = horizontal
          ? { x: base.x + row * mainStep, y: base.y + k * crossStep }
          : { x: base.x + k * crossStep, y: base.y + row * mainStep }
        candidate.x = Math.max(candidate.x, minX)
        candidate.y = Math.max(candidate.y, minY)
        const box = { x: candidate.x, y: candidate.y, w: size.width, h: size.height }
        if (!obstacles.some((o) => overlaps(box, o))) {
          free.push(candidate)
          if (free.length >= 6) break
        }
      }
      if (free.length > 0 && row >= 1) break
    }

    const centerOf = (n: DraftNode) => {
      const b = boxOf(n)
      return { x: cx(b), y: cy(b) }
    }
    const positioned = (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter((n): n is DraftNode => !!n && !!n.position && n.id !== node.id)
    const predCenters = positioned(edges.filter((e) => e.target === node.id).map((e) => e.source)).map(centerOf)
    const succCenters = positioned(edges.filter((e) => e.source === node.id).map((e) => e.target)).map(centerOf)
    const neighborCenters = [...predCenters, ...succCenters]
    const existingSegments = edges
      .filter((e) => e.source !== node.id && e.target !== node.id)
      .map((e) => [byId.get(e.source), byId.get(e.target)] as const)
      .filter((pair): pair is readonly [DraftNode, DraftNode] => !!pair[0]?.position && !!pair[1]?.position)
      .map(([a, b]) => [centerOf(a), centerOf(b)] as const)
    const along = (p: Position) => (horizontal ? p.x : p.y)
    const score = (candidate: Position) => {
      const center = { x: candidate.x + size.width / 2, y: candidate.y + size.height / 2 }
      let crossings = 0
      for (const neighbor of neighborCenters) {
        for (const [p, q] of existingSegments) if (segmentsCross(center, neighbor, p, q)) crossings++
      }
      // Edges should keep flowing forward: predecessors before, successors after.
      const backwards =
        predCenters.filter((p) => along(p) > along(center)).length + succCenters.filter((s) => along(s) < along(center)).length
      return crossings * 10_000 + backwards * 5_000 + Math.hypot(candidate.x - base.x, candidate.y - base.y)
    }
    const chosen = free.length
      ? free.reduce((best, c) => {
          const value = score(c)
          return value < best.value ? { c, value } : best
        }, { c: free[0], value: Infinity }).c
      : { x: base.x, y: base.y + 30 * mainStep }
    node.position = { x: Math.round(chosen.x - parentAbs.x), y: Math.round(chosen.y - parentAbs.y) }
  }
  return nodes
}

/** Proper intersection of segments ab and cd (touching endpoints don't count). */
function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const orient = (p: Position, q: Position, r: Position) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/**
 * Grow containers so they enclose their children with padding. Children that
 * stick out above or left of the header area move the container instead, so
 * nothing jumps on screen. Containers never shrink here.
 */
export function fitContainers(nodesIn: ChartNode[], onlyIds?: Set<string>): ChartNode[] {
  const nodes = nodesIn.map((n) => ({ ...n, position: { ...n.position } }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depth = (n: ChartNode) => {
    let d = 0
    const seen = new Set<string>()
    let p = n.parentNode
    while (p && !seen.has(p)) {
      seen.add(p)
      d += 1
      p = byId.get(p)?.parentNode
    }
    return d
  }
  const containers = nodes
    .filter((n) => n.type === 'container' && (!onlyIds || onlyIds.has(n.id)))
    .sort((a, b) => depth(b) - depth(a))

  for (const container of containers) {
    const kids = nodes.filter((n) => n.parentNode === container.id)
    const current = nodeSize(container)
    if (kids.length === 0) {
      container.width = container.width ?? current.width
      container.height = container.height ?? current.height
      continue
    }
    const boxes = kids.map((k) => ({ node: k, size: nodeSize(k) }))
    const minX = Math.min(...boxes.map((b) => b.node.position.x))
    const minY = Math.min(...boxes.map((b) => b.node.position.y))
    const dx = minX < CONTAINER_PADDING.left ? CONTAINER_PADDING.left - minX : 0
    const dy = minY < CONTAINER_PADDING.top ? CONTAINER_PADDING.top - minY : 0
    if (dx || dy) {
      container.position.x -= dx
      container.position.y -= dy
      for (const k of kids) {
        k.position.x += dx
        k.position.y += dy
      }
    }
    const maxX = Math.max(...boxes.map((b) => b.node.position.x + b.size.width))
    const maxY = Math.max(...boxes.map((b) => b.node.position.y + b.size.height))
    container.width = Math.round(Math.max(current.width, maxX + CONTAINER_PADDING.right, CONTAINER_MIN_SIZE.width))
    container.height = Math.round(Math.max(current.height, maxY + CONTAINER_PADDING.bottom, CONTAINER_MIN_SIZE.height))
  }
  return nodes
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/**
 * Pick the sides edges attach to, from node geometry. Mirrors hand-drawn
 * flowcharts: forward edges leave the bottom and enter the top (TB), decision
 * branches leave the left/right corners, loops go around the side.
 */
export function assignHandles(
  nodes: ChartNode[],
  edges: ChartEdge[],
  direction: LayoutDirection = 'TB',
  overwrite = false,
): ChartEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n as DraftNode]))
  const boxes = new Map<string, Box>()
  for (const n of nodes) {
    const abs = absolutePosition(n, byId)
    const size = nodeSize(n)
    boxes.set(n.id, { x: abs.x, y: abs.y, w: size.width, h: size.height })
  }
  const horizontal = direction === 'LR'
  const THRESHOLD = 30

  // Decision fan-out: outermost branches use the side corners of the diamond.
  const branchHandle = new Map<string, HandlePosition>()
  const branchSides = new Map<string, Set<HandlePosition>>()
  for (const node of nodes) {
    if (node.type !== 'decision') continue
    const src = boxes.get(node.id)!
    const outgoing = edges
      .filter((e) => e.source === node.id && e.target !== node.id && boxes.has(e.target))
      .map((e) => ({ edge: e, box: boxes.get(e.target)! }))
      .filter(({ box }) => (horizontal ? cx(box) - cx(src) > THRESHOLD : cy(box) - cy(src) > THRESHOLD))
    if (outgoing.length < 2) continue
    const across = (b: Box) => (horizontal ? cy(b) - cy(src) : cx(b) - cx(src))
    outgoing.sort((a, b) => across(a.box) - across(b.box))
    const first = outgoing[0]
    const last = outgoing[outgoing.length - 1]
    const sides = new Set<HandlePosition>()
    if (across(first.box) < -THRESHOLD) {
      branchHandle.set(first.edge.id, horizontal ? 'top' : 'left')
      sides.add(horizontal ? 'top' : 'left')
    }
    if (across(last.box) > THRESHOLD) {
      branchHandle.set(last.edge.id, horizontal ? 'bottom' : 'right')
      sides.add(horizontal ? 'bottom' : 'right')
    }
    branchSides.set(node.id, sides)
  }

  return edges.map((edge) => {
    if (!overwrite && edge.sourceHandle && edge.targetHandle) return edge
    const s = boxes.get(edge.source)
    const t = boxes.get(edge.target)
    if (!s || !t) return edge
    let sourceHandle: HandlePosition
    let targetHandle: HandlePosition
    const dx = cx(t) - cx(s)
    const dy = cy(t) - cy(s)

    if (edge.source === edge.target) {
      sourceHandle = horizontal ? 'bottom' : 'right'
      targetHandle = horizontal ? 'bottom' : 'right'
    } else if (branchHandle.has(edge.id)) {
      sourceHandle = branchHandle.get(edge.id)!
      targetHandle = horizontal ? 'left' : 'top'
    } else if (!horizontal) {
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dy) < Math.max(s.h, t.h)) {
        sourceHandle = dx > 0 ? 'right' : 'left'
        targetHandle = dx > 0 ? 'left' : 'right'
      } else if (dy >= 0) {
        sourceHandle = 'bottom'
        targetHandle = 'top'
      } else if (Math.abs(dx) < THRESHOLD) {
        sourceHandle = 'right'
        targetHandle = 'right'
      } else {
        sourceHandle = dx > 0 ? 'right' : 'left'
        targetHandle = dx > 0 ? 'left' : 'right'
      }
    } else {
      if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dx) < Math.max(s.w, t.w)) {
        sourceHandle = dy > 0 ? 'bottom' : 'top'
        targetHandle = dy > 0 ? 'top' : 'bottom'
      } else if (dx >= 0) {
        sourceHandle = 'right'
        targetHandle = 'left'
      } else if (Math.abs(dy) < THRESHOLD) {
        sourceHandle = 'bottom'
        targetHandle = 'bottom'
      } else {
        sourceHandle = dy > 0 ? 'bottom' : 'top'
        targetHandle = dy > 0 ? 'top' : 'bottom'
      }
    }

    // Don't enter a decision through the corner one of its branches leaves from:
    // use the free vertex opposite the incoming flow when both side corners are taken.
    const usedSides = branchSides.get(edge.target)
    if (usedSides?.has(targetHandle)) {
      const bothSides = horizontal ? usedSides.has('top') && usedSides.has('bottom') : usedSides.has('left') && usedSides.has('right')
      targetHandle = bothSides ? (horizontal ? 'right' : 'bottom') : horizontal ? 'left' : 'top'
    }

    return {
      ...edge,
      sourceHandle: overwrite || !edge.sourceHandle ? sourceHandle : edge.sourceHandle,
      targetHandle: overwrite || !edge.targetHandle ? targetHandle : edge.targetHandle,
    }
  })
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Guess how an existing chart flows (for edits that don't say): mostly sideways edges -> LR. */
export function inferDirection(
  nodes: DraftNode[],
  edges: ReadonlyArray<Pick<ChartEdge, 'source' | 'target'>>,
): LayoutDirection {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let horizontal = 0
  let vertical = 0
  for (const edge of edges) {
    const s = byId.get(edge.source)
    const t = byId.get(edge.target)
    if (!s?.position || !t?.position || s === t) continue
    const a = absolutePosition(s, byId)
    const b = absolutePosition(t, byId)
    const sa = nodeSize(s)
    const sb = nodeSize(t)
    horizontal += Math.abs(b.x + sb.width / 2 - (a.x + sa.width / 2))
    vertical += Math.abs(b.y + sb.height / 2 - (a.y + sa.height / 2))
  }
  return horizontal > vertical * 1.3 ? 'LR' : 'TB'
}

export interface ArrangeOptions {
  direction?: LayoutDirection
  /** Re-run the full layout even if nodes already have positions. */
  relayout?: boolean
}

export interface ArrangeResult {
  nodes: ChartNode[]
  edges: ChartEdge[]
  layout: 'full' | 'incremental' | 'none'
  direction: LayoutDirection
}

/** Which kind of layout arrangeChart will run, and how many nodes lack a position. */
export function planLayout(
  nodes: ReadonlyArray<Pick<DraftNode, 'position'>>,
  options: Pick<ArrangeOptions, 'relayout'> = {},
): { layout: ArrangeResult['layout']; missing: number } {
  const missing = nodes.filter((n) => !n.position).length
  if (nodes.length > 0 && (options.relayout || missing === nodes.length)) return { layout: 'full', missing }
  return { layout: missing > 0 ? 'incremental' : 'none', missing }
}

/**
 * Rough CPU cost of arranging a chart, in units of about 25 ms; small charts
 * cost 1. Full layouts grow roughly quadratically with size (measured with
 * ELK: ~5 units at 100 nodes, ~30 at 200, ~180 at 500 nodes and 1,000 edges).
 * Used to weight rate limits so huge layouts can't monopolize CPU.
 */
export function layoutWorkUnits(
  plan: { layout: ArrangeResult['layout']; missing: number },
  nodeCount: number,
  edgeCount: number,
): number {
  if (plan.layout === 'full') return Math.max(1, Math.ceil(((nodeCount + edgeCount / 2) / 75) ** 2))
  if (plan.layout === 'incremental') return Math.max(1, Math.ceil((plan.missing * nodeCount) / 5000))
  return 1
}

/**
 * Fill in whatever the chart is missing:
 * - no positions at all (or relayout) -> full ELK layout
 * - some positions missing -> incremental placement of just those nodes
 * - all positions present -> left alone
 * Then fit containers the server touched and choose missing edge handles.
 */
export async function arrangeChart(
  nodesIn: DraftNode[],
  edgesIn: ChartEdge[],
  options: ArrangeOptions = {},
): Promise<ArrangeResult> {
  const missing = nodesIn.filter((n) => !n.position)
  const direction =
    options.direction ?? (missing.length === nodesIn.length ? 'TB' : inferDirection(nodesIn, edgesIn))
  const plan = planLayout(nodesIn, options)

  let nodes: ChartNode[]
  const layout = plan.layout
  if (layout === 'full') {
    nodes = await layoutWithElk(nodesIn, edgesIn, direction)
  } else if (layout === 'incremental') {
    const placed = placeNodes(nodesIn, edgesIn, direction) as ChartNode[]
    // Fit every container that holds a newly placed node (and their ancestors).
    const byId = new Map(placed.map((n) => [n.id, n]))
    const touched = new Set<string>()
    for (const n of missing) {
      let p = byId.get(n.id)?.parentNode
      while (p && !touched.has(p)) {
        touched.add(p)
        p = byId.get(p)?.parentNode
      }
      if (n.type === 'container') touched.add(n.id)
    }
    nodes = fitContainers(placed, touched)
  } else {
    nodes = nodesIn as ChartNode[]
  }

  // Containers without an explicit size always get one.
  const unsized = new Set(nodes.filter((n) => n.type === 'container' && (!n.width || !n.height)).map((n) => n.id))
  if (unsized.size) nodes = fitContainers(nodes, unsized)

  // React Flow needs parents before children; storing that order keeps the
  // browser's round-trip of the document stable.
  nodes = parentsFirst(nodes)

  // Handles on edges touching nodes the server just placed were guesses (the
  // caller could not know where those nodes would go), so derive them from the layout.
  const placedNow = new Set(layout === 'incremental' ? missing.map((n) => n.id) : [])
  const edgesToAssign = placedNow.size
    ? edgesIn.map((e) =>
        placedNow.has(e.source) || placedNow.has(e.target) ? { ...e, sourceHandle: undefined, targetHandle: undefined } : e,
      )
    : edgesIn

  const edges = assignHandles(nodes, edgesToAssign, direction, layout === 'full' && !!options.relayout).map((e) => {
    // Keep stored edges free of explicit undefined keys.
    const out = { ...e }
    if (out.sourceHandle === undefined) delete out.sourceHandle
    if (out.targetHandle === undefined) delete out.targetHandle
    return out
  })
  return { nodes, edges, layout, direction }
}

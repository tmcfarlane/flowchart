import { getWorldPoints, positionBoundText, type Bounds, type DrawElement, type Point } from '../utils/drawScene.js'

export interface Obstacle extends Bounds { id: string }
export interface RouteBudget { remaining: number }
export class GeometryBudgetError extends Error {}
export const ROUTE_CLEARANCE = 12
const EPSILON = 0.00001
const MARKER_LEAD = 34
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export const inflate = (box: Bounds, amount: number): Bounds => ({ x: box.x - amount, y: box.y - amount, width: box.width + amount * 2, height: box.height + amount * 2 })
export const boxesOverlap = (a: Bounds, b: Bounds): boolean => a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON && a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON

export function segmentHitsBox(a: Point, b: Point, box: Bounds): boolean {
  let start = 0, end = 1
  for (const [origin, delta, low, high] of [[a.x, b.x - a.x, box.x + EPSILON, box.x + box.width - EPSILON], [a.y, b.y - a.y, box.y + EPSILON, box.y + box.height - EPSILON]]) {
    if (Math.abs(delta) < EPSILON) {
      if (origin < low || origin > high) return false
    } else {
      const first = (low - origin) / delta, last = (high - origin) / delta
      start = Math.max(start, Math.min(first, last))
      end = Math.min(end, Math.max(first, last))
      if (start > end) return false
    }
  }
  return true
}

export function contourValue(shape: DrawElement, point: Point): number {
  const x = Math.abs((point.x - shape.x - shape.width / 2) / (shape.width / 2))
  const y = Math.abs((point.y - shape.y - shape.height / 2) / (shape.height / 2))
  return shape.type === 'ellipse' ? x * x + y * y : shape.type === 'diamond' ? x + y : Math.max(x, y)
}

function outward(shape: DrawElement, port: Point, next: Point): boolean {
  const dx = (port.x - shape.x - shape.width / 2) / (shape.width / 2), dy = (port.y - shape.y - shape.height / 2) / (shape.height / 2)
  const vx = (next.x - port.x) / (shape.width / 2), vy = (next.y - port.y) / (shape.height / 2)
  if (shape.type === 'ellipse') return dx * vx + dy * vy > EPSILON
  if (shape.type === 'diamond') return Math.sign(dx) * vx + Math.sign(dy) * vy > EPSILON
  return (Math.abs(dx) > 1 - EPSILON && dx * vx > EPSILON) || (Math.abs(dy) > 1 - EPSILON && dy * vy > EPSILON)
}

export function pathIsClear(points: Point[], obstacles: Obstacle[], source?: DrawElement, target?: DrawElement, budget?: RouteBudget): boolean {
  if (points.length < 2 || points.length > 32) return false
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x, ay = points[i].y - points[i - 1].y
    const bx = points[i + 1].x - points[i].x, by = points[i + 1].y - points[i].y
    if (Math.abs(ax * by - ay * bx) < EPSILON && ax * bx + ay * by < 0) return false
  }
  if (source && (!outward(source, points[0], points[1]) || Math.abs(contourValue(source, points[0]) - 1) > 0.001)) return false
  if (target && (!outward(target, points[points.length - 1], points[points.length - 2]) || Math.abs(contourValue(target, points[points.length - 1]) - 1) > 0.001)) return false
  for (let i = 1; i < points.length; i++) {
    for (const obstacle of obstacles) {
      if (budget && --budget.remaining < 0) throw new GeometryBudgetError('Routing exceeded its intersection budget.')
      if ((i === 1 && obstacle.id === source?.id) || (i === points.length - 1 && obstacle.id === target?.id)) continue
      if (segmentHitsBox(points[i - 1], points[i], inflate(obstacle, ROUTE_CLEARANCE))) return false
    }
  }
  return true
}

export function markerIsClear(points: Point[], path: DrawElement, obstacles: Obstacle[], target?: DrawElement, caption?: DrawElement): boolean {
  if (path.type !== 'arrow' || path.endArrowhead === null) return true
  const tip = points[points.length - 1], previous = points[points.length - 2], length = distance(tip, previous)
  const stroke = path.strokeWidth ?? 2, scale = Math.max(1, (32 + stroke * 5) / 48), size = Math.max(16, stroke * 4) * scale
  if (length < Math.max(MARKER_LEAD, size + stroke * scale + 16) - EPSILON) return false
  const ux = (tip.x - previous.x) / length, uy = (tip.y - previous.y) / length
  const wings = [-1, 1].map(side => ({ x: tip.x - size * ux - side * size / 2 * uy, y: tip.y - size * uy + side * size / 2 * ux }))
  const left = Math.min(tip.x, ...wings.map(point => point.x)), top = Math.min(tip.y, ...wings.map(point => point.y))
  const bounds = inflate({ x: left, y: top, width: Math.max(tip.x, ...wings.map(point => point.x)) - left, height: Math.max(tip.y, ...wings.map(point => point.y)) - top }, stroke * scale / 2 + 2)
  if (obstacles.some(obstacle => obstacle.id !== target?.id && boxesOverlap(bounds, obstacle))) return false
  if (caption) {
    const placed = positionBoundText(caption, { ...path, x: 0, y: 0, angle: 0, points: points.map(point => [point.x, point.y]) })
    if (boxesOverlap(bounds, inflate(placed, 6))) return false
  }
  return true
}

export function captionFits(points: Point[], caption: DrawElement | undefined, obstacles: Obstacle[], type = 'arrow'): boolean {
  if (!caption) return true
  const lengths = points.slice(1).map((point, index) => distance(points[index], point))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2
  const boundsCenter = { x: (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2, y: (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2 }
  for (let i = 0; i < lengths.length; i++) {
    if (type === 'line') {
      if (Math.abs(distance(points[i], boundsCenter) + distance(boundsCenter, points[i + 1]) - lengths[i]) > EPSILON) continue
      remaining = distance(points[i], boundsCenter)
    } else if (remaining > lengths[i]) { remaining -= lengths[i]; continue }
    const ratio = lengths[i] ? remaining / lengths[i] : 0
    const center = { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio }
    const shaft = (Math.abs(points[i + 1].x - points[i].x) * (caption.width + 12) + Math.abs(points[i + 1].y - points[i].y) * (caption.height + 12)) / Math.max(lengths[i], 1) / 2 + 12
    if (remaining < shaft || lengths[i] - remaining < shaft) return false
    const box = inflate({ x: center.x - caption.width / 2, y: center.y - caption.height / 2, width: caption.width, height: caption.height }, 6)
    return !obstacles.some(obstacle => boxesOverlap(box, inflate(obstacle, 2)))
  }
  return false
}

interface Port { point: Point; lead: Point }
function ports(shape: DrawElement | undefined, endpoint: Point, toward: Point): Port[] {
  if (!shape) return [
    { point: endpoint, lead: { x: endpoint.x + MARKER_LEAD, y: endpoint.y } },
    { point: endpoint, lead: { x: endpoint.x - MARKER_LEAD, y: endpoint.y } },
    { point: endpoint, lead: { x: endpoint.x, y: endpoint.y + MARKER_LEAD } },
    { point: endpoint, lead: { x: endpoint.x, y: endpoint.y - MARKER_LEAD } },
  ].sort((a, b) => distance(a.lead, toward) - distance(b.lead, toward))
  const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2
  return [
    { point: { x: shape.x + shape.width, y: cy }, lead: { x: shape.x + shape.width + MARKER_LEAD, y: cy } },
    { point: { x: shape.x, y: cy }, lead: { x: shape.x - MARKER_LEAD, y: cy } },
    { point: { x: cx, y: shape.y + shape.height }, lead: { x: cx, y: shape.y + shape.height + MARKER_LEAD } },
    { point: { x: cx, y: shape.y }, lead: { x: cx, y: shape.y - MARKER_LEAD } },
  ].sort((a, b) => distance(a.point, toward) - distance(b.point, toward))
}

function projectedPort(shape: DrawElement, endpoint: Point, adjacent: Point): Point {
  const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2
  if (Math.abs(endpoint.y - adjacent.y) < EPSILON && endpoint.y > shape.y && endpoint.y < shape.y + shape.height) {
    const offset = (endpoint.y - cy) / (shape.height / 2)
    const reach = shape.type === 'ellipse' ? Math.sqrt(1 - offset * offset) : shape.type === 'diamond' ? 1 - Math.abs(offset) : 1
    return { x: cx + (adjacent.x >= cx ? 1 : -1) * shape.width / 2 * reach, y: endpoint.y }
  }
  if (Math.abs(endpoint.x - adjacent.x) < EPSILON && endpoint.x > shape.x && endpoint.x < shape.x + shape.width) {
    const offset = (endpoint.x - cx) / (shape.width / 2)
    const reach = shape.type === 'ellipse' ? Math.sqrt(1 - offset * offset) : shape.type === 'diamond' ? 1 - Math.abs(offset) : 1
    return { x: endpoint.x, y: cy + (adjacent.y >= cy ? 1 : -1) * shape.height / 2 * reach }
  }
  let dx = adjacent.x - cx, dy = adjacent.y - cy
  if (Math.abs(dx) + Math.abs(dy) < EPSILON) dx = 1
  const scale = shape.type === 'ellipse' ? 1 / Math.sqrt((dx / (shape.width / 2)) ** 2 + (dy / (shape.height / 2)) ** 2)
    : shape.type === 'diamond' ? 1 / (Math.abs(dx) / (shape.width / 2) + Math.abs(dy) / (shape.height / 2))
      : Math.min(dx ? shape.width / 2 / Math.abs(dx) : Infinity, dy ? shape.height / 2 / Math.abs(dy) : Infinity)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function simplify(points: Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    if (result.length && distance(result[result.length - 1], point) < EPSILON) continue
    while (result.length >= 2) {
      const a = result[result.length - 2], b = result[result.length - 1]
      if (Math.abs((b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x)) > EPSILON || (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) < 0) break
      result.pop()
    }
    result.push(point)
  }
  return result
}

class MinHeap {
  private entries: Array<{ state: number; cost: number }> = []
  push(entry: { state: number; cost: number }) {
    let index = this.entries.length
    this.entries.push(entry)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.entries[parent].cost <= entry.cost) break
      this.entries[index] = this.entries[parent]
      index = parent
    }
    this.entries[index] = entry
  }
  pop(): { state: number; cost: number } | undefined {
    const first = this.entries[0], last = this.entries.pop()
    if (!this.entries.length || !last) return first
    let index = 0
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1
      if (child + 1 < this.entries.length && this.entries[child + 1].cost < this.entries[child].cost) child++
      if (this.entries[child].cost >= last.cost) break
      this.entries[index] = this.entries[child]
      index = child
    }
    this.entries[index] = last
    return first
  }
}

function visibilityRoute(start: Point, end: Point, obstacles: Obstacle[], budget: RouteBudget): Point[] | null {
  const blocked = obstacles.map(obstacle => inflate(obstacle, ROUTE_CLEARANCE))
  const xs = [...new Set([start.x, end.x, ...blocked.flatMap(box => [box.x - 1, box.x + box.width + 1])])].sort((a, b) => a - b)
  const ys = [...new Set([start.y, end.y, ...blocked.flatMap(box => [box.y - 1, box.y + box.height + 1])])].sort((a, b) => a - b)
  const count = xs.length * ys.length
  if (count > 32768) throw new GeometryBudgetError('Routing exceeded 32768 visibility vertices.')
  const node = (x: number, y: number) => y * xs.length + x
  const point = (index: number) => ({ x: xs[index % xs.length], y: ys[Math.floor(index / xs.length)] })
  const first = node(xs.indexOf(start.x), ys.indexOf(start.y)), goal = node(xs.indexOf(end.x), ys.indexOf(end.y))
  const costs = new Float64Array(count * 3).fill(Infinity), previous = new Int32Array(count * 3).fill(-1)
  const heap = new MinHeap(), edges = new Map<string, boolean>()
  costs[first * 3] = 0
  heap.push({ state: first * 3, cost: 0 })
  let current: ReturnType<MinHeap['pop']>
  while ((current = heap.pop())) {
    if (--budget.remaining < 0) throw new GeometryBudgetError('Routing exceeded its search budget.')
    const state = current.state, index = Math.floor(state / 3), direction = state % 3
    if (current.cost !== costs[state]) continue
    if (index === goal) {
      const result: Point[] = []
      for (let step = state; step !== -1; step = previous[step]) result.push(point(Math.floor(step / 3)))
      return simplify(result.reverse())
    }
    const x = index % xs.length, y = Math.floor(index / xs.length)
    for (const [nx, ny, axis] of [[x - 1, y, 1], [x + 1, y, 1], [x, y - 1, 2], [x, y + 1, 2]]) {
      if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue
      const next = node(nx, ny), key = `${Math.min(index, next)}:${Math.max(index, next)}`
      let clear = edges.get(key)
      if (clear === undefined) {
        const a = point(index), b = point(next)
        clear = !blocked.some(box => {
          if (--budget.remaining < 0) throw new GeometryBudgetError('Routing exceeded its intersection budget.')
          return segmentHitsBox(a, b, box)
        })
        edges.set(key, clear)
      }
      if (!clear) continue
      const nextState = next * 3 + axis, cost = costs[state] + distance(point(index), point(next)) + (direction && direction !== axis ? 24 : 0)
      if (cost >= costs[nextState]) continue
      costs[nextState] = cost
      previous[nextState] = state
      heap.push({ state: nextState, cost })
    }
  }
  return null
}

export function routeConnector(path: DrawElement, source: DrawElement | undefined, target: DrawElement | undefined, caption: DrawElement | undefined, obstacles: Obstacle[], budget: RouteBudget): Point[] | null {
  const original = getWorldPoints(path), authored = original.map(point => ({ ...point }))
  if (source) authored[0] = projectedPort(source, authored[0], authored[1])
  if (target) authored[authored.length - 1] = projectedPort(target, authored[authored.length - 1], authored[authored.length - 2])
  if (pathIsClear(authored, obstacles, source, target, budget) && markerIsClear(authored, path, obstacles, target, caption) && captionFits(authored, caption, obstacles, path.type)) return authored
  const starts = ports(source, original[0], original[original.length - 1]), ends = ports(target, original[original.length - 1], original[0])
  for (const start of starts) for (const end of ends) {
    const middle = visibilityRoute(start.lead, end.lead, obstacles, budget)
    if (!middle) continue
    const candidate = simplify([start.point, ...middle, end.point])
    if (pathIsClear(candidate, obstacles, source, target, budget) && markerIsClear(candidate, path, obstacles, target, caption) && captionFits(candidate, caption, obstacles, path.type)) return candidate
    if (!caption) continue
    const left = Math.min(start.lead.x, end.lead.x, ...obstacles.map(box => box.x)) - caption.width / 2 - 24
    const right = Math.max(start.lead.x, end.lead.x, ...obstacles.map(box => box.x + box.width)) + caption.width / 2 + 24
    const top = Math.min(start.lead.y, end.lead.y, ...obstacles.map(box => box.y)) - caption.height / 2 - 24
    const bottom = Math.max(start.lead.y, end.lead.y, ...obstacles.map(box => box.y + box.height)) + caption.height / 2 + 24
    const corridors = [
      [{ x: start.lead.x, y: top }, { x: end.lead.x, y: top }],
      [{ x: start.lead.x, y: bottom }, { x: end.lead.x, y: bottom }],
      [{ x: left, y: start.lead.y }, { x: left, y: end.lead.y }],
      [{ x: right, y: start.lead.y }, { x: right, y: end.lead.y }],
    ]
    for (const corridor of corridors) {
      const labelled = simplify([start.point, start.lead, ...corridor, end.lead, end.point])
      if (pathIsClear(labelled, obstacles, source, target, budget) && markerIsClear(labelled, path, obstacles, target, caption) && captionFits(labelled, caption, obstacles, path.type)) return labelled
    }
  }
  return null
}

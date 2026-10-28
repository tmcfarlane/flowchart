import type { ArchitectureScene } from '../shared/architectureScene'
import { createElement, editableSelection, expandSelection, lockedElementIds, getElementBounds, getElementCenter, getSceneBounds, getWorldPoints, newDrawId, rerouteBindings, rotatePoint, sceneElements, type DrawBinding, type DrawElement, type Point } from './drawScene'

export type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
export const directions: Record<Direction, Point> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
}

function keepLocked(before: ArchitectureScene, after: ArchitectureScene): ArchitectureScene {
  const lockedIds = lockedElementIds(before)
  const locked = new Map(sceneElements(before).filter(element => lockedIds.has(element.id)).map(element => [element.id, element]))
  return { ...after, elements: after.elements.map(element => locked.get(String(element.id)) ?? element) }
}

export function flipSelection(scene: ArchitectureScene, ids: Iterable<string>, axis: 'horizontal' | 'vertical'): ArchitectureScene {
  const selected = new Set(editableSelection(scene, ids, true)), locked = lockedElementIds(scene)
  const eligible = sceneElements(scene).filter(element => selected.has(element.id) && !element.locked && !element.isDeleted)
  const eligibleIds = new Set(eligible.map(element => element.id))
  const targets = eligible.filter(element => !element.containerId || eligibleIds.has(element.containerId))
  if (!targets.length) return scene
  const changed = new Set(targets.map(element => element.id)), bounds = getSceneBounds(targets)
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const horizontal = axis === 'horizontal'
  const reflect = (point: Point): Point => ({ x: horizontal ? 2 * center.x - point.x : point.x, y: horizontal ? point.y : 2 * center.y - point.y })
  const binding = (value: DrawBinding | null | undefined): DrawBinding | null | undefined => value && changed.has(value.elementId) ? {
    ...value, ...(value.fixedPoint ? { fixedPoint: [horizontal ? 1 - value.fixedPoint[0] : value.fixedPoint[0], horizontal ? value.fixedPoint[1] : 1 - value.fixedPoint[1]] } : {}),
    ...(typeof value.focus === 'number' ? { focus: -value.focus } : {}),
  } : value
  const elements = sceneElements(scene).map(element => {
    if (locked.has(element.id) || element.isDeleted) return element
    let next = element
    if (changed.has(element.id)) {
      const oldCenter = getElementCenter(element), newCenter = reflect(oldCenter)
      next = { ...element, x: element.x + newCenter.x - oldCenter.x, y: element.y + newCenter.y - oldCenter.y, angle: -(element.angle ?? 0) }
      if (element.points?.length) {
        const points = getWorldPoints(element).map(reflect).map(point => rotatePoint(point, newCenter, -next.angle))
        const first = points[0]
        next = { ...next, x: first.x, y: first.y, points: points.map(point => [point.x - first.x, point.y - first.y]) }
      }
      if (element.type === 'image') {
        const scale = Array.isArray(element.scale) ? element.scale : [1, 1]
        next = { ...next, scale: [Number(scale[0]) * (horizontal ? -1 : 1), Number(scale[1]) * (horizontal ? 1 : -1)] }
      }
    }
    if (element.startBinding || element.endBinding) next = { ...next, startBinding: binding(element.startBinding) ?? null, endBinding: binding(element.endBinding) ?? null }
    return next
  })
  return keepLocked(scene, rerouteBindings({ ...scene, elements }, changed))
}

export function createConnectedShape(scene: ArchitectureScene, ids: Iterable<string>, direction: Direction): { scene: ArchitectureScene; selectedIds: string[] } | null {
  const selected = new Set(ids), elements = sceneElements(scene).filter(element => !element.isDeleted)
  const shapes = elements.filter(element => selected.has(element.id) && !element.containerId)
  if (shapes.length !== 1 || lockedElementIds(scene).has(shapes[0].id) || !['rectangle', 'ellipse', 'diamond'].includes(shapes[0].type)) return null
  const source = shapes[0], vector = directions[direction], bounds = getElementBounds(source)
  const delta = { x: vector.x * (bounds.width + 80), y: vector.y * (bounds.height + 80) }
  const clone: DrawElement = { ...structuredClone(source), id: newDrawId(), x: source.x + delta.x, y: source.y + delta.y, groupIds: [], frameId: null, boundElements: null }
  delete clone.customData
  const labels = elements.filter(element => element.type === 'text' && element.containerId === source.id).map(element => {
    const label = { ...structuredClone(element), id: newDrawId(), x: element.x + delta.x, y: element.y + delta.y, containerId: clone.id, groupIds: [], frameId: null, locked: false, boundElements: null }
    delete label.customData
    return label
  })
  const arrow = createElement('arrow', getElementCenter(source), getElementCenter(clone), {
    strokeColor: source.strokeColor ?? '#1e293b', strokeWidth: source.strokeWidth ?? 2,
    startBinding: { elementId: source.id, focus: 0, gap: 8 }, endBinding: { elementId: clone.id, focus: 0, gap: 8 },
  })
  return { scene: keepLocked(scene, rerouteBindings({ ...scene, elements: [...scene.elements, clone, ...labels, arrow] }, [clone.id, arrow.id])), selectedIds: [clone.id, ...labels.map(label => label.id)] }
}

export function navigateConnection(scene: ArchitectureScene, ids: Iterable<string>, direction: Direction): string[] | null {
  const selected = new Set(ids), elements = sceneElements(scene).filter(element => !element.isDeleted), byId = new Map(elements.map(element => [element.id, element]))
  const sources = elements.filter(element => selected.has(element.id) && !element.containerId), vector = directions[direction]
  const candidates: Array<{ id: string; score: number }> = []
  for (const source of sources) for (const arrow of elements.filter(element => element.type === 'arrow')) {
    const targetId = arrow.startBinding?.elementId === source.id ? arrow.endBinding?.elementId : arrow.endBinding?.elementId === source.id ? arrow.startBinding?.elementId : undefined
    const target = targetId ? byId.get(targetId) : undefined
    if (!target || target.locked || selected.has(target.id)) continue
    const a = getElementCenter(source), b = getElementCenter(target), dx = b.x - a.x, dy = b.y - a.y, forward = dx * vector.x + dy * vector.y
    if (forward > 0) candidates.push({ id: target.id, score: Math.hypot(dx, dy) + 2 * Math.abs(dx * vector.y - dy * vector.x) })
  }
  candidates.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
  return candidates.length ? expandSelection(scene, [candidates[0].id], true).filter(id => !byId.get(id)?.locked) : null
}

function cross(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) }
function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) < 1e-8 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}
function contains(polygon: Point[], point: Point): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i]
    if (onSegment(a, b, point)) return true
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function outline(element: DrawElement): { points: Point[]; closed: boolean } {
  if (['line', 'arrow', 'freedraw'].includes(element.type)) return { points: getWorldPoints(element), closed: false }
  const center = getElementCenter(element), { x, y, width: w, height: h } = element
  const points = element.type === 'ellipse' ? Array.from({ length: 64 }, (_, i) => ({ x: center.x + Math.cos(i * Math.PI / 32) * w / 2, y: center.y + Math.sin(i * Math.PI / 32) * h / 2 }))
    : element.type === 'diamond' ? [{ x: center.x, y }, { x: x + w, y: center.y }, { x: center.x, y: y + h }, { x, y: center.y }]
      : [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  return { points: points.map(point => rotatePoint(point, center, element.angle ?? 0)), closed: true }
}
export function lassoSelection(scene: ArchitectureScene, polygon: Point[], deep = false): string[] {
  if (polygon.length < 3) return []
  const elements = sceneElements(scene).filter(element => !element.isDeleted && !element.locked)
  const hits = elements.filter(element => {
    const { points, closed } = outline(element)
    if (points.some(point => contains(polygon, point)) || (closed && polygon.some(point => contains(points, point)))) return true
    return points.some((point, index) => (closed || index + 1 < points.length) && polygon.some((a, i) => intersects(point, points[(index + 1) % points.length], a, polygon[(i + 1) % polygon.length])))
  })
  const eligible = new Set(elements.map(element => element.id))
  return expandSelection(scene, hits.map(element => element.containerId && !deep ? element.containerId : element.id), deep).filter(id => eligible.has(id))
}

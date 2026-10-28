import type { ArchitectureScene } from './architectureScene.js'
import { drawingFromScene } from './drawDocument.js'
import type { DrawProposal } from './drawGeneration.js'
import { DRAW_LINE_HEIGHT, isGeneratedDrawFont, measureDrawText } from './drawFont.js'
import { getWorldPoints, positionBoundText, rerouteBindings, type Bounds, type DrawElement, type Point } from '../utils/drawScene.js'
import { boxesOverlap, captionFits, contourValue, inflate, markerIsClear, pathIsClear, segmentHitsBox, type Obstacle } from './drawRouting.js'

export interface DrawQualityIssue { code: string; elementIds: string[]; detail: string }
export const isShape = (element: DrawElement): boolean => ['rectangle', 'ellipse', 'diamond'].includes(element.type)
export function occupiedBounds(elements: DrawElement[], omitCaptionFor?: string): Obstacle[] {
  return elements.flatMap(element => {
    if (element.type === 'frame') {
      const size = measureDrawText(String(element.name), 13)
      return [{ id: element.id, x: element.x, y: element.y - 9 - size.height, ...size }]
    }
    if (isShape(element) || (element.type === 'text' && !element.containerId)) return [{ id: element.id, x: element.x, y: element.y, width: element.width, height: element.height }]
    if (element.type === 'text' && element.containerId !== omitCaptionFor && elements.some(host => host.id === element.containerId && ['arrow', 'line'].includes(host.type))) return [{ id: element.id, x: element.x - 6, y: element.y - 6, width: element.width + 12, height: element.height + 12 }]
    return []
  })
}

type Cubic = [Point, Point, Point, Point]

function cubicHitsBox(curve: Cubic, box: Bounds, budget: { remaining: number }, depth = 0): boolean {
  if (--budget.remaining < 0) return true
  const left = Math.min(...curve.map(point => point.x)), right = Math.max(...curve.map(point => point.x))
  const top = Math.min(...curve.map(point => point.y)), bottom = Math.max(...curve.map(point => point.y))
  if (right < box.x || left > box.x + box.width || bottom < box.y || top > box.y + box.height) return false
  if (depth === 16 || (right - left <= 0.25 && bottom - top <= 0.25)) return true
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const [start, first, second, end] = curve
  const a = midpoint(start, first), b = midpoint(first, second), c = midpoint(second, end)
  const d = midpoint(a, b), e = midpoint(b, c), middle = midpoint(d, e)
  return cubicHitsBox([start, a, d, middle], box, budget, depth + 1) || cubicHitsBox([middle, e, c, end], box, budget, depth + 1)
}

function freehandHitsBox(points: Point[], box: Bounds, budget: { remaining: number }): boolean {
  if (points.length === 2) return segmentHitsBox(points[0], points[1], box)
  return points.slice(1).some((end, index) => {
    const start = points[index], previous = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 2)]
    const first = { x: start.x + (end.x - previous.x) / 6, y: start.y + (end.y - previous.y) / 6 }
    const second = { x: end.x - (next.x - start.x) / 6, y: end.y - (next.y - start.y) / 6 }
    return cubicHitsBox([start, first, second, end], box, budget)
  })
}

export function inspectDrawGeometry(scene: ArchitectureScene, plan: DrawProposal): DrawQualityIssue[] {
  const issues: DrawQualityIssue[] = [], freehandBudget = { remaining: 100_000 }
  const add = (code: string, elementIds: string[], detail: string) => { if (issues.length < 20) issues.push({ code, elementIds, detail }) }
  try { drawingFromScene(scene) } catch (error) {
    add('native-document', [], error instanceof Error ? error.message : 'Invalid native document.')
    return issues
  }
  if (scene.elements.length > 200) return [{ code: 'geometry-budget', elementIds: [], detail: 'Generated drawings may contain at most 200 native objects including labels.' }]
  const elements = scene.elements as DrawElement[], byId = new Map(elements.map(element => [element.id, element]))
  const permitted = new Set((plan.overlaps ?? []).map(pair => [pair.firstId, pair.secondId].sort().join(':')))
  const obstacles = occupiedBounds(elements)
  for (let i = 0; i < obstacles.length; i++) for (let j = i + 1; j < obstacles.length; j++) {
    const a = obstacles[i], b = obstacles[j]
    if (!boxesOverlap(inflate(a, 2), inflate(b, 2))) continue
    if (permitted.has([a.id, b.id].sort().join(':')) && isShape(byId.get(a.id)!) && isShape(byId.get(b.id)!)) continue
    add('object-overlap', [a.id, b.id], 'Separate these occupied objects or their labels.')
  }
  for (const element of elements) {
    if (element.angle !== 0) add('unsupported-geometry', [element.id], 'Generated objects must have unrotated, validated geometry.')
    if (['text', 'frame'].includes(element.type) && !isGeneratedDrawFont(element.customData)) add('text-font', [element.id], 'Generated text and frame titles require the canonical font marker.')
    if (element.type === 'text') {
      if (element.fontFamily !== 2 || element.autoResize !== true || element.lineHeight !== DRAW_LINE_HEIGHT) add('text-font', [element.id], 'Generated text requires explicit canonical font and line-height fields.')
      const measured = measureDrawText(element.text ?? '', element.fontSize ?? 18)
      if (element.width + 0.001 < measured.width || element.height + 0.001 < measured.height) add('text-fit', [element.id], 'Text dimensions do not contain the canonical font metrics.')
      const host = element.containerId ? byId.get(element.containerId) : undefined
      if (host && isShape(host)) {
        for (const x of [element.x - 8, element.x + element.width + 8]) for (const y of [element.y - 8, element.y + element.height + 8]) {
          if (contourValue(host, { x, y }) > 1.00001) add('text-fit', [host.id, element.id], 'Fit the padded label inside its shape contour.')
        }
      }
      for (const obstacle of obstacles) {
        if (obstacle.id === element.id || obstacle.id === host?.id) continue
        if (boxesOverlap(element, obstacle)) add('text-overlap', [element.id, obstacle.id], 'Text must remain clear of unrelated objects even when shape overlaps are declared.')
      }
    }
    if (!['arrow', 'line', 'freedraw'].includes(element.type)) continue
    const points = getWorldPoints(element)
    if (points.length > 32 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1_000_000 || Math.abs(point.y) > 1_000_000)) {
      add('geometry-budget', [element.id], 'Paths require at most 32 finite points inside native coordinate limits.')
      continue
    }
    if (element.roundness || element.elbowed || element.routing === 'elbow') add('unsupported-geometry', [element.id], 'Only validated sharp paths may be generated.')
    if (element.type === 'freedraw') {
      const protectedText = [...elements.filter(candidate => candidate.type === 'text'), ...obstacles.filter(obstacle => byId.get(obstacle.id)?.type === 'frame')]
      for (const text of protectedText) {
        const intersects = freehandHitsBox(points, inflate(text, 2 + (element.strokeWidth ?? 2) / 2), freehandBudget)
        if (freehandBudget.remaining < 0) {
          add('geometry-budget', [element.id], 'Freehand curves exceeded the 100000 subdivision check limit.')
          return issues
        }
        if (intersects) add('text-overlap', [element.id, text.id], 'Move the smoothed annotation stroke away from text and frame titles.')
      }
      continue
    }
    const source = element.startBinding ? byId.get(element.startBinding.elementId) : undefined
    const target = element.endBinding ? byId.get(element.endBinding.elementId) : undefined
    for (const binding of [element.startBinding, element.endBinding]) {
      if (binding && (!binding.fixedPoint || binding.gap !== 0 || !isShape(byId.get(binding.elementId)!))) add('endpoint-binding', [element.id, binding.elementId], 'Bound endpoints need final fixed contour anchors.')
    }
    const occupied = occupiedBounds(elements, element.id)
    if (!pathIsClear(points, occupied, source, target)) add('route-blocked', [element.id], 'Route the connector outside unrelated objects and frame titles with outward endpoint leads.')
    const caption = elements.find(candidate => candidate.containerId === element.id && candidate.type === 'text')
    if (!markerIsClear(points, element, occupied, target, caption)) add('marker-blocked', [element.id], 'Reserve a clear terminal shaft of at least 34 units and keep the end marker away from every object except its target.')
    if (!captionFits(points, caption, occupied, element.type)) add('caption-blocked', [element.id, ...(caption ? [caption.id] : [])], 'The native midpoint caption needs a clear straight shaft with room on both sides.')
    if (caption && element.type === 'line') {
      const placed = positionBoundText(caption, element)
      if (Math.abs(placed.x - caption.x) > 0.001 || Math.abs(placed.y - caption.y) > 0.001) add('caption-position', [element.id, caption.id], 'Line captions must retain their native center position.')
    }
  }
  const connectors = elements.filter(element => ['arrow', 'line'].includes(element.type))
  for (let i = 0; i < connectors.length; i++) for (let j = i + 1; j < connectors.length; j++) {
    const first = connectors[i], second = connectors[j], a = getWorldPoints(first), b = getWorldPoints(second)
    const sharedHost = [first.startBinding?.elementId, first.endBinding?.elementId].some(id => id && [second.startBinding?.elementId, second.endBinding?.elementId].includes(id))
    let overlap = false
    for (let ai = 1; ai < a.length; ai++) for (let bi = 1; bi < b.length; bi++) {
      const dx = a[ai].x - a[ai - 1].x, dy = a[ai].y - a[ai - 1].y, length = Math.hypot(dx, dy)
      if (!length) continue
      const cross = (point: { x: number; y: number }) => Math.abs(dx * (point.y - a[ai - 1].y) - dy * (point.x - a[ai - 1].x)) / length
      if (cross(b[bi - 1]) > 2 || cross(b[bi]) > 2) continue
      const projection = (point: { x: number; y: number }) => ((point.x - a[ai - 1].x) * dx + (point.y - a[ai - 1].y) * dy) / length
      const from = projection(b[bi - 1]), to = projection(b[bi])
      if (Math.min(length, Math.max(from, to)) - Math.max(0, Math.min(from, to)) > (sharedHost ? 24 : 4)) overlap = true
    }
    if (overlap) add('connector-overlap', [first.id, second.id], 'Separate shared connector shafts so each connection stays visible.')
  }
  const rerouted = rerouteBindings(scene).elements as DrawElement[]
  for (const element of rerouted) {
    const before = byId.get(element.id)!
    if (Math.abs(before.x - element.x) > 0.001 || Math.abs(before.y - element.y) > 0.001 || (element.points && getWorldPoints(before).some((point, index) => Math.hypot(point.x - getWorldPoints(element)[index].x, point.y - getWorldPoints(element)[index].y) > 0.001))) add('unstable-geometry', [element.id], 'Initial native binding recalculation must preserve the compiled geometry.')
  }
  return issues
}

import type { ArchitectureScene } from '../shared/architectureScene'

/** Flowchart's drawing model. Excalidraw-compatible record fields are retained
 * for file interoperability; rendering and editing do not depend on its editor. */
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export type LocalPoint = [number, number]
export interface DrawBinding extends Record<string, unknown> {
  elementId: string
  focus?: number
  gap?: number
  fixedPoint?: LocalPoint
}
export interface DrawElement extends Record<string, unknown>, Bounds {
  id: string
  type: string
  angle: number
  isDeleted?: boolean
  locked?: boolean
  points?: LocalPoint[]
  pressures?: number[]
  groupIds?: string[]
  frameId?: string | null
  containerId?: string | null
  boundElements?: Array<{ id: string; type: string }> | null
  startBinding?: DrawBinding | null
  endBinding?: DrawBinding | null
  fileId?: string | null
  text?: string
  originalText?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  strokeColor?: string
  backgroundColor?: string
  strokeWidth?: number
  strokeStyle?: string
  fillStyle?: string
  roughness?: number
  opacity?: number
  customData?: Record<string, unknown>
}

let idCounter = 0
export function newDrawId(prefix = 'draw'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++idCounter}`}`
}
export const sceneElements = (scene: ArchitectureScene): DrawElement[] => scene.elements as DrawElement[]
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const isPath = (element: DrawElement) => ['arrow', 'line', 'freedraw'].includes(element.type)
const finite = (number: number) => Number.isFinite(number) ? number : 0

export function createElement(type: string, start: Point, end?: Point, defaults: Partial<DrawElement> = {}): DrawElement {
  const finish = end ?? { x: start.x + (type === 'text' ? 180 : 120), y: start.y + (type === 'text' ? 28 : 80) }
  const path = ['line', 'arrow', 'freedraw'].includes(type)
  const element: DrawElement = {
    id: newDrawId(), type, x: path ? start.x : Math.min(start.x, finish.x), y: path ? start.y : Math.min(start.y, finish.y),
    width: Math.abs(finish.x - start.x), height: Math.abs(finish.y - start.y), angle: 0,
    strokeColor: '#1e293b', backgroundColor: 'transparent', strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid', roughness: 0,
    opacity: 100, groupIds: [], frameId: null, isDeleted: false, locked: false, boundElements: null,
    ...(path ? { points: [[0, 0], [finish.x - start.x, finish.y - start.y]], startBinding: null, endBinding: null } : {}),
    ...(type === 'arrow' ? { startArrowhead: null, endArrowhead: 'arrow' } : {}),
    ...(type === 'freedraw' ? { pressures: [], simulatePressure: true } : {}),
    ...(type === 'text' ? { text: 'Text', originalText: 'Text', fontSize: 20, fontFamily: 2, textAlign: 'left', verticalAlign: 'top', containerId: null } : {}),
    ...(type === 'frame' ? { name: 'Frame' } : {}),
    ...defaults,
  }
  return element
}

export function rotatePoint(point: Point, center: Point, angle: number): Point {
  const x = point.x - center.x, y = point.y - center.y
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

function localBounds(element: DrawElement): Bounds {
  if (isPath(element) && element.points?.length) {
    const xs = element.points.map(point => point[0]), ys = element.points.map(point => point[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x: element.x + x, y: element.y + y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  return { x: element.x, y: element.y, width: element.width, height: element.height }
}
export function getElementCenter(element: DrawElement): Point {
  const bounds = localBounds(element)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}
export function getWorldPoints(element: DrawElement): Point[] {
  const center = getElementCenter(element)
  return (element.points ?? [[0, 0], [element.width, element.height]]).map(([x, y]) => rotatePoint({ x: element.x + x, y: element.y + y }, center, element.angle ?? 0))
}
export function getElementBounds(element: DrawElement): Bounds {
  const bounds = localBounds(element), center = getElementCenter(element)
  const points = isPath(element) && element.points?.length ? getWorldPoints(element) : [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ].map(point => rotatePoint(point, center, element.angle ?? 0))
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y }
}
export function getSceneBounds(elements: readonly Record<string, unknown>[]): Bounds {
  const bounds = (elements as readonly DrawElement[]).filter(element => !element.isDeleted).map(getElementBounds)
  if (!bounds.length) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Math.min(...bounds.map(bound => bound.x)), y = Math.min(...bounds.map(bound => bound.y))
  return { x, y, width: Math.max(...bounds.map(bound => bound.x + bound.width)) - x, height: Math.max(...bounds.map(bound => bound.y + bound.height)) - y }
}

/** Expand a normal selection through visual groups, frames and bound labels.
 * Deep selection skips group expansion, allowing an individual grouped object. */
export function expandSelection(scene: ArchitectureScene, ids: Iterable<string>, deep = false): string[] {
  const selected = new Set(ids), elements = sceneElements(scene).filter(element => !element.isDeleted)
  let changed = true
  while (changed) {
    changed = false
    const groups = new Set(elements.filter(element => selected.has(element.id)).flatMap(element => deep ? [] : element.groupIds ?? []))
    for (const element of elements) {
      const attached = element.containerId && selected.has(element.containerId)
      const framed = element.frameId && selected.has(element.frameId)
      if (!selected.has(element.id) && (attached || framed || element.groupIds?.some(group => groups.has(group)))) {
        selected.add(element.id); changed = true
      }
    }
  }
  return [...selected]
}

export function lockedElementIds(scene: ArchitectureScene): Set<string> {
  return new Set(expandSelection(scene, sceneElements(scene).filter(element => element.locked && !element.isDeleted).map(element => element.id), true))
}

export function editableSelection(scene: ArchitectureScene, ids: Iterable<string>, deep = true): string[] {
  const locked = lockedElementIds(scene)
  return expandSelection(scene, ids, deep).filter(id => !locked.has(id))
}

/** Reconstruct local path coordinates after endpoint edits without discarding
 * its rotation, intermediate points, freehand pressures or unknown fields. */
function withWorldPoints(element: DrawElement, world: Point[]): DrawElement {
  const angle = element.angle ?? 0, origin = { x: 0, y: 0 }
  const unrotated = world.map(point => rotatePoint(point, origin, -angle))
  const xs = unrotated.map(point => point.x), ys = unrotated.map(point => point.y)
  const center = rotatePoint({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, origin, angle)
  const raw = world.map(point => rotatePoint(point, center, -angle)), first = raw[0]
  const points: LocalPoint[] = raw.map(point => [point.x - first.x, point.y - first.y])
  return { ...element, x: first.x, y: first.y, width: Math.max(...raw.map(point => point.x)) - Math.min(...raw.map(point => point.x)), height: Math.max(...raw.map(point => point.y)) - Math.min(...raw.map(point => point.y)), points }
}

function bindingPoint(shape: DrawElement, binding: DrawBinding, adjacent: Point): Point {
  const center = getElementCenter(shape)
  if (binding.fixedPoint?.length === 2) {
    return rotatePoint({ x: shape.x + binding.fixedPoint[0] * shape.width, y: shape.y + binding.fixedPoint[1] * shape.height }, center, shape.angle ?? 0)
  }
  const toward = rotatePoint(adjacent, center, -(shape.angle ?? 0))
  let dx = toward.x - center.x, dy = toward.y - center.y
  if (Math.abs(dx) + Math.abs(dy) < 0.0001) dy = -1
  const hw = Math.max(shape.width / 2, 0.001), hh = Math.max(shape.height / 2, 0.001)
  const scale = shape.type === 'ellipse' ? 1 / Math.sqrt(dx * dx / (hw * hw) + dy * dy / (hh * hh))
    : shape.type === 'diamond' ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
      : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  const distance = scale
  const length = Math.hypot(dx, dy), gap = Math.max(0, Number(binding.gap) || 0)
  return rotatePoint({ x: center.x + dx * distance + dx / length * gap, y: center.y + dy * distance + dy / length * gap }, center, shape.angle ?? 0)
}

function preserveElbows(before: Point[], after: Point[], angle: number): Point[] {
  const origin = { x: 0, y: 0 }
  const previous = before.map(point => rotatePoint(point, origin, -angle))
  const next = after.map(point => rotatePoint(point, origin, -angle))
  const firstHorizontal = Math.abs(previous[1].y - previous[0].y) <= Math.abs(previous[1].x - previous[0].x)
  const last = previous.length - 1
  const lastHorizontal = Math.abs(previous[last].y - previous[last - 1].y) <= Math.abs(previous[last].x - previous[last - 1].x)
  if (next.length === 2 || (next.length === 3 && firstHorizontal === lastHorizontal)) {
    const start = next[0], end = next[next.length - 1]
    const path = firstHorizontal
      ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
      : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end]
    return path.map(point => rotatePoint(point, origin, angle))
  }
  if (firstHorizontal) next[1] = { ...next[1], y: next[0].y }
  else next[1] = { ...next[1], x: next[0].x }
  if (lastHorizontal) next[last - 1] = { ...next[last - 1], y: next[last].y }
  else next[last - 1] = { ...next[last - 1], x: next[last].x }
  return next.map(point => rotatePoint(point, origin, angle))
}

export function positionBoundText(element: DrawElement, container: DrawElement): DrawElement {
  let center = getElementCenter(container)
  if (container.type === 'arrow') {
    const points = getWorldPoints(container)
    const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
    let remaining = lengths.reduce((total, length) => total + length, 0) / 2
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] || i === lengths.length - 1) {
        const ratio = lengths[i] ? remaining / lengths[i] : 0
        center = { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio }; break
      }
      remaining -= lengths[i]
    }
  }
  return { ...element, x: center.x - element.width / 2, y: center.y - element.height / 2, ...(container.type === 'arrow' ? {} : { angle: container.angle }) }
}

/** Update bindings after transforms and rebuild reciprocal references. */
export function rerouteBindings(scene: ArchitectureScene, changedIds?: Iterable<string>): ArchitectureScene {
  const changed = changedIds ? new Set(changedIds) : null
  const locked = lockedElementIds(scene)
  const original = sceneElements(scene), alive = new Map(original.filter(element => !element.isDeleted).map(element => [element.id, element]))
  let elements = original.map(element => {
    if (locked.has(element.id) || element.isDeleted || element.type !== 'arrow' || !element.points || element.points.length < 2) return element
    const relevant = !changed || changed.has(element.id) || (element.startBinding && changed.has(element.startBinding.elementId)) || (element.endBinding && changed.has(element.endBinding.elementId))
    if (!relevant) return element
    let next = element
    let world = getWorldPoints(element)
    const before = world.map(point => ({ ...point }))
    for (const [key, index, adjacentIndex] of [['startBinding', 0, 1], ['endBinding', world.length - 1, world.length - 2]] as const) {
      const binding = element[key]
      if (!binding) continue
      const target = alive.get(binding.elementId)
      if (!target) { next = { ...next, [key]: null }; continue }
      world[index] = bindingPoint(target, binding, world[adjacentIndex])
    }
    if (element.elbowed || element.routing === 'elbow') world = preserveElbows(before, world, element.angle ?? 0)
    return withWorldPoints(next, world)
  })
  const byId = new Map(elements.filter(element => !element.isDeleted).map(element => [element.id, element]))
  elements = elements.map(element => {
    if (locked.has(element.id) || element.isDeleted || element.type !== 'text' || !element.containerId) return element
    const container = byId.get(element.containerId)
    if (!container) return { ...element, containerId: null }
    if (changed && !changed.has(container.id) && !changed.has(element.id) && !(container.startBinding && changed.has(container.startBinding.elementId)) && !(container.endBinding && changed.has(container.endBinding.elementId))) return element
    return positionBoundText(element, container)
  })
  const bound = new Map<string, Array<{ id: string; type: string }>>()
  const addBound = (id: string, entry: { id: string; type: string }) => {
    if (!byId.has(id)) return
    const entries = bound.get(id) ?? []
    if (!entries.some(existing => existing.id === entry.id)) entries.push(entry)
    bound.set(id, entries)
  }
  for (const element of elements.filter(element => !element.isDeleted)) {
    if (element.type === 'text' && element.containerId) addBound(element.containerId, { id: element.id, type: 'text' })
    if (element.type === 'arrow') for (const binding of [element.startBinding, element.endBinding]) if (binding) addBound(binding.elementId, { id: element.id, type: 'arrow' })
  }
  return { ...scene, elements: elements.map(element => locked.has(element.id) ? element : ({ ...element, boundElements: bound.get(element.id) ?? null })) }
}

export function moveElements(scene: ArchitectureScene, ids: Iterable<string>, delta: Point, deep = false): ArchitectureScene {
  const selected = new Set(editableSelection(scene, ids, deep)), moved = new Set<string>()
  if (!selected.size) return scene
  const elements = sceneElements(scene).map(element => {
    if (!selected.has(element.id) || element.isDeleted || element.locked) return element
    moved.add(element.id)
    return { ...element, x: element.x + finite(delta.x), y: element.y + finite(delta.y) }
  })
  return rerouteBindings({ ...scene, elements }, moved)
}

export function resizeElement(scene: ArchitectureScene, id: string, bounds: Bounds): ArchitectureScene {
  const selected = sceneElements(scene).find(element => element.id === id)
  if (!selected || lockedElementIds(scene).has(id) || selected.isDeleted) return scene
  const width = Math.max(0, finite(bounds.width)), height = Math.max(0, finite(bounds.height))
  const elements = sceneElements(scene).map(element => {
    if (element.id !== id) return element
    if (element.points?.length) {
      const original = localBounds(element), minX = original.x - element.x, minY = original.y - element.y
      const points = element.points.map(([x, y], index) => {
        const progress = element.points!.length > 1 ? index / (element.points!.length - 1) : 0
        return { x: finite(bounds.x) + (original.width ? (x - minX) / original.width : progress) * width,
          y: finite(bounds.y) + (original.height ? (y - minY) / original.height : progress) * height }
      })
      const first = points[0]
      return { ...element, x: first.x, y: first.y, width, height, points: points.map(point => [point.x - first.x, point.y - first.y] as LocalPoint) }
    }
    return { ...element, x: finite(bounds.x), y: finite(bounds.y), width, height }
  })
  return rerouteBindings({ ...scene, elements }, [id])
}

export function rotateElements(scene: ArchitectureScene, ids: Iterable<string>, angleDelta: number, pivot?: Point, deep = false): ArchitectureScene {
  const selected = new Set(editableSelection(scene, ids, deep)), candidates = sceneElements(scene).filter(element => selected.has(element.id) && !element.isDeleted && !element.locked)
  if (!candidates.length) return scene
  const bounds = getSceneBounds(candidates), center = pivot ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const elements = sceneElements(scene).map(element => {
    if (!selected.has(element.id) || element.isDeleted || element.locked) return element
    const before = getElementCenter(element), after = rotatePoint(before, center, finite(angleDelta))
    return { ...element, x: element.x + after.x - before.x, y: element.y + after.y - before.y, angle: element.angle + finite(angleDelta) }
  })
  return rerouteBindings({ ...scene, elements }, candidates.map(element => element.id))
}

export function deleteElements(scene: ArchitectureScene, ids: Iterable<string>, deep = false): ArchitectureScene {
  const selected = new Set(editableSelection(scene, ids, deep))
  if (!selected.size) return scene
  const deleted = new Set(sceneElements(scene).filter(element => selected.has(element.id) && !element.locked).map(element => element.id))
  const elements = sceneElements(scene).map(element => deleted.has(element.id) ? { ...element, isDeleted: true } : {
    ...element, ...(element.frameId && deleted.has(element.frameId) ? { frameId: null } : {}),
    ...(element.containerId && deleted.has(element.containerId) ? { containerId: null } : {}),
    ...(element.startBinding && deleted.has(element.startBinding.elementId) ? { startBinding: null } : {}),
    ...(element.endBinding && deleted.has(element.endBinding.elementId) ? { endBinding: null } : {}),
  })
  return rerouteBindings({ ...scene, elements }, deleted)
}

export function setElementProperties(scene: ArchitectureScene, ids: Iterable<string>, properties: Partial<DrawElement>): ArchitectureScene {
  const lockOnly = typeof properties.locked === 'boolean' && Object.keys(properties).length === 1
  const selected = new Set(lockOnly ? ids : editableSelection(scene, ids))
  if (lockOnly && properties.locked === false) {
    const byId = new Map(sceneElements(scene).map(element => [element.id, element])), locked = lockedElementIds(scene)
    for (const id of selected) {
      const element = byId.get(id)
      for (const owner of [element?.containerId, element?.frameId]) if (owner && locked.has(owner)) selected.add(owner)
    }
  }
  if (!selected.size) return scene
  const elements = sceneElements(scene).map(element => selected.has(element.id) && !element.isDeleted ? { ...element, ...properties, id: element.id, type: element.type } : element)
  return lockOnly ? { ...scene, elements } : rerouteBindings({ ...scene, elements }, selected)
}

/** Duplicate complete relationships, including semantic graph IDs and images.
 * External bindings stay attached to their existing targets. */
export function duplicateSelection(scene: ArchitectureScene, ids: Iterable<string>, offset: Point = { x: 24, y: 24 }, deep = false, editableOnly = false): { scene: ArchitectureScene; selectedIds: string[] } {
  const selected = new Set(editableOnly ? editableSelection(scene, ids, deep) : expandSelection(scene, ids, deep)), originals = sceneElements(scene).filter(element => selected.has(element.id) && !element.isDeleted)
  const idMap = new Map(originals.map(element => [element.id, newDrawId()])), groupMap = new Map<string, string>(), graphMap = new Map<string, string>(), fileMap = new Map<string, string>()
  for (const element of originals) {
    for (const group of element.groupIds ?? []) if (!groupMap.has(group)) groupMap.set(group, newDrawId('group'))
    const metadata = element.customData?.flowchart as Record<string, unknown> | undefined
    if (metadata && metadata.kind !== 'icon' && typeof metadata.id === 'string') graphMap.set(metadata.id, `draw-${idMap.get(element.id)}`)
    if (element.fileId && scene.files[element.fileId] && !fileMap.has(element.fileId)) fileMap.set(element.fileId, newDrawId('asset'))
  }
  const files = { ...scene.files }
  for (const [original, id] of fileMap) files[id] = { ...copy(scene.files[original]), id }
  const duplicates = originals.map(original => {
    const element = copy(original), metadata = element.customData?.flowchart as Record<string, unknown> | undefined
    const remap = (id: string | null | undefined) => id ? idMap.get(id) ?? id : id
    let customData = element.customData
    if (metadata && typeof metadata.id === 'string') {
      const snapshot = metadata.snapshot as Record<string, unknown> | undefined
      const nextSnapshot = snapshot ? { ...snapshot, id: graphMap.get(String(metadata.id)) ?? metadata.id,
        ...(typeof snapshot.parentNode === 'string' ? { parentNode: graphMap.get(snapshot.parentNode) ?? snapshot.parentNode } : {}),
        ...(typeof snapshot.source === 'string' ? { source: graphMap.get(snapshot.source) ?? snapshot.source } : {}),
        ...(typeof snapshot.target === 'string' ? { target: graphMap.get(snapshot.target) ?? snapshot.target } : {}),
      } : undefined
      customData = { ...customData, flowchart: { ...metadata, id: graphMap.get(metadata.id) ?? metadata.id, ...(nextSnapshot ? { snapshot: nextSnapshot } : {}) } }
    }
    return { ...element, id: idMap.get(element.id)!, x: element.x + offset.x, y: element.y + offset.y, ...(customData ? { customData } : {}),
      groupIds: (element.groupIds ?? []).map(group => group.startsWith('fc-container-') && graphMap.has(group.slice('fc-container-'.length)) ? `fc-container-${graphMap.get(group.slice('fc-container-'.length))}` : groupMap.get(group) ?? group),
      frameId: remap(element.frameId) ?? null, containerId: element.containerId ? idMap.get(element.containerId) ?? null : null,
      // Reciprocal references are rebuilt from the copied bindings below.
      boundElements: null,
      startBinding: element.startBinding ? { ...element.startBinding, elementId: remap(element.startBinding.elementId)! } : null,
      endBinding: element.endBinding ? { ...element.endBinding, elementId: remap(element.endBinding.elementId)! } : null,
      ...(element.fileId ? { fileId: fileMap.get(element.fileId) ?? element.fileId } : {}),
    }
  })
  const next = rerouteBindings({ ...scene, files, elements: [...scene.elements, ...duplicates] }, duplicates.map(element => element.id))
  return { scene: next, selectedIds: duplicates.map(element => element.id) }
}

export function groupElements(scene: ArchitectureScene, ids: Iterable<string>, groupId = newDrawId('group')): ArchitectureScene {
  const selected = new Set(expandSelection(scene, ids))
  return { ...scene, elements: sceneElements(scene).map(element => selected.has(element.id) ? { ...element, groupIds: [...(element.groupIds ?? []), groupId] } : element) }
}
export function ungroupElements(scene: ArchitectureScene, ids: Iterable<string>): ArchitectureScene {
  const selected = new Set(ids), groups = new Set(sceneElements(scene).filter(element => selected.has(element.id)).map(element => element.groupIds?.slice(-1)[0]).filter((group): group is string => !!group))
  return { ...scene, elements: sceneElements(scene).map(element => ({ ...element, groupIds: element.groupIds?.filter(group => !groups.has(group)) ?? [] })) }
}
export function reorderElements(scene: ArchitectureScene, ids: Iterable<string>, direction: 'front' | 'back' | 'forward' | 'backward'): ArchitectureScene {
  const selected = new Set(expandSelection(scene, ids)), elements = [...scene.elements]
  if (direction === 'front' || direction === 'back') {
    const yes = elements.filter(element => selected.has(String(element.id))), no = elements.filter(element => !selected.has(String(element.id)))
    return { ...scene, elements: direction === 'front' ? [...no, ...yes] : [...yes, ...no] }
  }
  if (direction === 'forward') for (let i = elements.length - 2; i >= 0; i--) {
    if (selected.has(String(elements[i].id)) && !selected.has(String(elements[i + 1].id))) [elements[i], elements[i + 1]] = [elements[i + 1], elements[i]]
  }
  else for (let i = 1; i < elements.length; i++) {
    if (selected.has(String(elements[i].id)) && !selected.has(String(elements[i - 1].id))) [elements[i], elements[i - 1]] = [elements[i - 1], elements[i]]
  }
  return { ...scene, elements }
}
export function alignElements(scene: ArchitectureScene, ids: Iterable<string>, alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): ArchitectureScene {
  const selected = new Set(ids), targets = sceneElements(scene).filter(element => selected.has(element.id) && !element.isDeleted && !element.locked), all = getSceneBounds(targets)
  const elements = sceneElements(scene).map(element => {
    if (!targets.includes(element)) return element
    const bounds = getElementBounds(element)
    const dx = alignment === 'left' ? all.x - bounds.x : alignment === 'center' ? all.x + all.width / 2 - bounds.x - bounds.width / 2 : alignment === 'right' ? all.x + all.width - bounds.x - bounds.width : 0
    const dy = alignment === 'top' ? all.y - bounds.y : alignment === 'middle' ? all.y + all.height / 2 - bounds.y - bounds.height / 2 : alignment === 'bottom' ? all.y + all.height - bounds.y - bounds.height : 0
    return { ...element, x: element.x + dx, y: element.y + dy }
  })
  return rerouteBindings({ ...scene, elements }, selected)
}

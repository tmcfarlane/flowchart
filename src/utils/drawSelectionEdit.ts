import { validateArchitectureScene, type ArchitectureScene } from '../shared/architectureScene'
import { DrawEditContextSchema, validateDrawEdit, type DrawEditContext } from '../shared/drawSelectionEdit'
import { bridgeData, graphFromElements } from './architectureBridge'
import { lockedElementIds, positionBoundText, type DrawElement } from './drawScene'
import { drawingTextSize } from './drawText'
import type { Edge, Node } from 'reactflow'

export interface DrawEditSnapshot {
  sceneSignature: string
  selectedIds: string[]
  epoch: number
  context: DrawEditContext
}
const references = (element: DrawElement) => [element.containerId, element.frameId, element.startBinding?.elementId, element.endBinding?.elementId, ...(element.boundElements ?? []).map(bound => bound.id)].filter((id): id is string => typeof id === 'string')

export function captureDrawEdit(scene: ArchitectureScene, ids: readonly string[], epoch: number): DrawEditSnapshot {
  const selected = new Set(ids), elements = scene.elements as DrawElement[], byId = new Map(elements.map(element => [element.id, element]))
  const dependencies = new Set<string>(), locked = lockedElementIds(scene)
  const targets = [...selected].sort().map(id => {
    const element = byId.get(id)
    if (!element || element.isDeleted || locked.has(element.id)) throw new Error('Select existing unlocked Draw shapes or text to edit with AI.')
    const related = new Set(references(element))
    for (const other of elements) {
      if (other.id !== id && (references(other).includes(id) || other.groupIds?.some(group => element.groupIds?.includes(group)))) related.add(other.id)
    }
    for (const key of related) dependencies.add(key)
    const host = element.containerId ? byId.get(element.containerId) : undefined
    const safeAppearance: Record<string, unknown> = {}
    for (const key of ['strokeColor', 'backgroundColor', 'strokeWidth', 'strokeStyle', 'fillStyle', 'roughness', 'opacity'] as const) {
      const value = element[key]
      if (value !== undefined) safeAppearance[key] = value
    }
    return { id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height, angle: element.angle,
      ...(element.type === 'text' ? { text: element.text ?? '' } : {}), ...safeAppearance,
      geometryAllowed: !bridgeData(element) && !element.groupIds?.length && !related.size && ['rectangle', 'diamond', 'ellipse'].includes(element.type),
      textAllowed: element.type === 'text' && (!element.containerId || !!host && selected.has(host.id) && !host.locked && !host.isDeleted),
      dependencyIds: [...related].sort(),
    }
  })
  const parsed = DrawEditContextSchema.safeParse({ targets, dependencies: [...dependencies].sort().map(id => { const element = byId.get(id); return { id, type: element?.type, locked: !!element?.locked, selected: selected.has(id) } }) })
  if (!parsed.success) throw new Error('Select up to 50 native Draw elements with supported appearance. This selection cannot be sent to AI.')
  return { sceneSignature: JSON.stringify(scene), selectedIds: [...selected].sort(), epoch, context: parsed.data }
}

export function drawEditIsCurrent(snapshot: DrawEditSnapshot, scene: ArchitectureScene, ids: readonly string[], epoch: number): boolean {
  return snapshot.epoch === epoch && snapshot.sceneSignature === JSON.stringify(scene) && JSON.stringify(snapshot.selectedIds) === JSON.stringify([...new Set(ids)].sort())
}

export function applyDrawEdit(scene: ArchitectureScene, snapshot: DrawEditSnapshot, input: unknown, nodes: Node[], edges: Edge[]): ArchitectureScene {
  const current = captureDrawEdit(scene, snapshot.selectedIds, snapshot.epoch)
  if (current.sceneSignature !== snapshot.sceneSignature || JSON.stringify(current.context) !== JSON.stringify(snapshot.context)) throw new Error('The drawing changed. Open a new AI edit before applying.')
  const proposal = validateDrawEdit(current.context, input), updates = new Map(proposal.operations.map(operation => [operation.id, operation.changes]))
  const elements = scene.elements as DrawElement[], byId = new Map(elements.map(element => [element.id, element]))
  const next = validateArchitectureScene({ ...scene, elements: elements.map(element => {
    const changes = updates.get(String(element.id))
    if (!changes) return element
    if (changes.text === undefined) return { ...element, ...changes }
    const edited = { ...element, ...changes, originalText: changes.text, ...drawingTextSize(changes.text, element) }
    const host = edited.containerId ? byId.get(edited.containerId) : undefined
    return host ? positionBoundText(edited, host) : edited
  }) })
  const graph = graphFromElements(next.elements as DrawElement[], nodes, edges)
  validateArchitectureScene({ ...next, elements: [...graph.elements] })
  return next
}

import { validateArchitectureScene, type ArchitectureScene } from '../shared/architectureScene'
import { getSceneBounds } from './drawScene'

/** Fits the 4.5 MB serverless request limit, including the document envelope. */
export const EXCALIDRAW_IMPORT_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  maxElements: 5000,
  maxFiles: 100,
  maxCoordinate: 1_000_000,
} as const

const SUPPORTED_ELEMENTS = new Set([
  'rectangle', 'diamond', 'ellipse', 'text', 'line', 'arrow', 'freedraw', 'image', 'frame',
])
const IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
])
type ElementRecord = Record<string, unknown>

const ARROWHEADS = new Set(['arrow', 'triangle', 'triangle_outline', 'bar', 'dot', 'dot_outline', 'diamond', 'diamond_outline', 'circle', 'circle_outline', 'crowfoot_one', 'crowfoot_many', 'crowfoot_one_or_many'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__', 'prototype', 'constructor'].includes(value) && !/[\u0000-\u001f\u007f]/.test(value)
}

function geometry(value: unknown, field: string, id: string, nonnegative = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > EXCALIDRAW_IMPORT_LIMITS.maxCoordinate || (nonnegative && value < 0)) {
    throw new Error(`Element “${id}” has an invalid ${field}. Use finite coordinates and non-negative dimensions within ±1,000,000.`)
  }
}

function requireReference(value: unknown, ids: Set<string>, deleted: Set<string>, label: string): string | null {
  if (value == null) return null
  if (!validId(value)) throw new Error(`${label} contains an invalid element reference.`)
  if (deleted.has(value)) return null
  if (!ids.has(value)) throw new Error(`${label} references missing element “${value}”. Re-export the complete drawing from Excalidraw.`)
  return value
}

function validateDrawAppearance(element: ElementRecord, id: string): void {
  const enums: Record<string, readonly string[]> = {
    fillStyle: ['solid', 'hachure', 'cross-hatch', 'zigzag'],
    strokeStyle: ['solid', 'dashed', 'dotted'],
    textAlign: ['left', 'center', 'right'],
    verticalAlign: ['top', 'middle', 'bottom'],
  }
  for (const [field, supported] of Object.entries(enums)) {
    if (element[field] != null && !supported.includes(String(element[field]))) throw new Error(`Draw cannot render this drawing's ${field} on element “${id}”. Use a supported style and export again.`)
  }
  for (const field of ['strokeWidth', 'roughness', 'fontSize', 'lineHeight']) {
    if (element[field] != null) {
      geometry(element[field], field, id, true)
      if ((field === 'fontSize' || field === 'lineHeight') && element[field] === 0) throw new Error(`Element “${id}” has an invalid ${field}. Use a positive number.`)
    }
  }
  if (element.fontFamily != null && (typeof element.fontFamily !== 'number' || !Number.isInteger(element.fontFamily) || element.fontFamily < 1)) throw new Error(`Element “${id}” has an invalid font family.`)
  for (const field of ['startArrowhead', 'endArrowhead']) if (element[field] != null && !ARROWHEADS.has(String(element[field]))) throw new Error(`Draw cannot render the ${field} on element “${id}”. Use a supported arrowhead and export again.`)
  if (element.roundness != null && (!isRecord(element.roundness) || ![1, 2, 3].includes(Number(element.roundness.type)))) throw new Error(`Draw cannot render the corner style on element “${id}”.`)
  if (element.type === 'image') {
    if (element.scale != null && (!Array.isArray(element.scale) || element.scale.length !== 2 || !element.scale.every((value) => value === 1 || value === -1))) throw new Error(`Image element “${id}” has an invalid flip transform.`)
    if (element.crop != null) {
      if (!isRecord(element.crop)) throw new Error(`Image element “${id}” has an invalid crop.`)
      for (const field of ['x', 'y', 'width', 'height', 'naturalWidth', 'naturalHeight']) {
        geometry(element.crop[field], `crop ${field}`, id, true)
        if (['width', 'height', 'naturalWidth', 'naturalHeight'].includes(field) && element.crop[field] === 0) throw new Error(`Image element “${id}” has an empty crop.`)
      }
      const crop = element.crop as Record<string, number>
      if (crop.x + crop.width > crop.naturalWidth + 0.0001 || crop.y + crop.height > crop.naturalHeight + 0.0001) throw new Error(`Image element “${id}” has a crop outside its image bounds.`)
    }
  }
}

/** Differences that users see before deciding whether to open or insert. Data remains intact. */
export function getExcalidrawCompatibilityNotes(scene: ArchitectureScene): string[] {
  const notes: string[] = []
  if (scene.elements.some((element) => element.type === 'text' && ![2, 3].includes(Number(element.fontFamily ?? 1)))) notes.push('Excalidraw fonts use local font fallbacks in Draw. Text may wrap or measure differently.')
  if (scene.elements.some((element) => Number(element.roughness ?? 0) > 0 || ['hachure', 'cross-hatch', 'zigzag'].includes(String(element.fillStyle)))) notes.push('Sketch strokes and patterned fills use Draw’s rendering, so their textures can look different.')
  if (scene.elements.some((element) => element.type === 'freedraw' && Array.isArray(element.pressures) && element.pressures.length > 0)) notes.push('Freehand points and pressure stay editable; stroke smoothing may look slightly different.')
  if (scene.elements.some((element) => Array.isArray(element.fixedSegments) && element.fixedSegments.length > 0)) notes.push('Fixed elbow segments can move when you edit their path in Draw.')
  return notes
}

/** Validate before rendering or application so unsupported file content never disappears silently. */
export function parseExcalidrawScene(text: string): ArchitectureScene {
  if (new TextEncoder().encode(text).byteLength > EXCALIDRAW_IMPORT_LIMITS.maxBytes) {
    throw new Error('This drawing exceeds the 4 MiB import limit. Remove unused images or split the drawing and try again.')
  }
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new Error('This file does not contain valid JSON. Export a .excalidraw file and try again.')
  }
  if (!isRecord(input) || input.type !== 'excalidraw') {
    throw new Error('This is not an Excalidraw drawing. Choose a file exported as .excalidraw.')
  }
  if (input.version !== 1 && input.version !== 2) {
    throw new Error(`Excalidraw file version ${String(input.version ?? '(missing)')} is not supported. Import a version 1 or 2 drawing.`)
  }
  if (!Array.isArray(input.elements)) throw new Error('The Excalidraw file is missing its elements array.')
  if (input.elements.length > EXCALIDRAW_IMPORT_LIMITS.maxElements) {
    throw new Error('This drawing contains more than 5,000 elements. Split the drawing and try again.')
  }
  if (input.appState != null && !isRecord(input.appState)) throw new Error('The Excalidraw appState must be an object.')
  if (input.files != null && !isRecord(input.files)) throw new Error('The Excalidraw image files must be an object.')

  const elements: ElementRecord[] = []
  const ids = new Set<string>()
  const deletedIds = new Set<string>()
  const allIds = new Set<string>()
  const unsupported = new Set<string>()
  for (const value of input.elements) {
    if (!isRecord(value) || !validId(value.id)) throw new Error('Every drawing element must have a non-empty, unique ID.')
    if (allIds.has(value.id)) throw new Error(`The drawing contains duplicate element ID “${value.id}”. Re-export it and try again.`)
    allIds.add(value.id)
    if (value.isDeleted === true) { deletedIds.add(value.id); continue }
    if (typeof value.type !== 'string' || !SUPPORTED_ELEMENTS.has(value.type)) {
      unsupported.add(String(value.type ?? '(missing type)'))
      continue
    }
    validateDrawAppearance(value, value.id)
    geometry(value.x, 'x coordinate', value.id)
    geometry(value.y, 'y coordinate', value.id)
    geometry(value.width, 'width', value.id, true)
    geometry(value.height, 'height', value.id, true)
    if (value.angle != null) geometry(value.angle, 'rotation', value.id)
    if (value.opacity != null && (typeof value.opacity !== 'number' || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 100)) {
      throw new Error(`Element “${value.id}” has an invalid opacity. Use a value from 0 to 100.`)
    }
    if (value.type === 'text' && typeof value.text !== 'string') throw new Error(`Text element “${value.id}” is missing its text.`)
    if (['arrow', 'line', 'freedraw'].includes(value.type)) {
      if (!Array.isArray(value.points) || value.points.length < (value.type === 'freedraw' ? 1 : 2)) {
        throw new Error(`Element “${value.id}” is missing its editable path points.`)
      }
      for (const point of value.points) {
        if (!Array.isArray(point) || point.length !== 2) throw new Error(`Element “${value.id}” has a malformed path point.`)
        geometry(point[0], 'path x coordinate', value.id)
        geometry(point[1], 'path y coordinate', value.id)
      }
      if (value.type === 'freedraw' && value.pressures != null && (!Array.isArray(value.pressures) || !value.pressures.every((pressure) => typeof pressure === 'number' && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1))) {
        throw new Error(`Element “${value.id}” has invalid pen-pressure data.`)
      }
    }
    if (value.groupIds != null && (!Array.isArray(value.groupIds) || !value.groupIds.every(validId))) {
      throw new Error(`Element “${value.id}” has invalid group references.`)
    }
    ids.add(value.id)
    const element: ElementRecord = { ...value, angle: value.angle ?? 0 }
    // Files exported by this app may include semantic bridge IDs. A foreign
    // drawing must never gain permission to mutate existing graph nodes.
    if (isRecord(value.customData) && 'flowchart' in value.customData) {
      const customData = { ...value.customData }
      delete customData.flowchart
      element.customData = customData
    }
    elements.push(element)
  }
  if (unsupported.size) throw new Error(`This drawing includes unsupported content: ${[...unsupported].join(', ')}. Remove or replace it in Excalidraw before importing. Nothing has been changed.`)
  if (!elements.length) throw new Error('This drawing has no visible elements to import. Deleted elements are ignored.')

  const fileInput = (input.files ?? {}) as Record<string, unknown>
  if (Object.keys(fileInput).length > EXCALIDRAW_IMPORT_LIMITS.maxFiles) throw new Error('This drawing includes more than 100 images. Split the drawing and try again.')
  const files: ArchitectureScene['files'] = {}
  for (const [id, file] of Object.entries(fileInput)) {
    if (!validId(id) || !isRecord(file) || (file.id != null && file.id !== id)) throw new Error(`Image asset “${id}” has an invalid ID.`)
    if (typeof file.mimeType !== 'string' || !IMAGE_MIME_TYPES.has(file.mimeType) || typeof file.dataURL !== 'string') {
      throw new Error(`Image asset “${id}” is not a supported embedded image. Embed it in Excalidraw and export again.`)
    }
    const match = file.dataURL.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/)
    if (!match || match[1] !== file.mimeType || match[2].length % 4 !== 0) throw new Error(`Image asset “${id}” contains corrupt or external image data. Export it with embedded images.`)
    files[id] = { ...file, id }
  }

  const elementById = new Map(elements.map((element) => [element.id as string, element]))
  for (const element of elements) {
    const id = element.id as string
    for (const field of ['containerId', 'frameId'] as const) {
      if (element[field] != null) element[field] = requireReference(element[field], ids, deletedIds, `Element “${id}”`)
      if (element[field] === id) throw new Error(`Element “${id}” cannot reference itself as a text container or frame.`)
    }
    if (typeof element.frameId === 'string' && elementById.get(element.frameId)?.type !== 'frame') {
      throw new Error(`Element “${id}” refers to a frame that is not a frame element.`)
    }
    if (typeof element.containerId === 'string' && (element.type !== 'text' || !['rectangle', 'diamond', 'ellipse', 'arrow'].includes(String(elementById.get(element.containerId)?.type)))) {
      throw new Error(`Text element “${id}” has an invalid label container.`)
    }
    for (const field of ['startBinding', 'endBinding'] as const) {
      const binding = element[field]
      if (binding != null) {
        if (!isRecord(binding) || !validId(binding.elementId)) throw new Error(`Element “${id}” has an invalid arrow binding.`)
        const reference = requireReference(binding.elementId, ids, deletedIds, `Arrow “${id}”`)
        for (const field of ['focus', 'gap']) if (binding[field] != null) geometry(binding[field], `binding ${field}`, id)
        if (reference && ['arrow', 'line', 'freedraw'].includes(String(elementById.get(reference)?.type))) throw new Error(`Arrow “${id}” has an invalid endpoint binding.`)
        element[field] = reference ? { ...binding, elementId: reference } : null
      }
    }
    if (element.boundElements != null) {
      if (!Array.isArray(element.boundElements)) throw new Error(`Element “${id}” has invalid bound elements.`)
      element.boundElements = element.boundElements.flatMap((bound) => {
        if (!isRecord(bound) || !validId(bound.id)) throw new Error(`Element “${id}” has an invalid bound-element reference.`)
        const reference = requireReference(bound.id, ids, deletedIds, `Element “${id}”`)
        if (reference && (!['arrow', 'text'].includes(String(bound.type)) || elementById.get(reference)?.type !== bound.type)) throw new Error(`Element “${id}” has a mismatched bound-element type.`)
        return reference ? [{ ...bound, id: reference }] : []
      })
    }
    if (element.boundElementIds != null) {
      if (!Array.isArray(element.boundElementIds)) throw new Error(`Element “${id}” has invalid bound element IDs.`)
      element.boundElementIds = element.boundElementIds.flatMap((bound) => {
        const reference = requireReference(bound, ids, deletedIds, `Element “${id}”`)
        return reference ? [reference] : []
      })
    }
    if (element.type === 'image' && (typeof element.fileId !== 'string' || !Object.prototype.hasOwnProperty.call(files, element.fileId))) {
      throw new Error(`Image element “${id}” is missing its embedded asset. Export the file with embedded images.`)
    }
  }

  const appState: NonNullable<ArchitectureScene['appState']> = {}
  if (isRecord(input.appState)) {
    if (input.appState.viewBackgroundColor != null) {
      if (typeof input.appState.viewBackgroundColor !== 'string' || input.appState.viewBackgroundColor.length > 100) throw new Error('The drawing has an invalid background color.')
      appState.viewBackgroundColor = input.appState.viewBackgroundColor
    }
    if (input.appState.gridSize != null) {
      if (typeof input.appState.gridSize !== 'number' || !Number.isFinite(input.appState.gridSize) || input.appState.gridSize <= 0 || input.appState.gridSize > 1000) throw new Error('The drawing has an invalid grid size.')
      appState.gridSize = input.appState.gridSize
    } else if (isRecord(input.appState) && input.appState.gridSize === null) appState.gridSize = null
  }
  return validateArchitectureScene({ version: 1, elements, files, appState })
}

function uniqueId(prefix: string, occupied: Set<string>): string {
  let id: string
  do { id = `${prefix}-${globalThis.crypto.randomUUID()}` } while (occupied.has(id))
  occupied.add(id)
  return id
}

/** A newly opened external scene cannot reserve future semantic graph IDs. */
export function prepareSceneOpen(imported: ArchitectureScene): ArchitectureScene {
  return remapScene(imported)
}

/** Insert editable file records as one translated unit, with independent relationships and image assets. */
export function prepareSceneInsertion(
  imported: ArchitectureScene,
  current: ArchitectureScene | undefined,
  point: { x: number; y: number },
): ArchitectureScene {
  return remapScene(imported, current, point)
}

function remapScene(
  imported: ArchitectureScene,
  current?: ArchitectureScene,
  point?: { x: number; y: number },
): ArchitectureScene {
  if (!imported.elements.length) throw new Error('This drawing has no visible elements to insert.')
  if (point) {
    geometry(point.x, 'insertion x coordinate', 'import')
    geometry(point.y, 'insertion y coordinate', 'import')
  }
  const occupied = new Set<string>([
    ...(current?.elements.flatMap((element) => [String(element.id), ...((element.groupIds as string[] | undefined) ?? [])]) ?? []),
    ...Object.keys(current?.files ?? {}),
  ])
  const elementIds = new Map(imported.elements.map((element) => [element.id as string, uniqueId('import', occupied)]))
  const groupIds = new Map<string, string>()
  const assetIds = new Map(Object.keys(imported.files).map((id) => [id, uniqueId('asset', occupied)]))
  for (const element of imported.elements) for (const id of (element.groupIds as string[] | undefined) ?? []) {
    if (!groupIds.has(id)) groupIds.set(id, uniqueId('group', occupied))
  }

  // Paths can extend left/up of their origin despite positive width/height.
  // Use the renderer's pure geometry so their visible center also lands at
  // the requested position, without changing any saved local path points.
  const bounds = getSceneBounds(imported.elements)
  const dx = point ? point.x - (bounds.x + bounds.width / 2) : 0
  const dy = point ? point.y - (bounds.y + bounds.height / 2) : 0
  const elements = imported.elements.map((element) => {
    const result: ElementRecord = { ...element, id: elementIds.get(element.id as string)!, x: (element.x as number) + dx, y: (element.y as number) + dy }
    geometry(result.x, 'translated x coordinate', result.id as string)
    geometry(result.y, 'translated y coordinate', result.id as string)
    if (Array.isArray(element.groupIds)) result.groupIds = element.groupIds.map((id) => groupIds.get(id as string)!)
    for (const field of ['frameId', 'containerId'] as const) if (typeof element[field] === 'string') result[field] = elementIds.get(element[field] as string) ?? null
    for (const field of ['startBinding', 'endBinding'] as const) if (isRecord(element[field])) {
      result[field] = { ...element[field], elementId: elementIds.get(element[field].elementId as string)! }
    }
    if (Array.isArray(element.boundElements)) result.boundElements = element.boundElements.map((bound) => ({ ...(bound as ElementRecord), id: elementIds.get((bound as ElementRecord).id as string)! }))
    if (Array.isArray(element.boundElementIds)) result.boundElementIds = element.boundElementIds.map((id) => elementIds.get(id as string)!)
    if (typeof element.fileId === 'string') result.fileId = assetIds.get(element.fileId)!
    return result
  })
  const files = Object.fromEntries(Object.entries(imported.files).map(([id, file]) => {
    const newId = assetIds.get(id)!
    return [newId, { ...file, id: newId }]
  }))
  const result: ArchitectureScene = {
    version: 1,
    elements: [...(current?.elements ?? []), ...elements],
    files: { ...current?.files, ...files },
    appState: current?.appState ?? imported.appState,
  }
  if (result.elements.length > EXCALIDRAW_IMPORT_LIMITS.maxElements || Object.keys(result.files).length > EXCALIDRAW_IMPORT_LIMITS.maxFiles || new TextEncoder().encode(JSON.stringify(result)).byteLength > EXCALIDRAW_IMPORT_LIMITS.maxBytes) {
    throw new Error('The combined drawing exceeds the 5,000 element or 4 MiB scene limit. Open this file as a new diagram instead.')
  }
  return validateArchitectureScene(result)
}

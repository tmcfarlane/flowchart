import type { ArchitectureScene } from '../shared/architectureScene'

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

/** Validate before restoring: the editor's tolerant restore utility can otherwise silently drop unsupported content. */
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

  for (const element of elements) {
    const id = element.id as string
    for (const field of ['containerId', 'frameId'] as const) {
      if (element[field] != null) element[field] = requireReference(element[field], ids, deletedIds, `Element “${id}”`)
      if (element[field] === id) throw new Error(`Element “${id}” cannot reference itself as a text container or frame.`)
    }
    if (typeof element.frameId === 'string' && !elements.some((candidate) => candidate.id === element.frameId && candidate.type === 'frame')) {
      throw new Error(`Element “${id}” refers to a frame that is not a frame element.`)
    }
    for (const field of ['startBinding', 'endBinding'] as const) {
      const binding = element[field]
      if (binding != null) {
        if (!isRecord(binding) || !validId(binding.elementId)) throw new Error(`Element “${id}” has an invalid arrow binding.`)
        const reference = requireReference(binding.elementId, ids, deletedIds, `Arrow “${id}”`)
        element[field] = reference ? { ...binding, elementId: reference } : null
      }
    }
    if (element.boundElements != null) {
      if (!Array.isArray(element.boundElements)) throw new Error(`Element “${id}” has invalid bound elements.`)
      element.boundElements = element.boundElements.flatMap((bound) => {
        if (!isRecord(bound) || !validId(bound.id)) throw new Error(`Element “${id}” has an invalid bound-element reference.`)
        const reference = requireReference(bound.id, ids, deletedIds, `Element “${id}”`)
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
  return { version: 1, elements, files, appState }
}

function uniqueId(prefix: string, occupied: Set<string>): string {
  let id: string
  do { id = `${prefix}-${globalThis.crypto.randomUUID()}` } while (occupied.has(id))
  occupied.add(id)
  return id
}

/** Insert the intact native scene as one translated unit, with independent relationships and image assets. */
export function prepareSceneInsertion(
  imported: ArchitectureScene,
  current: ArchitectureScene | undefined,
  point: { x: number; y: number },
): ArchitectureScene {
  if (!imported.elements.length) throw new Error('This drawing has no visible elements to insert.')
  geometry(point.x, 'insertion x coordinate', 'import')
  geometry(point.y, 'insertion y coordinate', 'import')
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

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const element of imported.elements) {
    // Rotated bounds keep a scene's visible center at the insertion point.
    const x = element.x as number, y = element.y as number
    const width = element.width as number, height = element.height as number
    const angle = typeof element.angle === 'number' ? element.angle : 0
    const halfWidth = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2
    const halfHeight = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2
    const centerX = x + width / 2, centerY = y + height / 2
    minX = Math.min(minX, centerX - halfWidth); maxX = Math.max(maxX, centerX + halfWidth)
    minY = Math.min(minY, centerY - halfHeight); maxY = Math.max(maxY, centerY + halfHeight)
  }
  const dx = point.x - (minX + maxX) / 2, dy = point.y - (minY + maxY) / 2
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
  return result
}

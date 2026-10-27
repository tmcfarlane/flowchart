/** A lossless, versioned native drawing, independent of the editor package. */
export interface ArchitectureScene {
  version: 1
  elements: Array<Record<string, unknown>>
  files: Record<string, Record<string, unknown>>
  appState?: {
    viewBackgroundColor?: string
    gridSize?: number | null
  }
}

/** Leaves room below the hosting platform's 4.5 MB request limit. */
export const MAX_ARCHITECTURE_DOCUMENT_BYTES = 4 * 1024 * 1024
export const ARCHITECTURE_SCENE_LIMITS = {
  maxElements: 5000,
  maxFiles: 100,
  maxBytes: MAX_ARCHITECTURE_DOCUMENT_BYTES - 64 * 1024,
  maxCoordinate: 1_000_000,
} as const

export const SUPPORTED_ARCHITECTURE_ELEMENT_TYPES = [
  'rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'embeddable', 'iframe', 'magicframe',
] as const
export const SUPPORTED_ARCHITECTURE_IMAGE_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp', 'image/x-icon',
] as const

export function serializedByteLength(value: unknown): number {
  let bytes = 0
  for (const char of JSON.stringify(value)) {
    const code = char.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertJson(value: unknown, depth = 0): void {
  if (depth > 50) throw new Error('Drawing data is nested too deeply.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    for (const child of value) assertJson(child, depth + 1)
    return
  }
  if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Drawing data contains an unsafe property name.')
      assertJson(child, depth + 1)
    }
    return
  }
  throw new Error('Drawing data must contain only finite JSON values.')
}

/** Validates before storing or applying; returns every native field unchanged. */
export function validateArchitectureScene(value: unknown): ArchitectureScene {
  if (!object(value) || value.version !== 1) throw new Error('Unsupported architecture scene version. Expected version 1.')
  if (Object.keys(value).some((key) => !['version', 'elements', 'files', 'appState'].includes(key))) {
    throw new Error('Architecture scene contains an unsupported top-level field.')
  }
  if (!Array.isArray(value.elements) || value.elements.length > ARCHITECTURE_SCENE_LIMITS.maxElements) {
    throw new Error(`Architecture scenes require an elements array with at most ${ARCHITECTURE_SCENE_LIMITS.maxElements} elements.`)
  }
  if (!object(value.files) || Object.keys(value.files).length > ARCHITECTURE_SCENE_LIMITS.maxFiles) {
    throw new Error(`Architecture scenes require a files object with at most ${ARCHITECTURE_SCENE_LIMITS.maxFiles} image assets.`)
  }
  assertJson(value)
  if (serializedByteLength(value) > ARCHITECTURE_SCENE_LIMITS.maxBytes) throw new Error('Architecture scene exceeds the 4032 KB drawing limit. Use smaller images or split the drawing.')
  const ids = new Set<string>()
  for (const [index, element] of value.elements.entries()) {
    if (!object(element) || typeof element.id !== 'string' || !element.id || element.id.length > 200) {
      throw new Error(`Drawing element ${index + 1} needs a valid id.`)
    }
    if (ids.has(element.id)) throw new Error(`Drawing element id ${JSON.stringify(element.id)} is duplicated.`)
    ids.add(element.id)
    if (typeof element.type !== 'string' || !(SUPPORTED_ARCHITECTURE_ELEMENT_TYPES as readonly string[]).includes(element.type)) {
      throw new Error(`Drawing element ${element.id} has an unsupported type: ${String(element.type)}.`)
    }
    for (const axis of ['x', 'y', 'width', 'height', 'angle']) {
      const coordinate = element[axis]
      if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || Math.abs(coordinate) > ARCHITECTURE_SCENE_LIMITS.maxCoordinate) {
        throw new Error(`Drawing element ${element.id} has an invalid ${axis}.`)
      }
      if ((axis === 'width' || axis === 'height') && coordinate < 0) throw new Error(`Drawing element ${element.id} has a negative ${axis}.`)
    }
    if (element.type === 'image' && !element.isDeleted && (typeof element.fileId !== 'string' || !Object.prototype.hasOwnProperty.call(value.files, element.fileId))) {
      throw new Error(`Image element ${element.id} refers to a missing image asset.`)
    }
  }
  for (const element of value.elements as Array<Record<string, unknown>>) {
    const references: unknown[] = [element.containerId, element.frameId]
    for (const key of ['startBinding', 'endBinding']) {
      if (object(element[key])) references.push(element[key].elementId)
    }
    if (Array.isArray(element.boundElements)) {
      for (const bound of element.boundElements) {
        if (!object(bound)) throw new Error(`Drawing element ${element.id} has an invalid bound element.`)
        references.push(bound.id)
      }
    }
    for (const reference of references) {
      if (reference != null && (typeof reference !== 'string' || !ids.has(reference))) {
        throw new Error(`Drawing element ${element.id} refers to a missing element: ${String(reference)}.`)
      }
    }
  }
  for (const [id, file] of Object.entries(value.files)) {
    if (!object(file) || file.id !== id || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon);base64,/i.test(file.dataURL)) {
      throw new Error(`Drawing asset ${JSON.stringify(id)} must be an embedded image with a matching id.`)
    }
  }
  if (value.appState !== undefined) {
    if (!object(value.appState) || Object.keys(value.appState).some((key) => !['viewBackgroundColor', 'gridSize'].includes(key))) {
      throw new Error('Drawing appState supports only background color and grid size.')
    }
    if (value.appState.viewBackgroundColor !== undefined && (typeof value.appState.viewBackgroundColor !== 'string' || value.appState.viewBackgroundColor.length > 100)) {
      throw new Error('Drawing background color must be a color string.')
    }
    if (value.appState.gridSize !== undefined && value.appState.gridSize !== null && (typeof value.appState.gridSize !== 'number' || value.appState.gridSize <= 0 || value.appState.gridSize > 1000)) {
      throw new Error('Drawing grid size must be null or a number between 0 and 1000.')
    }
  }
  return value as unknown as ArchitectureScene
}

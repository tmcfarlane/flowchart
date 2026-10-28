import { ARCHITECTURE_SCENE_LIMITS, serializedByteLength, validateArchitectureScene, type ArchitectureScene } from './architectureScene.js'

export interface ExcalidrawDrawing {
  type: 'excalidraw'
  version: 2
  source: string
  elements: ArchitectureScene['elements']
  files: ArchitectureScene['files']
  appState?: ArchitectureScene['appState']
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseDrawDocument(value: unknown): ExcalidrawDrawing {
  if (!record(value) || value.type !== 'excalidraw' || value.version !== 2) throw new Error('AI drawing must be an Excalidraw version 2 document.')
  if (Object.keys(value).some(key => !['type', 'version', 'source', 'elements', 'files', 'appState'].includes(key))) throw new Error('Drawing document has an unsupported field.')
  if (typeof value.source !== 'string' || !value.source || value.source.length > 2000) throw new Error('Drawing document needs a bounded source.')
  const scene = validateArchitectureScene({ version: 1, elements: value.elements, files: value.files, ...(value.appState === undefined ? {} : { appState: value.appState }) })
  for (const element of scene.elements) {
    if (['line', 'arrow', 'freedraw'].includes(String(element.type))) {
      if (!Array.isArray(element.points) || !element.points.length) throw new Error('Drawing path needs points.')
      for (const point of element.points) {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= ARCHITECTURE_SCENE_LIMITS.maxCoordinate)) throw new Error('Drawing path has an invalid point.')
      }
    }
    if (element.type === 'text' && (typeof element.text !== 'string' || typeof element.fontSize !== 'number' || !Number.isFinite(element.fontSize) || element.fontSize <= 0 || element.fontSize > 1000)) throw new Error('Drawing text has invalid content or font size.')
    for (const key of ['startBinding', 'endBinding']) {
      const binding = element[key]
      if (binding == null) continue
      if (!record(binding) || typeof binding.elementId !== 'string') throw new Error('Drawing path has an invalid binding.')
      if (binding.fixedPoint !== undefined && (!Array.isArray(binding.fixedPoint) || binding.fixedPoint.length !== 2 || !binding.fixedPoint.every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1))) throw new Error('Drawing attachment has invalid fixed coordinates.')
    }
  }
  if (serializedByteLength(value) > ARCHITECTURE_SCENE_LIMITS.maxBytes) throw new Error('Drawing document exceeds the drawing size limit.')
  return value as unknown as ExcalidrawDrawing
}

export function drawingFromScene(scene: ArchitectureScene): ExcalidrawDrawing {
  return parseDrawDocument({ type: 'excalidraw', version: 2, source: 'FlowChart', elements: scene.elements, files: scene.files, ...(scene.appState === undefined ? {} : { appState: scene.appState }) })
}

export function sceneFromDrawing(drawing: ExcalidrawDrawing): ArchitectureScene {
  const validated = parseDrawDocument(drawing)
  return { version: 1, elements: validated.elements, files: validated.files, ...(validated.appState === undefined ? {} : { appState: validated.appState }) }
}

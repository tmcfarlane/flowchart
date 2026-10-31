import { parseFlowJson } from './exportUtils'
import { parseExcalidrawScene } from './excalidrawImport'
import type { ArchitectureScene } from '../shared/architectureScene'

export type DiagramImport =
  | { kind: 'flowchart'; document: ReturnType<typeof parseFlowJson> }
  | { kind: 'excalidraw'; scene: ArchitectureScene }

/** Detect by contents, including .excalidraw files whose OS supplies an empty MIME type. */
export function parseDiagramFile(text: string): DiagramImport {
  let input: unknown
  try { input = JSON.parse(text) } catch { throw new Error('This file does not contain valid JSON. Choose a .json or .excalidraw drawing.') }
  if (input && typeof input === 'object' && 'type' in input && input.type === 'excalidraw') {
    return { kind: 'excalidraw', scene: parseExcalidrawScene(text) }
  }
  return { kind: 'flowchart', document: parseFlowJson(text) }
}

async function checkEmbeddedImages(scene: ArchitectureScene): Promise<void> {
  await Promise.all(Object.entries(scene.files).map(([id, file]) => new Promise<void>((resolve, reject) => {
    const image = new Image()
    const timeout = window.setTimeout(() => finish(new Error(`Image “${id}” could not be decoded. Re-export the drawing with embedded images.`)), 10_000)
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      if (error) reject(error)
      else resolve()
    }
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? undefined : new Error(`Image “${id}” is empty or corrupt.`))
    image.onerror = () => finish(new Error(`Image “${id}” is corrupt or unsupported. Re-export it with embedded images.`))
    image.src = file.dataURL as string
  })))
}

const MAX_FLOWCHART_FILE_BYTES = 64 * 1024 * 1024

/** All picker and drop routes use the same validation, including actual image decoding. */
export async function readDiagramFile(file: File): Promise<DiagramImport> {
  if (!file.size) throw new Error('This file is empty. Choose a saved .json or .excalidraw drawing.')
  // Excalidraw scenes keep their own 4 MiB limit, enforced by parseExcalidrawScene.
  // Flowchart JSON may be as large as a board the browser autosaves, so a board
  // saved to a file can always be opened again.
  if (file.size > MAX_FLOWCHART_FILE_BYTES) throw new Error('This file exceeds the 64 MiB import limit. Use smaller images or split the drawing.')
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read the selected file. Try selecting it again.'))
    reader.readAsText(file)
  })
  const parsed = parseDiagramFile(text)
  if (parsed.kind === 'excalidraw') await checkEmbeddedImages(parsed.scene)
  return parsed
}

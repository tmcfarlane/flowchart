import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDiagramFile, readDiagramFile } from '../utils/diagramImport'
import { serializeFlow } from '../utils/exportUtils'

const sceneFile = readFileSync(`${process.cwd()}/src/test/fixtures/excalidraw/architecture-complete.excalidraw`, 'utf8')

function imageDecoder(succeeds: boolean) {
  vi.stubGlobal('Image', class {
    naturalWidth = 1
    naturalHeight = 1
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => succeeds ? this.onload?.() : this.onerror?.()) }
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('shared file-picker and canvas-drop import route', () => {
  it('keeps legacy native Flowchart JSON compatible', () => {
    const document = { nodes: [{ id: 'n1', position: { x: -10, y: 20 }, data: { label: 'Existing' } }], edges: [], mode: 'flowchart' }
    expect(parseDiagramFile(JSON.stringify(document))).toMatchObject({ kind: 'flowchart', document })
  })

  it('detects Excalidraw by contents even for a .json file with an empty OS MIME type', async () => {
    imageDecoder(true)
    const result = await readDiagramFile(new File([sceneFile], 'system.json', { type: '' }))
    expect(result.kind).toBe('excalidraw')
    if (result.kind === 'excalidraw') expect(result.scene.elements).toHaveLength(9)
  })

  it('rejects corrupt embedded image bytes before returning an import candidate', async () => {
    imageDecoder(false)
    await expect(readDiagramFile(new File([sceneFile], 'corrupt-image.excalidraw'))).rejects.toThrow(/image.*corrupt|unsupported/i)
  })

  it('rejects an empty file with an actionable message', async () => {
    await expect(readDiagramFile(new File([], 'empty.excalidraw'))).rejects.toThrow(/empty/i)
  })

  it('rejects malformed JSON without relying on its extension', () => {
    expect(() => parseDiagramFile('{broken')).toThrow(/valid JSON/i)
  })
})

describe('file size limits', () => {
  it('opens Flowchart JSON larger than the Excalidraw limit', async () => {
    const image = 'data:image/png;base64,' + 'A'.repeat(95000)
    const nodes = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), type: 'image', position: { x: i * 10, y: 0 }, data: { label: `Image ${i}`, imageUrl: image } }))
    const text = serializeFlow(nodes, [], 'flowchart')
    expect(text.length).toBeGreaterThan(4 * 1024 * 1024)
    const opened = await readDiagramFile(new File([text], 'big.json', { type: 'application/json' }))
    expect(opened.kind === 'flowchart' && opened.document.nodes).toHaveLength(50)
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateArchitectureScene, type ArchitectureScene } from '../../shared/architectureScene'
import { ArchitectureSceneSchema, CreateFlowBodySchema, ReplaceFlowBodySchema, StoredChartSchema } from '../../shared/flowSchema'
import { FlowService } from '../../shared/server/flowService'
import { MemoryFlowStore } from '../../shared/server/store'

const rectangle = { id: 'rect', type: 'rectangle', x: -80, y: 120, width: 200, height: 80, angle: 0.3, strokeColor: '#343a40', groupIds: ['group1'], frameId: null, boundElements: [{ id: 'text', type: 'text' }] }
const text = { id: 'text', type: 'text', x: -60, y: 140, width: 160, height: 30, angle: 0.3, text: 'API service', containerId: 'rect', fontFamily: 1, fontSize: 20 }
const scene = (): ArchitectureScene => ({ version: 1, elements: [structuredClone(rectangle), structuredClone(text)], files: {}, appState: { viewBackgroundColor: '#ffffff', gridSize: 20 } })

describe('versioned native architecture scene', () => {
  it('retains complete native geometry, relationships and unknown drawing properties', () => {
    const input = scene()
    input.elements[0].customData = { architectureType: 'service', protocol: 'HTTPS' }
    expect(validateArchitectureScene(input)).toEqual(input)
    expect(ArchitectureSceneSchema.parse(input)).toEqual(input)
    expect(CreateFlowBodySchema.parse({ nodes: [], architectureScene: input }).architectureScene).toEqual(input)
    expect(ReplaceFlowBodySchema.parse({ nodes: [], architectureScene: null }).architectureScene).toBeNull()
  })

  it('retains embedded images without flattening or external URLs', () => {
    const input = scene()
    input.files.picture = { id: 'picture', dataURL: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', created: 1 }
    input.elements.push({ id: 'image', type: 'image', x: 20, y: -20, width: 100, height: 80, angle: 0, fileId: 'picture' })
    expect(validateArchitectureScene(input)).toEqual(input)
    input.elements[2].fileId = 'toString'
    expect(() => validateArchitectureScene(input)).toThrow('missing image asset')
  })

  it('rejects invalid scene version, geometry, references and unsupported native elements before storage', () => {
    expect(() => validateArchitectureScene({ ...scene(), version: 9 })).toThrow('version')
    const nonfinite = scene()
    nonfinite.elements[0].x = Infinity
    expect(() => validateArchitectureScene(nonfinite)).toThrow('finite JSON')
    const missing = scene()
    missing.elements[1].containerId = 'missing'
    expect(() => validateArchitectureScene(missing)).toThrow('missing element')
    const unsupported = scene()
    unsupported.elements[0].type = 'future-unknown-tool'
    expect(() => validateArchitectureScene(unsupported)).toThrow('unsupported type')
    const duplicate = scene()
    duplicate.elements[1].id = 'rect'
    expect(() => validateArchitectureScene(duplicate)).toThrow('duplicated')
  })

  it('rejects unsafe nested properties and oversized assets', () => {
    const unsafe = scene()
    unsafe.elements[0].customData = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(() => validateArchitectureScene(unsafe)).toThrow('unsafe property')
    const oversized = scene()
    oversized.files.image = { id: 'image', dataURL: 'data:image/png;base64,' + 'x'.repeat(4 * 1024 * 1024) }
    expect(() => validateArchitectureScene(oversized)).toThrow('drawing limit')
  })
})

describe('shared drawing persistence', () => {
  it('stores and returns scenes, preserves them on graph-only edits, and permits explicit removal', async () => {
    const service = new FlowService({ store: new MemoryFlowStore() })
    const drawing = scene()
    const created = await service.create({ title: 'Native sketch', nodes: [], architectureScene: drawing, source: 'api' })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.message)
    const { id } = created.chart
    expect(StoredChartSchema.parse(created.chart).architectureScene).toEqual(drawing)
    expect((await service.get(id))?.architectureScene).toEqual(drawing)
    const patched = await service.applyOperations(id, created.editToken, { operations: [{ op: 'add_node', node: { id: 'api', type: 'service', label: 'API', position: { x: 0, y: 0 } } }], source: 'mcp' })
    expect(patched.ok && patched.chart.architectureScene).toEqual(drawing)
    const legacyPut = await service.replace(id, created.editToken, { nodes: [], source: 'api' })
    expect(legacyPut.ok && legacyPut.chart.architectureScene).toEqual(drawing)
    const changed = scene()
    changed.elements[0].angle = 0.8
    const replacement = await service.replace(id, created.editToken, { nodes: [], architectureScene: changed, source: 'api' })
    expect(replacement.ok && replacement.chart.architectureScene).toEqual(changed)
    const cleared = await service.replace(id, created.editToken, { nodes: [], architectureScene: null, source: 'api' })
    expect(cleared.ok).toBe(true)
    expect(cleared.ok && cleared.chart).not.toHaveProperty('architectureScene')
  })

  it('accepts bounded image-bearing drawings larger than the legacy graph cap', async () => {
    const drawing = scene()
    drawing.files.picture = { id: 'picture', dataURL: 'data:image/png;base64,' + 'x'.repeat(300 * 1024), mimeType: 'image/png' }
    const service = new FlowService({ store: new MemoryFlowStore() })
    const result = await service.create({ title: 'Image sketch', nodes: [], architectureScene: drawing, source: 'api' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.chart.architectureScene).toEqual(drawing)
  })
})

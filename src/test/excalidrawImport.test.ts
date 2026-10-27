// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseExcalidrawScene, prepareSceneInsertion, prepareSceneOpen, getExcalidrawCompatibilityNotes, EXCALIDRAW_IMPORT_LIMITS } from '../utils/excalidrawImport'

const fixture = (name = 'architecture-complete.excalidraw') =>
  readFileSync(new URL(`./fixtures/excalidraw/${name}`, import.meta.url), 'utf8')

const source = () => JSON.parse(fixture()) as {
  type: string
  version: number
  elements: Array<Record<string, unknown>>
  appState: Record<string, unknown>
  files: Record<string, Record<string, unknown>>
}

const parse = (data: unknown) => parseExcalidrawScene(JSON.stringify(data))
const byId = (elements: Array<Record<string, unknown>>, id: string) => elements.find((element) => element.id === id)!

function refs(scene: ReturnType<typeof parseExcalidrawScene>) {
  const ids = new Set(scene.elements.map((element) => element.id))
  for (const element of scene.elements) {
    for (const key of ['containerId', 'frameId']) {
      if (element[key]) expect(ids.has(element[key])).toBe(true)
    }
    for (const key of ['startBinding', 'endBinding']) {
      const binding = element[key] as { elementId?: string } | null
      if (binding) expect(ids.has(binding.elementId)).toBe(true)
    }
    for (const binding of (element.boundElements ?? []) as Array<{ id: string }>) {
      expect(ids.has(binding.id)).toBe(true)
    }
    if (element.fileId) expect(scene.files).toHaveProperty(element.fileId as string)
  }
}

describe('Excalidraw file interoperability', () => {
  it('imports an actual Excalidraw-exported fixture without requiring an editor runtime', () => {
    const text = fixture('native-editor-roundtrip.excalidraw')
    const exported = JSON.parse(text)
    const scene = parseExcalidrawScene(text)
    expect(scene.elements).toEqual(exported.elements)
    expect(scene.files).toEqual(exported.files)
    expect(scene.elements.map((element) => element.type)).toEqual(expect.arrayContaining(['rectangle', 'ellipse', 'text', 'arrow', 'frame', 'freedraw', 'image']))
    refs(scene)
  })

  it('preserves editable shapes, bound labels/arrows, rotation, frames, groups, pen pressure, and image bytes', () => {
    const original = source()
    const scene = parseExcalidrawScene(fixture())
    expect(scene.version).toBe(1)
    expect(scene.elements).toHaveLength(9)
    expect(scene.elements.some((element) => element.isDeleted)).toBe(false)
    for (const id of ['api-label', 'orders-db', 'request-arrow', 'request-label', 'annotation', 'logo-image', 'platform-frame', 'independent-note']) {
      expect(byId(scene.elements, id)).toEqual(byId(original.elements, id))
    }
    expect(byId(scene.elements, 'api-service')).toMatchObject({
      angle: 0.17,
      x: -250,
      y: -100,
      groupIds: ['backend'],
      frameId: 'platform-frame',
      fillStyle: 'cross-hatch',
      backgroundColor: '#d0ebff',
      strokeStyle: 'dashed',
      customData: { fixtureRole: 'service' },
    })
    expect((byId(scene.elements, 'api-service').boundElements as Array<{id: string}>).map((entry) => entry.id)).toEqual(['api-label', 'request-arrow'])
    expect(scene.files).toEqual(original.files)
    expect(scene.appState).toEqual({ viewBackgroundColor: '#f8f9fa', gridSize: 20 })
    refs(scene)
  })

  it('does not allow an imported drawing to claim existing semantic graph IDs', () => {
    const original = source()
    byId(original.elements, 'api-service').customData = {
      flowchart: { nodeId: 'existing-canvas-node', kind: 'node' },
      fixtureRole: 'service',
    }
    expect(byId(parse(original).elements, 'api-service').customData).toEqual({ fixtureRole: 'service' })
  })

  it('accepts the documented version 1 envelope and detects contents without relying on a file extension or MIME type', () => {
    const original = source()
    original.version = 1
    expect(parse(original).elements).toHaveLength(9)
  })

  it.each(['empty.excalidraw', 'future-version.excalidraw', 'corrupt.excalidraw'])(
    'rejects %s before it can replace a document', (name) => {
      expect(() => parseExcalidrawScene(fixture(name))).toThrow()
    },
  )

  it.each([null, [], 'text', {}, { type: 'not-excalidraw', version: 2, elements: [] }])(
    'rejects invalid envelopes %# with a readable error', (data) => {
      expect(() => parse(data)).toThrow(/excalidraw|scene|file|JSON/i)
    },
  )

  it('rejects nonfinite coordinates and malformed path geometry', () => {
    const invalidCoordinate = source()
    invalidCoordinate.elements[1].x = 'somewhere'
    expect(() => parse(invalidCoordinate)).toThrow(/geometry|coordinate|number|x/i)
    const invalidPoints = source()
    byId(invalidPoints.elements, 'annotation').points = [[0, 0], ['invalid', 3]]
    expect(() => parse(invalidPoints)).toThrow(/point|path|coordinate|geometry|number/i)
  })

  it('rejects negative shape dimensions and duplicate element IDs', () => {
    const invalidSize = source()
    invalidSize.elements[1].width = -100
    expect(() => parse(invalidSize)).toThrow(/size|width|geometry|positive|negative/i)
    const duplicate = source()
    duplicate.elements.push({ ...duplicate.elements[1] })
    expect(() => parse(duplicate)).toThrow(/duplicate|unique|ID/i)
  })

  it('rejects a missing shape/frame/arrow/text relationship rather than silently detaching it', () => {
    for (const [id, field, value] of [
      ['api-label', 'containerId', 'missing'],
      ['api-service', 'frameId', 'missing'],
      ['request-arrow', 'startBinding', { elementId: 'missing', focus: 0, gap: 0 }],
      ['orders-db', 'boundElements', [{ id: 'missing', type: 'text' }]],
    ] as const) {
      const scene = source()
      byId(scene.elements, id)[field] = value
      expect(() => parse(scene)).toThrow(/reference|missing|binding|exist|bound|frame|container/i)
    }
  })

  it('clears bindings to deleted elements while keeping the surviving drawing editable', () => {
    const original = source()
    byId(original.elements, 'request-arrow').endBinding = { elementId: 'deleted-shape', focus: 0, gap: 5 }
    const scene = parse(original)
    expect(byId(scene.elements, 'request-arrow').endBinding).toBeNull()
    expect(byId(scene.elements, 'request-arrow').points).toEqual(byId(original.elements, 'request-arrow').points)
  })

  it('rejects malformed label and connector associations before applying a scene', () => {
    const wrongContainer = source()
    byId(wrongContainer.elements, 'api-label').containerId = 'request-label'
    expect(() => parse(wrongContainer)).toThrow(/container/i)
    const wrongBoundType = source()
    byId(wrongBoundType.elements, 'orders-db').boundElements = [{ id: 'request-arrow', type: 'text' }]
    expect(() => parse(wrongBoundType)).toThrow(/bound.*type/i)
    const badGap = source()
    byId(badGap.elements, 'request-arrow').startBinding = { elementId: 'api-service', focus: 0, gap: 'nearby' }
    expect(() => parse(badGap)).toThrow(/binding|gap/i)
  })

  it('identifies unsupported live elements before any content is applied; deleted unsupported elements are harmless', () => {
    for (const type of ['embeddable', 'iframe', 'magicframe', 'unknown-tool']) {
      const original = source()
      original.elements[1].type = type
      expect(() => parse(original)).toThrow(new RegExp(type, 'i'))
    }
    const deleted = source()
    byId(deleted.elements, 'deleted-shape').type = 'iframe'
    expect(parse(deleted).elements).toHaveLength(9)
  })

  it('requires image assets to exist and validates embedded data before changing a scene', () => {
    const missing = source()
    missing.files = {}
    expect(() => parse(missing)).toThrow(/image|asset|file/i)
    byId(missing.elements, 'logo-image').fileId = 'toString'
    expect(() => parse(missing)).toThrow(/image|asset|file/i)
    const malformed = source()
    malformed.files['asset-logo'].dataURL = 'https://example.com/remote-image.png'
    expect(() => parse(malformed)).toThrow(/embedded|data|image|asset/i)
    const wrongType = source()
    wrongType.files['asset-logo'].mimeType = 'text/html'
    expect(() => parse(wrongType)).toThrow(/image|mime|type|asset/i)
  })

  it('enforces element, asset, and encoded file size limits', () => {
    const tooMany = source()
    tooMany.elements = Array.from({ length: EXCALIDRAW_IMPORT_LIMITS.maxElements + 1 }, (_, i) => ({
      id: `rectangle-${i}`, type: 'rectangle', x: 0, y: 0, width: 100, height: 100, isDeleted: false,
    }))
    expect(() => parse(tooMany)).toThrow(/element|limit|many/i)
    const tooBig = source()
    tooBig.appState.unused = 'é'.repeat(Math.ceil(EXCALIDRAW_IMPORT_LIMITS.maxBytes / 2))
    expect(() => parse(tooBig)).toThrow(/size|large|MiB|byte|limit/i)
    const tooManyAssets = source()
    tooManyAssets.files = Object.fromEntries(Array.from({ length: EXCALIDRAW_IMPORT_LIMITS.maxFiles + 1 }, (_, i) => [`asset-${i}`, {
      ...tooManyAssets.files['asset-logo'], id: `asset-${i}`,
    }]))
    expect(() => parse(tooManyAssets)).toThrow(/asset|file|100|limit|many/i)
  })
})

describe('custom Draw import compatibility', () => {
  it('explains local font, sketch-fill, and pressure rendering differences before import', () => {
    const scene = parseExcalidrawScene(fixture())
    const before = JSON.stringify(scene)
    const notes = getExcalidrawCompatibilityNotes(scene)
    expect(notes).toHaveLength(3)
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/font.*fallback|fallback.*font/i),
      expect.stringMatching(/sketch|patterned|texture/i),
      expect.stringMatching(/pressure|freehand/i),
    ]))
    expect(JSON.stringify(scene)).toBe(before)
  })

  it('identifies pinned elbow constraints while preserving their editable path data', () => {
    const original = source()
    const arrow = byId(original.elements, 'request-arrow')
    arrow.elbowed = true
    arrow.fixedSegments = [{ index: 1, start: [0, 0], end: [135, -30] }]
    const scene = parse(original)
    expect(byId(scene.elements, 'request-arrow')).toMatchObject({
      points: arrow.points,
      elbowed: true,
      fixedSegments: arrow.fixedSegments,
    })
    const notes = getExcalidrawCompatibilityNotes(scene)
    expect(notes).toHaveLength(4)
    expect(notes).toContainEqual(expect.stringMatching(/fixed.*elbow|elbow.*segment|constraint/i))
  })

  it('does not show irrelevant compatibility notes for clean sans-serif and monospace drawings', () => {
    const original = source()
    for (const element of original.elements) {
      element.roughness = 0
      element.fillStyle = 'solid'
      if (element.type === 'text') element.fontFamily = element.id === 'api-label' ? 2 : 3
      if (element.type === 'freedraw') element.pressures = []
    }
    expect(getExcalidrawCompatibilityNotes(parse(original))).toEqual([])
  })

  it.each([
    ['api-service', 'fillStyle', 'gradient'],
    ['api-service', 'strokeStyle', 'double'],
    ['api-label', 'textAlign', 'justify'],
    ['api-label', 'verticalAlign', 'baseline'],
    ['request-arrow', 'endArrowhead', 'sparkles'],
    ['request-arrow', 'startArrowhead', 'sparkles'],
    ['api-service', 'roundness', { type: 99 }],
    ['api-label', 'fontSize', 0],
    ['api-label', 'lineHeight', 0],
    ['api-label', 'fontFamily', 'unavailable-font'],
  ])('rejects unsupported %s.%s before a scene can be applied', (id, field, value) => {
    const original = source()
    byId(original.elements, id as string)[field as string] = value
    expect(() => parse(original)).toThrow(/Draw|invalid|supported|positive/i)
  })

  it('retains supported styling, typography, rotation, crops, and image flipping', () => {
    const original = source()
    Object.assign(byId(original.elements, 'api-service'), {
      angle: 0.4, opacity: 61, strokeColor: '#1864ab', strokeWidth: 3,
      strokeStyle: 'dotted', fillStyle: 'zigzag', roughness: 2, roundness: { type: 2 },
    })
    Object.assign(byId(original.elements, 'api-label'), {
      fontFamily: 3, fontSize: 18, lineHeight: 1.4, textAlign: 'right', verticalAlign: 'bottom',
    })
    Object.assign(byId(original.elements, 'logo-image'), {
      scale: [-1, 1], crop: { x: 10, y: 20, width: 40, height: 30, naturalWidth: 120, naturalHeight: 80 },
    })
    const scene = parse(original)
    for (const id of ['api-service', 'api-label', 'logo-image']) {
      const expected = { ...byId(original.elements, id) }
      if (id === 'api-service') {
        expected.boundElements = (expected.boundElements as Array<{ id: string }>).filter((bound) => bound.id !== 'deleted-label')
      }
      expect(byId(scene.elements, id)).toEqual(expected)
    }
  })

  it.each([
    'arrow', 'triangle', 'triangle_outline', 'bar', 'dot', 'dot_outline',
    'diamond', 'diamond_outline', 'circle', 'circle_outline',
    'crowfoot_one', 'crowfoot_many', 'crowfoot_one_or_many',
  ])('retains the supported %s arrowhead at both ends', (arrowhead) => {
    const original = source()
    Object.assign(byId(original.elements, 'request-arrow'), { startArrowhead: arrowhead, endArrowhead: arrowhead })
    expect(byId(parse(original).elements, 'request-arrow')).toMatchObject({ startArrowhead: arrowhead, endArrowhead: arrowhead })
  })

  it.each([
    { x: 0, y: 0, width: 0, height: 30, naturalWidth: 100, naturalHeight: 100 },
    { x: -1, y: 0, width: 20, height: 30, naturalWidth: 100, naturalHeight: 100 },
    { x: 90, y: 0, width: 20, height: 30, naturalWidth: 100, naturalHeight: 100 },
    { x: 0, y: 90, width: 20, height: 30, naturalWidth: 100, naturalHeight: 100 },
    { x: 0, y: 0, width: 20, height: 30, naturalWidth: 100 },
    { x: 0, y: 0, width: '20', height: 30, naturalWidth: 100, naturalHeight: 100 },
  ])('rejects malformed or out-of-bounds image crop %# before applying', (crop) => {
    const original = source()
    byId(original.elements, 'logo-image').crop = crop
    expect(() => parse(original)).toThrow(/crop/i)
  })

  it.each([[[0, 1]], [[2, 1]], [[-1]], [['flip', 1]]])('rejects an invalid image flip transform %#', (scale) => {
    const original = source()
    byId(original.elements, 'logo-image').scale = scale
    expect(() => parse(original)).toThrow(/flip|transform/i)
  })
})

describe('opening an Excalidraw scene', () => {
  it('namespaces exported semantic IDs without moving or flattening any native geometry', () => {
    const imported = parseExcalidrawScene(fixture().split('"api-service"').join('"fc-node-2"'))
    expect(imported.elements.some((element) => element.id === 'fc-node-2')).toBe(true)
    const before = JSON.stringify(imported)
    const opened = prepareSceneOpen(imported)
    expect(JSON.stringify(imported)).toBe(before)
    expect(opened.elements).toHaveLength(imported.elements.length)
    expect(opened.elements.every((element) => !(element.id as string).startsWith('fc-'))).toBe(true)
    expect(opened.elements.every((element) => !imported.elements.some((original) => original.id === element.id))).toBe(true)
    expect(new Set(opened.elements.map((element) => element.id)).size).toBe(opened.elements.length)
    const referenceFields = new Set(['id', 'groupIds', 'frameId', 'containerId', 'startBinding', 'endBinding', 'boundElements', 'boundElementIds', 'fileId'])
    const geometryAndAppearance = (element: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(element).filter(([key]) => !referenceFields.has(key)))
    opened.elements.forEach((element, index) => {
      expect(geometryAndAppearance(element)).toEqual(geometryAndAppearance(imported.elements[index]))
    })
    expect(opened.appState).toEqual(imported.appState)
    expect(Object.keys(opened.files)).toHaveLength(Object.keys(imported.files).length)
    expect(Object.keys(opened.files).every((id) => !(id in imported.files))).toBe(true)
    const originalImage = Object.values(imported.files)[0]
    const openedImage = Object.values(opened.files)[0]
    expect(openedImage.dataURL).toBe(originalImage.dataURL)
    expect(openedImage.mimeType).toBe(originalImage.mimeType)
    refs(opened)
  })
})

describe('inserting an Excalidraw scene', () => {
  it('rejects a combined document that would exceed the asset limit before insertion', () => {
    const original = source()
    const logo = original.files['asset-logo']
    original.files = Object.fromEntries(Array.from({ length: Math.ceil(EXCALIDRAW_IMPORT_LIMITS.maxFiles / 2) + 1 }, (_, i) => {
      const id = i === 0 ? 'asset-logo' : `extra-asset-${i}`
      return [id, { ...logo, id }]
    }))
    const imported = parse(original)
    const before = JSON.stringify(imported)
    expect(() => prepareSceneInsertion(imported, imported, { x: 1000, y: 0 })).toThrow(/image|asset|file|limit|100/i)
    expect(JSON.stringify(imported)).toBe(before)
  })

  it('retains the current document and remaps every imported element, group, asset, and relationship', () => {
    const imported = parseExcalidrawScene(fixture())
    const current = parseExcalidrawScene(fixture())
    const before = JSON.stringify(current)
    const merged = prepareSceneInsertion(imported, current, { x: 1000, y: 500 })
    expect(JSON.stringify(current)).toBe(before)
    expect(merged.elements).toHaveLength(18)
    expect(merged.elements.slice(0, 9)).toEqual(current.elements)
    const inserted = merged.elements.slice(9)
    const originalIds = new Set(imported.elements.map((element) => element.id))
    expect(inserted.every((element) => !originalIds.has(element.id))).toBe(true)
    expect(new Set(merged.elements.map((element) => element.id)).size).toBe(18)
    expect(Object.keys(merged.files)).toHaveLength(2)
    const originalGroups = new Set(imported.elements.flatMap((element) => element.groupIds as string[]))
    expect(inserted.flatMap((element) => element.groupIds as string[]).every((id) => !originalGroups.has(id))).toBe(true)
    expect(merged.appState).toEqual(current.appState)
    refs(merged)
  })

  it('places negative-coordinate artwork as one unit centered at the requested canvas point', () => {
    const imported = parseExcalidrawScene(fixture())
    const inserted = prepareSceneInsertion(imported, undefined, { x: 1000, y: -400 })
    const originalFirst = imported.elements[0]
    const insertedFirst = inserted.elements[0]
    const dx = (insertedFirst.x as number) - (originalFirst.x as number)
    const dy = (insertedFirst.y as number) - (originalFirst.y as number)
    for (let i = 0; i < imported.elements.length; i++) {
      expect(inserted.elements[i].x).toBe((imported.elements[i].x as number) + dx)
      expect(inserted.elements[i].y).toBe((imported.elements[i].y as number) + dy)
      expect(inserted.elements[i].width).toBe(imported.elements[i].width)
      expect(inserted.elements[i].height).toBe(imported.elements[i].height)
      expect(inserted.elements[i].angle).toBe(imported.elements[i].angle)
      if (imported.elements[i].points) expect(inserted.elements[i].points).toEqual(imported.elements[i].points)
    }
    // The frame defines the complete fixture's bounds: (-350, -200) through (450, 400).
    expect(dx).toBe(950)
    expect(dy).toBe(-500)
    expect(inserted.appState).toEqual(imported.appState)
    refs(inserted)
  })

  it('centers an up-left arrow at the insertion point using its visible negative path extents', () => {
    const points = [[0, 0], [-200, -100]]
    const imported = parse({
      type: 'excalidraw', version: 2,
      elements: [{ id: 'up-left', type: 'arrow', x: 100, y: 100, width: 200, height: 100, angle: 0, points }],
      files: {},
    })
    const point = { x: 500, y: 500 }
    const inserted = prepareSceneInsertion(imported, undefined, point).elements[0]
    // The source endpoints are (100,100) and (-100,0), centered at (0,50).
    // Translating by (500,450) centers the actual stroke at the requested point.
    expect(inserted.x).toBe(600)
    expect(inserted.y).toBe(550)
    expect(inserted.points).toEqual(points)
    expect(inserted.angle).toBe(0)
    const first = { x: inserted.x as number, y: inserted.y as number }
    const last = { x: first.x - 200, y: first.y - 100 }
    expect((first.x + last.x) / 2).toBe(point.x)
    expect((first.y + last.y) / 2).toBe(point.y)
  })

  it.each(['arrow', 'line'])('centers a rotated multipoint %s by its transformed visible bounds', (type) => {
    const points = [[0, 0], [-200, 0], [-50, -100]]
    const angle = Math.PI / 4
    const imported = parse({
      type: 'excalidraw', version: 2,
      elements: [{ id: 'rotated-path', type, x: 100, y: 100, width: 200, height: 100, angle, points }],
      files: {},
    })
    const point = { x: -350, y: 720 }
    const inserted = prepareSceneInsertion(imported, undefined, point).elements[0]
    // Rotate the three world points around (0,50) by 45 degrees. Their bounds
    // are x=[-150/sqrt(2),100/sqrt(2)], y=[50-50/sqrt(2),50+150/sqrt(2)].
    // This asymmetric path's visible bounds are not centered on its rotation pivot.
    const sourceCenter = { x: -25 / Math.SQRT2, y: 50 + 50 / Math.SQRT2 }
    const dx = (inserted.x as number) - 100
    const dy = (inserted.y as number) - 100
    expect(sourceCenter.x + dx).toBeCloseTo(point.x, 8)
    expect(sourceCenter.y + dy).toBeCloseTo(point.y, 8)
    expect(inserted.x).toBeCloseTo(100 + point.x - sourceCenter.x, 8)
    expect(inserted.y).toBeCloseTo(100 + point.y - sourceCenter.y, 8)
    expect(inserted.points).toEqual(points)
    expect(inserted.angle).toBe(angle)
    expect(inserted.width).toBe(200)
    expect(inserted.height).toBe(100)
  })

  it('centers rotated freehand artwork and a companion shape as one unit without changing their geometry', () => {
    const points = [[0, 0], [-200, 0], [-50, -100]]
    const pressures = [0.3, 0.9, 0.5]
    const angle = Math.PI / 4
    const imported = parse({
      type: 'excalidraw', version: 2,
      elements: [
        { id: 'pen', type: 'freedraw', x: 100, y: 100, width: 200, height: 100, angle, points, pressures, simulatePressure: false, groupIds: ['artwork'] },
        { id: 'companion', type: 'rectangle', x: 200, y: 200, width: 20, height: 40, angle: 0, groupIds: ['artwork'] },
      ],
      files: {},
    })
    const point = { x: 600, y: -250 }
    const inserted = prepareSceneInsertion(imported, undefined, point).elements
    const stroke = inserted[0]
    const companion = inserted[1]
    // The freehand path supplies min x=-150/sqrt(2), min y=50-50/sqrt(2).
    // The companion supplies max x=220 and max y=240 for the combined bounds.
    const sourceCenter = { x: 110 - 75 / Math.SQRT2, y: 145 - 25 / Math.SQRT2 }
    const dx = (stroke.x as number) - 100
    const dy = (stroke.y as number) - 100
    expect(sourceCenter.x + dx).toBeCloseTo(point.x, 8)
    expect(sourceCenter.y + dy).toBeCloseTo(point.y, 8)
    expect((companion.x as number) - (stroke.x as number)).toBeCloseTo(100, 8)
    expect((companion.y as number) - (stroke.y as number)).toBeCloseTo(100, 8)
    expect(stroke).toMatchObject({ points, pressures, angle, simulatePressure: false, width: 200, height: 100 })
    expect(companion).toMatchObject({ angle: 0, width: 20, height: 40 })
    expect(stroke.groupIds).toEqual(companion.groupIds)
    expect(stroke.groupIds).not.toEqual(['artwork'])
  })

  it('makes repeated insertion independent even when source IDs collide with both the existing document and previous imports', () => {
    const imported = parseExcalidrawScene(fixture())
    const once = prepareSceneInsertion(imported, imported, { x: 1000, y: 0 })
    const twice = prepareSceneInsertion(imported, once, { x: 2000, y: 0 })
    expect(twice.elements).toHaveLength(27)
    expect(new Set(twice.elements.map((element) => element.id)).size).toBe(27)
    expect(Object.keys(twice.files)).toHaveLength(3)
    const originals = new Set(imported.elements.map((element) => element.id))
    for (const element of twice.elements.slice(9)) {
      if (element.containerId) expect(originals.has(element.containerId)).toBe(false)
      if (element.frameId) expect(originals.has(element.frameId)).toBe(false)
      for (const key of ['startBinding', 'endBinding']) {
        const binding = element[key] as { elementId?: string } | null
        if (binding) expect(originals.has(binding.elementId)).toBe(false)
      }
    }
    refs(twice)
  })
})

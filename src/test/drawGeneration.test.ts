import { describe, expect, it } from 'vitest'
import { validateArchitectureScene, type ArchitectureScene } from '../shared/architectureScene'
import { DrawGenerationContextSchema, type DrawProposal } from '../shared/drawGeneration'
import { captureDrawGenerationContext, drawProposalToScene } from '../utils/drawGeneration'
import { getElementBounds, getWorldPoints, moveElements, rerouteBindings, type DrawElement } from '../utils/drawScene'
import { prepareSceneInsertion } from '../utils/excalidrawImport'
import { drawingTextSize } from '../utils/drawText'

const proposal: DrawProposal = {
  outputMode: 'draw', summary: 'A small system sketch', elements: [
    { id: 'ai-label-0', type: 'rectangle', x: 0, y: 0, width: 180, height: 80, label: 'Send request', strokeColor: '#123456', backgroundColor: '#ffffff' },
    { id: 'right', type: 'ellipse', x: 300, y: 0, width: 160, height: 80, label: 'Receive', strokeColor: '#123456', backgroundColor: 'transparent' },
    { id: 'caption', type: 'text', x: 30, y: 150, text: 'An independent note', fontSize: 20, strokeColor: '#123456' },
    { id: 'line', type: 'line', points: [{ x: 50, y: 210 }, { x: -10, y: 250 }, { x: 80, y: 250 }], sourceId: null, targetId: null, label: '', strokeColor: '#123456' },
    { id: 'pen', type: 'freedraw', points: [{ x: 300, y: 200 }, { x: 310, y: 220 }, { x: 340, y: 210 }], sourceId: null, targetId: null, label: '', strokeColor: '#123456' },
    { id: 'link', type: 'arrow', points: [{ x: 180, y: 40 }, { x: 300, y: 40 }], sourceId: 'ai-label-0', targetId: 'right', label: 'HTTPS', strokeColor: '#123456' },
  ],
}

const element = (scene: ArchitectureScene, id: string) => scene.elements.find(item => item.id === id) as DrawElement

const horizontalProposal: DrawProposal = {
  outputMode: 'draw', summary: '', elements: [
    { id: 'arrow', type: 'arrow', points: [{ x: 320, y: 265 }, { x: 900, y: 265 }], sourceId: 'left', targetId: 'right', label: 'Next', strokeColor: '#123456' },
    { id: 'left', type: 'rectangle', x: 80, y: 180, width: 240, height: 170, label: 'Prepare tonight\nSet out clothes, water, and anything you need for the morning. Keep a bedtime that gives you enough time to sleep.', strokeColor: '#123456', backgroundColor: '#ffffff' },
    { id: 'right', type: 'rectangle', x: 900, y: 180, width: 240, height: 170, label: 'Keep a steady time', strokeColor: '#123456', backgroundColor: '#ffffff' },
  ],
}

describe('native Draw generation', () => {
  it('fits a native frame around final members and their labels regardless of proposal order', () => {
    const framed: DrawProposal = { ...horizontalProposal, elements: [
      horizontalProposal.elements[0],
      { id: 'region', type: 'frame', x: 100, y: 200, width: 80, height: 80, name: 'Morning preparation', children: ['left', 'arrow'] },
      ...horizontalProposal.elements.slice(1),
    ] }
    const drawing = drawProposalToScene(framed)
    expect(drawing.elements[0]).toMatchObject({ id: 'region', type: 'frame', name: 'Morning preparation' })
    expect(drawing.elements.filter(item => item.type !== 'frame').map(item => item.id)).toEqual(drawProposalToScene(horizontalProposal).elements.map(item => item.id))
    const region = element(drawing, 'region')
    const members = drawing.elements.filter(item => item.frameId === 'region') as DrawElement[]
    expect(members.map(item => item.id)).toEqual(expect.arrayContaining(['left', 'arrow']))
    expect(members.some(item => item.type === 'text' && item.containerId === 'left')).toBe(true)
    expect(members.some(item => item.type === 'text' && item.containerId === 'arrow')).toBe(true)
    expect(element(drawing, 'right').frameId).toBeNull()
    for (const member of members) {
      const bounds = getElementBounds(member)
      expect(bounds.x - region.x).toBeGreaterThanOrEqual(40)
      expect(bounds.y - region.y).toBeGreaterThanOrEqual(40)
      expect(region.x + region.width - bounds.x - bounds.width).toBeGreaterThanOrEqual(40)
      expect(region.y + region.height - bounds.y - bounds.height).toBeGreaterThanOrEqual(40)
    }
    expect(element(drawing, 'arrow').startBinding?.elementId).toBe('left')
    expect(getWorldPoints(element(drawing, 'arrow'))[0]).toEqual({ x: 320, y: 265 })
  })

  it('retains empty frame geometry while fitting a long title', () => {
    const drawing = drawProposalToScene({ outputMode: 'draw', summary: '', elements: [
      { id: 'blank', type: 'frame', x: 10, y: 20, width: 20, height: 50, name: 'A long mobile screen title', children: [] },
    ] })
    const frame = element(drawing, 'blank')
    expect(frame).toMatchObject({ type: 'frame', x: 10, y: 20, height: 50, name: 'A long mobile screen title' })
    expect(frame.width).toBeGreaterThanOrEqual(drawingTextSize(String(frame.name), { fontSize: 13, fontFamily: 2 }).width + 16)
  })

  it('leaves a cross-frame arrow outside both frames unless explicitly listed', () => {
    const drawing = drawProposalToScene({ outputMode: 'draw', summary: '', elements: [
      { id: 'arrow', type: 'arrow', points: [{ x: 200, y: 50 }, { x: 400, y: 50 }], sourceId: 'left', targetId: 'right', label: '', strokeColor: '#123456' },
      { id: 'left-frame', type: 'frame', x: -40, y: -40, width: 280, height: 180, name: 'Input', children: ['left'] },
      { id: 'right-frame', type: 'frame', x: 360, y: -40, width: 280, height: 180, name: 'Output', children: ['right'] },
      { id: 'left', type: 'rectangle', x: 0, y: 0, width: 200, height: 100, label: '', strokeColor: '#123456', backgroundColor: 'transparent' },
      { id: 'right', type: 'rectangle', x: 400, y: 0, width: 200, height: 100, label: '', strokeColor: '#123456', backgroundColor: 'transparent' },
    ] })
    expect(element(drawing, 'left').frameId).toBe('left-frame')
    expect(element(drawing, 'right').frameId).toBe('right-frame')
    expect(element(drawing, 'arrow').frameId).toBeNull()
    expect(element(drawing, 'arrow').startBinding?.elementId).toBe('left')
    expect(element(drawing, 'arrow').endBinding?.elementId).toBe('right')
  })

  it('accepts derived frame dimensions beyond authored limits and remaps members on repeated insert', () => {
    const drawing = drawProposalToScene({ outputMode: 'draw', summary: '', elements: [
      { id: 'far', type: 'text', x: 8000, y: 0, text: 'Far', fontSize: 20, strokeColor: '#123456' },
      { id: 'near', type: 'text', x: 0, y: 0, text: 'Near', fontSize: 20, strokeColor: '#123456' },
      { id: 'frame', type: 'frame', x: -40, y: -40, width: 80, height: 80, name: 'Wide section', children: ['near', 'far'] },
    ] })
    expect(element(drawing, 'frame').width).toBeGreaterThan(5000)
    const once = prepareSceneInsertion(drawing, undefined, { x: 0, y: 0 })
    const twice = prepareSceneInsertion(drawing, once, { x: 100, y: 100 })
    expect(validateArchitectureScene(twice)).toBe(twice)
    const frames = twice.elements.filter(item => item.type === 'frame') as DrawElement[]
    expect(frames).toHaveLength(2)
    for (const frame of frames) expect(twice.elements.filter(item => item.frameId === frame.id)).toHaveLength(2)
    const moved = moveElements(twice, [frames[1].id], { x: 30, y: 20 })
    expect(element(moved, frames[1].id).x).toBeCloseTo(frames[1].x + 30)
    expect(moved.elements.filter(item => item.frameId === frames[1].id).map(item => item.x)).toEqual(
      twice.elements.filter(item => item.frameId === frames[1].id).map(item => item.x + 30),
    )
  })
  it('materializes editable shapes, independent objects, measured text, and bound arrows', () => {
    const drawing = drawProposalToScene(proposal)
    expect(drawProposalToScene(proposal)).toEqual(drawing)
    expect(validateArchitectureScene(drawing)).toBe(drawing)
    expect(drawing.files).toEqual({})
    expect(drawing.elements).toHaveLength(9)
    expect(drawing.elements.every(item => !('customData' in item) && !('fileId' in item))).toBe(true)
    expect(element(drawing, 'caption')).toMatchObject({ type: 'text', text: 'An independent note', containerId: null })
    expect(element(drawing, 'caption').width).toBeGreaterThan(24)
    expect(element(drawing, 'line')).toMatchObject({ type: 'line', x: -10, y: 210, width: 90, height: 40, points: [[60, 0], [0, 40], [90, 40]] })
    expect(element(drawing, 'pen')).toMatchObject({ type: 'freedraw', points: [[0, 0], [10, 20], [40, 10]] })
    expect(element(drawing, 'link').startBinding?.elementId).toBe('ai-label-0')
    expect(element(drawing, 'link').endBinding?.elementId).toBe('right')
    expect(element(drawing, 'ai-label-0').boundElements).toEqual(expect.arrayContaining([
      { id: 'ai-label-1', type: 'text' }, { id: 'link', type: 'arrow' },
    ]))
    expect(element(drawing, 'link').boundElements).toContainEqual({ id: 'ai-label-3', type: 'text' })
    expect(element(drawing, 'ai-label-3')).toMatchObject({ containerId: 'link', text: 'HTTPS' })
  })

  it('keeps bindings when inserted and moving a generated shape', () => {
    const existing = { version: 1, elements: [element(drawProposalToScene(proposal), 'caption')], files: {} } satisfies ArchitectureScene
    const inserted = prepareSceneInsertion(drawProposalToScene(proposal), existing, { x: 600, y: 400 })
    expect(inserted.elements).toHaveLength(10)
    expect(inserted.elements[0]).toEqual(existing.elements[0])
    const added = inserted.elements.slice(1) as DrawElement[]
    const left = added.find(item => item.type === 'rectangle')!
    const arrow = added.find(item => item.type === 'arrow')!
    const label = added.find(item => item.type === 'text' && item.containerId === left.id)!
    expect(arrow.startBinding?.elementId).toBe(left.id)
    expect(left.boundElements).toContainEqual({ id: label.id, type: 'text' })
    const before = getWorldPoints(arrow)[0]
    const moved = moveElements(inserted, [left.id], { x: 40, y: 30 })
    expect(getWorldPoints(element(moved, arrow.id))[0]).not.toEqual(before)
    expect(element(moved, label.id)).toMatchObject({ containerId: left.id })
    expect(validateArchitectureScene(moved)).toBe(moved)
  })

  it('keeps a horizontal arrow straight after unequal label growth, insertion and rerouting', () => {
    const drawing = drawProposalToScene(horizontalProposal)
    expect(element(drawing, 'left').height).toBeGreaterThan(170)
    expect(element(drawing, 'right').height).toBe(170)
    const points = getWorldPoints(element(drawing, 'arrow'))
    expect(points[0]).toEqual({ x: 320, y: 265 })
    expect(points[1]).toEqual({ x: 900, y: 265 })
    expect(rerouteBindings(rerouteBindings(drawing))).toEqual(drawing)
    expect(element(drawing, 'arrow').startBinding?.elementId).toBe('left')
    expect(element(drawing, 'arrow').endBinding?.elementId).toBe('right')
    expect(element(drawing, 'left').boundElements).toContainEqual({ id: 'arrow', type: 'arrow' })

    const inserted = prepareSceneInsertion(drawing, undefined, { x: 600, y: 400 })
    const arrow = inserted.elements.find(item => item.type === 'arrow') as DrawElement
    const before = getWorldPoints(arrow)
    const moved = moveElements(inserted, [arrow.startBinding!.elementId], { x: 30, y: 0 })
    const after = getWorldPoints(element(moved, arrow.id))
    expect(after[0].x).toBeCloseTo(before[0].x + 30)
    expect(after[0].y).toBeCloseTo(before[0].y)
    expect(after[1]).toEqual(before[1])
    expect(after[0].y).toBeCloseTo(after[1].y)
  })

  it.each(['ellipse', 'diamond'] as const)('attaches horizontal arrows to the fitted %s contour', type => {
    const drawing = drawProposalToScene({ ...horizontalProposal, elements: horizontalProposal.elements.map(item => item.type === 'rectangle' ? { ...item, type } : item) })
    const points = getWorldPoints(element(drawing, 'arrow'))
    for (const [index, id] of ['left', 'right'].entries()) {
      const host = element(drawing, id), point = points[index]
      const dx = (point.x - host.x - host.width / 2) / (host.width / 2)
      const dy = (point.y - host.y - host.height / 2) / (host.height / 2)
      expect(point.y).toBeCloseTo(265)
      expect(type === 'ellipse' ? dx * dx + dy * dy : Math.abs(dx) + Math.abs(dy)).toBeCloseTo(1)
      expect(index === 0 ? dx : -dx).toBeGreaterThan(0)
    }
    expect(rerouteBindings(rerouteBindings(drawing))).toEqual(drawing)
  })

  it('accepts horizontal proposal points inside their bound hosts', () => {
    const drawing = drawProposalToScene({ ...horizontalProposal, elements: horizontalProposal.elements.map(item => item.type === 'arrow' ? { ...item, points: [{ x: 200, y: 265 }, { x: 1020, y: 265 }] } : item) })
    expect(getWorldPoints(element(drawing, 'arrow'))).toEqual([{ x: 320, y: 265 }, { x: 900, y: 265 }])
  })

  it.each([
    { name: 'diagonal', points: [{ x: 320, y: 265 }, { x: 900, y: 270 }] },
    { name: 'small deliberate diagonal', points: [{ x: 320, y: 265 }, { x: 900, y: 265.00000001 }] },
    { name: 'bent', points: [{ x: 320, y: 265 }, { x: 600, y: 300 }, { x: 900, y: 265 }] },
    { name: 'vertical', points: [{ x: 320, y: 265 }, { x: 320, y: 400 }] },
    { name: 'reversed', points: [{ x: 900, y: 265 }, { x: 320, y: 265 }], sourceId: 'right', targetId: 'left' },
    { name: 'unbound', points: [{ x: 320, y: 265 }, { x: 900, y: 265 }], sourceId: null, targetId: null },
    { name: 'single-bound', points: [{ x: 320, y: 265 }, { x: 900, y: 265 }], targetId: null },
    { name: 'outside the common lane', points: [{ x: 320, y: 100 }, { x: 900, y: 100 }] },
  ])('preserves existing routing for a $name arrow', ({ name: _name, ...changes }) => {
    const drawing = drawProposalToScene({ ...horizontalProposal, elements: horizontalProposal.elements.map(item => item.type === 'arrow' ? { ...item, ...changes } : item) })
    const arrow = element(drawing, 'arrow')
    expect(arrow.startBinding?.fixedPoint).toBeUndefined()
    expect(arrow.endBinding?.fixedPoint).toBeUndefined()
    if (changes.points.length > 2) expect(getWorldPoints(arrow)[1]).toEqual(changes.points[1])
  })

  it.each(['diamond', 'ellipse'] as const)('fits wrapped text inside a %s outline', type => {
    const drawing = drawProposalToScene({ outputMode: 'draw', summary: '', elements: [
      { id: 'box', type, x: 0, y: 0, width: 20, height: 20, label: 'A very long description that needs several lines of space', strokeColor: '#123456', backgroundColor: 'transparent' },
    ] })
    const box = element(drawing, 'box')
    const label = drawing.elements.find(item => item.type === 'text') as DrawElement
    expect(label.text).toContain('\n')
    const halfWidth = box.width / 2, halfHeight = box.height / 2
    const centerX = box.x + halfWidth, centerY = box.y + halfHeight
    for (const x of [label.x, label.x + label.width]) for (const y of [label.y, label.y + label.height]) {
      const dx = Math.abs(x - centerX) / halfWidth, dy = Math.abs(y - centerY) / halfHeight
      expect(type === 'diamond' ? dx + dy : dx * dx + dy * dy).toBeLessThan(1)
    }
  })

  it.each(['rectangle', 'ellipse', 'diamond', 'arrow'] as const)('wraps %s captions between words and preserves paragraphs', type => {
    const text = '1. Prepare tonight\n\nChoose a bedtime and put your alarm across the room.'
    const item = type === 'arrow'
      ? { id: 'host', type, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }], sourceId: null, targetId: null, label: text, strokeColor: '#123456' }
      : { id: 'host', type, x: 0, y: 0, width: 180, height: 210, label: text, strokeColor: '#123456', backgroundColor: '#ffffff' }
    const drawing = drawProposalToScene({ outputMode: 'draw', summary: '', elements: [item] })
    const label = drawing.elements.find(item => item.type === 'text') as DrawElement
    expect(label.text!.split(/\s+/)).toEqual(text.split(/\s+/))
    expect(label.text).toContain('\n\n')
    expect(label.originalText).toBe(text)
    expect(label.containerId).toBe('host')
    expect(label.height).toBe(drawingTextSize(label.text!, { fontSize: label.fontSize }).height)
    for (const line of label.text!.split('\n')) {
      expect(drawingTextSize(line, { fontSize: label.fontSize }).width).toBeLessThanOrEqual(type === 'arrow' ? 320 : 156)
    }
  })

  it('wraps an oversized token without losing content or splitting Unicode codepoints', () => {
    const text = '🙂'.repeat(30) + '\n\n' + 'oversizedunbrokenidentifier'.repeat(3)
    const drawing = drawProposalToScene({ outputMode: 'draw', summary: '', elements: [
      { id: 'box', type: 'rectangle', x: 0, y: 0, width: 180, height: 80, label: text, strokeColor: '#123456', backgroundColor: 'transparent' },
    ] })
    const label = drawing.elements.find(item => item.type === 'text') as DrawElement
    expect(label.text!.replace(/\n/g, '')).toBe(text.replace(/\n/g, ''))
    expect(label.text).toContain('\n\n')
    expect(label.text).not.toMatch(/[\uD800-\uDBFF]\n|\n[\uDC00-\uDFFF]/)
    for (const line of label.text!.split('\n')) expect(drawingTextSize(line, { fontSize: label.fontSize }).width).toBeLessThanOrEqual(156)
  })

  it('rejects an invalid reference even if a caller bypasses its TypeScript type', () => {
    expect(() => drawProposalToScene({ ...proposal, elements: proposal.elements.map(item => item.id === 'link' ? { ...item, targetId: 'missing' } : item) } as DrawProposal)).toThrow()
  })
})

describe('safe Draw generation context', () => {
  it('captures only bounded visible geometry and displayed text', () => {
    const drawing = drawProposalToScene(proposal)
    const image = { ...element(drawing, 'caption'), id: 'image', type: 'image', text: 'private image text', fileId: 'asset', dataURL: 'secret-bytes', link: 'https://private.example', customData: { secret: true } }
    const context = captureDrawGenerationContext({
      version: 1, files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,c2VjcmV0' } },
      elements: [
        image,
        ...drawing.elements,
        { ...element(drawing, 'caption'), id: 'bad id' },
        { ...element(drawing, 'caption'), id: 'far-away', x: 100001 },
        { ...element(drawing, 'caption'), id: 'deleted', isDeleted: true },
        { ...element(drawing, 'caption'), id: 'invisible', opacity: 0 },
        { ...element(drawing, 'caption'), id: 'linked', text: 'See https://private.example/key for details' },
      ],
    })
    expect(DrawGenerationContextSchema.parse(context)).toEqual(context)
    expect(context.elements[0]).toMatchObject({ id: 'image', type: 'image', text: null })
    expect(context.elements.find(item => item.id === 'caption')?.text).toBe('An independent note')
    expect(context.elements.find(item => item.id === 'linked')?.text).toBe('See [link omitted] for details')
    expect(context.omittedElementCount).toBe(4)
    expect(JSON.stringify(context)).not.toMatch(/secret|private|dataURL|customData|fileId|https:/)
  })

  it('caps the context and counts omitted records', () => {
    const template = element(drawProposalToScene(proposal), 'caption')
    const context = captureDrawGenerationContext({ version: 1, files: {}, elements: Array.from({ length: 110 }, (_, index) => ({ ...template, id: `text-${index}`, text: 'x'.repeat(700) })) })
    expect(context.elements).toHaveLength(100)
    expect(context.elements[99].id).toBe('text-99')
    expect(context.elements[0].text).toHaveLength(500)
    expect(context.omittedElementCount).toBe(10)
  })
})

import { describe, expect, it } from 'vitest'
import { validateArchitectureScene, type ArchitectureScene } from '../shared/architectureScene'
import { DrawGenerationContextSchema, type DrawProposal } from '../shared/drawGeneration'
import { captureDrawGenerationContext, drawProposalToScene } from '../utils/drawGeneration'
import { getWorldPoints, moveElements, type DrawElement } from '../utils/drawScene'
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

describe('native Draw generation', () => {
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

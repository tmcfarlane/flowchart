import { describe, expect, it } from 'vitest'
import { DrawGenerationContextSchema, DrawProposalSchema, DRAW_PROPOSAL_RESPONSE_FORMAT } from '../shared/drawGeneration'
import { normalizeGenerationProposal, parseGenerationProposal } from '../shared/aiGeneration'

const shape = { id: 'box', type: 'rectangle', x: 0, y: 0, width: 180, height: 80, label: 'Plan', strokeColor: '#123', backgroundColor: 'transparent' }
const arrow = { id: 'arrow', type: 'arrow', points: [{ x: 180, y: 40 }, { x: 300, y: 40 }], sourceId: 'box', targetId: null, label: 'Next', strokeColor: '#123456' }
const drawing = { outputMode: 'draw', summary: 'Plan', elements: [shape, arrow] }

describe('shared generation boundary', () => {
  it('accepts native shapes, standalone text, arrows, lines and freehand paths', () => {
    const proposal = { ...drawing, elements: [...drawing.elements,
      { id: 'title', type: 'text', x: 0, y: -40, text: 'Workshop', fontSize: 24, strokeColor: '#123' },
      { ...arrow, id: 'line', type: 'line', sourceId: null },
      { ...arrow, id: 'stroke', type: 'freedraw', sourceId: null, label: '' },
    ] }
    expect(normalizeGenerationProposal(proposal, 'draw')).toEqual(proposal)
    expect(DRAW_PROPOSAL_RESPONSE_FORMAT.json_schema.schema.additionalProperties).toBe(false)
  })

  it.each([
    { ...drawing, files: {} },
    { ...drawing, elements: [{ ...shape, customData: {} }] },
    { ...drawing, elements: [{ ...shape, imageUrl: 'https://example.com/private.png' }] },
    { ...drawing, elements: [{ ...shape, id: 'unsafe/id' }] },
    { ...drawing, elements: [shape, shape] },
    { ...drawing, elements: [shape, { ...arrow, targetId: 'missing' }] },
    { ...drawing, elements: [shape, { ...arrow, targetId: 'box' }] },
    { ...drawing, elements: [shape, { ...arrow, type: 'line' }] },
    { ...drawing, elements: [shape, { ...arrow, sourceId: 'arrow' }] },
    { ...drawing, elements: [{ ...arrow, sourceId: null, type: 'freedraw' }] },
    { ...drawing, elements: [{ ...arrow, sourceId: null, points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }] },
    { ...drawing, elements: [{ ...shape, x: Infinity }] },
    { ...drawing, elements: [{ ...shape, width: 5001 }] },
    { ...drawing, elements: [{ ...shape, label: 'x'.repeat(501) }] },
    { ...drawing, elements: [] },
    { ...drawing, elements: Array.from({ length: 101 }, (_, index) => ({ ...shape, id: String(index) })) },
  ])('rejects unsafe or invalid drawing data %#', value => {
    expect(DrawProposalSchema.safeParse(value).success).toBe(false)
    expect(() => normalizeGenerationProposal(value, 'draw')).toThrow()
  })

  it('allows only bounded visible geometry in Draw context', () => {
    const context = { elements: [{ id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100, text: null }], omittedElementCount: 2 }
    expect(DrawGenerationContextSchema.parse(context)).toEqual(context)
    expect(DrawGenerationContextSchema.safeParse({ ...context, files: {} }).success).toBe(false)
    expect(DrawGenerationContextSchema.safeParse({ ...context, elements: [{ ...context.elements[0], fileId: 'secret' }] }).success).toBe(false)
  })

  it('requires the captured output mode and raw complete JSON', () => {
    expect(() => normalizeGenerationProposal(drawing, 'flowchart')).toThrow()
    expect(() => parseGenerationProposal(JSON.stringify(drawing), 'draw', 'length')).toThrow()
    expect(() => parseGenerationProposal('```json\n' + JSON.stringify(drawing) + '\n```', 'draw')).toThrow()
    expect(() => normalizeGenerationProposal({ ...drawing, outputMode: undefined }, 'draw')).toThrow()
  })

  it('preserves graph metadata while normalizing nullable fields for browser use', () => {
    const proposal = {
      outputMode: 'architecture', summary: 'Services',
      nodes: [
        { id: 'group', type: 'container', label: 'Cloud', position: { x: 0, y: 0 }, containerKind: 'vpc' },
        { id: 'service', type: 'service', label: 'API', position: { x: 20, y: 40 }, parentNode: 'group', width: 200, height: null, imageUrl: '/assets/api.svg' },
      ],
      edges: [{ source: 'service', target: 'group', protocol: 'HTTPS', commStyle: 'sync', label: null }],
    }
    const result = normalizeGenerationProposal(proposal, 'architecture')
    expect(result).toMatchObject({ ...proposal, nodes: [proposal.nodes[0], { ...proposal.nodes[1], height: undefined }], edges: [{ ...proposal.edges[0], label: undefined }] })
    expect(() => normalizeGenerationProposal(proposal, 'flowchart')).toThrow()
    expect(() => normalizeGenerationProposal({ ...proposal, edges: [{ source: 'service', target: 'missing' }] }, 'architecture')).toThrow()
  })
})

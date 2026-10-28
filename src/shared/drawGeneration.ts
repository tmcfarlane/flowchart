import { z } from 'zod'

export const DRAW_GENERATION_LIMITS = {
  elements: 100, points: 32, text: 500, summary: 2000,
  coordinate: 100000, minSize: 20, maxSize: 5000, minFontSize: 12, maxFontSize: 48,
} as const

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
const coordinate = z.number().min(-DRAW_GENERATION_LIMITS.coordinate).max(DRAW_GENERATION_LIMITS.coordinate)
const size = z.number().min(DRAW_GENERATION_LIMITS.minSize).max(DRAW_GENERATION_LIMITS.maxSize)
const text = z.string().max(DRAW_GENERATION_LIMITS.text)
const color = z.string().regex(/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|transparent)$/)
const point = z.strictObject({ x: coordinate, y: coordinate })
const shape = z.strictObject({
  id, type: z.enum(['rectangle', 'ellipse', 'diamond']), x: coordinate, y: coordinate,
  width: size, height: size, label: text, strokeColor: color, backgroundColor: color,
})
const standaloneText = z.strictObject({
  id, type: z.literal('text'), x: coordinate, y: coordinate, text: text.min(1),
  fontSize: z.number().min(DRAW_GENERATION_LIMITS.minFontSize).max(DRAW_GENERATION_LIMITS.maxFontSize), strokeColor: color,
})
const path = z.strictObject({
  id, type: z.enum(['line', 'arrow', 'freedraw']),
  points: z.array(point).min(2).max(DRAW_GENERATION_LIMITS.points),
  sourceId: id.nullable(), targetId: id.nullable(), label: text, strokeColor: color,
})
const frame = z.strictObject({
  id, type: z.literal('frame'), x: coordinate, y: coordinate,
  width: size, height: size,
  name: z.string().trim().min(1).max(100).refine(value => !/[\r\n]/.test(value)),
  children: z.array(id).max(DRAW_GENERATION_LIMITS.elements - 1),
})
const overlap = z.strictObject({ firstId: id, secondId: id, reason: z.enum(['venn', 'overlay', 'container']) })
const proposal = z.strictObject({
  outputMode: z.literal('draw'), summary: z.string().max(DRAW_GENERATION_LIMITS.summary),
  elements: z.array(z.union([shape, standaloneText, path, frame])).min(1).max(DRAW_GENERATION_LIMITS.elements),
  overlaps: z.array(overlap).max(DRAW_GENERATION_LIMITS.elements).optional(),
})

export const DrawProposalSchema = proposal.superRefine((value, ctx) => {
  const elements = new Map(value.elements.map(element => [element.id, element]))
  if (elements.size !== value.elements.length) ctx.addIssue({ code: 'custom', message: 'Duplicate drawing element IDs.' })
  const pairs = new Set<string>()
  for (const pair of value.overlaps ?? []) {
    const key = [pair.firstId, pair.secondId].sort().join(':')
    if (pair.firstId === pair.secondId || !elements.has(pair.firstId) || !elements.has(pair.secondId) || elements.get(pair.firstId)?.type === 'frame' || elements.get(pair.secondId)?.type === 'frame' || pairs.has(key)) ctx.addIssue({ code: 'custom', message: 'Overlap permissions need distinct existing non-frame elements and unique pairs.' })
    pairs.add(key)
  }
  const owners = new Set<string>()
  for (const element of value.elements) {
    if (element.type === 'frame') {
      for (const childId of element.children) {
        const child = elements.get(childId)
        if (!child || child.type === 'frame' || childId === element.id || owners.has(childId)) {
          ctx.addIssue({ code: 'custom', message: 'Frame children must be unique, existing non-frame elements with one owner.' })
        }
        owners.add(childId)
      }
      continue
    }
    if (!('points' in element)) continue
    if (element.points.every(point => point.x === element.points[0].x && point.y === element.points[0].y)) {
      ctx.addIssue({ code: 'custom', message: 'Drawing paths must have nonzero length.' })
    }
    if (element.type !== 'arrow' && (element.sourceId !== null || element.targetId !== null)) {
      ctx.addIssue({ code: 'custom', message: 'Only arrows can bind to shapes.' })
    }
    if (element.type === 'freedraw' && element.label !== '') ctx.addIssue({ code: 'custom', message: 'Freehand paths cannot have captions.' })
    if (element.sourceId !== null && element.sourceId === element.targetId) ctx.addIssue({ code: 'custom', message: 'Arrows cannot bind both ends to the same shape.' })
    for (const targetId of [element.sourceId, element.targetId]) {
      if (targetId === null) continue
      const target = elements.get(targetId)
      if (!target || !['rectangle', 'ellipse', 'diamond'].includes(target.type)) {
        ctx.addIssue({ code: 'custom', message: 'Arrow endpoints must refer to shapes in this proposal.' })
      }
    }
  }
})
export type DrawProposal = z.infer<typeof DrawProposalSchema>

export const DRAW_TOOL_CAPABILITIES = {
  rectangle: { name: 'Rectangle', purpose: 'cards, panels and box-shaped objects' },
  ellipse: { name: 'Ellipse', purpose: 'round concepts and steps' },
  diamond: { name: 'Diamond', purpose: 'decisions and branches' },
  text: { name: 'Text', purpose: 'headings, notes and annotations without a shape' },
  line: { name: 'Line', purpose: 'dividers, boundaries and simple strokes' },
  arrow: { name: 'Arrow', purpose: 'directional connections between ideas or objects' },
  freedraw: { name: 'Pen', purpose: 'hand-drawn marks, loops and loose sketches' },
  frame: { name: 'Frame', purpose: 'named sections and wireframe screens containing chosen objects' },
} satisfies Record<DrawProposal['elements'][number]['type'], { name: string; purpose: string }>

export const DrawGenerationContextSchema = z.strictObject({
  elements: z.array(z.strictObject({
    id,
    type: z.enum(['rectangle', 'ellipse', 'diamond', 'text', 'line', 'arrow', 'freedraw', 'frame', 'image']),
    x: coordinate, y: coordinate,
    width: z.number().min(0).max(DRAW_GENERATION_LIMITS.maxSize),
    height: z.number().min(0).max(DRAW_GENERATION_LIMITS.maxSize),
    text: text.nullable(),
  })).max(DRAW_GENERATION_LIMITS.elements),
  omittedElementCount: z.number().int().min(0).max(1000000),
}).superRefine((value, ctx) => {
  if (new Set(value.elements.map(element => element.id)).size !== value.elements.length) ctx.addIssue({ code: 'custom', message: 'Duplicate drawing context IDs.' })
})
export type DrawGenerationContext = z.infer<typeof DrawGenerationContextSchema>

const strictProposal = proposal.extend({ overlaps: z.array(overlap).max(DRAW_GENERATION_LIMITS.elements) })
const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(strictProposal, { target: 'draft-7' })
export const DRAW_PROPOSAL_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'DrawProposal', strict: true, schema: jsonSchema },
}

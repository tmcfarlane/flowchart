import { z } from 'zod'

const id = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/)
const coordinate = z.number().min(-1000000).max(1000000)
const color = z.string().regex(/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|transparent)$/)
const geometryKeys = ['x', 'y', 'width', 'height', 'angle'] as const
const appearance = {
  strokeColor: color.optional(), backgroundColor: color.optional(),
  strokeWidth: z.number().min(0).max(20).optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fillStyle: z.enum(['solid', 'hachure', 'cross-hatch']).optional(),
  roughness: z.number().min(0).max(3).optional(), opacity: z.number().min(0).max(100).optional(),
}
const changes = z.strictObject({
  ...appearance,
  text: z.string().max(2000).optional(),
  x: coordinate.optional(), y: coordinate.optional(),
  width: z.number().min(1).max(5000).optional(), height: z.number().min(1).max(5000).optional(),
  angle: z.number().min(-Math.PI * 2).max(Math.PI * 2).optional(),
}).refine(value => Object.keys(value).length > 0, 'An update must change at least one field.')

export const DrawEditContextSchema = z.strictObject({
  targets: z.array(z.strictObject({
    id, type: z.enum(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'image', 'frame', 'text']),
    x: coordinate, y: coordinate, width: coordinate.nonnegative(), height: coordinate.nonnegative(), angle: coordinate,
    text: z.string().max(2000).optional(), ...appearance,
    geometryAllowed: z.boolean(), textAllowed: z.boolean(),
    dependencyIds: z.array(id).max(100),
  })).min(1).max(50),
  dependencies: z.array(z.strictObject({ id, type: z.string().max(30), locked: z.boolean(), selected: z.boolean() })).max(100),
}).superRefine((value, ctx) => {
  const targetIds = new Set(value.targets.map(target => target.id)), dependencies = new Set(value.dependencies.map(item => item.id))
  if (targetIds.size !== value.targets.length || dependencies.size !== value.dependencies.length) ctx.addIssue({ code: 'custom', message: 'Duplicate Draw context IDs.' })
  for (const target of value.targets) {
    if (target.dependencyIds.some(key => !dependencies.has(key))) ctx.addIssue({ code: 'custom', message: 'Missing Draw dependency.' })
    if (target.geometryAllowed && (target.dependencyIds.length || !['rectangle', 'diamond', 'ellipse'].includes(target.type))) ctx.addIssue({ code: 'custom', message: 'Geometry requires an independent primitive.' })
    if (target.textAllowed && target.type !== 'text') ctx.addIssue({ code: 'custom', message: 'Only text elements can change text.' })
  }
})
export const DrawEditProposalSchema = z.strictObject({
  summary: z.string().max(2000),
  operations: z.array(z.strictObject({ op: z.literal('update_element'), id, changes })).max(50),
})
export type DrawEditContext = z.infer<typeof DrawEditContextSchema>
export type DrawEditProposal = z.infer<typeof DrawEditProposalSchema>

export function validateDrawEdit(context: DrawEditContext, input: unknown): DrawEditProposal {
  const parsed = DrawEditProposalSchema.safeParse(input)
  if (!parsed.success) throw new Error('AI returned unsupported Draw changes. Try a simpler edit.')
  const targets = new Map(context.targets.map(target => [target.id, target])), updated = new Set<string>()
  for (const operation of parsed.data.operations) {
    const target = targets.get(operation.id)
    if (!target || updated.has(operation.id)) throw new Error('AI tried to change an element outside the selection or update it twice.')
    updated.add(operation.id)
    if (geometryKeys.some(key => operation.changes[key] !== undefined) && !target.geometryAllowed) throw new Error('Geometry edits require an independent, unbound Draw shape.')
    if (operation.changes.text !== undefined && !target.textAllowed) throw new Error('This text edit would change an unselected or locked host.')
  }
  return parsed.data
}

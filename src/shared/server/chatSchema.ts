import { z } from 'zod'
import { NODE_TYPES, EDGE_STYLES, HANDLE_POSITIONS, CONTAINER_KINDS, EDGE_PROTOCOLS, COMM_STYLES } from '../flowTypes.js'
import type { ChartEdge, ChartNode } from '../flowTypes.js'
import { edgeFromInput, nodeFromInput } from '../flowSchema.js'
import { DrawEditContextSchema } from '../drawSelectionEdit.js'
import { SelectionEditScopeSchema, selectionScopeError } from '../selectionEdit.js'

const id = z.string().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/)
const contextEdgeId = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/)
const position = z.strictObject({ x: z.number().min(-1000000).max(1000000), y: z.number().min(-1000000).max(1000000) })
const size = z.number().min(20).max(5000)
const nodeShape = {
  id,
  type: z.enum(NODE_TYPES),
  label: z.string().max(500),
  position,
  width: size.nullable(),
  height: size.nullable(),
  imageUrl: z.string().max(2000).nullable(),
  parentNode: id.nullable(),
  containerKind: z.enum(CONTAINER_KINDS).nullable(),
}
const edgeShape = {
  id,
  source: id,
  target: id,
  style: z.enum(EDGE_STYLES).nullable(),
  sourceHandle: z.enum(HANDLE_POSITIONS).nullable(),
  targetHandle: z.enum(HANDLE_POSITIONS).nullable(),
  label: z.string().max(200).nullable(),
  protocol: z.enum(EDGE_PROTOCOLS).nullable(),
  commStyle: z.enum(COMM_STYLES).nullable(),
}
const nodeSchema = z.strictObject(nodeShape).partial({ width: true, height: true, imageUrl: true, parentNode: true, containerKind: true })
const edgeSchema = z.strictObject(edgeShape).partial({ id: true, style: true, sourceHandle: true, targetHandle: true, label: true, protocol: true, commStyle: true })
const contentShape = { nodes: z.array(nodeSchema).max(200), edges: z.array(edgeSchema).max(400) }
const contextShape = { nodes: z.array(nodeSchema.extend({ icon: z.string().max(120).nullish() })).max(200), edges: z.array(edgeSchema.extend({ id: contextEdgeId.optional() })).max(400) }

const GraphChatRequestSchema = z.strictObject({
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(12000) })).min(1).max(20),
  flowContext: z.strictObject(contextShape).optional(),
  mode: z.enum(['generate', 'refine', 'edit']).default('generate'),
  diagramMode: z.enum(['flowchart', 'architecture', 'draw']).default('flowchart'),
  selection: SelectionEditScopeSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'refine' && !value.flowContext) ctx.addIssue({ code: 'custom', message: 'Refinement requires diagram context' })
  if (value.mode === 'edit') {
    if (value.diagramMode === 'draw') ctx.addIssue({ code: 'custom', message: 'Selected-node AI edits are available in Flowchart and Architecture modes.' })
    if (!value.flowContext || !value.selection) ctx.addIssue({ code: 'custom', message: 'Selected-node edits require a frozen selection and diagram context.' })
    else {
      if (value.flowContext.edges.some(edge => !edge.id)) ctx.addIssue({ code: 'custom', message: 'Captured connections require stable IDs.' })
      const error = selectionScopeError(value.flowContext.nodes.map(node => nodeFromInput(node) as ChartNode), value.flowContext.edges.map(edge => edgeFromInput(edge) as ChartEdge), value.selection)
      if (error) ctx.addIssue({ code: 'custom', message: error })
    }
  } else if (value.selection) ctx.addIssue({ code: 'custom', message: 'An edit selection cannot be used with generation or refinement.' })
  if (value.messages[value.messages.length - 1]?.role !== 'user') ctx.addIssue({ code: 'custom', message: 'A user message is required' })
})
export const ChatRequestSchema = z.union([GraphChatRequestSchema, z.strictObject({
  mode: z.literal('draw-edit'), diagramMode: z.literal('draw'),
  messages: z.array(z.strictObject({ role: z.literal('user'), content: z.string().trim().min(1).max(12000) })).length(1),
  drawContext: DrawEditContextSchema,
})])
export type ChatRequest = z.infer<typeof ChatRequestSchema>

export const ProposalSchema = z.strictObject({ summary: z.string().max(2000), ...contentShape }).superRefine((value, ctx) => {
  const nodes = new Map(value.nodes.map(node => [node.id, node]))
  if (nodes.size !== value.nodes.length) ctx.addIssue({ code: 'custom', message: 'Duplicate node ids' })
  const edgeIds = value.edges.flatMap(edge => edge.id ? [edge.id] : [])
  if (new Set(edgeIds).size !== edgeIds.length) ctx.addIssue({ code: 'custom', message: 'Duplicate edge ids' })
  for (const edge of value.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) ctx.addIssue({ code: 'custom', message: 'Unknown edge endpoint' })
  }
  for (const node of value.nodes) {
    if (node.imageUrl && !/^https:\/\/|^\/assets\//.test(node.imageUrl)) ctx.addIssue({ code: 'custom', message: 'Unsupported image URL' })
    const seen = new Set([node.id])
    let parent = node.parentNode
    while (parent) {
      if (seen.has(parent) || nodes.get(parent)?.type !== 'container') {
        ctx.addIssue({ code: 'custom', message: 'Invalid container hierarchy' })
        break
      }
      seen.add(parent)
      parent = nodes.get(parent)?.parentNode
    }
  }
})

const strictProposal = z.strictObject({
  summary: z.string(),
  nodes: z.array(z.strictObject(nodeShape)),
  edges: z.array(z.strictObject(edgeShape)),
})
const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(strictProposal, { target: 'draft-7' })
export const PROPOSAL_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'DiagramProposal', strict: true, schema: jsonSchema },
}

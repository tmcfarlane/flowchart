import { z } from 'zod'
import { NODE_TYPES, EDGE_STYLES, HANDLE_POSITIONS, CONTAINER_KINDS, EDGE_PROTOCOLS, COMM_STYLES } from '../flowTypes.js'

const id = z.string().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/)
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

export const ChatRequestSchema = z.strictObject({
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(12000) })).min(1).max(20),
  flowContext: z.strictObject(contentShape).optional(),
  mode: z.enum(['generate', 'refine']).default('generate'),
  diagramMode: z.enum(['flowchart', 'architecture', 'draw']).default('flowchart'),
}).superRefine((value, ctx) => {
  if (value.mode === 'refine' && !value.flowContext) ctx.addIssue({ code: 'custom', message: 'Refinement requires diagram context' })
  if (value.messages[value.messages.length - 1]?.role !== 'user') ctx.addIssue({ code: 'custom', message: 'A user message is required' })
})
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

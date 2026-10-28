import { z } from 'zod'
import { NODE_TYPES, EDGE_STYLES, HANDLE_POSITIONS, CONTAINER_KINDS, EDGE_PROTOCOLS, COMM_STYLES, type DiagramMode } from './flowTypes.js'
import { DrawProposalSchema, type DrawProposal } from './drawGeneration.js'
import { parseDrawDocument, type ExcalidrawDrawing } from './drawDocument.js'

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

export const FlowGenerationContextSchema = z.strictObject(contextShape)
export type FlowGenerationContext = z.infer<typeof FlowGenerationContextSchema>

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

const TaggedGraphProposalSchema = ProposalSchema.safeExtend({ outputMode: z.enum(['flowchart', 'architecture']) })
export const AIGenerationProposalSchema = z.union([TaggedGraphProposalSchema, DrawProposalSchema])

type GraphWireProposal = z.infer<typeof TaggedGraphProposalSchema>
type WithoutNull<T> = { [K in keyof T]: Exclude<T[K], null> }
export type GraphGenerationProposal = {
  outputMode: 'flowchart' | 'architecture'
  summary: string
  nodes: WithoutNull<GraphWireProposal['nodes'][number]>[]
  edges: WithoutNull<GraphWireProposal['edges'][number]>[]
}
export type AuthoringGenerationProposal = GraphGenerationProposal | DrawProposal
export type FinalizedDrawProposal = {
  outputMode: 'draw'
  summary: string
  proposal: DrawProposal
  drawing: ExcalidrawDrawing
}
export type AIGenerationProposal = GraphGenerationProposal | FinalizedDrawProposal
export type AIGenerationContext =
  | { flowContext: FlowGenerationContext; drawContext?: never }
  | { drawContext: import('./drawGeneration.js').DrawGenerationContext; flowContext?: never }

export function normalizeGenerationProposal(value: unknown, outputMode: 'draw'): DrawProposal
export function normalizeGenerationProposal(value: unknown, outputMode: 'flowchart' | 'architecture'): GraphGenerationProposal
export function normalizeGenerationProposal(value: unknown, outputMode: DiagramMode): AuthoringGenerationProposal
export function normalizeGenerationProposal(value: unknown, outputMode: DiagramMode): AuthoringGenerationProposal {
  const proposal = AIGenerationProposalSchema.parse(value)
  if (proposal.outputMode !== outputMode) throw new Error('AI proposal output mode does not match the requested mode.')
  if (proposal.outputMode === 'draw') return proposal
  return {
    ...proposal,
    nodes: proposal.nodes.map(node => ({ ...node, width: node.width ?? undefined, height: node.height ?? undefined, imageUrl: node.imageUrl ?? undefined, parentNode: node.parentNode ?? undefined, containerKind: node.containerKind ?? undefined })),
    edges: proposal.edges.map(edge => ({ ...edge, style: edge.style ?? undefined, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined, label: edge.label ?? undefined, protocol: edge.protocol ?? undefined, commStyle: edge.commStyle ?? undefined })),
  }
}

export function parseGenerationProposal(content: string, outputMode: DiagramMode, finishReason?: string): AuthoringGenerationProposal {
  if (finishReason === 'length') throw new Error('AI reached its response limit. Try a simpler diagram.')
  return normalizeGenerationProposal(JSON.parse(content), outputMode)
}

/** Validate the finalized API boundary without changing any drawing geometry. */
export function parseGenerationResponse(value: unknown, outputMode: DiagramMode): AIGenerationProposal {
  const response = z.object({ message: z.string(), finishReason: z.string().optional(), drawing: z.unknown().optional(), drawOverlaps: z.unknown().optional() }).parse(value)
  const proposal = parseGenerationProposal(response.message, outputMode, response.finishReason)
  if (proposal.outputMode !== 'draw') return proposal
  const source = response.drawOverlaps === undefined ? proposal : DrawProposalSchema.parse({ ...proposal, overlaps: response.drawOverlaps })
  return { outputMode: 'draw', summary: source.summary, proposal: source, drawing: parseDrawDocument(response.drawing) }
}

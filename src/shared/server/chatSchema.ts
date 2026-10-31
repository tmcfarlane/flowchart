import { z } from 'zod'
import { FlowGenerationContextSchema } from '../aiGeneration.js'
export { ProposalSchema, PROPOSAL_RESPONSE_FORMAT } from '../aiGeneration.js'
import type { ChartEdge, ChartNode } from '../flowTypes.js'
import { edgeFromInput, nodeFromInput } from '../flowSchema.js'
import { DrawGenerationContextSchema, DrawProposalSchema } from '../drawGeneration.js'
import { DrawEditContextSchema } from '../drawSelectionEdit.js'
import { SelectionEditScopeSchema, selectionScopeError } from '../selectionEdit.js'
import { AiImageDataUrlSchema } from '../aiImage.js'

const GenerationAndGraphEditRequestSchema = z.strictObject({
  messages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(12000) })).min(1).max(20),
  flowContext: FlowGenerationContextSchema.optional(),
  drawContext: DrawGenerationContextSchema.optional(),
  drawProposal: DrawProposalSchema.optional(),
  mode: z.enum(['generate', 'refine', 'edit']).default('generate'),
  diagramMode: z.enum(['flowchart', 'architecture', 'draw']).default('flowchart'),
  selection: SelectionEditScopeSchema.optional(),
  // Attached to the latest user message only; earlier turns are text.
  image: AiImageDataUrlSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.image && value.mode !== 'generate') ctx.addIssue({ code: 'custom', message: 'Images are only accepted for new generations.' })
  if (value.flowContext && value.drawContext) ctx.addIssue({ code: 'custom', message: 'Use only one source context.' })
  if (value.mode === 'refine') {
    if (value.diagramMode === 'draw') {
      if (!value.drawProposal || value.flowContext || value.drawContext) ctx.addIssue({ code: 'custom', message: 'Draw refinement requires only the previous Draw proposal.' })
    } else if (!value.flowContext || value.drawContext || value.drawProposal) ctx.addIssue({ code: 'custom', message: 'Graph refinement requires only graph context.' })
  } else if (value.drawProposal) ctx.addIssue({ code: 'custom', message: 'Previous proposals are only accepted for refinement.' })
  if (value.diagramMode === 'draw' && value.flowContext?.nodes.some(node => node.imageUrl)) {
    ctx.addIssue({ code: 'custom', message: 'Draw generation context cannot include image URLs or data.' })
  }
  if (value.mode === 'edit') {
    if (value.drawContext) ctx.addIssue({ code: 'custom', message: 'Selected-node edits require graph context.' })
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
export const ChatRequestSchema = z.union([GenerationAndGraphEditRequestSchema, z.strictObject({
  mode: z.literal('draw-edit'), diagramMode: z.literal('draw'),
  messages: z.array(z.strictObject({ role: z.literal('user'), content: z.string().trim().min(1).max(12000) })).length(1),
  drawContext: DrawEditContextSchema,
})])
export type ChatRequest = z.infer<typeof ChatRequestSchema>

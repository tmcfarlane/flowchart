import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readFileSync } from 'fs'
import { join } from 'path'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface FlowNode {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
  width?: number
  height?: number
  imageUrl?: string
}

type EdgeStyle = 'default' | 'animated' | 'step'
type HandlePosition = 'top' | 'right' | 'bottom' | 'left'

interface FlowEdge {
  id: string
  source: string
  target: string
  style?: EdgeStyle
  sourceHandle?: HandlePosition
  targetHandle?: HandlePosition
  label?: string
}

interface FlowContext {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface ChatRequest {
  messages: ChatMessage[]
  flowContext?: FlowContext
  mode?: 'generate' | 'refine'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { messages, flowContext, mode } = req.body as ChatRequest

    // Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: messages array is required' })
    }

    // Get Azure OpenAI configuration from server-side environment variables
    const deploymentName = process.env.AZURE_DEPLOYMENT_NAME
    const resourceName = process.env.AZURE_RESOURCE_NAME
    const apiKey = process.env.AZURE_API_KEY

    if (!deploymentName || !resourceName || !apiKey) {
      console.error('Missing Azure OpenAI configuration')
      return res.status(500).json({
        error: 'Server configuration error: Azure OpenAI credentials not configured',
      })
    }

    // Load flowchart generation skill
    const skillPath = join(process.cwd(), 'api', 'flowchart-generation-skill.md')
    const skillContent = readFileSync(skillPath, 'utf-8')
    
    // Build system message
    let systemMessage = skillContent
    
    if (flowContext) {
      if (mode === 'refine') {
        // Refinement mode: modify the existing flowchart, don't replace it
        systemMessage += `\n\n---\n\nEXISTING FLOWCHART (you are refining this):\n${JSON.stringify(flowContext, null, 2)}\n\nIMPORTANT REFINEMENT RULES:\n- The user wants to MODIFY this existing flowchart.\n- Return the COMPLETE flowchart with ALL nodes and edges.\n- Keep every node and edge that the user did NOT ask to change — preserve their IDs, labels, positions, types, and connections EXACTLY.\n- Only add, remove, or modify the specific parts the user requests.\n- If the user asks to change one node, return all the other nodes unchanged plus the modified one.\n- Do NOT regenerate the entire flowchart from scratch.\n- Maintain the existing layout structure and spacing.`
      } else {
        // Generation mode: create new nodes alongside existing canvas content
        systemMessage += `\n\n---\n\nCURRENT FLOWCHART CONTEXT:\n${JSON.stringify(flowContext, null, 2)}\n\nGenerate NEW nodes/edges to insert alongside the existing flowchart.`
      }
    }

    // Define JSON schema for structured outputs
    // This guarantees the model returns valid JSON matching our flowchart schema
    const flowchartSchema = {
      type: 'json_schema',
      json_schema: {
        name: 'FlowchartProposal',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: ['step', 'decision', 'note', 'image'] },
                  label: { type: 'string' },
                  position: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                    },
                    required: ['x', 'y'],
                    additionalProperties: false,
                  },
                  width: { type: ['number', 'null'] },
                  height: { type: ['number', 'null'] },
                  imageUrl: { type: ['string', 'null'] },
                },
                required: ['id', 'type', 'label', 'position', 'width', 'height', 'imageUrl'],
                additionalProperties: false,
              },
            },
            edges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  source: { type: 'string' },
                  target: { type: 'string' },
                  style: { type: ['string', 'null'], enum: ['default', 'animated', 'step', null] },
                  sourceHandle: { type: ['string', 'null'], enum: ['top', 'right', 'bottom', 'left', null] },
                  targetHandle: { type: ['string', 'null'], enum: ['top', 'right', 'bottom', 'left', null] },
                  label: { type: ['string', 'null'] },
                },
                required: ['id', 'source', 'target', 'style', 'sourceHandle', 'targetHandle', 'label'],
                additionalProperties: false,
              },
            },
          },
          required: ['summary', 'nodes', 'edges'],
          additionalProperties: false,
        },
      },
    }

    // Call Azure OpenAI API
    const endpoint = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=2024-08-01-preview`

    const allMessages = [{ role: 'system', content: systemMessage }, ...messages]

    // Helper to call the Azure OpenAI API with a given response_format
    async function callAzureOpenAI(responseFormat: unknown) {
      const body: Record<string, unknown> = {
        messages: allMessages,
        max_completion_tokens: 4000,
        temperature: 1,
      }
      if (responseFormat) {
        body.response_format = responseFormat
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey as string,
        },
        body: JSON.stringify(body),
      })
      return resp
    }

    // Attempt 1: Try structured outputs (json_schema) for guaranteed schema compliance
    let response = await callAzureOpenAI(flowchartSchema)

    // If the model/deployment doesn't support json_schema, fall back to json_object
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMsg = errorData.error?.message || ''

      // Check if the error is specifically about unsupported response_format
      const isFormatError =
        response.status === 400 &&
        (errorMsg.includes('response_format') ||
          errorMsg.includes('json_schema') ||
          errorMsg.includes('Unsupported'))

      if (isFormatError) {
        console.warn('json_schema not supported by deployment, falling back to json_object format')
        response = await callAzureOpenAI({ type: 'json_object' })
      }

      if (!response.ok) {
        // If we retried, read the new error; otherwise reuse the original
        const finalError = isFormatError
          ? await response.json().catch(() => ({}))
          : errorData
        console.error('Azure OpenAI API error:', finalError)
        return res.status(response.status).json({
          error: finalError.error?.message || `Azure OpenAI API request failed with status ${response.status}`,
        })
      }
    }

    const data = await response.json()
    const assistantMessage = data.choices[0]?.message?.content || 'No response received.'
    const finishReason = data.choices[0]?.finish_reason || 'unknown'

    // Server-side validation: ensure the response is valid JSON before sending to client
    try {
      const parsed = JSON.parse(assistantMessage)
      if (!parsed.nodes || !Array.isArray(parsed.nodes) || !parsed.edges || !Array.isArray(parsed.edges)) {
        console.error('Response is JSON but missing required nodes/edges arrays:', assistantMessage)
        return res.status(502).json({
          error: 'AI returned an invalid flowchart structure. Please try again.',
        })
      }
    } catch {
      // Response is not valid JSON at all — the model ignored our instructions
      console.error('AI returned non-JSON response despite format constraints:', assistantMessage.substring(0, 200))
      return res.status(502).json({
        error: 'AI returned a non-JSON response. Please try rephrasing your request as a process or workflow.',
      })
    }

    // Return validated response with finish_reason for truncation detection
    return res.status(200).json({
      message: assistantMessage,
      role: 'assistant',
      finishReason,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    })
  }
}

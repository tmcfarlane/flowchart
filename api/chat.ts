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
}

interface FlowContext {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface ChatRequest {
  messages: ChatMessage[]
  flowContext?: FlowContext
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { messages, flowContext } = req.body as ChatRequest

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
      systemMessage += `\n\n---\n\nCURRENT FLOWCHART CONTEXT:\n${JSON.stringify(flowContext, null, 2)}\n\nGenerate NEW nodes/edges to insert alongside the existing flowchart.`
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
                },
                required: ['id', 'source', 'target', 'style', 'sourceHandle', 'targetHandle'],
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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: 'system', content: systemMessage }, ...messages],
        // Newer Azure OpenAI chat models require `max_completion_tokens`
        // (and may reject `max_tokens`).
        max_completion_tokens: 4000,
        temperature: 0.7,
        // Use structured outputs to guarantee valid JSON matching our schema
        response_format: flowchartSchema,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Azure OpenAI API error:', errorData)
      return res.status(response.status).json({
        error: errorData.error?.message || `Azure OpenAI API request failed with status ${response.status}`,
      })
    }

    const data = await response.json()
    const assistantMessage = data.choices[0]?.message?.content || 'No response received.'
    const finishReason = data.choices[0]?.finish_reason || 'unknown'

    // Return successful response with finish_reason for truncation detection
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

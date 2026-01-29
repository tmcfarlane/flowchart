import type { VercelRequest, VercelResponse } from '@vercel/node'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface FlowNode {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
}

interface FlowEdge {
  id: string
  source: string
  target: string
}

interface FlowContext {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface ChatRequest {
  messages: ChatMessage[]
  flowContext?: FlowContext
  requestStructuredUpdate?: boolean
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { messages, flowContext, requestStructuredUpdate } = req.body as ChatRequest

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

    // Build system message with flow context if provided
    let systemMessage = 'You are a flowchart assistant helping users create and modify flowcharts.'
    if (flowContext && requestStructuredUpdate) {
      systemMessage += `\n\nThe user has the following flowchart:\n${JSON.stringify(flowContext, null, 2)}\n\nWhen the user asks you to make changes to their flowchart, respond with a JSON object containing the updated flow. The JSON should have this structure:
{
  "explanation": "A brief natural language description of what you changed and why",
  "nodes": [
    { "id": "1", "type": "step", "label": "Node label", "position": { "x": 250, "y": 100 } }
  ],
  "edges": [
    { "id": "e1-2", "source": "1", "target": "2" }
  ]
}

Node types can be: "step", "decision", or "note".
Always include ALL nodes and edges in your response (both existing and new ones).
Make sure to provide a clear explanation in natural language before the JSON.
Format your response as: First explain what you're doing, then provide the JSON wrapped in a code block like this:
\`\`\`json
{...}
\`\`\``
    } else if (flowContext) {
      systemMessage += `\n\nThe user has the following flowchart:\n${JSON.stringify(flowContext, null, 2)}\n\nHelp them modify or understand their flowchart. If they ask you to make changes, explain what you would do clearly.`
    }

    // Call Azure OpenAI API
    const endpoint = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`

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
        max_completion_tokens: 800,
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

    // Return successful response
    return res.status(200).json({
      message: assistantMessage,
      role: 'assistant',
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    })
  }
}

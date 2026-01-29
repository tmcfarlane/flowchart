import type { VercelRequest, VercelResponse } from '@vercel/node'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface ChatRequest {
  messages: ChatMessage[]
  flowContext?: {
    nodes: Array<{ id: string; type: string; label: string; position: { x: number; y: number } }>
    edges: Array<{ id: string; source: string; target: string }>
  }
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

    // Build system message with flow context if provided
    let systemMessage = 'You are a flowchart assistant helping users create and modify flowcharts.'
    if (flowContext) {
      systemMessage += `\n\nThe user has the following flowchart:\n${JSON.stringify(flowContext, null, 2)}\n\nHelp them modify or understand their flowchart. If they ask you to make changes, explain what you would do clearly. You cannot directly modify the flowchart, but you can provide clear instructions.`
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
        max_tokens: 800,
        temperature: 0.7,
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

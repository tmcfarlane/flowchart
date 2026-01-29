import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
function apiChatDevPlugin(mode: string): Plugin {
  return {
    name: 'api-chat-dev',
    configureServer(server) {
      // Load non-VITE_* env vars for server-side usage in dev.
      // (Vite filters env exposure to the browser; this is server-only middleware.)
      const env = loadEnv(mode, process.cwd(), '')

      server.middlewares.use('/api/chat', async (req, res) => {
        if (!req.url) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Bad request' }))
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const deploymentName = env.AZURE_DEPLOYMENT_NAME || process.env.AZURE_DEPLOYMENT_NAME
          const resourceName = env.AZURE_RESOURCE_NAME || process.env.AZURE_RESOURCE_NAME
          const apiKey = env.AZURE_API_KEY || process.env.AZURE_API_KEY

          if (!deploymentName || !resourceName || !apiKey) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: 'Server configuration error: Azure OpenAI credentials not configured',
              })
            )
            return
          }

          // Read and parse request body
          const chunks: Uint8Array[] = []
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          }
          const raw = Buffer.concat(chunks).toString('utf-8')
          const body = raw ? JSON.parse(raw) : {}

          const { messages, flowContext } = body as {
            messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
            flowContext?: unknown
          }

          if (!messages || !Array.isArray(messages) || messages.length === 0) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid request: messages array is required' }))
            return
          }

          let systemMessage =
            'You are a flowchart assistant helping users create and modify flowcharts.'
          if (flowContext) {
            systemMessage += `\n\nThe user has the following flowchart:\n${JSON.stringify(
              flowContext,
              null,
              2
            )}\n\nHelp them modify or understand their flowchart. If they ask you to make changes, explain what you would do clearly. You cannot directly modify the flowchart, but you can provide clear instructions.`
          }

          const endpoint = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-15-preview`

          const upstream = await fetch(endpoint, {
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

          const upstreamJson = await upstream.json().catch(() => ({}))
          if (!upstream.ok) {
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error:
                  upstreamJson?.error?.message ||
                  `Azure OpenAI API request failed with status ${upstream.status}`,
              })
            )
            return
          }

          const assistantMessage =
            upstreamJson?.choices?.[0]?.message?.content || 'No response received.'

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ message: assistantMessage, role: 'assistant' }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : 'Internal server error',
            })
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiChatDevPlugin(mode)],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))

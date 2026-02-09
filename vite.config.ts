import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { join } from 'path'

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

          // Load the same flowchart generation skill used in production
          const skillPath = join(process.cwd(), 'api', 'flowchart-generation-skill.md')
          let systemMessage: string
          try {
            systemMessage = readFileSync(skillPath, 'utf-8')
          } catch {
            console.warn('Could not load flowchart-generation-skill.md, using fallback prompt')
            systemMessage =
              'You are a flowchart JSON generator. You ONLY output valid JSON with "summary", "nodes", and "edges" fields. Never output plain text.'
          }

          if (flowContext) {
            systemMessage += `\n\n---\n\nCURRENT FLOWCHART CONTEXT:\n${JSON.stringify(flowContext, null, 2)}\n\nGenerate NEW nodes/edges to insert alongside the existing flowchart.`
          }

          // Same structured output schema as production (api/chat.ts)
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

          const endpoint = `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=2024-08-01-preview`
          const allMessages = [{ role: 'system', content: systemMessage }, ...messages]

          // Helper to call Azure OpenAI with a given response_format
          const callAzure = async (responseFormat: unknown) => {
            const reqBody: Record<string, unknown> = {
              messages: allMessages,
              max_completion_tokens: 4000,
              temperature: 1,
            }
            if (responseFormat) {
              reqBody.response_format = responseFormat
            }
            return fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey as string,
              },
              body: JSON.stringify(reqBody),
            })
          }

          // Try structured outputs first, fall back to json_object if unsupported
          let upstream = await callAzure(flowchartSchema)

          if (!upstream.ok) {
            const errorData = await upstream.json().catch(() => ({}))
            const errorMsg = errorData?.error?.message || ''
            const isFormatError =
              upstream.status === 400 &&
              (errorMsg.includes('response_format') ||
                errorMsg.includes('json_schema') ||
                errorMsg.includes('Unsupported'))

            if (isFormatError) {
              console.warn('json_schema not supported, falling back to json_object')
              upstream = await callAzure({ type: 'json_object' })
            }

            if (!upstream.ok) {
              const finalError = isFormatError
                ? await upstream.json().catch(() => ({}))
                : errorData
              res.statusCode = upstream.status
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error:
                    finalError?.error?.message ||
                    `Azure OpenAI API request failed with status ${upstream.status}`,
                })
              )
              return
            }
          }

          const upstreamJson = await upstream.json().catch(() => ({}))
          const assistantMessage =
            upstreamJson?.choices?.[0]?.message?.content || 'No response received.'
          const finishReason = upstreamJson?.choices?.[0]?.finish_reason || 'unknown'

          // Server-side validation: ensure valid JSON with nodes/edges
          try {
            const parsed = JSON.parse(assistantMessage)
            if (!parsed.nodes || !Array.isArray(parsed.nodes) || !parsed.edges || !Array.isArray(parsed.edges)) {
              console.error('Response is JSON but missing nodes/edges:', assistantMessage)
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'AI returned an invalid flowchart structure. Please try again.' }))
              return
            }
          } catch {
            console.error('AI returned non-JSON:', assistantMessage.substring(0, 200))
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'AI returned a non-JSON response. Please try rephrasing your request as a process or workflow.' }))
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ message: assistantMessage, role: 'assistant', finishReason }))
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
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: !!process.env.PORT,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))

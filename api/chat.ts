import type { IncomingMessage } from 'node:http'
import type { ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeAIProposal, parseAIProposal } from '../src/shared/aiProposal.js'
import { NODE_TYPES, ICON_NODE_TYPES, CONTAINER_KINDS, EDGE_PROTOCOLS, COMM_STYLES, LIMITS } from '../src/shared/flowTypes.js'
import { DIAGRAM_ICONS } from '../src/shared/diagramIcons.js'
import { BODY_TOO_LARGE_FLAG, clientIp } from '../src/shared/server/http.js'
import { ChatLimitError, createChatLimiter, type ChatLimiter } from '../src/shared/server/chatLimits.js'

interface Message { role: 'user' | 'assistant'; content: string }
function reply(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}
interface ChatRequest extends IncomingMessage { body?: unknown }
interface ChatHandlerOptions {
  env?: Record<string, string | undefined>; limiter?: ChatLimiter; fetcher?: typeof fetch
  readInstructions?: () => string; timeoutMs?: number
}
class ProviderDataError extends Error {}
async function providerJson(response: Response, maxBytes = 1_500_000): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new ProviderDataError('Provider response too large')
  const reader = response.body?.getReader()
  if (!reader) throw new ProviderDataError('Provider response is empty')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) { await reader.cancel(); throw new ProviderDataError('Provider response too large') }
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ProviderDataError('Provider returned unreadable JSON') }
}
function websiteOrigin(req: ChatRequest, env: Record<string, string | undefined>): boolean {
  const configured = env.PUBLIC_BASE_URL?.trim()
  if (!configured) return true
  let expected: string
  try {
    const url = new URL(configured)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) return false
    expected = url.origin
  } catch { return false }
  const origin = req.headers.origin
  if (origin && origin !== expected) return false
  const production = env.VERCEL_ENV ? env.VERCEL_ENV !== 'development' : env.NODE_ENV === 'production'
  if (production && origin !== expected) return false
  const site = req.headers['sec-fetch-site']
  return !site || ['same-origin', 'none'].includes(String(site))
}
const nullable = (type: 'string' | 'number', values?: readonly string[]) => ({ type: [type, 'null'], ...(values ? { enum: [...values, null] } : {}) })
const nodeProperties = {
  id: { type: 'string' }, type: { type: 'string', enum: [...NODE_TYPES] }, label: { type: 'string' },
  position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false },
  width: nullable('number'), height: nullable('number'), imageUrl: nullable('string'), icon: nullable('string'),
  parentNode: nullable('string'), containerKind: nullable('string', CONTAINER_KINDS),
}
const edgeProperties = {
  id: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' }, label: nullable('string'),
  style: nullable('string', ['default', 'animated', 'step']),
  sourceHandle: nullable('string', ['top', 'right', 'bottom', 'left']), targetHandle: nullable('string', ['top', 'right', 'bottom', 'left']),
  protocol: nullable('string', EDGE_PROTOCOLS), commStyle: nullable('string', COMM_STYLES),
}
export const AI_RESPONSE_FORMAT = {
  type: 'json_schema', json_schema: { name: 'FlowchartProposal', strict: true, schema: {
    type: 'object', properties: {
      summary: { type: 'string' },
      nodes: { type: 'array', items: { type: 'object', properties: nodeProperties, required: Object.keys(nodeProperties), additionalProperties: false } },
      edges: { type: 'array', items: { type: 'object', properties: edgeProperties, required: Object.keys(edgeProperties), additionalProperties: false } },
    }, required: ['summary', 'nodes', 'edges'], additionalProperties: false,
  } },
}

export function createChatHandler(options: ChatHandlerOptions = {}) {
  const env = options.env ?? process.env
  const fetcher = options.fetcher ?? fetch
  let limiter = options.limiter
  return async function handler(req: ChatRequest, res: ServerResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, { error: 'Method not allowed' }) }
  let providerStarted = false
  let timedOut = false
  try {
    if (!websiteOrigin(req, env)) return reply(res, 403, { error: 'Open the assistant from the Flowchart website to continue.' })
    if ((req as unknown as Record<string, unknown>)[BODY_TOO_LARGE_FLAG]) return reply(res, 413, { error: 'This diagram is too large for one AI request. Try a smaller section.' })
    if (req.headers['content-type'] && !String(req.headers['content-type']).toLowerCase().includes('application/json')) return reply(res, 415, { error: 'The assistant request must use JSON.' })
    let raw: unknown
    try { raw = req.body } catch { return reply(res, 400, { error: 'The assistant request must contain valid JSON.' }) }
    const body = raw as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 20) {
      return reply(res, 400, { error: 'Send between 1 and 20 conversation messages.' })
    }
    if (Buffer.byteLength(JSON.stringify(body)) > LIMITS.maxBodyBytes) return reply(res, 413, { error: 'This diagram is too large for one AI request. Try a smaller section.' })
    const messages: Message[] = []
    for (const entry of body.messages) {
      if (!entry || typeof entry !== 'object' || !['user', 'assistant'].includes(entry.role) || typeof entry.content !== 'string' || !entry.content.trim() || entry.content.length > 10000) {
        return reply(res, 400, { error: 'Messages must contain user or assistant text of up to 10,000 characters.' })
      }
      messages.push({ role: entry.role, content: entry.content })
    }
    if (messages[messages.length - 1].role !== 'user') return reply(res, 400, { error: 'The last message must describe your request.' })
    if (body.mode != null && body.mode !== 'generate' && body.mode !== 'refine') return reply(res, 400, { error: 'Choose generate or refine mode.' })
    if (body.diagramMode != null && body.diagramMode !== 'flowchart' && body.diagramMode !== 'architecture') return reply(res, 400, { error: 'Choose flowchart or architecture mode.' })
    const refine = body.mode === 'refine'
    let context: ReturnType<typeof normalizeAIProposal> | undefined
    let preservedImageNodeIds: string[] = []
    if (body.flowContext != null) {
      try {
        const rawContext = body.flowContext as { nodes?: Array<{ id?: unknown; type?: unknown; imageUrl?: unknown; icon?: unknown }> }
        // Context uploads stay in the browser in both modes. Only edit-mode
        // responses may reuse those existing ids without supplying artwork.
        const omittedImageIds = Array.isArray(rawContext.nodes)
          ? rawContext.nodes.filter(node => node?.type === 'image' && typeof node.id === 'string' && !node.imageUrl && !node.icon).map(node => String(node.id))
          : []
        context = normalizeAIProposal(body.flowContext, true, { preservedImageNodeIds: omittedImageIds })
        // Upload bytes may already be omitted from architecture nodes too. Only
        // existing compatible ids may omit a source in the response; the client
        // verifies and restores its actual original artwork before applying it.
        preservedImageNodeIds = refine ? context.nodes.filter(node => ICON_NODE_TYPES.includes(node.type)).map(node => node.id) : []
      }
      catch { return reply(res, 400, { error: 'The current diagram contains invalid nodes or connections. Check it before asking the assistant to edit it.' }) }
    }
    if (refine && !context) return reply(res, 400, { error: 'A current diagram is required for editing.' })
    const deployment = env.AZURE_DEPLOYMENT_NAME
    const resource = env.AZURE_RESOURCE_NAME
    const key = env.AZURE_API_KEY
    if (!deployment || !resource || !key) return reply(res, 503, { error: 'The AI assistant is not configured on this server yet. You can still use templates and edit the canvas.' })
    if (!/^[A-Za-z0-9-]+$/.test(resource)) return reply(res, 503, { error: 'The AI assistant configuration needs attention.' })
    let instructions = options.readInstructions ? options.readInstructions() : readFileSync(join(process.cwd(), 'api', 'flowchart-generation-skill.md'), 'utf8')
    instructions += '\n\nADDITIONAL SUPPORTED FEATURES:\nYou may use all of these node types: ' + NODE_TYPES.join(', ') + '. Only these types may have icon or imageUrl: ' + ICON_NODE_TYPES.join(', ') + '. Use a known catalog icon reference or an existing usable image URL. Image nodes require one of those sources; existing nodes with artwork may retain their unchanged ids with an omitted source for client restoration when using an image or architecture type. Choose one source: a catalog icon takes precedence over imageUrl. Never add icon/imageUrl to other node types. Group nodes in a container using parentNode; containerKind is valid only on a container. Preserve protocol and commStyle on architecture connections. Return null for unused optional fields. Never invent an external image URL. Existing image URLs must be preserved when supplied. Uploaded binary images are omitted from the context and will be restored by the client for unchanged node ids.'
    instructions += '\nLOCAL ICON CATALOG (id=name): ' + DIAGRAM_ICONS.map(icon => `${icon.id}=${icon.name}`).join('; ') + '. Preserve other existing canonical Azure icon references when supplied.'
    if (body.diagramMode === 'architecture') instructions += '\nThe user is working in architecture mode. Prefer service, database, queue, cache, apiGateway, externalActor and meaningful container boundaries.'
    if (context) {
      instructions += `\n\nCURRENT DIAGRAM:\n${JSON.stringify(context)}\n\n` + (refine
        ? 'EDIT MODE: Return the COMPLETE diagram with all nodes and edges. Preserve ids, positions, sizes, images, container hierarchy and connection details for every part the user did not ask to change. Only change the requested parts. Use new unique ids for added nodes. Do not replace the diagram from scratch. Explain the concrete changes in summary.'
        : 'INSERT MODE: Generate a NEW standalone diagram. Do not repeat the existing nodes. It will be inserted alongside the current canvas.')
      if (Array.isArray(body.selectedNodeIds)) {
        const selected = body.selectedNodeIds.filter((id): id is string => typeof id === 'string' && context.nodes.some((n) => n.id === id)).slice(0, LIMITS.maxNodes)
        if (refine && selected.length) instructions += `\nFocus the requested change on selected nodes ${JSON.stringify(selected)} unless the user asks otherwise. Return the complete diagram.`
      }
    }
    const endpoint = `https://${resource}.openai.azure.com/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-08-01-preview`
    limiter ??= createChatLimiter(env)
    const reservation = await limiter.acquire(clientIp(req, env))
    const controller = new AbortController()
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, options.timeoutMs ?? 90000)
    const disconnected = () => { if (!res.writableEnded) controller.abort() }
    res.on('close', disconnected)
    const call = (format: unknown) => fetcher(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': key }, signal: controller.signal,
      body: JSON.stringify({ messages: [{ role: 'system', content: instructions }, ...messages], max_completion_tokens: 12000, temperature: 1, response_format: format }),
    })
    try {
      providerStarted = true
      let response = await call(AI_RESPONSE_FORMAT)
      if (!response.ok && response.status === 400) {
        const err = await providerJson(response, 16000).catch(() => ({})) as { error?: { message?: string } }
        if (/response_format|json_schema/i.test(err.error?.message ?? '')) response = await call({ type: 'json_object' })
      }
      if (!response.ok) {
        if (response.status === 429) res.setHeader('Retry-After', Math.max(1, Math.min(3600, Number(response.headers.get('retry-after')) || 30)))
        return reply(res, response.status === 429 ? 429 : 502, { error: response.status === 429 ? 'The assistant is busy. Please wait a moment and try again.' : 'The AI provider could not complete this request. Please try again.' })
      }
      const data = await providerJson(response) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
      const content = data.choices?.[0]?.message?.content
      const finishReason = data.choices?.[0]?.finish_reason
      if (!content || finishReason === 'length') return reply(res, 502, { error: 'The diagram response was incomplete. Try a smaller change or fewer steps.' })
      try {
        const proposal = parseAIProposal(content, finishReason, refine, { preservedImageNodeIds })
        return reply(res, 200, { message: JSON.stringify(proposal), role: 'assistant', finishReason })
      } catch { return reply(res, 502, { error: 'The assistant returned an invalid diagram. Please try again or describe a smaller change.' }) }
    } finally { clearTimeout(timeout); res.off('close', disconnected); controller.abort(); await reservation.release().catch(() => {}) }
  } catch (error) {
    if (res.destroyed) return
    if (error instanceof ChatLimitError) {
      if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter)
      return reply(res, error.status, { error: error.message, code: error.code })
    }
    if (timedOut) return reply(res, 504, { error: 'The assistant timed out. Your canvas is safe; try again with a smaller request.' })
    return reply(res, providerStarted ? 502 : 500, { error: providerStarted ? 'The AI provider could not complete this request. Please try again.' : 'The assistant encountered a server error. Please try again.' })
  }
  }
}

export default createChatHandler()
export const maxDuration = 120

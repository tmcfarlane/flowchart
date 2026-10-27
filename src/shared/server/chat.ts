import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { z } from 'zod'
import { aiEnabled, readAiConfig, providerEndpoint, type AiConfig, type AiEnv } from './aiConfig.js'
import { createAiAdmission, type AiAdmission, type AdmissionReason } from './aiAdmission.js'
import { ChatRequestSchema, ProposalSchema, PROPOSAL_RESPONSE_FORMAT, type ChatRequest } from './chatSchema.js'
import { BODY_TOO_LARGE_FLAG, clientIp, sendJson, type ApiRequest } from './http.js'

interface ChatDependencies {
  fetch: typeof fetch
  admission: AiAdmission
  skill: string
  report(event: AiEvent): void
}
export interface AiEvent {
  event: 'ai_request'
  requestId: string
  environment: string
  routing: string
  status: number
  outcome: string
  attempts: number
  latencyMs: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  reservedCostUsd: number
  usageReported: boolean
  model?: string
}
export interface ChatContext {
  env: AiEnv
  dependencies?: Partial<ChatDependencies>
}
const completionSchema = z.object({
  model: z.string().max(200).optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }).optional(), finish_reason: z.string().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional(),
})
const providerErrorSchema = z.object({ error: z.object({ message: z.string().max(10000).optional(), param: z.string().nullable().optional(), code: z.string().nullable().optional() }) })
const defaultAdmissions = new Map<string, AiAdmission>()
let skillContent: string | undefined

class ChatFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfter?: number) { super(message) }
}
const unavailable = () => new ChatFailure(503, 'unavailable', 'AI is temporarily unavailable. Please try again later.')

function buildMessages(request: ChatRequest, skill: string) {
  let system = skill
  system += request.diagramMode === 'architecture' || request.diagramMode === 'draw'
    ? '\nCreate an architecture diagram. Use service, database, queue, cache, apiGateway, externalActor and container nodes as appropriate. Preserve parentNode, containerKind, protocol and commStyle metadata. Child positions are relative to their container. Include all schema fields and use null for unused optional values.'
    : '\nCreate a flowchart. Use step, decision, note and image nodes. Include all schema fields and use null for unused optional values.'
  if (request.flowContext) {
    system += request.mode === 'refine'
      ? `\nEXISTING DIAGRAM TO REFINE:\n${JSON.stringify(request.flowContext)}\nReturn the COMPLETE diagram. Preserve every unchanged node and edge, including IDs, geometry, nesting, icons and protocol metadata. Only modify what the user requests.`
      : `\nCURRENT DIAGRAM CONTEXT:\n${JSON.stringify(request.flowContext)}\nGenerate NEW nodes and edges to insert alongside this context.`
  }
  return [{ role: 'system', content: system }, ...request.messages]
}

function defaultAdmission(env: AiEnv, config: AiConfig): AiAdmission {
  const key = JSON.stringify([config.environment, config.admissionStore, config.clientPerMinute, config.globalPerMinute, config.dailyBudgetMicros, config.concurrency, env.KV_REST_API_URL, env.KV_REST_API_TOKEN, env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN])
  let admission = defaultAdmissions.get(key)
  if (!admission) {
    admission = createAiAdmission(env, config)
    defaultAdmissions.set(key, admission)
  }
  return admission
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw unavailable()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new ChatFailure(502, 'response_size', 'AI returned too much data. Try a simpler diagram.')
      }
      chunks.push(result.value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { return null }
  } catch (error) {
    if (error instanceof ChatFailure) throw error
    throw new ChatFailure(502, 'invalid_response', 'AI returned an invalid response. Please try again.')
  } finally {
    reader.releaseLock()
  }
}

function formatUnsupported(status: number, data: unknown): boolean {
  if (status !== 400) return false
  const parsed = providerErrorSchema.safeParse(data)
  if (!parsed.success) return false
  const error = parsed.data.error
  return error.param === 'response_format' && ['unsupported_value', 'unsupported_parameter'].includes(error.code || '')
    || /(?:response_format|json_schema).{0,100}(?:not supported|unsupported)|does not support.{0,50}json_schema/i.test(error.message || '')
}

function upstreamFailure(status: number): ChatFailure {
  if (status === 429) return new ChatFailure(429, 'upstream_limit', 'AI has reached a usage limit. Please try again later.', 60)
  if (status === 401 || status === 403) return unavailable()
  if (status >= 500) return unavailable()
  return new ChatFailure(502, 'provider_rejected', 'AI could not complete this request. Try a simpler diagram.')
}

function denied(reason: AdmissionReason, retryAfter: number): ChatFailure {
  const messages: Record<AdmissionReason, string> = {
    client_rate: 'Too many AI requests. Please wait before trying again.',
    global_rate: 'AI is busy. Please try again shortly.',
    budget: 'AI has reached its daily usage limit. Please try again tomorrow.',
    concurrency: 'AI is busy. Please try again shortly.',
  }
  return new ChatFailure(429, reason, messages[reason], retryAfter)
}

export async function handleChat(req: ApiRequest, res: ServerResponse, context: ChatContext = { env: process.env }): Promise<void> {
  const started = Date.now()
  const requestId = randomUUID()
  const event: AiEvent = { event: 'ai_request', requestId, environment: 'unknown', routing: 'disabled', status: 500, outcome: 'internal', attempts: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, reservedCostUsd: 0, usageReported: false }
  const report = context.dependencies?.report || ((entry: AiEvent) => console.info(JSON.stringify(entry)))
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let deadline: Promise<never> | undefined
  const bounded = <T>(work: Promise<T>): Promise<T> => deadline ? Promise.race([work, deadline]) : work
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      throw new ChatFailure(405, 'method', 'Method not allowed')
    }
    if (!aiEnabled(context.env)) throw new ChatFailure(503, 'disabled', 'AI is currently disabled. You can still edit the canvas.')
    const config = readAiConfig(context.env)
    event.environment = config.environment
    event.routing = config.route.kind
    if (config.route.kind === 'disabled') throw new ChatFailure(503, 'unconfigured', 'AI is not configured. You can still edit the canvas.')
    deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(new ChatFailure(504, 'timeout', 'AI took too long to respond. Please try a simpler request.'))
      }, Math.max(1, config.timeoutMs - (Date.now() - started)))
    })
    const oversized = Reflect.get(req, BODY_TOO_LARGE_FLAG)
    const contentLength = Number(req.headers['content-length'] || 0)
    if (oversized || contentLength > config.maxBodyBytes) throw new ChatFailure(413, 'request_size', 'This diagram is too large for AI. Try a smaller selection or shorter conversation.')
    let rawBody: unknown
    try {
      rawBody = req.body
      if (typeof rawBody === 'string') {
        if (Buffer.byteLength(rawBody) > config.maxBodyBytes) throw new ChatFailure(413, 'request_size', 'This request is too large for AI.')
        rawBody = JSON.parse(rawBody)
      }
      if (Buffer.byteLength(JSON.stringify(rawBody) || '') > config.maxBodyBytes) throw new ChatFailure(413, 'request_size', 'This request is too large for AI.')
    } catch (error) {
      if (error instanceof ChatFailure) throw error
      throw new ChatFailure(400, 'invalid_request', 'Invalid AI request.')
    }
    const parsed = ChatRequestSchema.safeParse(rawBody)
    if (!parsed.success) throw new ChatFailure(400, 'invalid_request', 'Invalid AI request. Use at most 20 messages, 200 nodes and 400 edges.')
    const request = parsed.data
    const skill = context.dependencies?.skill ?? (skillContent ??= readFileSync(join(process.cwd(), 'api', 'flowchart-generation-skill.md'), 'utf8'))
    const messages = buildMessages(request, skill)
    const admission = context.dependencies?.admission ?? defaultAdmission(context.env, config)
    const doFetch = context.dependencies?.fetch ?? fetch
    const route = config.route
    const endpoint = providerEndpoint(route)
    let responseFormat: unknown = PROPOSAL_RESPONSE_FORMAT
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!aiEnabled(context.env)) throw new ChatFailure(503, 'disabled', 'AI is currently disabled. You can still edit the canvas.')
      const body = JSON.stringify({ messages, max_completion_tokens: config.maxOutputTokens, ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}), response_format: responseFormat })
      const inputBytes = Buffer.byteLength(body)
      if (inputBytes > config.maxInputBytes) throw new ChatFailure(413, 'context_size', 'This diagram or conversation is too large for AI. Try a smaller diagram.')
      const inputTokenBound = inputBytes + 1024 + messages.length * 16
      const costMicros = Math.ceil((inputTokenBound * config.inputPricePerMillion + config.maxOutputTokens * config.outputPricePerMillion) * config.admissionCostMultiplier)
      const allowance = await bounded(admission.acquire({ id: `${requestId}:${attempt}`, client: clientIp(req, context.env), costMicros, leaseMs: config.timeoutMs * 2 + 60000 }))
      if (!allowance.allowed) throw denied(allowance.reason, allowance.retryAfterSeconds)
      event.reservedCostUsd += costMicros / 1000000
      let finished = false
      try {
        if (!aiEnabled(context.env)) throw new ChatFailure(503, 'disabled', 'AI is currently disabled. You can still edit the canvas.')
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'api-key': route.azure.apiKey }
        if (route.kind === 'gateway') {
          Object.assign(headers, {
            'cf-aig-authorization': `Bearer ${route.token}`,
            'cf-aig-skip-cache': 'true',
            'cf-aig-collect-log-payload': 'false',
            'cf-aig-max-attempts': '1',
            'cf-aig-request-timeout': String(Math.max(1, config.timeoutMs - (Date.now() - started))),
            'cf-aig-custom-cost': JSON.stringify({ per_token_in: config.inputPricePerMillion / 1000000, per_token_out: config.outputPricePerMillion / 1000000 }),
            'cf-aig-metadata': JSON.stringify({ environment: config.environment, requestId, operation: request.mode, diagramMode: request.diagramMode }),
          })
        }
        event.attempts++
        const response = await bounded(doFetch(endpoint, { method: 'POST', headers, body, signal: controller.signal }))
        const data = await bounded(readBoundedResponse(response, config.maxResponseBytes))
        finished = true
        if (!response.ok) {
          if (attempt === 0 && formatUnsupported(response.status, data)) {
            responseFormat = { type: 'json_object' }
            continue
          }
          throw upstreamFailure(response.status)
        }
        const completion = completionSchema.safeParse(data)
        if (!completion.success) throw new ChatFailure(502, 'invalid_response', 'AI returned an invalid response. Please try again.')
        const model = completion.data.model
        if (model && /^[A-Za-z0-9._-]{1,100}$/.test(model)) event.model = model
        const usage = completion.data.usage
        if (usage) {
          event.usageReported = true
          event.inputTokens += usage.prompt_tokens
          event.outputTokens += usage.completion_tokens
          event.estimatedCostUsd += (usage.prompt_tokens * config.inputPricePerMillion + usage.completion_tokens * config.outputPricePerMillion) / 1000000
        }
        const choice = completion.data.choices[0]
        if (choice.finish_reason === 'length') throw new ChatFailure(502, 'truncated', 'AI reached its response limit. Try a simpler diagram.')
        let proposal: unknown
        try { proposal = JSON.parse(choice.message?.content || '') as unknown } catch { throw new ChatFailure(502, 'invalid_diagram', 'AI returned an invalid diagram. Please try again.') }
        const validated = ProposalSchema.safeParse(proposal)
        if (!validated.success) throw new ChatFailure(502, 'invalid_diagram', 'AI returned an invalid diagram. Please try again.')
        await bounded(allowance.release())
        finished = false
        event.status = 200
        event.outcome = 'success'
        sendJson(res, 200, { message: JSON.stringify(validated.data), role: 'assistant', finishReason: choice.finish_reason || 'stop' }, { 'X-Request-Id': requestId })
        return
      } finally {
        if (finished && !timedOut) await bounded(allowance.release())
      }
    }
    throw unavailable()
  } catch (error) {
    const failure = timedOut
      ? new ChatFailure(504, 'timeout', 'AI took too long to respond. Please try a simpler request.')
      : error instanceof ChatFailure ? error : unavailable()
    event.status = failure.status
    event.outcome = failure.code
    sendJson(res, failure.status, { error: failure.message, code: failure.code }, { 'X-Request-Id': requestId, ...(failure.retryAfter ? { 'Retry-After': String(failure.retryAfter) } : {}) })
  } finally {
    if (timer) clearTimeout(timer)
    event.latencyMs = Date.now() - started
    report(event)
  }
}

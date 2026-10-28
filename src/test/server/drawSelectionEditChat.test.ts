// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleChat, type AiEvent, type ChatContext } from '../../shared/server/chat'
import { prepareVercelStyleRequest } from '../../shared/server/nodeAdapter'

const ENV = {
  AI_ROUTING_MODE: 'gateway', AZURE_RESOURCE_NAME: 'test-resource', AZURE_DEPLOYMENT_NAME: 'test-deployment',
  AZURE_API_KEY: 'provider-secret', CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_AI_GATEWAY_ID: 'gateway', CLOUDFLARE_AI_GATEWAY_TOKEN: 'gateway-secret',
  AI_INPUT_PRICE_PER_MILLION: '0.25', AI_OUTPUT_PRICE_PER_MILLION: '0.75', NODE_ENV: 'test',
}
const REQUEST = {
  mode: 'draw-edit', diagramMode: 'draw', messages: [{ role: 'user', content: 'Make the selected shape blue.' }],
  drawContext: { targets: [{ id: 'shape', type: 'rectangle', x: 0, y: 0, width: 200, height: 100, angle: 0, geometryAllowed: true, textAllowed: false, dependencyIds: [] }], dependencies: [] },
}
const EDIT = { summary: 'Make the selected shape blue.', operations: [{ op: 'update_element', id: 'shape', changes: { backgroundColor: '#dbeafe' } }] }
const upstream = (proposal: unknown = EDIT, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposal) }, finish_reason: finishReason }], usage: { prompt_tokens: 100, completion_tokens: 40 } }))
const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve())) })

function context(fetcher: typeof fetch = vi.fn(async () => upstream())) {
  const report = vi.fn<(entry: AiEvent) => void>(), release = vi.fn(async () => {})
  const acquire = vi.fn(async () => ({ allowed: true as const, release }))
  return { env: ENV, dependencies: { fetch: fetcher, report, admission: { acquire }, skill: 'Generation-only diagram prompt.' }, release, acquire }
}
async function server(ctx: ChatContext): Promise<string> {
  const instance = createServer(async (req, res) => {
    await prepareVercelStyleRequest(req, {}, 128 * 1024)
    await handleChat(req, res, ctx)
  })
  servers.push(instance)
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(instance.address() as AddressInfo).port}/api/chat`
}
const post = (url: string, body: unknown = REQUEST) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('selected Draw edit chat', () => {
  it('reuses authenticated Azure gateway, admission, response format and confidential logging', async () => {
    const fetcher = vi.fn(async () => upstream()), ctx = context(fetcher)
    const response = await post(await server(ctx))
    expect(response.status).toBe(200)
    expect(JSON.parse((await response.json()).message)).toEqual(EDIT)
    expect(ctx.acquire).toHaveBeenCalledOnce()
    expect(ctx.release).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('gateway.ai.cloudflare.com')
    const headers = new Headers(init.headers)
    expect(headers.get('api-key')).toBe('provider-secret')
    expect(headers.get('cf-aig-authorization')).toBe('Bearer gateway-secret')
    expect(headers.get('cf-aig-collect-log-payload')).toBe('false')
    const body = JSON.parse(String(init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('FROZEN DRAW CONTEXT')
    expect(body.messages[0].content).not.toContain('Generation-only diagram prompt.')
    expect(JSON.stringify(ctx.dependencies.report.mock.calls)).not.toMatch(/provider-secret|gateway-secret|selected shape/)
  })
  it.each([
    { ...REQUEST, diagramMode: 'architecture' }, { ...REQUEST, drawContext: undefined }, { ...REQUEST, flowContext: { nodes: [], edges: [] } },
    { ...REQUEST, drawContext: { ...REQUEST.drawContext, files: {} } },
    { ...REQUEST, drawContext: { ...REQUEST.drawContext, targets: [{ ...REQUEST.drawContext.targets[0], customData: {} }] } },
  ])('rejects invalid Draw contexts before acquiring provider allowance', async request => {
    const ctx = context()
    expect((await post(await server(ctx), request)).status).toBe(400)
    expect(ctx.acquire).not.toHaveBeenCalled()
    expect(ctx.dependencies.fetch).not.toHaveBeenCalled()
  })
  it.each([
    { summary: 'replace', elements: [] },
    { summary: 'outside', operations: [{ op: 'update_element', id: 'other', changes: { x: 50 } }] },
    { summary: 'unsafe', operations: [{ op: 'update_element', id: 'shape', changes: { link: 'https://example.com' } }] },
  ])('rejects invalid provider proposals and releases the lease', async proposal => {
    const ctx = context(vi.fn(async () => upstream(proposal)))
    const response = await post(await server(ctx))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'invalid_edit' })
    expect(ctx.release).toHaveBeenCalledOnce()
  })
  it('rejects geometry changes when a relationship makes geometry read only', async () => {
    const ctx = context(vi.fn(async () => upstream({ ...EDIT, operations: [{ op: 'update_element', id: 'shape', changes: { x: 20 } }] })))
    const response = await post(await server(ctx), { ...REQUEST, drawContext: { targets: [{ ...REQUEST.drawContext.targets[0], geometryAllowed: false, dependencyIds: ['arrow'] }], dependencies: [{ id: 'arrow', type: 'arrow', locked: false, selected: false }] } })
    expect(response.status).toBe(502)
  })
  it('keeps the existing kill switch and refuses truncated proposals', async () => {
    const disabled = context(); disabled.env = { ...ENV, AI_ENABLED: 'false' } as typeof ENV
    expect((await post(await server(disabled))).status).toBe(503)
    expect(disabled.acquire).not.toHaveBeenCalled()
    const response = await post(await server(context(vi.fn(async () => upstream(EDIT, 'length')))))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'truncated' })
  })
})

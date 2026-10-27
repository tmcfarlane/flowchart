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
  mode: 'edit', diagramMode: 'architecture', messages: [{ role: 'user', content: 'Rename the selected service to Orders API.' }],
  selection: { nodeIds: ['api'], edgeIds: [], snapshotId: 'private-selection-snapshot', revision: 12 },
  flowContext: {
    nodes: [
      { id: 'api', type: 'service', label: 'Verbose API service', position: { x: -40, y: 0 }, icon: 'app-services' },
      { id: 'db', type: 'database', label: 'Keep this database unchanged', position: { x: 250, y: 0 } },
    ],
    edges: [{ id: 'connection', source: 'api', target: 'db', protocol: 'SQL', commStyle: 'sync' }],
  },
}
const EDIT = { summary: 'Rename the selected service in place.', operations: [{ op: 'update_node', id: 'api', changes: { label: 'Orders API' } }] }
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

describe('selected-node edit chat gateway', () => {
  it('returns a validated no-op explanation without inventing changes', async () => {
    const noChanges = { summary: 'The selected service already has the requested name.', operations: [] }
    const response = await post(await server(context(vi.fn(async () => upstream(noChanges)))))
    expect(response.status).toBe(200)
    expect(JSON.parse((await response.json()).message)).toEqual(noChanges)
  })

  it('returns sparse validated operations through the same authenticated and admitted gateway', async () => {
    const fetcher = vi.fn(async () => upstream()), ctx = context(fetcher)
    const response = await post(await server(ctx))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ role: 'assistant', finishReason: 'stop', message: JSON.stringify(EDIT) })
    expect(ctx.acquire).toHaveBeenCalledOnce()
    expect(ctx.release).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('gateway.ai.cloudflare.com/v1/account/gateway/azure-openai/test-resource/test-deployment')
    const headers = new Headers(init.headers)
    expect(headers.get('api-key')).toBe('provider-secret')
    expect(headers.get('cf-aig-authorization')).toBe('Bearer gateway-secret')
    expect(headers.get('cf-aig-collect-log-payload')).toBe('false')
    expect(JSON.parse(headers.get('cf-aig-metadata')!)).toMatchObject({ operation: 'edit', diagramMode: 'architecture' })
    const body = JSON.parse(String(init.body))
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('READ ONLY')
    expect(body.messages[0].content).toContain('private-selection-snapshot')
    expect(body.messages[0].content).not.toContain('Generation-only diagram prompt.')
    expect(JSON.stringify(ctx.dependencies.report.mock.calls)).not.toMatch(/provider-secret|gateway-secret|private-selection-snapshot|Orders API|Keep this database/)
  })

  it.each([
    { ...REQUEST, selection: undefined },
    { ...REQUEST, selection: { ...REQUEST.selection, nodeIds: [] } },
    { ...REQUEST, selection: { ...REQUEST.selection, nodeIds: ['missing'] } },
    { ...REQUEST, selection: { ...REQUEST.selection, edgeIds: ['missing'] } },
    { ...REQUEST, flowContext: undefined },
    { ...REQUEST, diagramMode: 'draw' },
    { ...REQUEST, mode: 'generate' },
  ])('rejects invalid scope / unsupported mode before spending provider allowance', async request => {
    const fetcher = vi.fn(async () => upstream()), ctx = context(fetcher)
    const response = await post(await server(ctx), request)
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    expect(ctx.acquire).not.toHaveBeenCalled()
  })

  it('rejects a valid-looking edit targeting an unselected node and releases its lease', async () => {
    const invalid = { summary: 'Wrong target', operations: [{ op: 'update_node', id: 'db', changes: { label: 'Do not change' } }] }
    const ctx = context(vi.fn(async () => upstream(invalid)))
    const response = await post(await server(ctx))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'invalid_edit', error: expect.stringContaining('outside') })
    expect(ctx.release).toHaveBeenCalledOnce()
    expect(ctx.dependencies.report).toHaveBeenCalledWith(expect.objectContaining({ status: 502, outcome: 'invalid_edit' }))
  })

  it('requires explicit approval for the incidental deletion of a boundary connection', async () => {
    const deletion = { summary: 'Delete service', operations: [{ op: 'remove_node', id: 'api' }] }
    const blocked = context(vi.fn(async () => upstream(deletion)))
    expect((await post(await server(blocked))).status).toBe(502)
    const included = context(vi.fn(async () => upstream(deletion)))
    const response = await post(await server(included), { ...REQUEST, selection: { ...REQUEST.selection, edgeIds: ['connection'] } })
    expect(response.status).toBe(200)
    expect(JSON.parse((await response.json()).message)).toEqual(deletion)
  })

  it('rejects a selected container move that implicitly moves an unselected nested descendant', async () => {
    const moved = { summary: 'Move boundary', operations: [{ op: 'update_node', id: 'outer', changes: { position: { x: 200, y: 50 } } }] }
    const request = {
      ...REQUEST,
      selection: { ...REQUEST.selection, nodeIds: ['outer', 'inner'] },
      flowContext: {
        nodes: [
          { id: 'outer', type: 'container', label: 'Outer', position: { x: 100, y: 50 }, width: 600, height: 400 },
          { id: 'inner', type: 'container', label: 'Inner', parentNode: 'outer', position: { x: 20, y: 30 }, width: 300, height: 200 },
          { id: 'leaf', type: 'service', label: 'Unselected API', parentNode: 'inner', position: { x: 10, y: 20 } },
        ],
        edges: [],
      },
    }
    const ctx = context(vi.fn(async () => upstream(moved)))
    const response = await post(await server(ctx), request)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'invalid_edit', error: expect.stringContaining('unselected descendant') })
    expect(ctx.release).toHaveBeenCalledOnce()
  })

  it('preserves explicit null while leaving all unmentioned fields absent', async () => {
    const edit = { summary: 'Use default width', operations: [{ op: 'update_node', id: 'api', changes: { width: null } }] }
    const response = await post(await server(context(vi.fn(async () => upstream(edit)))))
    expect(response.status).toBe(200)
    expect(JSON.parse((await response.json()).message)).toEqual(edit)
  })

  it('rejects invented icon IDs before a proposal can fail shared-chart persistence', async () => {
    const edit = { summary: 'Use an invented icon', operations: [{ op: 'update_node', id: 'api', changes: { icon: 'not-an-azure-icon' } }] }
    const response = await post(await server(context(vi.fn(async () => upstream(edit)))))
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'invalid_edit', error: expect.stringContaining('unknown Azure icon') })
  })

  it('accepts existing shared connection IDs longer than generation-only IDs', async () => {
    const connectionId = 'connection-' + 'x'.repeat(120)
    const request = { ...REQUEST, selection: { ...REQUEST.selection, edgeIds: [connectionId] }, flowContext: { ...REQUEST.flowContext, edges: [{ ...REQUEST.flowContext.edges[0], id: connectionId }] } }
    const edit = { summary: 'Label connection', operations: [{ op: 'update_edge', id: connectionId, changes: { label: 'Query' } }] }
    const response = await post(await server(context(vi.fn(async () => upstream(edit)))), request)
    expect(response.status).toBe(200)
  })

  it('retains gateway admission failures and never falls back to direct Azure', async () => {
    const fetcher = vi.fn(async () => upstream()), ctx = context(fetcher)
    ctx.dependencies.admission.acquire = vi.fn(async () => ({ allowed: false as const, reason: 'budget' as const, retryAfterSeconds: 120 })) as typeof ctx.dependencies.admission.acquire
    const denied = await post(await server(ctx))
    expect(denied.status).toBe(429)
    expect(denied.headers.get('retry-after')).toBe('120')
    expect(fetcher).not.toHaveBeenCalled()
    const rejected = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'provider-secret' } }), { status: 503 }))
    const response = await post(await server(context(rejected)))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('provider-secret')
    expect(rejected).toHaveBeenCalledOnce()
    expect(String(rejected.mock.calls[0][0])).toContain('gateway.ai.cloudflare.com')
  })

  it('rejects malformed and truncated edit responses without accepting a replacement diagram', async () => {
    const replacement = { summary: 'Replacement', nodes: [], edges: [] }
    expect((await post(await server(context(vi.fn(async () => upstream(replacement)))))).status).toBe(502)
    const truncated = await post(await server(context(vi.fn(async () => upstream(EDIT, 'length')))))
    expect(truncated.status).toBe(502)
    expect(await truncated.json()).toMatchObject({ code: 'truncated' })
  })
})

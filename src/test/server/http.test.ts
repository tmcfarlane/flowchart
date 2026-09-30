// @vitest-environment node
// Runs the real Vercel handlers on a Node HTTP server (the same adapter the
// Vite dev server uses) and drives them over the network.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import mcpHandler from '../../../api/mcp'
import flowsHandler from '../../../api/flows/index'
import flowHandler from '../../../api/flows/[id]'
import {
  clientIp,
  createApiContext,
  handleFlowItem,
  handleFlowsCollection,
  handleMcp,
  type ApiContext,
} from '../../shared/server/http'
import { matchApiRoute, prepareVercelStyleRequest } from '../../shared/server/nodeAdapter'
import { MemoryRateLimiter } from '../../shared/server/rateLimit'
import { MemoryFlowStore, STORAGE_UNAVAILABLE_MESSAGE, StorageUnavailableError } from '../../shared/server/store'
import { LIMITS } from '../../shared/flowTypes'

function startServer(ctx: ApiContext): Promise<{ server: Server; base: string }> {
  const handlers = { mcp: handleMcp, flows: handleFlowsCollection, flow: handleFlowItem }
  const server = createServer(async (req, res) => {
    const route = matchApiRoute(new URL(req.url ?? '/', 'http://x').pathname)
    if (!route) {
      res.statusCode = 404
      res.end()
      return
    }
    await prepareVercelStyleRequest(req, route.params)
    await handlers[route.name](req, res, ctx)
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${port}` })
    }),
  )
}

const SAMPLE = {
  title: 'Password reset',
  nodes: [
    { id: 'req', type: 'step', label: 'Request reset link' },
    { id: 'known', type: 'decision', label: 'Email known?' },
    { id: 'send', type: 'step', label: 'Email a one-time link' },
    { id: 'noop', type: 'note', label: 'Always show the same message' },
  ],
  edges: [
    { source: 'req', target: 'known' },
    { source: 'known', target: 'send', label: 'Yes' },
  ],
}

describe('HTTP: api/mcp and api/flows', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const ctx = createApiContext({ PUBLIC_BASE_URL: 'https://flowchart.example' }, { store: new MemoryFlowStore() })
    ;({ server, base } = await startServer(ctx))
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('the api/ entry points export the shared handlers', () => {
    expect(mcpHandler).toBe(handleMcp)
    expect(flowsHandler).toBe(handleFlowsCollection)
    expect(flowHandler).toBe(handleFlowItem)
  })

  it('speaks MCP over Streamable HTTP with the official client', async () => {
    const client = new Client({ name: 'http-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)))
    expect(client.getServerVersion()?.name).toBe('flowchart-ai')

    const { tools } = await client.listTools()
    expect(tools).toHaveLength(5)

    const created = await client.callTool({ name: 'create_flowchart', arguments: SAMPLE })
    expect(created.isError).toBeFalsy()
    const data = created.structuredContent as { id: string; editToken: string; editUrl: string }
    expect(data.editUrl).toMatch(/^https:\/\/flowchart\.example\/f\/[0-9A-Za-z]{10}#edit=/)

    const updated = await client.callTool({
      name: 'update_flowchart',
      arguments: {
        id: data.id,
        editToken: data.editToken,
        expectedVersion: 1,
        operations: [{ op: 'add_edge', edge: { source: 'known', target: 'noop', label: 'No' } }],
      },
    })
    expect(updated.isError).toBeFalsy()

    const read = await client.callTool({ name: 'get_flowchart', arguments: { id: data.id } })
    expect((read.structuredContent as { version: number }).version).toBe(2)

    // The same chart is visible through the REST API the browser uses.
    const rest = await fetch(`${base}/api/flows/${data.id}`).then((r) => r.json())
    expect(rest).toMatchObject({ id: data.id, version: 2, updatedVia: 'mcp' })
    await client.close()
  })

  it('is stateless: GET and DELETE on /api/mcp return 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${base}/api/mcp`, { method, headers: { Accept: 'text/event-stream' } })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST, OPTIONS')
      expect((await res.json()).jsonrpc).toBe('2.0')
    }
  })

  it('answers CORS preflights for browser-based MCP clients', async () => {
    const res = await fetch(`${base}/api/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://inspector.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, mcp-protocol-version',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, mcp-protocol-version')
    expect(res.headers.get('access-control-expose-headers')).toContain('Mcp-Session-Id')
  })

  it('returns a JSON-RPC parse error for malformed MCP bodies', async () => {
    const res = await fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32700)
  })

  it('creates, reads, polls, replaces and patches charts over REST', async () => {
    const createRes = await fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(createRes.headers.get('location')).toBe(`/api/flows/${created.id}`)
    expect(created.url).toBe(`https://flowchart.example/f/${created.id}`)
    expect(created.editUrl).toBe(`${created.url}#edit=${created.editToken}`)
    expect(created.chart.updatedVia).toBe('api')

    const url = `${base}/api/flows/${created.id}`
    const auth = { Authorization: `Bearer ${created.editToken}`, 'Content-Type': 'application/json' }

    expect(await fetch(`${url}?since=1`).then((r) => r.json())).toEqual({ id: created.id, version: 1, changed: false })

    const put = await fetch(url, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ nodes: created.chart.nodes, edges: created.chart.edges, title: 'Renamed', baseVersion: 1 }),
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({ version: 2, title: 'Renamed' })

    const polled = await fetch(`${url}?since=1`).then((r) => r.json())
    expect(polled).toMatchObject({ changed: true, version: 2, title: 'Renamed' })
    expect(polled.nodes).toHaveLength(4)

    const patch = await fetch(url, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ baseVersion: 2, operations: [{ op: 'remove_node', id: 'noop' }] }),
    })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toMatchObject({ version: 3, changes: ['removed node "noop"'] })

    const get = await fetch(url)
    expect(get.headers.get('cache-control')).toBe('no-store')
    expect(await get.json()).toMatchObject({ version: 3, url: `https://flowchart.example/f/${created.id}` })
  })

  it('enforces edit tokens and optimistic concurrency', async () => {
    const created = await fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    }).then((r) => r.json())
    const url = `${base}/api/flows/${created.id}`
    const body = JSON.stringify({ nodes: created.chart.nodes, edges: created.chart.edges, baseVersion: 1 })

    const missing = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')

    const wrong = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' }, body })
    expect(wrong.status).toBe(403)

    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${created.editToken}` }
    expect((await fetch(url, { method: 'PUT', headers: auth, body })).status).toBe(200)
    const stale = await fetch(url, { method: 'PUT', headers: auth, body })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'conflict', currentVersion: 2 })
  })

  it('validates bodies and ids', async () => {
    const invalid = await fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [{ id: 'a', type: 'circle', label: 'x' }] }),
    })
    expect(invalid.status).toBe(400)
    const invalidBody = await invalid.json()
    expect(invalidBody.issues[0]).toMatchObject({ path: 'nodes[0].type' })

    const semantic = await fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [{ id: 'a', type: 'step', label: 'x' }], edges: [{ source: 'a', target: 'b' }] }),
    })
    expect(semantic.status).toBe(400)
    expect((await semantic.json()).issues[0].path).toBe('edges[0].target')

    const badJson = await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    expect(badJson.status).toBe(400)

    expect((await fetch(`${base}/api/flows/Nope000000`)).status).toBe(404)
    expect((await fetch(`${base}/api/flows/..%2F..%2Fetc`)).status).toBe(404)
    expect((await fetch(`${base}/api/flows`, { method: 'GET' })).status).toBe(405)
    expect((await fetch(`${base}/api/flows/Nope000000`, { method: 'DELETE' })).status).toBe(405)
  })

  it('rejects oversized bodies', async () => {
    const huge = JSON.stringify({ nodes: [{ id: 'a', type: 'step', label: 'x'.repeat(LIMITS.maxBodyBytes) }] })
    const res = await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: huge })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('too_large')
  })
})

describe('HTTP: rate limits, base URLs and missing storage', () => {
  const post = (base: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(SAMPLE),
    })
  const mcpPost = (base: string, body: unknown) =>
    fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    })
  const stop = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))

  it('rate-limits per IP with Retry-After and a clear message', async () => {
    const limiter = new MemoryRateLimiter({
      perIp: {
        create: { limit: 1, windowSeconds: 60 },
        mcp: { limit: 2, windowSeconds: 60 },
      },
    })
    const { server, base } = await startServer(createApiContext({}, { store: new MemoryFlowStore(), limiter }))
    expect((await post(base)).status).toBe(201)
    const limited = await post(base)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    const body = await limited.json()
    expect(body).toMatchObject({ code: 'rate_limited', scope: 'ip' })
    expect(body.error).toMatch(/^Rate limit reached for new charts from your network: 1 per minute/)

    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
    await mcpPost(base, ping)
    await mcpPost(base, ping)
    const blocked = await mcpPost(base, ping)
    expect(blocked.status).toBe(429)
    expect((await blocked.json()).error.message).toContain('Rate limit reached for MCP requests')
    await stop(server)
  })

  it('counts every message of a JSON-RPC batch', async () => {
    const limiter = new MemoryRateLimiter({ perIp: { mcp: { limit: 5, windowSeconds: 60 } } })
    const { server, base } = await startServer(createApiContext({}, { store: new MemoryFlowStore(), limiter }))
    const batch = (size: number) => Array.from({ length: size }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }))
    expect((await mcpPost(base, batch(6))).status).toBe(429)
    expect((await mcpPost(base, batch(4))).status).toBe(200) // the refused batch used only one message
    await stop(server)
  })

  it('returns the shared daily budget as a 429 that says so', async () => {
    const limiter = new MemoryRateLimiter({ global: { creates: { limit: 1, windowSeconds: 86_400 } } })
    const { server, base } = await startServer(createApiContext({}, { store: new MemoryFlowStore(), limiter }))
    expect((await post(base)).status).toBe(201)
    const res = await post(base)
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.scope).toBe('global')
    expect(body.error).toContain('budget for new charts: 1 per day across all users')
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
    await stop(server)
  })

  it('checks polls and reads against in-memory buckets and writes against shared ones', async () => {
    const limiter = new MemoryRateLimiter()
    const spy = vi.spyOn(limiter, 'check')
    const { server, base } = await startServer(createApiContext({}, { store: new MemoryFlowStore(), limiter }))
    const created = await (await post(base)).json()
    await fetch(`${base}/api/flows/${created.id}?since=1`)
    await fetch(`${base}/api/flows/${created.id}`)
    await fetch(`${base}/api/flows/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.editToken}` },
      body: JSON.stringify({ operations: [{ op: 'remove_node', id: 'noop' }] }),
    })
    // Creating also charges the new chart's size to the storage budget; removing a node shrinks it.
    expect(spy.mock.calls.map(([bucket]) => bucket)).toEqual(['create', 'storage', 'poll', 'read', 'write'])
    await stop(server)
  })

  it("ignores X-Forwarded-For unless a trusted proxy (Vercel) set it, so it can't dodge limits", async () => {
    const ctx = createApiContext({}, { store: new MemoryFlowStore(), limiter: new MemoryRateLimiter({ perIp: { create: { limit: 1, windowSeconds: 60 } } }) })
    const { server, base } = await startServer(ctx)
    expect((await post(base, { 'X-Forwarded-For': '198.51.100.1' })).status).toBe(201)
    expect((await post(base, { 'X-Forwarded-For': '198.51.100.2', 'X-Real-IP': '198.51.100.3' })).status).toBe(429)
    await stop(server)

    const req = (headers: Record<string, string>) =>
      ({ headers, socket: { remoteAddress: '10.0.0.1' } }) as unknown as import('node:http').IncomingMessage
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.1' }), {})).toBe('10.0.0.1')
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.1, 10.0.0.2' }), { VERCEL: '1' })).toBe('198.51.100.1')
    expect(clientIp(req({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' }), { VERCEL: '1' })).toBe(
      '203.0.113.9',
    )
    expect(clientIp(req({ 'x-real-ip': '203.0.113.8' }), { FLOW_TRUST_PROXY: '1' })).toBe('203.0.113.8')
  })

  it('answers 503 with Retry-After when Redis is unavailable (for example, a used-up free quota)', async () => {
    const down = new MemoryFlowStore()
    const outage = new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, 'ERR max requests limit exceeded')
    down.get = async () => {
      throw outage
    }
    down.getVersion = down.get as unknown as MemoryFlowStore['getVersion']
    const { server, base } = await startServer(createApiContext({}, { store: down }))
    const res = await fetch(`${base}/api/flows/Ab3dE5fG7h?since=1`)
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(await res.json()).toMatchObject({ code: 'storage_unavailable', error: STORAGE_UNAVAILABLE_MESSAGE })

    const client = new Client({ name: 'http-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)))
    const tool = await client.callTool({ name: 'get_flowchart', arguments: { id: 'Ab3dE5fG7h' } })
    expect(tool.isError).toBe(true)
    expect(JSON.stringify(tool.content)).toContain('temporarily unavailable')
    await client.close()
    await stop(server)
  })

  it('treats a malformed id escape as not found instead of crashing', async () => {
    const { server, base } = await startServer(createApiContext({}, { store: new MemoryFlowStore() }))
    const res = await fetch(`${base}/api/flows/%E0%A4%A`)
    expect(res.status).toBe(404)
    await stop(server)
  })

  it('builds links from forwarded headers when PUBLIC_BASE_URL is not set', async () => {
    const { server, base } = await startServer(createApiContext({}, { store: new MemoryFlowStore() }))
    const res = await fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'preview.example.app', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify(SAMPLE),
    })
    expect((await res.json()).url).toMatch(/^https:\/\/preview\.example\.app\/f\//)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('fails loudly (503) in production without Redis', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { server, base } = await startServer(createApiContext({ VERCEL_ENV: 'production' }))
    const res = await fetch(`${base}/api/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('KV_REST_API_URL')

    const client = new Client({ name: 'http-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)))
    const tool = await client.callTool({ name: 'create_flowchart', arguments: SAMPLE })
    expect(tool.isError).toBe(true)
    expect(JSON.stringify(tool.content)).toContain('no chart storage configured')
    await client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    error.mockRestore()
  })
})

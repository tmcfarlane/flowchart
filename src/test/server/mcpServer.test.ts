// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowService } from '../../shared/server/flowService'
import { createFlowchartMcpServer, type McpServerContext } from '../../shared/server/mcpServer'
import {
  MemoryFlowStore,
  STORAGE_UNAVAILABLE_MESSAGE,
  StorageNotConfiguredError,
  StorageUnavailableError,
} from '../../shared/server/store'
import type { RateLimitResult } from '../../shared/server/rateLimit'
import { layoutWorkUnits } from '../../shared/layout'

const BASE = 'https://flowchart.test'

async function connect(overrides: Partial<McpServerContext> = {}) {
  const service = new FlowService({ store: new MemoryFlowStore() })
  const server = createFlowchartMcpServer({ getService: () => service, baseUrl: BASE, ...overrides })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'vitest', version: '1.0.0' })
  await client.connect(clientTransport)
  return { client, server, service }
}

type Connected = Awaited<ReturnType<typeof connect>>

const text = (result: unknown) => ((result as CallToolResult).content[0] as { text: string }).text
const structured = (result: unknown) => (result as CallToolResult).structuredContent as Record<string, any>

const SIGNUP = {
  title: 'SaaS signup',
  nodes: [
    { id: 'visit', type: 'step', label: 'Visitor clicks sign up' },
    { id: 'auth', type: 'image', label: 'Entra ID', icon: 'entra id' },
    { id: 'paid', type: 'decision', label: 'Payment succeeded?' },
    { id: 'retry', type: 'step', label: 'Try another card' },
    { id: 'done', type: 'step', label: 'Onboarding' },
  ],
  edges: [
    { source: 'visit', target: 'auth' },
    { source: 'auth', target: 'paid' },
    { source: 'paid', target: 'retry', label: 'No' },
    { source: 'retry', target: 'paid', label: 'Retry' },
    { source: 'paid', target: 'done', label: 'Yes' },
  ],
}

describe('MCP server: discovery', () => {
  let ctx: Connected
  beforeEach(async () => {
    ctx = await connect()
  })
  afterEach(async () => {
    await ctx.client.close()
  })

  it('identifies itself and gives usage instructions', () => {
    expect(ctx.client.getServerVersion()).toMatchObject({ name: 'flowchart-ai', title: 'Flowchart AI' })
    expect(ctx.client.getInstructions()).toContain('editUrl')
  })

  it('lists the five tools with annotations and rich input schemas', async () => {
    const { tools } = await ctx.client.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      'create_flowchart',
      'get_flowchart',
      'update_flowchart',
      'list_node_types',
      'search_azure_icons',
    ])
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.get_flowchart.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true })
    expect(byName.list_node_types.annotations?.readOnlyHint).toBe(true)
    expect(byName.search_azure_icons.annotations?.readOnlyHint).toBe(true)
    expect(byName.create_flowchart.annotations?.readOnlyHint).toBe(false)
    expect(byName.update_flowchart.annotations?.destructiveHint).toBe(true)

    const nodeSchema = (byName.create_flowchart.inputSchema.properties as any).nodes.items
    expect(nodeSchema.properties.type.enum).toContain('decision')
    expect(nodeSchema.additionalProperties).toBe(false)
    expect(byName.create_flowchart.inputSchema.required).toEqual(['title', 'nodes'])
    expect(byName.create_flowchart.outputSchema?.properties).toHaveProperty('editUrl')
    expect(byName.create_flowchart.description).toContain('editUrl')
  })

  it('serves the authoring guide and JSON Schema resources', async () => {
    const { resources } = await ctx.client.listResources()
    expect(resources.map((r) => r.uri)).toEqual(['flowchart://guide', 'flowchart://schema'])

    const guide = await ctx.client.readResource({ uri: 'flowchart://guide' })
    const guideText = (guide.contents[0] as { text: string }).text
    expect(guide.contents[0].mimeType).toBe('text/markdown')
    expect(guideText).toContain('## Workflow')
    expect(guideText).toContain('search_azure_icons')
    expect(guideText).not.toMatch(/ONLY output valid JSON/i)

    const schema = await ctx.client.readResource({ uri: 'flowchart://schema' })
    const doc = JSON.parse((schema.contents[0] as { text: string }).text)
    expect(doc.node.properties.type.enum).toHaveLength(11)
    expect(doc.operation).toBeDefined()
    expect(doc.limits.maxNodes).toBe(500)
  })

  it('offers the design_flowchart prompt', async () => {
    const { prompts } = await ctx.client.listPrompts()
    expect(prompts[0]).toMatchObject({ name: 'design_flowchart' })
    expect(prompts[0].arguments?.map((a) => a.name)).toEqual(['topic', 'kind'])

    const prompt = await ctx.client.getPrompt({ name: 'design_flowchart', arguments: { topic: 'password reset', kind: 'flowchart' } })
    const message = (prompt.messages[0].content as { text: string }).text
    expect(message).toContain('password reset')
    expect(message).toContain('create_flowchart')
    expect(message).toContain('editUrl')

    const arch = await ctx.client.getPrompt({ name: 'design_flowchart', arguments: { topic: 'checkout service', kind: 'architecture' } })
    expect((arch.messages[0].content as { text: string }).text).toContain('direction "LR"')
  })

  it('lists node types and searches icons', async () => {
    const types = await ctx.client.callTool({ name: 'list_node_types', arguments: {} })
    expect(structured(types).nodeTypes).toHaveLength(11)
    expect(text(types)).toContain('decision')

    const icons = await ctx.client.callTool({ name: 'search_azure_icons', arguments: { query: 'cosmos', limit: 3 } })
    expect(structured(icons).results[0]).toMatchObject({ id: 'azure-cosmos-db', name: 'Azure Cosmos DB' })
    expect(text(icons)).toContain('azure-cosmos-db: Azure Cosmos DB')

    const none = await ctx.client.callTool({ name: 'search_azure_icons', arguments: { query: 'zzqqzz' } })
    expect(none.isError).toBeFalsy()
    expect(text(none)).toContain('No Azure icons match')
  })
})

describe('MCP server: chart lifecycle', () => {
  let ctx: Connected
  beforeEach(async () => {
    ctx = await connect()
  })
  afterEach(async () => {
    await ctx.client.close()
  })

  async function createChart() {
    const result = await ctx.client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    expect(result.isError).toBeFalsy()
    return structured(result)
  }

  it('creates a chart and returns links, token, and next steps', async () => {
    const result = await ctx.client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    const data = structured(result)
    expect(data.id).toMatch(/^[0-9A-Za-z]{10}$/)
    expect(data.url).toBe(`${BASE}/f/${data.id}`)
    expect(data.editUrl).toBe(`${BASE}/f/${data.id}#edit=${data.editToken}`)
    expect(data).toMatchObject({ version: 1, nodeCount: 5, edgeCount: 5, layout: 'full' })
    expect(text(result)).toContain(data.editUrl)
    expect(text(result)).toContain('Give the user this link')
    expect(text(result)).toContain('call get_flowchart')
  })

  it('rejects invalid nodes with precise messages', async () => {
    const shape = await ctx.client.callTool({
      name: 'create_flowchart',
      arguments: { title: 'Bad', nodes: [{ id: 'a', type: 'proces', label: 'x' }] },
    })
    expect(shape.isError).toBe(true)
    expect(text(shape)).toContain('"proces" is not a valid node type')

    const semantic = await ctx.client.callTool({
      name: 'create_flowchart',
      arguments: {
        title: 'Bad',
        nodes: [
          { id: 'a', type: 'step', label: 'x', icon: 'cosmos' },
          { id: 'b', type: 'image', label: 'y' },
        ],
        edges: [{ source: 'a', target: 'c' }],
      },
    })
    expect(semantic.isError).toBe(true)
    expect(text(semantic)).toContain('create_flowchart failed: The chart has 3 problems')
    expect(text(semantic)).toContain('- nodes[0].icon:')
    expect(text(semantic)).toContain('- nodes[1]: image nodes need an "icon"')
    expect(text(semantic)).toContain('- edges[0].target: no node with id "c"')
  })

  it('gets a chart by id or by URL, with its version', async () => {
    const created = await createChart()
    for (const id of [created.id, created.url, created.editUrl]) {
      const result = await ctx.client.callTool({ name: 'get_flowchart', arguments: { id } })
      expect(result.isError).toBeFalsy()
      expect(structured(result)).toMatchObject({ id: created.id, version: 1, title: 'SaaS signup' })
      expect(structured(result).nodes).toHaveLength(5)
      expect(text(result)).toContain('expectedVersion: 1')
    }
    const missing = await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: 'Zz9Zz9Zz9Z' } })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('no flowchart with id "Zz9Zz9Zz9Z"')
  })

  it('updates with operations and reports the change', async () => {
    const created = await createChart()
    const result = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: {
        id: created.id,
        editToken: created.editToken,
        expectedVersion: 1,
        operations: [
          { op: 'add_node', node: { id: 'email', type: 'step', label: 'Send welcome email' } },
          { op: 'add_edge', edge: { source: 'done', target: 'email' } },
          { op: 'update_edge', id: 'epaid-retry', changes: { label: 'Declined' } },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    expect(structured(result)).toMatchObject({ version: 2, nodeCount: 6, edgeCount: 6, layout: 'incremental' })
    expect(structured(result).changes).toContain('added node "email"')
    expect(text(result)).toContain('expectedVersion: 2')

    const after = structured(await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: created.id } }))
    expect(after.edges.find((e: any) => e.id === 'epaid-retry').label).toBe('Declined')
  })

  it('accepts the edit link in place of the token', async () => {
    const created = await createChart()
    const result = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: { id: created.url, editToken: created.editUrl, title: 'Renamed' },
    })
    expect(result.isError).toBeFalsy()
    expect(structured(result).title).toBe('Renamed')
  })

  it('rejects a wrong token, unknown ids and bad operations', async () => {
    const created = await createChart()
    const ops = [{ op: 'remove_node', id: 'retry' }]

    const wrongToken = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: { id: created.id, editToken: 'not-the-token', operations: ops },
    })
    expect(wrongToken.isError).toBe(true)
    expect(text(wrongToken)).toContain('edit token is missing or does not match')

    const unknownId = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: { id: 'Nope000000', editToken: created.editToken, operations: ops },
    })
    expect(text(unknownId)).toContain('No flowchart with id "Nope000000"')

    const badOp = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: { id: created.id, editToken: created.editToken, operations: [{ op: 'update_node', id: 'dnoe', changes: { label: 'x' } }] },
    })
    expect(badOp.isError).toBe(true)
    expect(text(badOp)).toContain('operations[0] (update_node): no node with id "dnoe". Did you mean "done"?')
  })

  it('refuses to overwrite newer browser edits and explains how to recover', async () => {
    const created = await createChart()
    // The user edits in the browser (REST API): version 2.
    const browser = await ctx.service.applyOperations(created.id, created.editToken, {
      operations: [{ op: 'update_node', id: 'visit', changes: { label: 'Edited in browser' } }],
      source: 'api',
    })
    expect(browser.ok).toBe(true)

    const stale = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: {
        id: created.id,
        editToken: created.editToken,
        expectedVersion: 1,
        operations: [{ op: 'update_node', id: 'done', changes: { label: 'Agent edit' } }],
      },
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('Version conflict: the chart is at version 2, not 1')
    expect(text(stale)).toContain('Call get_flowchart to read version 2')

    const latest = await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: created.id } })
    expect(text(latest)).toContain('latest change was made in the browser')
    expect(structured(latest).nodes.find((n: any) => n.id === 'visit').label).toBe('Edited in browser')
  })

  it('guards replace with expectedVersion and rejects ambiguous calls', async () => {
    const created = await createChart()
    const noVersion = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: { id: created.id, editToken: created.editToken, replace: { nodes: SIGNUP.nodes } },
    })
    expect(text(noVersion)).toContain('requires expectedVersion')

    const both = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: {
        id: created.id,
        editToken: created.editToken,
        expectedVersion: 1,
        replace: { nodes: SIGNUP.nodes },
        operations: [{ op: 'remove_node', id: 'retry' }],
      },
    })
    expect(text(both)).toContain('either operations or replace')

    const nothing = await ctx.client.callTool({ name: 'update_flowchart', arguments: { id: created.id, editToken: created.editToken } })
    expect(text(nothing)).toContain('nothing to change')

    const replaced = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: {
        id: created.id,
        editToken: created.editToken,
        expectedVersion: 1,
        replace: { nodes: [{ id: 'only', type: 'step', label: 'Only node' }], edges: [] },
      },
    })
    expect(structured(replaced)).toMatchObject({ version: 2, nodeCount: 1, edgeCount: 0 })
  })

  it('re-lays out the whole chart on request', async () => {
    const created = await createChart()
    const result = await ctx.client.callTool({
      name: 'update_flowchart',
      arguments: { id: created.id, editToken: created.editToken, relayout: true, direction: 'LR' },
    })
    expect(structured(result).layout).toBe('full')
    const chart = structured(await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: created.id } }))
    const x = (id: string) => chart.nodes.find((n: any) => n.id === id).position.x
    expect(x('visit')).toBeLessThan(x('auth'))
  })
})

describe('MCP server: operational failures', () => {
  it('explains missing storage configuration instead of crashing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = await connect({
      getService: () => {
        throw new StorageNotConfiguredError('Chart storage is not configured. Connect Upstash Redis.')
      },
    })
    const result = await client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no chart storage configured')
    // Tools that don't need storage keep working.
    const icons = await client.callTool({ name: 'search_azure_icons', arguments: { query: 'aks' } })
    expect(icons.isError).toBeFalsy()
    await client.close()
    error.mockRestore()
  })

  it('reports rate limiting as a tool error', async () => {
    const blocked: RateLimitResult = {
      allowed: false,
      scope: 'ip',
      limit: 300,
      remaining: 0,
      windowSeconds: 3600,
      retryAfterSeconds: 42,
    }
    const { client } = await connect({ rateLimit: async () => blocked })
    const result = await client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'create_flowchart failed: Rate limit reached for new charts from your network: 300 per hour (a large automatic layout counts as several). Try again in 42 seconds.',
    )
    await client.close()
  })

  it('charges agent calls to the MCP buckets, large layouts and storage growth included', async () => {
    const calls: Array<[string, number | undefined]> = []
    const allowed: RateLimitResult = { allowed: true, scope: 'ip', limit: 10, remaining: 9, windowSeconds: 60, retryAfterSeconds: 0 }
    const { client } = await connect({
      rateLimit: async (bucket, cost) => {
        calls.push([bucket, cost])
        return allowed
      },
    })
    const created = structured(await client.callTool({ name: 'create_flowchart', arguments: SIGNUP }))
    await client.callTool({ name: 'get_flowchart', arguments: { id: created.id } })
    await client.callTool({
      name: 'update_flowchart',
      arguments: {
        id: created.id,
        editToken: created.editToken,
        operations: [{ op: 'add_node', node: { id: 'x', type: 'note', label: 'A note that grows the chart. '.repeat(15) } }],
      },
    })
    expect(calls.map(([bucket]) => bucket)).toEqual(['mcpCreate', 'storage', 'read', 'mcpWrite', 'storage'])
    expect(calls[1][1]).toBeGreaterThan(500) // the new chart's size in bytes

    // A 200-node chart without positions needs a full layout: it costs extra work units up front.
    calls.length = 0
    const big = {
      title: 'Big',
      nodes: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, type: 'step', label: `Step ${i}` })),
      edges: Array.from({ length: 199 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })),
    }
    await client.callTool({ name: 'create_flowchart', arguments: big })
    expect(calls[1]).toEqual(['mcpCreate', layoutWorkUnits({ layout: 'full', missing: 200 }, 200, 199) - 1])
    await client.close()
  })

  it('explains a refused storage budget instead of storing the chart', async () => {
    const { client } = await connect({
      rateLimit: async (bucket) =>
        bucket === 'storage'
          ? { allowed: false, scope: 'global', limit: 50 * 1024 * 1024, remaining: 0, windowSeconds: 86_400, retryAfterSeconds: 7200 }
          : { allowed: true, scope: 'ip', limit: 10, remaining: 9, windowSeconds: 60, retryAfterSeconds: 0 },
    })
    const result = await client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(text(result)).toContain('budget for new chart data: 50 MB per day across all users')
    expect(text(result)).toContain('Try again in 2 hours')
    await client.close()
  })

  it('reports an unreachable Redis as a temporary problem', async () => {
    const service = new FlowService({ store: new MemoryFlowStore() })
    service.get = async () => {
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, 'ERR max requests limit exceeded')
    }
    const { client } = await connect({ getService: () => service })
    const result = await client.callTool({ name: 'get_flowchart', arguments: { id: 'Ab3dE5fG7h' } })
    expect(text(result)).toBe(`get_flowchart failed: ${STORAGE_UNAVAILABLE_MESSAGE}`)
    await client.close()
  })

  it('accepts a malformed edit link without crashing', async () => {
    const { client } = await connect()
    const created = structured(await client.callTool({ name: 'create_flowchart', arguments: SIGNUP }))
    const result = await client.callTool({
      name: 'update_flowchart',
      arguments: { id: created.id, editToken: `${created.url}#edit=%E0%A4%A`, title: 'Renamed' },
    })
    expect(text(result)).toContain('edit token is missing or does not match')
    await client.close()
  })
})

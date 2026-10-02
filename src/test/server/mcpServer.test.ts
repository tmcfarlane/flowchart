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
  sharing: 'link-shared',
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
    expect(ctx.client.getInstructions()).toContain('Private')
  })

  it('lists the chart and local helper tools with accurate annotations and rich input schemas', async () => {
    const { tools } = await ctx.client.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      'create_flowchart',
      'get_flowchart',
      'list_node_types',
      'search_azure_icons',
      'search_icons',
      'list_diagram_templates',
      'get_diagram_template',
      'audit_diagram',
    ])
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(byName.get_flowchart.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true })
    expect(byName.list_node_types.annotations?.readOnlyHint).toBe(true)
    expect(byName.search_azure_icons.annotations?.readOnlyHint).toBe(true)
    expect(byName.create_flowchart.annotations?.readOnlyHint).toBe(false)
    for (const name of ['search_icons', 'list_diagram_templates', 'get_diagram_template', 'audit_diagram']) {
      expect(byName[name].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true })
    }

    const nodeSchema = (byName.create_flowchart.inputSchema.properties as any).nodes.items
    expect(nodeSchema.properties.type.enum).toContain('decision')
    expect(nodeSchema.additionalProperties).toBe(false)
    expect(byName.create_flowchart.inputSchema.required).toEqual(['sharing', 'title', 'nodes'])
    expect(byName.create_flowchart.outputSchema?.properties).not.toHaveProperty('editUrl')
    expect(byName.create_flowchart.description).toContain('private')
  })

  it('serves the authoring guide and JSON Schema resources', async () => {
    const { resources } = await ctx.client.listResources()
    expect(resources.map((r) => r.uri)).toEqual(['ui://flowchart-ai/chart-card-v3.html', 'flowchart://guide', 'flowchart://schema', 'flowchart://templates'])

    const card = await ctx.client.readResource({ uri: 'ui://flowchart-ai/chart-card-v3.html' })
    expect(card.contents[0].mimeType).toBe('text/html;profile=mcp-app')
    expect(card.contents[0]._meta?.ui).toMatchObject({ csp: { connectDomains: [BASE], resourceDomains: [] } })
    expect((card.contents[0]._meta?.ui as { csp: unknown }).csp).not.toHaveProperty('frameDomains')
    expect((card.contents[0] as { text: string }).text).toContain('id="diagram"')

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

    const catalog = await ctx.client.readResource({ uri: 'flowchart://templates' })
    expect(JSON.parse((catalog.contents[0] as { text: string }).text).templates).toHaveLength(20)
  })

  it('offers the design_flowchart prompt', async () => {
    const { prompts } = await ctx.client.listPrompts()
    expect(prompts[0]).toMatchObject({ name: 'design_flowchart' })
    expect(prompts[0].arguments?.map((a) => a.name)).toEqual(['topic', 'kind'])

    const prompt = await ctx.client.getPrompt({ name: 'design_flowchart', arguments: { topic: 'password reset', kind: 'flowchart' } })
    const message = (prompt.messages[0].content as { text: string }).text
    expect(message).toContain('password reset')
    expect(message).toContain('create_flowchart')
    expect(message).toContain('private')

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

  it('reads, audits and saves an imaginative template through the actual MCP contract', async () => {
    const catalog = structured(await ctx.client.callTool({ name: 'list_diagram_templates', arguments: { category: 'creative', query: 'dream' } }))
    expect(catalog.templates[0].id).toBe('dream-observatory')
    const draft = structured(await ctx.client.callTool({ name: 'get_diagram_template', arguments: { id: catalog.templates[0].id } })).template
    const audit = structured(await ctx.client.callTool({ name: 'audit_diagram', arguments: { nodes: draft.nodes, edges: draft.edges } }))
    expect(audit.valid).toBe(true)
    expect(audit.findings).toEqual([])
    const icons = structured(await ctx.client.callTool({ name: 'search_icons', arguments: { query: 'portal', provider: 'flowchart' } }))
    expect(icons.results[0]).toMatchObject({ id: 'icon-portal', provider: 'flowchart' })
    const created = await ctx.client.callTool({ name: 'create_flowchart', arguments: { sharing: 'link-shared', title: draft.title, nodes: audit.normalized.nodes, edges: audit.normalized.edges, direction: draft.direction } })
    expect(created.isError).toBeFalsy()
    expect(structured(created).nodeCount).toBe(draft.nodes.length)
    const visible = JSON.stringify({ content: created.content, structuredContent: created.structuredContent })
    expect(visible).not.toContain('#edit=')
    expect(visible).not.toContain('editToken')
  })

  it('returns actionable validation reports and unknown-template errors without creating charts', async () => {
    const bad = await ctx.client.callTool({ name: 'audit_diagram', arguments: { nodes: [{ id: 'a', type: 'step', label: 'A' }], edges: [{ source: 'a', target: 'missing' }] } })
    expect(bad.isError).toBeFalsy()
    expect(structured(bad)).toMatchObject({ valid: false, normalized: null })
    expect(structured(bad).findings[0]).toMatchObject({ severity: 'error', path: 'edges[0].target' })
    expect((await ctx.client.callTool({ name: 'get_diagram_template', arguments: { id: '__proto__' } })).isError).toBe(true)
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

  it('keeps edit access exclusively in private tool-result metadata', async () => {
    const result = await ctx.client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    const data = structured(result)
    const privateData = result._meta?.['flowchart/private'] as { id: string; editUrl: string; editToken: string }
    expect(data.id).toMatch(/^[0-9A-Za-z]{10}$/)
    expect(data.url).toBe(`${BASE}/f/${data.id}`)
    expect(privateData.editUrl).toBe(`${data.url}#edit=${privateData.editToken}`)
    const visible = JSON.stringify({ content: result.content, structuredContent: result.structuredContent })
    expect(visible).not.toContain(privateData.editToken)
    expect(visible).not.toContain('#edit=')
    expect(data).not.toHaveProperty('nodes')
    expect(data).not.toHaveProperty('edges')
    const preview = result._meta?.['flowchart/chart'] as { title: string; nodes: unknown[]; edges: unknown[] }
    expect(preview.title).toBe(SIGNUP.title)
    expect(preview.nodes).toHaveLength(SIGNUP.nodes.length)
    expect(preview.edges).toHaveLength(SIGNUP.edges.length)
    expect(JSON.stringify(preview)).not.toContain(privateData.editToken)
    expect(JSON.stringify(preview)).not.toMatch(/imageUrl|createdAt|updatedAt|editUrl|editToken/)
    expect(data).toMatchObject({ sharing: 'link-shared', version: 1, nodeCount: 5, edgeCount: 5, layout: 'full' })
    const { tools } = await ctx.client.listTools()
    expect(JSON.stringify(tools)).not.toContain('editToken')
    for (const tool of tools) expect(tool._meta?.securitySchemes).toEqual([{ type: 'noauth' }])
  })

  it('requires deliberate link-sharing mode before persisting', async () => {
    const { sharing: _sharing, ...draft } = SIGNUP
    const result = await ctx.client.callTool({ name: 'create_flowchart', arguments: draft })
    expect(result.isError).toBe(true)
    expect(result._meta).toBeUndefined()
    expect((await ctx.client.callTool({ name: 'create_flowchart', arguments: { ...draft, sharing: 'private' } })).isError).toBe(true)
  })

  it('rejects invalid nodes with precise messages', async () => {
    const shape = await ctx.client.callTool({
      name: 'create_flowchart',
      arguments: { sharing: 'link-shared', title: 'Bad', nodes: [{ id: 'a', type: 'proces', label: 'x' }] },
    })
    expect(shape.isError).toBe(true)
    expect(text(shape)).toContain('"proces" is not a valid node type')

    const semantic = await ctx.client.callTool({
      name: 'create_flowchart',
      arguments: {
        sharing: 'link-shared',
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

  it('rejects blank IDs before create or audit while preserving valid spaced IDs and blank captions in saved and preview data', async () => {
    const invalidDrafts = [
      { nodes: [{ id: '   ', type: 'step', label: '' }], edges: [] },
      { nodes: [{ id: 'valid', type: 'step', label: '' }], edges: [{ id: '\u00a0\u2003', source: 'valid', target: 'valid' }] },
      { nodes: [{ id: 'valid', type: 'service', label: '', parentNode: '   ' }], edges: [] },
    ]
    for (const draft of invalidDrafts) for (const name of ['create_flowchart', 'audit_diagram']) {
      const invalid = await ctx.client.callTool({ name, arguments: name === 'create_flowchart' ? { ...draft, sharing: 'link-shared', title: 'Invalid identity' } : draft })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('must not be blank')
      expect(invalid._meta).toBeUndefined()
    }
    const draft = { sharing: 'link-shared', title: 'Valid exact identities', nodes: [
      { id: ' node ', type: 'step', label: '', position: { x: 0, y: 0 } },
      { id: ' next ', type: 'note', label: '   ', position: { x: 240, y: 0 } },
    ], edges: [{ id: ' edge ', source: ' node ', target: ' next ', label: '   ' }] }
    const result = await ctx.client.callTool({ name: 'create_flowchart', arguments: draft })
    expect(result.isError).toBeFalsy()
    const saved = structured(await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: structured(result).id } }))
    expect(saved.nodes.map(({ id, label }: { id: string; label: string }) => ({ id, label }))).toEqual([{ id: ' node ', label: '' }, { id: ' next ', label: '   ' }])
    expect(saved.edges[0]).toMatchObject({ id: ' edge ', source: ' node ', target: ' next ', label: '   ' })
    expect(result._meta?.['flowchart/chart']).toMatchObject({ nodes: [{ id: ' node ', label: '' }, { id: ' next ', label: '   ' }] })
  })

  it('reads the latest browser state and creates a revised copy without overwriting', async () => {
    const result = await ctx.client.callTool({ name: 'create_flowchart', arguments: SIGNUP })
    const created = structured(result)
    const privateData = result._meta?.['flowchart/private'] as { editToken: string }
    await ctx.service.applyOperations(created.id, privateData.editToken, {
      operations: [{ op: 'update_node', id: 'visit', changes: { label: 'Browser edit' } }], source: 'api', expectedVersion: 1,
    })
    const latest = structured(await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: created.id } }))
    expect(latest.version).toBe(2)
    expect(latest.nodes[0].label).toBe('Browser edit')
    const revised = structured(await ctx.client.callTool({ name: 'create_flowchart', arguments: {
      sharing: 'link-shared', title: 'Revised signup', nodes: latest.nodes,
      edges: latest.edges.filter((e: any) => e.target !== 'retry'),
    } }))
    expect(revised.id).not.toBe(created.id)
    expect(revised.version).toBe(1)
    expect((await ctx.service.get(created.id))?.version).toBe(2)
    expect((await ctx.service.get(created.id))?.edges).toHaveLength(5)
  })

  it('rejects edit URLs as read arguments and has no MCP mutation of existing charts', async () => {
    const created = await createChart()
    const read = await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: created.url } })
    expect(read.isError).toBe(true)
    const write = await ctx.client.callTool({ name: 'update_flowchart', arguments: { id: created.id } })
    expect(write.isError).toBe(true)
    const missing = await ctx.client.callTool({ name: 'get_flowchart', arguments: { id: 'Zz9Zz9Zz9Z' } })
    expect(missing.isError).toBe(true)
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
    for (const [name, args] of [
      ['list_diagram_templates', {}],
      ['get_diagram_template', { id: 'checkout-journey' }],
      ['search_icons', { query: 'payment' }],
      ['audit_diagram', { nodes: [{ id: 'a', type: 'step', label: 'A' }] }],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError, name).toBeFalsy()
    }
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
    expect(calls.map(([bucket]) => bucket)).toEqual(['mcpCreate', 'storage', 'read'])
    expect(calls[1][1]).toBeGreaterThan(500) // the new chart's size in bytes

    // A 200-node chart without positions needs a full layout: it costs extra work units up front.
    calls.length = 0
    const big = {
      sharing: 'link-shared',
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

})

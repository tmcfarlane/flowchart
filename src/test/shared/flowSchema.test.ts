// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CreateFlowBodySchema,
  EdgeInputSchema,
  MAX_DETAILED_ISSUES,
  MAX_REPORTED_ISSUES,
  NodeInputSchema,
  OperationSchema,
  edgeFromInput,
  formatIssues,
  formatPath,
  isAllowedImageUrl,
  issuesFromZod,
  nodeFromInput,
  parseAndValidateChart,
  validateChart,
  type EdgeInput,
  type NodeInput,
} from '../../shared/flowSchema'
import { LIMITS, canonicalEdgeStyle, estimateNodeSize, nextNumericNodeId } from '../../shared/flowTypes'
import { defaultIconResolver } from '../../shared/server/flowService'

const validate = (nodes: NodeInput[], edges: EdgeInput[] = []) =>
  validateChart(nodes.map(nodeFromInput), edges.map(edgeFromInput), { resolveIcon: defaultIconResolver })

const messages = (result: { issues: Array<{ path: string; message: string }> }) =>
  result.issues.map((i) => `${i.path}: ${i.message}`)

describe('zod input schemas', () => {
  it('accepts a minimal node and treats null optional fields as absent', () => {
    const parsed = NodeInputSchema.parse({ id: '1', type: 'step', label: 'Start', position: null, icon: null })
    expect(nodeFromInput(parsed)).toEqual({ id: '1', type: 'step', label: 'Start' })
  })

  it('rejects whitespace-only node, edge, parent and operation identities without changing valid IDs or labels', () => {
    for (const blank of ['   ', '\u00a0\u2003\ufeff']) {
      const inputs = [
        [NodeInputSchema, { id: blank, type: 'step', label: '' }],
        [NodeInputSchema, { id: 'a', type: 'service', label: '', parentNode: blank }],
        [EdgeInputSchema, { id: blank, source: 'a', target: 'b' }],
        [EdgeInputSchema, { source: blank, target: 'b' }],
        [EdgeInputSchema, { source: 'a', target: blank }],
        [OperationSchema, { op: 'update_node', id: blank, changes: { label: '' } }],
        [OperationSchema, { op: 'remove_node', id: blank }],
        [OperationSchema, { op: 'update_edge', id: blank, changes: { source: 'a' } }],
        [OperationSchema, { op: 'remove_edge', id: blank }],
        [OperationSchema, { op: 'update_node', id: 'a', changes: { parentNode: blank } }],
        [OperationSchema, { op: 'update_edge', id: 'edge', changes: { target: blank } }],
      ] as const
      for (const [schema, input] of inputs) {
        const parsed = schema.safeParse(input)
        expect(parsed.success).toBe(false)
        expect(issuesFromZod(parsed.error!)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('must not be blank') })]))
      }
    }
    expect(NodeInputSchema.parse({ id: ' node ', type: 'step', label: '   ' })).toMatchObject({ id: ' node ', label: '   ' })
    expect(EdgeInputSchema.parse({ id: ' edge ', source: ' node ', target: ' next ', label: '' })).toMatchObject({ id: ' edge ', source: ' node ', target: ' next ', label: '' })
    expect(OperationSchema.parse({ op: 'update_node', id: ' node ', changes: { label: '' } })).toMatchObject({ id: ' node ', changes: { label: '' } })
  })

  it('names the invalid node type and lists the valid ones', () => {
    const result = NodeInputSchema.safeParse({ id: '1', type: 'proces', label: 'x' })
    expect(result.success).toBe(false)
    const [issue] = issuesFromZod(result.error!)
    expect(issue.path).toBe('type')
    expect(issue.message).toContain('"proces" is not a valid node type')
    expect(issue.message).toContain('step, decision, note, image')
  })

  it('rejects unknown fields with a hint for common mistakes', () => {
    const result = NodeInputSchema.safeParse({ id: '1', type: 'step', label: 'x', parent: 'vpc', data: {} })
    expect(result.success).toBe(false)
    const message = issuesFromZod(result.error!)[0].message
    expect(message).toContain('Unknown fields "parent", "data"')
    expect(message).toContain('"parent" -> use parentNode')
  })

  it('never takes hints from inherited properties such as __proto__ or constructor', () => {
    const input = JSON.parse('{"id":"1","type":"step","label":"x","__proto__":{"polluted":true},"constructor":1,"toString":2}')
    const result = NodeInputSchema.safeParse(input)
    expect(result.success).toBe(false)
    const message = issuesFromZod(result.error!)[0].message
    expect(message).toContain('Unknown fields "__proto__", "constructor", "toString"')
    expect(message).not.toContain('Hint')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('reports missing required fields', () => {
    const result = NodeInputSchema.safeParse({ id: '1', label: 'x' })
    expect(issuesFromZod(result.error!)[0].message).toContain('node type is required')
  })

  it('validates edge enums and handles', () => {
    expect(EdgeInputSchema.safeParse({ source: 'a', target: 'b', style: 'step', sourceHandle: 'left' }).success).toBe(true)
    const bad = EdgeInputSchema.safeParse({ source: 'a', target: 'b', style: 'dashed' })
    expect(issuesFromZod(bad.error!)[0].message).toContain('"dashed" is not a valid edge style')
  })

  it('explains an unknown operation', () => {
    const result = OperationSchema.safeParse({ op: 'add_nodes', node: {} })
    expect(issuesFromZod(result.error!)[0].message).toContain('Each operation needs "op"')
  })

  it('enforces node, edge and title limits on request bodies', () => {
    const nodes = Array.from({ length: LIMITS.maxNodes + 1 }, (_, i) => ({ id: `n${i}`, type: 'step', label: 'x' }))
    const tooMany = CreateFlowBodySchema.safeParse({ nodes })
    expect(issuesFromZod(tooMany.error!)[0].message).toContain(`at most ${LIMITS.maxNodes} nodes`)

    const longTitle = CreateFlowBodySchema.safeParse({ title: 'x'.repeat(LIMITS.maxTitleLength + 1), nodes: [] })
    expect(issuesFromZod(longTitle.error!)[0].path).toBe('title')

    const longLabel = NodeInputSchema.safeParse({ id: 'a', type: 'step', label: 'x'.repeat(LIMITS.maxLabelLength + 1) })
    expect(issuesFromZod(longLabel.error!)[0].message).toContain(`at most ${LIMITS.maxLabelLength} characters`)
  })
})

describe('validateChart', () => {
  it('accepts a good chart and normalizes edges', () => {
    const result = validate(
      [
        { id: '1', type: 'step', label: 'Start' },
        { id: '2', type: 'decision', label: 'OK?' },
        { id: '3', type: 'image', label: 'Cosmos', icon: 'cosmos db' },
      ],
      [
        { source: '1', target: '2' },
        { source: '2', target: '3', label: 'Yes', commStyle: 'async', style: 'animated' },
        { source: '1', target: '2' },
      ],
    )
    expect(result.issues).toEqual([])
    expect(result.nodes[2].icon).toBe('azure-cosmos-db')
    expect(result.edges.map((e) => e.id)).toEqual(['e1-2', 'e2-3', 'e1-2-2'])
    expect(result.edges[0].style).toBe('animated')
    // With a comm style, "animated" is redundant and normalizes to "default".
    expect(result.edges[1].style).toBe('default')
  })

  it('reports duplicate ids and dangling edges with suggestions', () => {
    const result = validate(
      [
        { id: 'signup', type: 'step', label: 'a' },
        { id: 'signup', type: 'step', label: 'b' },
      ],
      [{ source: 'signup', target: 'sigup' }],
    )
    expect(messages(result)).toEqual([
      'nodes[1].id: duplicate node id "signup" (also used by nodes[0]). Node ids must be unique.',
      'edges[0].target: no node with id "sigup". Did you mean "signup"? Existing node ids: "signup".',
    ])
  })

  it('checks icon rules with actionable messages', () => {
    const result = validate([
      { id: 'a', type: 'step', label: 'x', icon: 'cosmos' },
      { id: 'b', type: 'image', label: 'y', icon: 'cosmoss' },
      { id: 'c', type: 'image', label: 'z' },
      { id: 'd', type: 'service', label: 'svc', icon: 'aks' },
    ])
    const text = messages(result)
    expect(text[0]).toContain('nodes[0].icon: "step" nodes don\'t show icons')
    expect(text[1]).toContain('unknown icon "cosmoss". Did you mean "azure-cosmos-db"')
    expect(text[2]).toContain('nodes[2]: image nodes need an "icon"')
    expect(result.nodes[3].icon).toBe('kubernetes-services')
  })

  it('only allows safe image URLs and lets icons win over imageUrl', () => {
    const result = validate([
      { id: 'a', type: 'image', label: 'x', imageUrl: 'javascript:alert(1)' },
      { id: 'b', type: 'image', label: 'y', imageUrl: 'https://api.iconify.design/mdi/cart.svg' },
      { id: 'c', type: 'image', label: 'z', icon: 'key vault', imageUrl: 'https://example.com/x.png' },
    ])
    expect(messages(result)).toEqual([
      'nodes[0].imageUrl: must be an https:// URL (or a data:image/ URL) without spaces or backslashes. Prefer "icon" with an id from search_icons or search_azure_icons.',
    ])
    expect(result.nodes[2]).toMatchObject({ icon: 'key-vaults' })
    expect(result.nodes[2].imageUrl).toBeUndefined()
  })

  it('refuses image URLs that browsers would resolve to another host', () => {
    const bad = [
      '/\\evil.example/pixel.png', // browsers treat "\" like "/": //evil.example
      '/\t/evil.example/pixel.png', // tabs are stripped: //evil.example
      '//evil.example/pixel.png',
      'https://user:secret@example.com/x.png',
      'https://exa mple.com/x.png',
      'http://example.com/x.png',
      'data:text/html,<script>alert(1)</script>',
      'https://',
    ]
    const good = ['/assets/icons/x.svg', 'https://example.com/a%20b.png?x=1', 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>']
    for (const url of bad) expect([url, isAllowedImageUrl(url)]).toEqual([url, false])
    for (const url of good) expect([url, isAllowedImageUrl(url)]).toEqual([url, true])
  })

  it('stays fast and bounded when every reference in a big chart is wrong', () => {
    const id = (prefix: string, i: number) => `${prefix}${i}_`.padEnd(50, 'x')
    const nodes = Array.from({ length: LIMITS.maxNodes }, (_, i) => ({ id: id('node', i), type: 'step' as const, label: 'x' }))
    const edges = Array.from({ length: LIMITS.maxEdges }, (_, i) => ({ source: id('src', i), target: id('tgt', i) }))
    const started = performance.now()
    const result = validate(nodes, edges)
    // It used to spend minutes of CPU computing "did you mean" for every one of 2,000 references.
    expect(performance.now() - started).toBeLessThan(2000)
    expect(result.issueCount).toBe(2 * LIMITS.maxEdges)
    expect(result.issues).toHaveLength(MAX_REPORTED_ISSUES + 1)
    expect(result.issues.at(-1)!.message).toBe(`...and ${2 * LIMITS.maxEdges - MAX_REPORTED_ISSUES} more problems like these.`)
    expect(result.issues[0].message).toContain('Existing node ids:')
    expect(result.issues[MAX_DETAILED_ISSUES].message).toBe(`no node with id ${JSON.stringify(edges[10].source)}.`)
  })

  it('still suggests close ids after the speed-ups', () => {
    const result = validate(
      [
        { id: 'payment-succeeded', type: 'step', label: 'a' },
        { id: 'done', type: 'step', label: 'b' },
      ],
      [
        { source: 'dnoe', target: 'payment-suceeded' },
        { source: 'done', target: 'zzzzzzzz' },
      ],
    )
    const text = messages(result)
    expect(text[0]).toContain('Did you mean "done"?')
    expect(text[1]).toContain('Did you mean "payment-succeeded"?')
    expect(text[2]).not.toContain('Did you mean')
  })

  it('validates containers and nesting', () => {
    const result = validate([
      { id: 'vpc', type: 'container', label: 'VPC' },
      { id: 'api', type: 'service', label: 'API', parentNode: 'vpc' },
      { id: 'db', type: 'database', label: 'DB', parentNode: 'api' },
      { id: 'x', type: 'step', label: 'X', parentNode: 'missing' },
      { id: 'y', type: 'step', label: 'Y', containerKind: 'vpc' },
      { id: 'self', type: 'container', label: 'S', parentNode: 'self' },
    ])
    expect(result.nodes[0].containerKind).toBe('group')
    expect(messages(result)).toEqual([
      'nodes[2].parentNode: node "api" is a "service", but only "container" nodes can hold other nodes.',
      'nodes[3].parentNode: no node with id "missing". Existing node ids: "vpc", "api", "db", "x", "y", "self".',
      'nodes[4].containerKind: containerKind is only valid on "container" nodes (this node is a "step").',
      "nodes[5].parentNode: a node can't be its own parent.",
      'nodes[5].parentNode: containers are nested in a cycle (self -> self).',
    ])
  })

  it('detects nesting cycles between containers', () => {
    const result = validate([
      { id: 'a', type: 'container', label: 'A', parentNode: 'b' },
      { id: 'b', type: 'container', label: 'B', parentNode: 'a' },
    ])
    expect(messages(result)).toEqual(['nodes[0].parentNode: containers are nested in a cycle (a -> b -> a).'])
  })

  it('can refer to nodes by id after operations', () => {
    const result = validateChart([{ id: 'db', type: 'step', label: 'x', icon: 'cosmos' }], [], {
      resolveIcon: defaultIconResolver,
      refStyle: 'id',
    })
    expect(result.issues[0].path).toBe('node "db".icon')
  })

  it('parseAndValidateChart combines shape and semantic checks', () => {
    expect(parseAndValidateChart({ nodes: [{ id: 1 }] }).issues[0].path).toBe('nodes[0].id')
    expect(parseAndValidateChart({ nodes: [{ id: 'a', type: 'step', label: 'A' }], edges: [] }).issues).toEqual([])
  })
})

describe('helpers', () => {
  it('formats paths and issue lists', () => {
    expect(formatPath(['nodes', 3, 'position', 'x'])).toBe('nodes[3].position.x')
    const text = formatIssues(Array.from({ length: 30 }, (_, i) => ({ path: `nodes[${i}]`, message: 'bad' })), 2)
    expect(text).toBe('- nodes[0]: bad\n- nodes[1]: bad\n- ...and 28 more')
  })

  it('canonicalizes edge styles like the editor renders them', () => {
    expect(canonicalEdgeStyle(undefined, undefined)).toBe('animated')
    expect(canonicalEdgeStyle('animated', 'sync')).toBe('default')
    expect(canonicalEdgeStyle('step', 'async')).toBe('step')
  })

  it('sizes nodes to fit long labels', () => {
    expect(estimateNodeSize('step', 'Short')).toEqual({ width: 180, height: 80 })
    const long = estimateNodeSize('step', 'A very long step label that clearly needs several lines to fit inside the box')
    expect(long.height).toBeGreaterThan(80)
    expect(estimateNodeSize('decision', 'Is the payment method valid and verified?').width).toBeGreaterThan(160)
  })

  it('computes the next free numeric id', () => {
    expect(nextNumericNodeId([{ id: '3' }, { id: 'signup' }, { id: '12' }])).toBe(13)
    expect(nextNumericNodeId([{ id: 'a' }])).toBe(1)
  })
})

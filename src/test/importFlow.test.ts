import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { MAX_DIAGRAM_IMPORT_BYTES, parseDiagramJson, parseFlowJson } from '../utils/importFlow'
import { serializeFlow } from '../utils/exportUtils'
import { getIconUrl } from '../utils/azureIconIds'

const base = () => ({ nodes: [{ id: 'start', type: 'step', label: 'First spark', position: { x: 0, y: 0 } }, { id: 'end', type: 'step', label: 'Launch', position: { x: 240, y: 0 } }], edges: [{ id: 'first', source: 'start', target: 'end', label: 'Ready' }] })

describe('Diagram import validation', () => {
  it('preserves valid IDs and intentional blank labels while rejecting whitespace-only identities', () => {
    const document = { nodes: [
      { id: ' node ', type: 'step', label: '', position: { x: 0, y: 0 } },
      { id: ' next ', type: 'note', label: '   ', position: { x: 240, y: 0 } },
    ], edges: [{ id: ' edge ', source: ' node ', target: ' next ', label: '   ' }] }
    const parsed = parseDiagramJson(JSON.stringify(document)).flow
    expect(parsed.nodes.map(({ id, label }) => ({ id, label }))).toEqual([{ id: ' node ', label: '' }, { id: ' next ', label: '   ' }])
    expect(parsed.edges[0]).toMatchObject({ id: ' edge ', source: ' node ', target: ' next ', label: '   ' })
    expect(() => parseDiagramJson(JSON.stringify({ ...document, nodes: [{ ...document.nodes[0], id: '   ' }], edges: [] }))).toThrow('id must be a nonempty string')
    expect(() => parseDiagramJson(JSON.stringify({ ...document, edges: [{ ...document.edges[0], id: '\u00a0\u2003' }] }))).toThrow('id must be a nonempty string')
  })

  it('round-trips editor exports with containers, icons, relative positions, and communication metadata', () => {
    const nodes: Node[] = [
      { id: 'boundary', type: 'container', position: { x: 0, y: 0 }, style: { width: 500, height: 400 }, data: { label: 'Dream district', containerKind: 'zone' } },
      { id: 'api', type: 'service', parentNode: 'boundary', extent: 'parent', position: { x: 40, y: 60 }, data: { label: 'Dream receiver', icon: 'icon-robot', imageUrl: '/assets/old-hash.svg', accountToken: 'secret-account', onLabelChange: () => {} } },
      { id: 'db', type: 'database', parentNode: 'boundary', extent: 'parent', position: { x: 260, y: 60 }, data: { label: 'Memory archive' } },
    ]
    const edges: Edge[] = [{ id: 'save', source: 'api', target: 'db', type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left', label: 'Remember', animated: true, style: { stroke: 'pink' }, data: { protocol: 'SQL', commStyle: 'async', editToken: 'secret-edit' } }]
    const result = parseFlowJson(serializeFlow(nodes, edges, 'architecture'))
    expect(result.mode).toBe('architecture')
    expect(result.nodes[0]).toMatchObject({ id: 'boundary', style: { width: 500, height: 400 }, data: { containerKind: 'zone' } })
    expect(result.nodes[1]).toMatchObject({ parentNode: 'boundary', extent: 'parent', position: { x: 40, y: 60 }, data: { label: 'Dream receiver', icon: 'icon-robot', imageUrl: getIconUrl('icon-robot') } })
    expect(result.edges[0]).toMatchObject({ type: 'smoothstep', sourceHandle: 'right', targetHandle: 'left', animated: true, data: { protocol: 'SQL', commStyle: 'async' } })
    expect(JSON.stringify(result)).not.toMatch(/secret-|old-hash|accountToken|editToken/)
  })

  it('recognizes a current local icon URL and saves its stable id in canonical content', () => {
    const localUrl = getIconUrl('icon-moon')
    expect(localUrl).toBeTruthy()
    const result = parseDiagramJson(JSON.stringify({ nodes: [{ id: 'moon', type: 'image', label: 'Moonlight', position: { x: 0, y: 0 }, imageUrl: localUrl }], edges: [] }))
    expect(result.flow.nodes[0]).toMatchObject({ icon: 'icon-moon' })
    expect(result.flow.nodes[0].imageUrl).toBeUndefined()
  })

  it('exports stable icon ids without changing the canvas or relying on a previous deployment hash', () => {
    const nodes: Node[] = [{ id: 'moon', type: 'image', position: { x: 0, y: 0 }, data: { label: 'Moonlight', imageUrl: getIconUrl('icon-moon') } }]
    const document = JSON.parse(serializeFlow(nodes, []))
    expect(document.nodes[0].data.icon).toBe('icon-moon')
    expect(nodes[0].data.icon).toBeUndefined()
    document.nodes[0].data.imageUrl = '/assets/no-longer-deployed-abc123.svg'
    expect(parseFlowJson(JSON.stringify(document)).nodes[0].data.imageUrl).toBe(getIconUrl('icon-moon'))
  })

  it('generates deterministic BaseFlow edge ids without colliding with explicit or parallel ids', () => {
    const diagram = base()
    const edges = [{ source: 'start', target: 'end' }, { source: 'start', target: 'end' }, { id: 'estart-end', source: 'start', target: 'end' }]
    const first = parseDiagramJson(JSON.stringify({ ...diagram, edges }))
    const second = parseDiagramJson(JSON.stringify({ ...diagram, edges }))
    expect(first.flow.edges.map((edge) => edge.id)).toEqual(['estart-end-2', 'estart-end-3', 'estart-end'])
    expect(second).toEqual(first)
    expect(first.flow.edges[0].style).toBe('animated')
    expect(() => parseFlowJson(JSON.stringify({ ...diagram, edges }))).toThrow(/needs a nonempty id/)
  })

  it('accepts safe external, generated, and embedded images without importing executable URLs', () => {
    for (const imageUrl of ['https://images.example/image.webp', '/assets/upload.webp', '/icons/cloud.svg', `/api/images/9ec56aa3-6579-4bb0-8d05-2db965f357a3?key=${'k'.repeat(43)}`, 'data:image/png;base64,aGVsbG8=', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E']) {
      const imported = parseDiagramJson(JSON.stringify({ nodes: [{ id: 'art', type: 'image', label: 'Original art', position: { x: 0, y: 0 }, imageUrl }], edges: [] }))
      expect(imported.flow.nodes[0].imageUrl).toBe(imageUrl)
    }
  })

  it.each(['step', 'decision', 'note', 'container'])('rejects hidden image sources on a %s node', (type) => {
    for (const source of [{ icon: 'icon-moon' }, { imageUrl: 'https://images.example/moon.png' }]) {
      expect(() => parseDiagramJson(JSON.stringify({ nodes: [{ id: 'hidden', type, label: 'Hidden', position: { x: 0, y: 0 }, ...source }], edges: [] }))).toThrow(/can show an image/)
    }
  })

  it.each([
    '/api/billing/session', '/account/avatar', '/assets/../api/billing/session.png', '/assets/%2e%2e/api/image.png', '/assets/%252e%252e/image.png', '/assets/%2Fapi/image.png', '/assets/diagram.svg?edit=secret', '/icons/icon.html',
    `/api/images/9ec56aa3-6579-4bb0-8d05-2db965f357a3?key=${'k'.repeat(42)}`, `/api/images/9ec56aa3-6579-4bb0-8d05-2db965f357a3?key=${'k'.repeat(43)}&edit=secret`,
    'data:image/png,plain-text', 'data:image/png;base64,a!', 'data:image/png;base64,aGVsbG8===', 'data:image/png;base64,', 'data:image/svg+xml,%broken', 'data:image/svg+xml,%3Chtml%3E',
  ])('rejects an unsupported image URL: %s', (imageUrl) => {
    expect(() => parseDiagramJson(JSON.stringify({ nodes: [{ id: 'art', type: 'image', label: 'Artwork', position: { x: 0, y: 0 }, imageUrl }], edges: [] }))).toThrow(/image URL|image asset|supported image/)
  })

  it('keeps larger local uploads available through JSON import', () => {
    const imageUrl = `data:image/png;base64,${'aGVs'.repeat(24_000)}`
    const imported = parseDiagramJson(JSON.stringify({ nodes: [{ id: 'art', type: 'image', label: 'Uploaded image', position: { x: 0, y: 0 }, imageUrl }], edges: [] }))
    expect(imported.flow.nodes[0].imageUrl).toBe(imageUrl)
  })

  it('drops imported behavior and styling while retaining only chart fields', () => {
    const imported = parseDiagramJson(JSON.stringify({
      version: 2, mode: 'architecture', editToken: 'account-secret',
      nodes: [{ id: '__proto__', type: 'service', position: { x: 0, y: 0 }, selected: true, draggable: false, className: 'injected-class', style: { color: 'red', width: 200 }, data: { label: 'A safe service', onLabelChange: 'malicious-code', recoveryCode: 'account-secret' } }], edges: [],
    }))
    expect(imported.flow.nodes[0]).toEqual({ id: '__proto__', type: 'service', label: 'A safe service', position: { x: 0, y: 0 }, width: 200 })
    expect(JSON.stringify(imported)).not.toMatch(/account-secret|malicious-code|injected-class/)
  })

  it('keeps legacy mode fallback and harmless feedback cycles', () => {
    const diagram = base()
    const result = parseFlowJson(JSON.stringify({ ...diagram, mode: 'mindmap', edges: [{ id: 'retry', source: 'start', target: 'start' }] }))
    expect(result.mode).toBe('flowchart')
    expect(result.edges[0]).toMatchObject({ source: 'start', target: 'start' })
  })

  it.each([
    ['string position', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { position: 'not coordinates' }) }],
    ['string coordinate', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0].position, { x: '50' }) }],
    ['non-finite coordinate', (raw: ReturnType<typeof base>) => { raw.nodes[0].position.x = Infinity }],
    ['missing node id', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { id: undefined }) }],
    ['duplicate node id', (raw: ReturnType<typeof base>) => { raw.nodes[1].id = 'start' }],
    ['unknown node type', (raw: ReturnType<typeof base>) => { raw.nodes[0].type = 'magic-code' }],
    ['invalid label', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { label: { html: '<script>' } }) }],
    ['foreign endpoint', (raw: ReturnType<typeof base>) => { raw.edges[0].target = 'missing' }],
    ['duplicate edge id', (raw: ReturnType<typeof base>) => { raw.edges.push({ ...raw.edges[0] }) }],
    ['invalid protocol', (raw: ReturnType<typeof base>) => { Object.assign(raw.edges[0], { protocol: 'ssh-code' }) }],
    ['invalid communication style', (raw: ReturnType<typeof base>) => { Object.assign(raw.edges[0], { commStyle: 'parallel' }) }],
    ['invalid handle', (raw: ReturnType<typeof base>) => { Object.assign(raw.edges[0], { sourceHandle: 'diagonal' }) }],
    ['missing container', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { parentNode: 'missing' }) }],
    ['non-container parent', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[1], { parentNode: 'start' }) }],
    ['cyclic parent graph', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { type: 'container', parentNode: 'end' }); Object.assign(raw.nodes[1], { type: 'container', parentNode: 'start' }) }],
    ['unknown icon', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { type: 'image', icon: 'icon-unregistered-123' }) }],
    ['unsafe image', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { type: 'image', imageUrl: 'javascript:alert(1)' }) }],
    ['network-path image', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { type: 'image', imageUrl: '//evil.example/image.svg' }) }],
    ['backslash image', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { type: 'image', imageUrl: '/\\evil.example/image.svg' }) }],
    ['HTML data URL', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { type: 'image', imageUrl: 'data:text/html,<script>' }) }],
    ['image with no asset', (raw: ReturnType<typeof base>) => { raw.nodes[0].type = 'image' }],
    ['negative width', (raw: ReturnType<typeof base>) => { Object.assign(raw.nodes[0], { width: -100 }) }],
  ])('rejects %s instead of applying a partial graph', (_name, damage) => {
    const raw = base()
    damage(raw)
    expect(() => parseDiagramJson(JSON.stringify(raw))).toThrow()
  })

  it('rejects missing ids in editor files, including files with foreign data shapes', () => {
    const document = { version: 2, nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } }], edges: [{ source: 'a', target: 'a' }] }
    expect(() => parseDiagramJson(JSON.stringify(document))).toThrow(/needs a nonempty id/)
    expect(() => parseFlowJson(JSON.stringify({ ...document, edges: [], nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: 'not data' }] }))).toThrow(/data must be an object/)
  })

  it('bounds JSON and diagram arrays before expensive conversion', () => {
    expect(() => parseFlowJson('{')).toThrow(/valid JSON/)
    expect(() => parseFlowJson('x'.repeat(MAX_DIAGRAM_IMPORT_BYTES + 1))).toThrow(/too large/)
    expect(() => parseDiagramJson(JSON.stringify({ nodes: Array.from({ length: 501 }, (_, i) => ({ ...base().nodes[0], id: String(i) })), edges: [] }))).toThrow(/at most 500/)
  })
})

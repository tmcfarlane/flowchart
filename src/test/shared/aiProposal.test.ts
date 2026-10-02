import { describe, it, expect } from 'vitest'
import { normalizeAIProposal, parseAIProposal, contextForAI, getPreservedImageNodeIds, preserveCanvasImages } from '../../shared/aiProposal'
import { ARCH_NODE_TYPES, ICON_NODE_TYPES, LIMITS, isArchitectureChart } from '../../shared/flowTypes'
import { parseAndValidateChart, validateChart } from '../../shared/flowSchema'
import { parseDiagramJson } from '../../utils/importFlow'
import { chartToFlow, flowToChart } from '../../utils/sharedFlow'
const node = { id: 'a', type: 'step', label: 'First', position: { x: 0, y: 0 } }
const chart = () => ({ summary: 'A chart', nodes: [{ ...node }], edges: [] })
describe('AI proposal validation', () => {
  it('preserves supported architecture metadata and normalizes nullable fields', () => {
    const result = normalizeAIProposal({ ...chart(), nodes: [{ ...node, type: 'container', containerKind: 'vpc' }, { id: 'b', type: 'database', label: 'Data', position: { x: 10, y: 15 }, parentNode: 'a', icon: 'icon-database', width: null }], edges: [{ id: 'e', source: 'a', target: 'b', protocol: 'SQL', commStyle: 'sync' }] })
    expect(result.nodes[1].parentNode).toBe('a')
    expect(result.nodes[1].width).toBeUndefined()
    expect(result.edges[0].protocol).toBe('SQL')
  })
  it.each([
    { nodes: [node, node], edges: [] },
    { nodes: [node], edges: [{ source: 'a', target: 'missing' }] },
    { nodes: [{ ...node, position: { x: NaN, y: 0 } }], edges: [] },
    { nodes: [{ ...node, imageUrl: 'javascript:alert(1)' }], edges: [] },
    { nodes: [{ ...node, parentNode: 'a', type: 'container' }], edges: [] },
  ])('rejects dangerous or invalid structures %j', (input) => expect(() => normalizeAIProposal(input)).toThrow())
  it('rejects incomplete responses and allows explicit complete removal in edit mode', () => {
    expect(() => parseAIProposal(JSON.stringify(chart()), 'length')).toThrow(/cut off/)
    expect(() => normalizeAIProposal({ nodes: [], edges: [] })).toThrow()
    expect(normalizeAIProposal({ nodes: [], edges: [] }, true).nodes).toEqual([])
  })
  it('keeps binary uploads out of AI requests and restores them only on matching ids', () => {
    const original = { nodes: [{ ...node, type: 'image', imageUrl: 'data:image/png;base64,aGVsbG8=' }], edges: [] }
    expect(contextForAI(original).nodes[0].imageUrl).toBeUndefined()
    expect(original.nodes[0].imageUrl).toBeTruthy()
    const proposal = normalizeAIProposal(contextForAI(original), true, { preservedImageNodeIds: ['a'] })
    const result = preserveCanvasImages(proposal, original.nodes)
    expect(result.nodes[0].imageUrl).toBe(original.nodes[0].imageUrl)
    expect(preserveCanvasImages(normalizeAIProposal({ ...chart(), nodes: [{ ...node, id: 'new' }] }), original.nodes).nodes[0].imageUrl).toBeUndefined()
  })
  it('preserves local generated image assets while refusing unsafe URL normalization and credentials', () => {
    const imageUrl = `/api/images/1bbf5160-4237-4181-9f70-9da023a0cde3?key=${'a'.repeat(43)}`
    expect(normalizeAIProposal({ nodes: [{ ...node, type: 'image', imageUrl }], edges: [] }).nodes[0].imageUrl).toBe(imageUrl)
    for (const unsafe of ['https://user:password@example.com/image.png', '/assets/\\\\example.com/image.png', 'https://example.com/ image.png', '//example.com/image.png', '/api/images/unknown?key=invalid']) {
      expect(() => normalizeAIProposal({ nodes: [{ ...node, type: 'image', imageUrl: unsafe }], edges: [] })).toThrow(/unsupported image URL/)
    }
  })
  it('canonicalizes local icon aliases and refuses unknown or path-based references', () => {
    for (const [ref, canonical] of [['Moon', 'icon-moon'], ['moon', 'icon-moon'], ['Azure Functions', 'function-apps'], ['icon-robot', 'icon-robot']]) {
      expect(normalizeAIProposal({ nodes: [{ ...node, type: 'image', icon: ref }], edges: [] }).nodes[0].icon).toBe(canonical)
    }
    for (const icon of ['missing-icon', '../../icon-moon.svg', 'https://example.com/icon-robot.svg']) {
      expect(() => normalizeAIProposal({ nodes: [{ ...node, type: 'image', icon }], edges: [] })).toThrow(/unknown local icon/)
    }
    expect(() => normalizeAIProposal({ nodes: [{ ...node, type: 'image' }], edges: [] })).toThrow(/without an image or local icon/)
  })
  it('allows only known existing upload ids to omit their image before restoration', () => {
    const original = [{ ...node, type: 'image', imageUrl: 'data:image/png;base64,aGVsbG8=' }]
    const context = contextForAI({ nodes: original, edges: [] })
    const options = { preservedImageNodeIds: ['a'] }
    expect(context.nodes[0].imageUrl).toBeUndefined()
    const accepted = normalizeAIProposal(context, true, options)
    const parsed = parseAIProposal(JSON.stringify(context), 'stop', true, options)
    expect(preserveCanvasImages(parsed, original).nodes[0].imageUrl).toBe(original[0].imageUrl)
    expect(accepted.nodes[0].imageUrl).toBeUndefined()
    expect(() => normalizeAIProposal({ nodes: [...context.nodes, { ...node, id: 'new', type: 'image' }], edges: [] }, true, options)).toThrow(/without an image or local icon/)
    expect(() => normalizeAIProposal(context, true)).toThrow(/without an image or local icon/)
  })
  it('preserves existing SVG uploads locally while rejecting newly model-supplied SVG data', () => {
    const original = [{ ...node, type: 'image', imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }]
    const proposal = normalizeAIProposal(contextForAI({ nodes: original, edges: [] }), true, { preservedImageNodeIds: ['a'] })
    const restored = preserveCanvasImages(proposal, original)
    expect(restored.nodes[0].imageUrl).toBe(original[0].imageUrl)
    expect(validateChart(restored.nodes, restored.edges).issues).toEqual([])
    expect(() => normalizeAIProposal({ nodes: original, edges: [] })).toThrow(/unsupported image URL/)
  })
  it('keeps larger existing binary uploads local during edits without allowing oversized new model sources', () => {
    const original = [{ ...node, type: 'image', imageUrl: `data:image/png;base64,${'a'.repeat(LIMITS.maxImageUrlLength + 4)}` }]
    const context = contextForAI({ nodes: original, edges: [] })
    expect(context.nodes[0].imageUrl).toBeUndefined()
    const proposal = normalizeAIProposal(context, true, { preservedImageNodeIds: ['a'] })
    expect(preserveCanvasImages(proposal, original).nodes[0].imageUrl).toBe(original[0].imageUrl)
    expect(() => normalizeAIProposal({ nodes: original, edges: [] })).toThrow(/image URL/)
  })
  it.each([
    'data:image/avif;base64,AAAA',
    'DATA:image/AVIF;base64,AAAA',
    'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
    'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E',
    'data:image/svg+xml;utf8,%3Csvg%2F%3E',
  ])('preserves accepted imported artwork through source omission and an unrelated complete edit: %s', (imageUrl) => {
    const imported = parseDiagramJson(JSON.stringify({ nodes: [
      { ...node, type: 'image', label: '', imageUrl },
      { ...node, id: 'named', label: 'Original action', position: { x: 200, y: 0 } },
    ], edges: [] })).flow
    expect(imported.nodes[0].imageUrl).toBe(imageUrl)
    const context = contextForAI(imported)
    expect(context.nodes[0].imageUrl).toBeUndefined()
    expect(JSON.stringify(context)).not.toContain(imageUrl)
    const response = { ...context, nodes: context.nodes.map((item) => item.id === 'named' ? { ...item, label: 'Edited action' } : item) }
    const proposal = parseAIProposal(JSON.stringify(response), 'stop', true, { preservedImageNodeIds: ['a'] })
    const restored = preserveCanvasImages(proposal, imported.nodes)
    expect(restored.nodes[0]).toMatchObject({ id: 'a', type: 'image', label: '', imageUrl })
    expect(restored.nodes[1].label).toBe('Edited action')
    expect(validateChart(restored.nodes, restored.edges).issues).toEqual([])
    expect(() => normalizeAIProposal({ nodes: [{ ...node, type: 'image', imageUrl }], edges: [] })).toThrow(/unsupported image URL/)
  })
  it('does not restore malformed or unsupported existing embedded sources', () => {
    const proposal = normalizeAIProposal({ nodes: [{ ...node, type: 'image' }], edges: [] }, true, { preservedImageNodeIds: ['a'] })
    for (const imageUrl of ['data:image/avif;base64,AAAA=', 'data:image/svg+xml,%E0%A4%A', 'data:image/svg+xml,%3Chtml%2F%3E', 'data:text/html,%3Csvg%2F%3E']) {
      expect(preserveCanvasImages(proposal, [{ ...node, type: 'image', imageUrl }]).nodes[0].imageUrl).toBeUndefined()
    }
  })
  it.each(['', '   ', '\n\t'])('preserves supported blank labels through context validation and an unrelated complete edit: %j', (label) => {
    const imported = parseDiagramJson(JSON.stringify({ nodes: [
      { ...node, label }, { ...node, id: 'named', label: 'Original action', position: { x: 200, y: 0 } },
    ], edges: [{ id: 'e', source: 'a', target: 'named', label: '   ' }] })).flow
    const context = normalizeAIProposal(contextForAI(imported), true)
    expect(context.nodes[0].label).toBe(label)
    expect(context.edges[0].label).toBe('   ')
    const edited = parseAIProposal(JSON.stringify({ ...context, nodes: context.nodes.map((item) => item.id === 'named' ? { ...item, label: 'Edited action' } : item) }), 'stop', true)
    expect(edited.nodes[0].label).toBe(label)
    expect(edited.nodes[1].label).toBe('Edited action')
    expect(validateChart(edited.nodes, edited.edges).issues).toEqual([])
  })
  it('keeps labels bounded strings while node and connection identifiers remain nonblank', () => {
    for (const label of [null, undefined, 42, 'a'.repeat(LIMITS.maxLabelLength + 1)]) {
      expect(() => normalizeAIProposal({ nodes: [{ ...node, label }], edges: [] })).toThrow(/node label/)
    }
    expect(() => normalizeAIProposal({ nodes: [node], edges: [{ source: 'a', target: 'a', label: 'a'.repeat(LIMITS.maxEdgeLabelLength + 1) }] })).toThrow(/connection label/)
    expect(() => normalizeAIProposal({ nodes: [{ ...node, id: ' ' }], edges: [] })).toThrow(/node id/)
    expect(() => normalizeAIProposal({ nodes: [node], edges: [{ id: ' ', source: 'a', target: 'a' }] })).toThrow(/connection id/)
  })
  it.each(ICON_NODE_TYPES)('accepts local icons and image URLs on %s nodes consistently with shared saves', (type) => {
    for (const source of [{ icon: 'Moon' }, { imageUrl: 'https://example.com/image.png' }]) {
      const proposal = normalizeAIProposal({ nodes: [{ ...node, type, ...source }], edges: [] })
      expect(validateChart(proposal.nodes, proposal.edges).issues).toEqual([])
      if ('icon' in source) expect(proposal.nodes[0].icon).toBe('icon-moon')
      else expect(proposal.nodes[0].imageUrl).toBe(source.imageUrl)
    }
  })
  it.each(['step', 'decision', 'note', 'container'])('rejects images and icons on %s nodes before review', (type) => {
    expect(() => normalizeAIProposal({ nodes: [{ ...node, type, icon: 'icon-moon' }], edges: [] })).toThrow(/does not display icons/)
    expect(() => normalizeAIProposal({ nodes: [{ ...node, type, imageUrl: 'https://example.com/image.png' }], edges: [] })).toThrow(/does not display images/)
  })
  it('permits container kinds only on containers and makes canonical local icons win over image URLs', () => {
    expect(() => normalizeAIProposal({ nodes: [{ ...node, containerKind: 'cluster' }], edges: [] })).toThrow(/container kind on a non-container/)
    const container = normalizeAIProposal({ nodes: [{ ...node, type: 'container', containerKind: 'cluster' }], edges: [] })
    expect(validateChart(container.nodes, container.edges).issues).toEqual([])
    for (const imageUrl of ['https://example.com/image.png', 'javascript:alert(1)']) {
      const proposal = normalizeAIProposal({ nodes: [{ ...node, type: 'service', icon: 'Moon', imageUrl }], edges: [] })
      expect(proposal.nodes[0].icon).toBe('icon-moon')
      expect(proposal.nodes[0].imageUrl).toBeUndefined()
      expect(validateChart(proposal.nodes, proposal.edges).issues).toEqual([])
    }
  })
  it('allows an uploaded image to become a shareable text node without restoring the old hidden source', () => {
    const original = [{ ...node, type: 'image', imageUrl: 'data:image/png;base64,aGVsbG8=' }]
    for (const type of ['step', 'decision', 'note', 'container']) {
      const converted = normalizeAIProposal({ nodes: [{ ...node, type }], edges: [] }, true, { preservedImageNodeIds: ['a'] })
      const restored = preserveCanvasImages(converted, original)
      expect(restored.nodes[0].imageUrl).toBeUndefined()
      expect(restored.nodes[0].icon).toBeUndefined()
      expect(validateChart(restored.nodes, restored.edges).issues).toEqual([])
    }
  })
  it('restores only valid sources from compatible existing nodes and preserves explicit replacements', () => {
    const proposal = normalizeAIProposal({ nodes: [{ ...node, type: 'service' }], edges: [] })
    for (const old of [
      { ...node, type: 'step', imageUrl: 'https://example.com/image.png' },
      { ...node, type: 'image', imageUrl: 'javascript:alert(1)' },
      { ...node, type: 'image', imageUrl: '/api/images/invalid?key=invalid' },
      { ...node, type: 'image', icon: 'missing-icon', imageUrl: 'https://example.com/image.png' },
    ]) {
      expect(preserveCanvasImages(proposal, [old]).nodes[0]).toEqual(proposal.nodes[0])
    }
    const original = [{ ...node, type: 'image', icon: 'Moon', imageUrl: 'https://example.com/image.png' }]
    const restored = preserveCanvasImages(proposal, original)
    expect(restored.nodes[0].icon).toBe('icon-moon')
    expect(restored.nodes[0].imageUrl).toBeUndefined()
    expect(validateChart(restored.nodes, restored.edges).issues).toEqual([])
    const replacement = normalizeAIProposal({ nodes: [{ ...node, type: 'service', icon: 'icon-robot' }], edges: [] })
    expect(preserveCanvasImages(replacement, original).nodes[0].icon).toBe('icon-robot')
  })
  it.each(ARCH_NODE_TYPES)('converts an imported uploaded %s into an image while keeping artwork, blank labels and its container', (type) => {
    const imageUrl = 'data:image/avif;base64,AAAA'
    const imported = parseDiagramJson(JSON.stringify({ mode: 'architecture', nodes: [
      { id: 'boundary', type: 'container', label: '', position: { x: 30, y: 40 }, width: 400, height: 300, containerKind: 'vpc' },
      { ...node, type, label: '   ', parentNode: 'boundary', position: { x: 20, y: 35 }, imageUrl },
      { ...node, id: 'other', type: 'service', label: 'Destination', parentNode: 'boundary', position: { x: 220, y: 35 }, icon: 'icon-server' },
    ], edges: [{ id: 'e', source: 'a', target: 'other', label: ' ', sourceHandle: 'right', targetHandle: 'left', protocol: 'event', commStyle: 'async' }] })).flow
    const context = contextForAI(imported)
    expect(context.nodes.find(item => item.id === 'a')?.imageUrl).toBeUndefined()
    const options = { preservedImageNodeIds: getPreservedImageNodeIds(imported.nodes) }
    expect(options.preservedImageNodeIds).toEqual(['a', 'other'])
    const proposal = parseAIProposal(JSON.stringify({ ...context, nodes: context.nodes.map(item => item.id === 'a' ? { ...item, type: 'image' } : item) }), 'stop', true, options)
    const restored = preserveCanvasImages(proposal, imported.nodes)
    expect(restored.nodes.find(item => item.id === 'a')).toMatchObject({ type: 'image', label: '   ', parentNode: 'boundary', position: { x: 20, y: 35 }, imageUrl })
    expect(restored.nodes[0]).toMatchObject({ type: 'container', label: '', containerKind: 'vpc' })
    expect(restored.edges[0]).toMatchObject({ label: ' ', protocol: 'event', commStyle: 'async', sourceHandle: 'right', targetHandle: 'left' })
    expect(parseAndValidateChart(restored).issues).toEqual([])
    const rendered = chartToFlow(restored, { onLabelChange: () => {}, edgeProps: (style, metadata) => ({ animated: style === 'animated', type: style === 'step' ? 'smoothstep' : 'default', data: metadata }) })
    expect(flowToChart(rendered.nodes, rendered.edges)).toEqual({ nodes: restored.nodes, edges: restored.edges })
  })
  it.each(['icon-robot', 'function-apps', 'azure-cosmos-db', 'browser'])('keeps imported canonical %s artwork and empty captions through architecture and flow image edits', (icon) => {
    let original = parseDiagramJson(JSON.stringify({ mode: 'flowchart', nodes: [{ ...node, type: 'image', label: '', icon }], edges: [] })).flow
    for (const type of ['service', 'image'] as const) {
      const context = contextForAI(original)
      const options = { preservedImageNodeIds: getPreservedImageNodeIds(original.nodes) }
      expect(options.preservedImageNodeIds).toEqual(['a'])
      const proposal = parseAIProposal(JSON.stringify({ ...context, nodes: context.nodes.map(item => ({ ...item, type, icon: undefined })) }), 'stop', true, options)
      const restored = preserveCanvasImages(proposal, original.nodes)
      expect(restored.nodes[0]).toMatchObject({ id: 'a', type, label: '', icon })
      expect(parseAndValidateChart(restored).issues).toEqual([])
      expect(isArchitectureChart(restored.nodes)).toBe(type === 'service')
      const rendered = chartToFlow(restored, { onLabelChange: () => {}, edgeProps: () => ({}) })
      original = flowToChart(rendered.nodes, rendered.edges)
      expect(original.nodes[0].icon).toBe(icon)
      expect(original.nodes[0].imageUrl).toBeUndefined()
    }
  })
  it('does not grant image-source omission to source-less, incompatible or invalid original artwork', () => {
    const originals = [
      { ...node, id: 'plain', type: 'service' },
      { ...node, id: 'container', type: 'container', imageUrl: 'https://example.com/image.png' },
      { ...node, id: 'step', type: 'step', icon: 'icon-robot' },
      { ...node, id: 'bad-icon', type: 'image', icon: 'missing-icon', imageUrl: 'https://example.com/image.png' },
      { ...node, id: 'bad-url', type: 'service', imageUrl: 'javascript:alert(1)' },
      { ...node, id: 'valid', type: 'service', imageUrl: 'data:image/svg+xml,%3Csvg%2F%3E' },
    ]
    const options = { preservedImageNodeIds: getPreservedImageNodeIds(originals) }
    expect(options.preservedImageNodeIds).toEqual(['valid'])
    for (const id of ['plain', 'container', 'step', 'bad-icon', 'bad-url', 'new']) {
      expect(() => parseAIProposal(JSON.stringify({ nodes: [{ ...node, id, type: 'image' }], edges: [] }), 'stop', true, options)).toThrow(/without an image or local icon/)
    }
    expect(() => parseAIProposal(JSON.stringify({ nodes: [{ ...node, id: 'valid', type: 'image', imageUrl: 'javascript:alert(1)' }], edges: [] }), 'stop', true, options)).toThrow(/unsupported image URL/)
    const converted = parseAIProposal(JSON.stringify({ nodes: [{ ...node, id: 'valid', type: 'container' }], edges: [] }), 'stop', true, options)
    expect(preserveCanvasImages(converted, originals).nodes[0].imageUrl).toBeUndefined()
    expect(parseAndValidateChart(preserveCanvasImages(converted, originals)).issues).toEqual([])
  })
})

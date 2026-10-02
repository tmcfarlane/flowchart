import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import TemplateGallery from '../components/TemplateGallery'
import { DIAGRAM_TEMPLATES, type DiagramTemplateCategory } from '../shared/diagramTemplates'
import { createFlowchartMcpServer } from '../shared/server/mcpServer'
import { FlowService } from '../shared/server/flowService'
import { MemoryFlowStore } from '../shared/server/store'

const allIds = DIAGRAM_TEMPLATES.map(template => template.id)
const cases: Array<{ query: string; ids: string[]; category?: DiagramTemplateCategory }> = [
  { query: 'Cosmos DB', ids: ['azure-serverless'] },
  { query: 'dream-observatory', ids: ['dream-observatory'] },
  { query: 'learning recall', ids: ['learning-loop'] },
  { query: '  COSMOS…DB!!  ', ids: ['azure-serverless'] },
  { query: 'creative, MOONLIGHT; observatory', ids: ['dream-observatory'] },
  { query: 'recall LEARNING', ids: ['learning-loop'], category: 'process' },
  { query: 'Cosmos DB', ids: [], category: 'creative' },
  { query: '   ', ids: allIds },
  { query: ' , -- ; ', ids: allIds },
  { query: 'unknown-template-zzqqzz', ids: [] },
]
const categoryLabels = { process: 'Processes', business: 'Business', cloud: 'Architecture', creative: 'Creative' }

describe('Gallery and MCP template search agreement', () => {
  let client: Client
  beforeEach(async () => {
    const service = new FlowService({ store: new MemoryFlowStore() })
    const server = createFlowchartMcpServer({ getService: () => service, baseUrl: 'https://flowchart.test' })
    const [browserTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    client = new Client({ name: 'template-search-contract', version: '1.0.0' })
    await client.connect(browserTransport)
  })
  afterEach(async () => { await client.close() })

  it.each(cases)('finds the same expected starting points for $query / $category', async ({ query, category, ids }) => {
    render(<TemplateGallery isOpen onClose={vi.fn()} onSelect={vi.fn()} />)
    if (category) fireEvent.click(screen.getByRole('button', { name: categoryLabels[category] }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search diagram templates' }), { target: { value: query } })
    const cards = screen.queryAllByRole('button', { name: /^Use .* template$/ })
    expect(cards.map(card => DIAGRAM_TEMPLATES.find(template => card.getAttribute('aria-label') === `Use ${template.title} template`)!.id)).toEqual(ids)
    const result = await client.callTool({ name: 'list_diagram_templates', arguments: { query, ...(category ? { category } : {}) } })
    expect(result.isError).toBeFalsy()
    const data = result.structuredContent as { templates: Array<{ id: string }>; total: number }
    expect(data.templates.map(template => template.id)).toEqual(ids)
    expect(data.total).toBe(ids.length)
  })

  it('retains MCP query and category validation limits', async () => {
    expect((await client.callTool({ name: 'list_diagram_templates', arguments: { query: 'x'.repeat(200) } })).isError).toBeFalsy()
    expect((await client.callTool({ name: 'list_diagram_templates', arguments: { query: 'x'.repeat(201) } })).isError).toBe(true)
    expect((await client.callTool({ name: 'list_diagram_templates', arguments: { category: 'unknown' } })).isError).toBe(true)
  })
})

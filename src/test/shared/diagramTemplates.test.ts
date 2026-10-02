// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DIAGRAM_TEMPLATES, DIAGRAM_TEMPLATE_CATEGORIES, getDiagramTemplate, searchDiagramTemplates } from '../../shared/diagramTemplates'
import { auditDiagram } from '../../shared/diagramAudit'
import { normalizeAIProposal } from '../../shared/aiProposal'
import { FlowService } from '../../shared/server/flowService'
import { MemoryFlowStore } from '../../shared/server/store'

describe('curated diagram templates', () => {
  it('covers all categories with unique, useful drafts that validate without warnings', () => {
    expect(DIAGRAM_TEMPLATES.length).toBeGreaterThanOrEqual(20)
    expect(new Set(DIAGRAM_TEMPLATES.map((item) => item.id)).size).toBe(DIAGRAM_TEMPLATES.length)
    expect(new Set(DIAGRAM_TEMPLATES.map((item) => item.category))).toEqual(new Set(DIAGRAM_TEMPLATE_CATEGORIES))
    for (const template of DIAGRAM_TEMPLATES) {
      expect(template.nodes.length, template.id).toBeGreaterThanOrEqual(6)
      expect(template.description.length, template.id).toBeGreaterThan(40)
      expect(template.nodes.every((node) => !node.position && !node.imageUrl), template.id).toBe(true)
      const report = auditDiagram(template)
      expect(report.valid, `${template.id}: ${JSON.stringify(report.findings)}`).toBe(true)
      expect(report.findings.filter((item) => item.severity !== 'info'), template.id).toEqual([])
    }
  })

  it('returns independent editable drafts and never guesses unknown ids', () => {
    const draft = getDiagramTemplate('dream-observatory')!
    draft.nodes[0].label = 'Changed in a local draft'
    draft.edges[0].label = 'Changed locally'
    expect(getDiagramTemplate(draft.id)?.nodes[0].label).not.toBe('Changed in a local draft')
    expect(getDiagramTemplate(draft.id)?.edges[0].label).not.toBe('Changed locally')
    expect(getDiagramTemplate('__proto__')).toBeUndefined()
    expect(getDiagramTemplate('/etc/passwd')).toBeUndefined()
    expect(getDiagramTemplate('https://example.com/template')).toBeUndefined()
  })

  it('filters titles, descriptions, categories and node labels without mutating catalog drafts', () => {
    expect(searchDiagramTemplates('dream').map((item) => item.id)).toContain('dream-observatory')
    expect(searchDiagramTemplates('', 'cloud')).toHaveLength(4)
    expect(searchDiagramTemplates('checkout', 'business').map((item) => item.id)).toContain('checkout-journey')
    expect(searchDiagramTemplates('impossiblymissing')).toEqual([])
    const [result] = searchDiagramTemplates('COSMOS—DB', 'cloud')
    expect(result.id).toBe('azure-serverless')
    result.nodes[0].label = 'Changed search result'
    expect(searchDiagramTemplates('COSMOS—DB', 'cloud')[0].nodes[0].label).not.toBe('Changed search result')
  })

  it('lays out all templates as real charts with resolvable local icons', async () => {
    const service = new FlowService({ store: new MemoryFlowStore() })
    for (const template of DIAGRAM_TEMPLATES) {
      const result = await service.create({ ...template, source: 'api' })
      expect(result.ok, `${template.id}: ${JSON.stringify(result)}`).toBe(true)
      if (!result.ok) continue
      expect(result.layout).toBe('full')
      expect(result.chart.nodes).toHaveLength(template.nodes.length)
      // A placed template can pass through the same full-diagram validation
      // used for model/API edits without losing local icons or architecture.
      expect(normalizeAIProposal({ summary: template.title, nodes: result.chart.nodes, edges: result.chart.edges }).nodes).toHaveLength(template.nodes.length)
      for (const node of result.chart.nodes) {
        expect(Number.isFinite(node.position.x), `${template.id}/${node.id}`).toBe(true)
        expect(Number.isFinite(node.position.y), `${template.id}/${node.id}`).toBe(true)
      }
    }
  }, 20000)
})

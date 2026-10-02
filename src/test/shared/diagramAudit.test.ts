// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { auditDiagram } from '../../shared/diagramAudit'

const step = (id: string, label = id) => ({ id, type: 'step', label })
const codes = (report: ReturnType<typeof auditDiagram>) => report.findings.map((finding) => finding.code)

describe('diagram audit', () => {
  it('reports structural and semantic problems without returning a partial draft', () => {
    const shape = auditDiagram({ nodes: [{ id: 'bad', type: 'sphere', label: 'Bad shape' }] })
    expect(shape.valid).toBe(false)
    expect(shape.normalized).toBeNull()
    expect(shape.findings[0]).toMatchObject({ severity: 'error', path: 'nodes[0].type' })
    const references = auditDiagram({ nodes: [step('a'), step('a')], edges: [{ source: 'a', target: 'missing' }] })
    expect(references.valid).toBe(false)
    expect(references.findings.map((finding) => finding.path)).toEqual(['nodes[1].id', 'edges[0].target'])
    expect(references.findings.every((finding) => finding.suggestion.length > 0)).toBe(true)
    expect(auditDiagram({ nodes: [] }).valid).toBe(false)
  })

  it('distinguishes valid drafts from actionable decision and connection warnings', () => {
    const report = auditDiagram({ nodes: [step('a'), { id: 'decision', type: 'decision', label: 'Ready?' }, step('b'), step('alone')], edges: [{ source: 'a', target: 'decision' }, { source: 'decision', target: 'b' }] })
    expect(report.valid).toBe(true)
    expect(report.normalized).not.toBeNull()
    expect(codes(report)).toEqual(expect.arrayContaining(['incomplete_decision', 'unlabeled_decision', 'isolated_node', 'disconnected_components']))
    expect(report.metrics).toMatchObject({ nodeCount: 4, edgeCount: 2, decisionCount: 1, connectedComponents: 2 })
  })

  it('accepts loops and unconnected context notes, and normalizes icons/edge ids', () => {
    const report = auditDiagram({ nodes: [{ id: 'a', type: 'service', label: 'A', icon: 'AI assistant' }, step('b'), { id: 'tip', type: 'note', label: 'A helpful tip' }], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a', label: 'Retry' }] })
    expect(report.valid).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.metrics.connectedComponents).toBe(1)
    expect(report.normalized?.nodes[0].icon).toBe('icon-robot')
    expect(report.normalized?.edges[0].id).toBe('ea-b')
  })

  it('flags repeated outcomes, empty containers and external image hosts', () => {
    const report = auditDiagram({ nodes: [{ id: 'q', type: 'decision', label: 'Which?' }, step('a'), { id: 'b', type: 'image', label: 'B', imageUrl: 'https://example.com/image.png' }, { id: 'group', type: 'container', label: 'Unused group' }], edges: [{ source: 'q', target: 'a', label: 'Yes' }, { source: 'q', target: 'b', label: 'YES' }] })
    expect(report.valid).toBe(true)
    expect(codes(report)).toEqual(expect.arrayContaining(['duplicate_outcomes', 'empty_container', 'external_image']))
    expect(report.findings.find((finding) => finding.code === 'external_image')?.severity).toBe('info')
  })

  it('bounds readability findings for a large valid draft', () => {
    const report = auditDiagram({ nodes: Array.from({ length: 500 }, (_, index) => step(`n${index}`, '')), edges: [] })
    expect(report.valid).toBe(true)
    expect(report.findings.length).toBeLessThanOrEqual(60)
    expect(report.metrics.connectedComponents).toBe(500)
  })
})

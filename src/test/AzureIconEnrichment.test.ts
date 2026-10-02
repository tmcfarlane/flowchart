import { describe, expect, it } from 'vitest'
import { normalizeAIProposal } from '../shared/aiProposal'
import { resolveAzureIcons } from '../utils/azureIconRegistry'
import { getIconUrl } from '../utils/azureIconIds'

describe('AI illustration enrichment preserves diagram meaning', () => {
  it('keeps architecture types, explicit artwork and the container hierarchy valid', () => {
    const proposal = normalizeAIProposal({ summary: 'An Azure architecture', nodes: [
      { id: 'region', type: 'container', label: 'Azure Kubernetes Service', containerKind: 'cluster', position: { x: 0, y: 0 } },
      { id: 'db', type: 'database', label: 'Cosmos DB', icon: 'Azure Cosmos DB', parentNode: 'region', position: { x: 30, y: 40 }, width: 180, height: 100 },
      { id: 'api', type: 'service', label: 'Azure Functions', parentNode: 'region', position: { x: 230, y: 40 } },
      { id: 'question', type: 'decision', label: 'Use Azure Functions?', position: { x: 0, y: 300 } },
      { id: 'note', type: 'note', label: 'Azure Cosmos DB', position: { x: 200, y: 300 } },
      { id: 'art', type: 'image', label: 'Azure Cosmos DB', icon: 'Moon', position: { x: 400, y: 300 } },
    ], edges: [{ id: 'read', source: 'api', target: 'db', protocol: 'SQL', commStyle: 'sync' }] })
    const enriched = resolveAzureIcons(proposal)
    expect(enriched).toEqual(proposal)
    expect(normalizeAIProposal(enriched)).toEqual(proposal)
    expect(getIconUrl(enriched.nodes[1].icon!)).toBeTruthy()
    expect(getIconUrl(enriched.nodes[5].icon!)).toBeTruthy()
  })

  it('infers local images only for new eligible plain steps and leaves edit proposals unchanged', () => {
    const proposal = normalizeAIProposal({ summary: 'Azure data flow', nodes: [{ id: 'a', type: 'step', label: 'Cosmos DB', position: { x: 0, y: 0 } }], edges: [] })
    const inserted = resolveAzureIcons(proposal, { intent: 'insert' })
    expect(inserted.nodes[0].type).toBe('image')
    expect(inserted.nodes[0].imageUrl).toBeTruthy()
    expect(inserted.nodes[0].imageUrl).not.toMatch(/^https?:/)
    expect(proposal.nodes[0].type).toBe('step')
    expect(resolveAzureIcons(proposal, { intent: 'edit' })).toBe(proposal)
  })
})

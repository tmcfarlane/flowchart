// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// The generator is plain Node ESM so it can run before dependencies are compiled.
import { OUTPUT_FILE, buildIconIndex, serializeIconIndex } from '../../../scripts/generate-azure-icon-index.mjs'
import { AZURE_ICONS, ICON_CATALOG, getAzureIcon, getIcon, iconIdFromPath, resolveIconRef, searchAzureIcons, searchIcons } from '../../shared/icons'
import { DIAGRAM_ICONS } from '../../shared/diagramIcons'

const ids = (query: string, options?: { limit?: number; category?: string }) =>
  searchAzureIcons(query, options).map((r) => r.id)

describe('Azure icon index', () => {
  it('is up to date with assets/icons (run `npm run icons:index` if this fails)', () => {
    expect(readFileSync(OUTPUT_FILE, 'utf-8')).toBe(serializeIconIndex(buildIconIndex()))
  })

  it('uses the same ids the browser derives from file paths', () => {
    expect(AZURE_ICONS.length).toBeGreaterThan(600)
    for (const icon of AZURE_ICONS) expect(iconIdFromPath(icon.path)).toBe(icon.id)
    expect(new Set(AZURE_ICONS.map((i) => i.id)).size).toBe(AZURE_ICONS.length)
  })

  it('has readable names and categories', () => {
    expect(getAzureIcon('azure-cosmos-db')).toMatchObject({ name: 'Azure Cosmos DB', category: 'databases' })
    expect(getAzureIcon('microsoft-entra-id')).toMatchObject({ name: 'Microsoft Entra ID' })
  })
})

describe('original local diagram icons', () => {
  it('uses fixed, unique ids and self-contained SVGs without active or external content', () => {
    expect(DIAGRAM_ICONS.length).toBeGreaterThanOrEqual(60)
    expect(new Set(ICON_CATALOG.map((icon) => icon.id)).size).toBe(ICON_CATALOG.length)
    for (const icon of DIAGRAM_ICONS) {
      expect(icon.id).toMatch(/^icon-[a-z0-9-]+$/)
      expect(icon.path).toBe(`/assets/diagram-icons/${icon.id}.svg`)
      const svg = readFileSync(new URL(`../../..${icon.path}`, import.meta.url), 'utf8')
      expect(svg).toContain('viewBox="0 0 64 64"')
      expect(svg).not.toMatch(/<script|<foreignObject|<image|href=|url\(|\bon[a-z]+\s*=|<style|<text/i)
      expect(getIcon(icon.id)).toMatchObject({ provider: 'flowchart', name: icon.name })
    }
  })

  it('searches concepts and filters providers while preserving Azure aliases', () => {
    expect(searchIcons('payment')[0].id).toBe('icon-credit-card')
    expect(searchIcons('portal', { provider: 'flowchart' })[0].id).toBe('icon-portal')
    expect(searchIcons('cosmos', { provider: 'azure' })[0].id).toBe('azure-cosmos-db')
    expect(searchIcons('dream', { category: 'cosmic' }).map((icon) => icon.id)).toContain('icon-moon')
    expect(searchIcons('robot', { provider: 'azure' }).every((icon) => icon.provider === 'azure')).toBe(true)
    expect(searchIcons('database', { limit: 2 })).toHaveLength(2)
    expect(searchIcons('')).toEqual([])
    expect(searchIcons('impossiblymissing')).toEqual([])
  })

  it('resolves local ids and display names without accepting paths or destinations', () => {
    expect(resolveIconRef('icon-portal').icon?.id).toBe('icon-portal')
    expect(resolveIconRef('AI assistant').icon?.id).toBe('icon-robot')
    expect(resolveIconRef('robot').icon?.id).toBe('icon-robot')
    for (const ref of ['/etc/passwd', '../../assets/diagram-icons/icon-robot.svg', 'https://example.com/robot.svg', 'javascript:alert(1)', '__proto__']) {
      expect(getIcon(ref)).toBeUndefined()
      expect(resolveIconRef(ref).icon).toBeUndefined()
    }
  })
})

describe('searchAzureIcons', () => {
  it('ranks the obvious service first for names, aliases and abbreviations', () => {
    expect(ids('cosmos')[0]).toBe('azure-cosmos-db')
    expect(ids('Cosmos DB')[0]).toBe('azure-cosmos-db')
    expect(ids('k8s')[0]).toBe('kubernetes-services')
    expect(ids('aks')[0]).toBe('kubernetes-services')
    expect(ids('key vault')[0]).toBe('key-vaults')
    expect(ids('functions')[0]).toBe('function-apps')
    expect(ids('redis')[0]).toBe('cache-redis')
  })

  it('tolerates typos', () => {
    expect(ids('cosmoss')).toContain('azure-cosmos-db')
    expect(ids('kubernetis')).toContain('kubernetes-services')
  })

  it('filters by category and caps the limit', () => {
    const results = searchAzureIcons('sql', { category: 'databases', limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(5)
    expect(results.every((r) => r.category === 'databases')).toBe(true)
    expect(searchAzureIcons('storage', { limit: 500 }).length).toBeLessThanOrEqual(50)
  })

  it('returns nothing for empty or unrelated queries', () => {
    expect(searchAzureIcons('   ')).toEqual([])
    expect(searchAzureIcons('zzzzqqqq')).toEqual([])
  })
})

describe('resolveIconRef', () => {
  it('preserves every canonical catalog id before considering overlapping illustration aliases', () => {
    for (const icon of ICON_CATALOG) {
      expect(resolveIconRef(icon.id, { suggest: false }).icon?.id, icon.id).toBe(icon.id)
    }
    expect(resolveIconRef('browser').icon?.id).toBe('browser')
    expect(resolveIconRef('icon-browser').icon?.id).toBe('icon-browser')
  })
  it('accepts ids, display names and aliases', () => {
    expect(resolveIconRef('azure-cosmos-db').icon?.id).toBe('azure-cosmos-db')
    expect(resolveIconRef('Azure Cosmos DB').icon?.id).toBe('azure-cosmos-db')
    expect(resolveIconRef('app service').icon?.id).toBe('app-services')
    expect(resolveIconRef('Azure Key Vaults').icon?.id).toBe('key-vaults')
  })

  it('suggests close matches for unknown references', () => {
    const result = resolveIconRef('cosmoss')
    expect(result.icon).toBeUndefined()
    expect(result.suggestions.map((s) => s.id)).toContain('azure-cosmos-db')
  })
})

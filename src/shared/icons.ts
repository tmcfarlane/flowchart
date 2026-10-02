// Local icon lookup for MCP and REST validation. Azure ids remain compatible;
// the original Flowchart set adds general-purpose and imaginative illustrations.

import iconIndex from './generated/azure-icon-index.json' with { type: 'json' }
import { AZURE_ALIASES } from './azureIconAliases.js'
import { slugifyIconName } from './iconIds.js'
import { DIAGRAM_ICONS } from './diagramIcons.js'

export { iconIdFromPath, iconNameFromFile, slugifyIconName } from './iconIds.js'

export interface AzureIcon {
  /** Stable id used in chart documents, e.g. "azure-cosmos-db". */
  id: string
  /** Display name, e.g. "Azure Cosmos DB". */
  name: string
  /** Folder in the Azure icon set, e.g. "databases". */
  category: string
  /** Source path of the SVG, e.g. "/assets/icons/.../10121-icon-service-Azure-Cosmos-DB.svg". */
  path: string
}

export const AZURE_ICONS: readonly AzureIcon[] = (iconIndex as { icons: AzureIcon[] }).icons

export interface CatalogIcon extends AzureIcon {
  provider: 'azure' | 'flowchart'
  keywords?: readonly string[]
}

export const ICON_CATALOG: readonly CatalogIcon[] = [
  ...DIAGRAM_ICONS,
  ...AZURE_ICONS.map((icon) => ({ ...icon, provider: 'azure' as const })),
]

const diagramById = new Map(DIAGRAM_ICONS.map((icon) => [icon.id, icon]))
const diagramByName = new Map(DIAGRAM_ICONS.map((icon) => [slugifyIconName(icon.name), icon]))
const diagramByShortId = new Map(DIAGRAM_ICONS.map((icon) => [icon.id.replace(/^icon-/, ''), icon]))

/** Exact stable-id lookup only. No input is treated as a URL or filesystem path. */
export function getIcon(id: string): CatalogIcon | undefined {
  const diagram = diagramById.get(id)
  if (diagram) return diagram
  const azure = byId.get(id)
  return azure ? { ...azure, provider: 'azure' } : undefined
}

const byId = new Map(AZURE_ICONS.map((icon) => [icon.id, icon]))

const STOPWORDS = new Set(['azure', 'microsoft', 'service', 'services', 'the', 'a', 'an', 'for', 'of', 'and', 'icon'])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0)
}

function meaningful(tokens: string[]): string[] {
  const filtered = tokens.filter((t) => !STOPWORDS.has(t))
  return filtered.length > 0 ? filtered : tokens
}

/** Small edit distance, capped: good enough for typo-tolerant matching of short words. */
function withinEdits(a: string, b: string, maxEdits: number): boolean {
  if (Math.abs(a.length - b.length) > maxEdits) return false
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    let rowMin = prev[0]
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
      rowMin = Math.min(rowMin, prev[j])
    }
    if (rowMin > maxEdits) return false
  }
  return prev[b.length] <= maxEdits
}

function fuzzyTokenMatch(token: string, candidates: string[]): boolean {
  if (token.length < 4) return false
  const maxEdits = token.length >= 8 ? 2 : 1
  return candidates.some((c) => c.length >= 3 && withinEdits(token, c, maxEdits))
}

/** alias phrase (normalized) -> icon ids it points to */
const aliasIndex = new Map<string, string[]>()
/** icon id -> extra search keywords taken from its aliases */
const aliasKeywords = new Map<string, Set<string>>()

for (const [phrase, target] of Object.entries(AZURE_ALIASES)) {
  const id = slugifyIconName(target)
  if (!byId.has(id)) continue
  const key = tokenize(phrase).join(' ')
  const list = aliasIndex.get(key) ?? []
  if (!list.includes(id)) list.push(id)
  aliasIndex.set(key, list)
  const words = aliasKeywords.get(id) ?? new Set<string>()
  for (const t of tokenize(phrase)) words.add(t)
  aliasKeywords.set(id, words)
}

export function getAzureIcon(id: string): AzureIcon | undefined {
  return byId.get(id)
}

/** Names without "Azure"/"Microsoft"/"service": "Microsoft Entra ID" -> "entra id". First icon wins. */
const byLooseName = new Map<string, AzureIcon>()
for (const icon of AZURE_ICONS) {
  const key = meaningful(tokenize(icon.name)).join(' ')
  if (key && !byLooseName.has(key)) byLooseName.set(key, icon)
}

export interface IconSearchResult extends AzureIcon {
  score: number
}

/**
 * Ranked keyword search over icon names, ids, categories and aliases.
 * "cosmos" -> azure-cosmos-db, "k8s" -> kubernetes-services, "key vault" -> key-vaults.
 */
export function searchAzureIcons(
  query: string,
  options: { limit?: number; category?: string } = {},
): IconSearchResult[] {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50))
  const q = query.trim().toLowerCase()
  const qTokens = meaningful(tokenize(q))
  const categoryFilter = options.category?.trim().toLowerCase()
  if (qTokens.length === 0 && !categoryFilter) return []

  const qKey = tokenize(q).join(' ')
  const qSlug = slugifyIconName(q)
  const aliasHits = new Set(aliasIndex.get(qKey) ?? [])

  const results: IconSearchResult[] = []
  for (const icon of AZURE_ICONS) {
    if (categoryFilter && !icon.category.toLowerCase().includes(categoryFilter)) continue

    const nameTokens = tokenize(icon.name)
    const nameMeaningful = meaningful(nameTokens)
    const extra = aliasKeywords.get(icon.id)
    let score = 0

    if (icon.id === qSlug) score += 100
    if (aliasHits.has(icon.id)) score += 80
    if (nameMeaningful.join(' ') === qTokens.join(' ')) score += 60

    let matched = 0
    for (const token of qTokens) {
      if (nameTokens.includes(token)) {
        score += 12
        matched += 1
      } else if (nameTokens.some((t) => t.startsWith(token) && token.length >= 2)) {
        score += 8
        matched += 1
      } else if (extra?.has(token)) {
        score += 6
        matched += 1
      } else if (token.length >= 4 && icon.id.includes(token)) {
        score += 4
        matched += 1
      } else if (fuzzyTokenMatch(token, nameTokens)) {
        score += 5
        matched += 1
      } else if (icon.category.toLowerCase().includes(token)) {
        score += 2
      }
    }
    if (qTokens.length > 0 && matched === qTokens.length) score += 10
    if (qTokens.length > 0 && matched === 0 && score < 80) continue
    if (!qTokens.length && categoryFilter) score = 1

    // Prefer concise names: "Azure Cosmos DB" over "Azure Cosmos DB for PostgreSQL ...".
    score -= Math.max(0, nameMeaningful.length - qTokens.length) * 0.5

    if (score > 0) results.push({ ...icon, score: Math.round(score * 10) / 10 })
  }

  results.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.id.localeCompare(b.id))
  return results.slice(0, limit)
}

export interface IconResolution {
  icon?: AzureIcon
  suggestions: AzureIcon[]
}

/**
 * Resolve what an agent wrote in a node's `icon` field. Accepts a canonical id
 * ("azure-cosmos-db"), a display name ("Azure Cosmos DB"), or a common alias
 * ("cosmos db", "aks"). Returns suggestions when nothing matches exactly.
 */
export function resolveIconRef(ref: string, options: { suggest?: boolean } = {}): IconResolution {
  const raw = ref.trim()
  if (!raw) return { suggestions: [] }
  const slug = slugifyIconName(raw)
  // Saved stable ids must win over display-name and short-name aliases. For
  // example, Azure's "browser" must not become the newer "icon-browser".
  const direct = diagramById.get(raw) ?? byId.get(raw) ?? diagramById.get(slug) ?? byId.get(slug)
  if (direct) return { icon: direct, suggestions: [] }
  const diagram = diagramByName.get(slug) ?? diagramByShortId.get(slug)
  if (diagram) return { icon: diagram, suggestions: [] }

  const aliasIds = aliasIndex.get(tokenize(raw).join(' '))
  if (aliasIds?.length) {
    const icon = byId.get(aliasIds[0])
    if (icon) return { icon, suggestions: [] }
  }

  const loose = byLooseName.get(meaningful(tokenize(raw)).join(' '))
  if (loose) return { icon: loose, suggestions: [] }

  const withoutPrefix = raw.replace(/^(azure|microsoft)[\s:-]+/i, '')
  if (withoutPrefix !== raw) {
    const again = byId.get(slugifyIconName(withoutPrefix))
    if (again) return { icon: again, suggestions: [] }
  }

  if (options.suggest === false) return { suggestions: [] }
  // Preserve the established Azure correction ordering for legacy documents.
  // Unified search may also match imaginative keywords such as "cosmos".
  const azureSuggestions = searchAzureIcons(raw, { limit: 3 })
  const ids = new Set(azureSuggestions.map((icon) => icon.id))
  return { suggestions: [...azureSuggestions, ...searchIcons(raw, { limit: 3 }).filter((icon) => !ids.has(icon.id))].slice(0, 3) }
}

export function listIconCategories(): string[] {
  return Array.from(new Set(AZURE_ICONS.map((i) => i.category))).sort()
}

export interface CatalogIconSearchResult extends CatalogIcon { score: number }

/** Ranked search across the fixed local catalog, preserving Azure alias search. */
export function searchIcons(
  query: string,
  options: { limit?: number; category?: string; provider?: 'azure' | 'flowchart' } = {},
): CatalogIconSearchResult[] {
  const limit = Math.max(1, Math.min(options.limit ?? 12, 50))
  const tokens = tokenize(query.trim())
  const category = options.category?.trim().toLowerCase()
  if (!tokens.length && !category) return []
  const results: CatalogIconSearchResult[] = options.provider === 'flowchart' ? [] :
    searchAzureIcons(query, { category, limit: 50 }).map((icon) => ({ ...icon, provider: 'azure' as const }))
  if (options.provider !== 'azure') {
    for (const icon of DIAGRAM_ICONS) {
      if (category && !icon.category.includes(category)) continue
      const names = tokenize(icon.name)
      const words = [...names, ...icon.keywords, ...tokenize(icon.id)]
      let score = slugifyIconName(query) === icon.id ? 100 : 0
      if (slugifyIconName(query) === slugifyIconName(icon.name)) score += 60
      let matches = 0
      for (const token of tokens) {
        if (names.includes(token)) { score += 12; matches++ }
        else if (icon.keywords.includes(token)) { score += 9; matches++ }
        else if (words.some((word) => token.length >= 2 && word.startsWith(token))) { score += 7; matches++ }
        else if (fuzzyTokenMatch(token, words)) { score += 5; matches++ }
        else if (icon.category.includes(token)) score += 2
      }
      if (tokens.length && matches === tokens.length) score += 10
      if (tokens.length && matches === 0 && score < 60) continue
      if (!tokens.length && category) score = 1
      if (score > 0) results.push({ ...icon, score })
    }
  }
  return results.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.id.localeCompare(b.id)).slice(0, limit)
}

export function listAllIconCategories(): string[] {
  return Array.from(new Set(ICON_CATALOG.map((icon) => icon.category))).sort()
}

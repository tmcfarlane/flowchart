/**
 * Azure Icon Registry
 *
 * Builds a static lookup map from Azure service names to Vite-resolved SVG URLs
 * at module-load time. Provides deterministic, local-only icon resolution for
 * AI-generated flowchart nodes.
 *
 * Matching priority:
 *   1. Alias match (covers abbreviations and common AI phrasings)
 *   2. Exact normalized match against icon service names
 *   3. Substring match (label contains icon name or vice versa)
 */

import type { BaseFlowNode, BaseFlowEdge } from '../App'
import { AZURE_ALIASES } from '../shared/azureIconAliases'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IconEntry {
  /** The service-name segment from the filename (e.g. "App-Services") */
  serviceName: string
  /** Vite-resolved URL for the SVG asset */
  url: string
}

interface FlowProposal {
  summary?: string
  nodes: BaseFlowNode[]
  edges: BaseFlowEdge[]
}

// ---------------------------------------------------------------------------
// 1. Load all SVGs via Vite's import.meta.glob (eager, build-time resolved)
// ---------------------------------------------------------------------------

// Exported for src/utils/azureIconIds.ts, so the asset map is only emitted once.
export const svgModules = import.meta.glob('/assets/icons/**/*.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

// ---------------------------------------------------------------------------
// 2. Build the icon registry (deduped by service name)
// ---------------------------------------------------------------------------

/** Map of normalized-name → IconEntry */
const iconMap = new Map<string, IconEntry>()

/** Map of raw service-name (lowercase) → IconEntry (for alias resolution) */
const serviceNameMap = new Map<string, IconEntry>()

function extractServiceName(filename: string): string {
  // Remove number prefix: "10035-icon-service-App-Services" → "icon-service-App-Services"
  let name = filename.replace(/^\d+-/, '')
  // Remove "icon-service-" prefix: → "App-Services"
  name = name.replace(/^icon-service-/i, '')
  return name
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[-_]/g, ' ')        // hyphens/underscores → spaces
    .replace(/[()]/g, '')         // strip parentheses
    .replace(/\bazure\b/g, '')    // remove "azure"
    .replace(/\bmicrosoft\b/g, '') // remove "microsoft"
    .replace(/\bservice\b/g, '')  // remove "service" (singular)
    .replace(/\bicon\b/g, '')     // remove "icon"
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim()
}

// Process each SVG module and build the maps
for (const [path, url] of Object.entries(svgModules)) {
  const parts = path.split('/')
  const filename = (parts[parts.length - 1] || '').replace('.svg', '')
  const serviceName = extractServiceName(filename)
  const normalizedName = normalize(serviceName)

  // Deduplicate: keep first occurrence per normalized name
  if (!iconMap.has(normalizedName)) {
    const entry: IconEntry = { serviceName, url }
    iconMap.set(normalizedName, entry)
    serviceNameMap.set(serviceName.toLowerCase(), entry)
  }
}

// ---------------------------------------------------------------------------
// 3. Alias map — common AI phrasings → canonical service-name (lowercase)
// ---------------------------------------------------------------------------

// The alias table lives in src/shared so the MCP server resolves the same phrases.
const ALIASES: Record<string, string> = AZURE_ALIASES

// ---------------------------------------------------------------------------
// 4. Resolve a single alias to an IconEntry via serviceNameMap
// ---------------------------------------------------------------------------

function resolveAlias(aliasTarget: string): IconEntry | undefined {
  return serviceNameMap.get(aliasTarget)
}

// ---------------------------------------------------------------------------
// 5. Public API
// ---------------------------------------------------------------------------

/**
 * Resolves an Azure service label to a local SVG asset URL.
 * Returns null if no match is found.
 */
export function resolveAzureIcon(label: string): string | null {
  const normalizedLabel = normalize(label)
  if (!normalizedLabel) return null

  // --- Priority 1: Alias match ---
  // Check the raw label (lowercased, trimmed) against aliases first
  const labelLower = label.toLowerCase().trim()
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (labelLower === alias || labelLower === `azure ${alias}`) {
      const entry = resolveAlias(target)
      if (entry) return entry.url
    }
  }

  // Also check the normalized label against aliases
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (normalizedLabel === normalize(alias)) {
      const entry = resolveAlias(target)
      if (entry) return entry.url
    }
  }

  // --- Priority 2: Exact normalized match ---
  const exactMatch = iconMap.get(normalizedLabel)
  if (exactMatch) return exactMatch.url

  // --- Priority 3: Substring match ---
  // Check if normalized label contains an icon name, or vice versa.
  // Prefer longer matches (more specific) by sorting candidates by length desc.
  const candidates: { entry: IconEntry; matchLen: number }[] = []

  for (const [normalizedIconName, entry] of iconMap) {
    // Skip very short icon names (< 3 chars) to avoid false positives
    if (normalizedIconName.length < 3) continue

    if (normalizedLabel.includes(normalizedIconName)) {
      candidates.push({ entry, matchLen: normalizedIconName.length })
    } else if (normalizedIconName.includes(normalizedLabel) && normalizedLabel.length >= 3) {
      candidates.push({ entry, matchLen: normalizedLabel.length })
    }
  }

  if (candidates.length > 0) {
    // Sort by match length descending — prefer the most specific match
    candidates.sort((a, b) => b.matchLen - a.matchLen)
    return candidates[0].entry.url
  }

  return null
}

/**
 * Returns true if the flow appears to be Azure-related.
 * Checks node labels and the proposal summary for Azure keywords.
 */
export function isAzureRelatedFlow(
  nodes: BaseFlowNode[],
  summary?: string
): boolean {
  const azureKeywords = [
    'azure',
    'microsoft',
    'cosmos db',
    'cosmosdb',
    'app service',
    'function app',
    'key vault',
    'aks',
    'kubernetes',
    'sql database',
    'blob storage',
    'service bus',
    'event hub',
    'logic app',
    'devops',
    'entra',
    'sentinel',
    'defender',
    'expressroute',
    'signalr',
    'databricks',
    'synapse',
    'redis cache',
    'front door',
    'openai',
    'cognitive',
    'api management',
    'virtual machine',
    'load balancer',
    'virtual network',
    'container instance',
    'container registry',
    'intune',
    'iot hub',
  ]

  const allText = [
    summary || '',
    ...nodes.map((n) => n.label),
  ]
    .join(' ')
    .toLowerCase()

  return azureKeywords.some((kw) => allText.includes(kw))
}

/**
 * Adds illustrations to eligible plain steps in new Azure-related proposals.
 * Architecture types, decisions, notes, explicit artwork and complete edits
 * preserve their authored structure and metadata.
 * Returns a new proposal object (does not mutate the input).
 */
export function resolveAzureIcons(proposal: FlowProposal, options: { intent?: 'insert' | 'edit' } = {}): FlowProposal {
  if (options.intent === 'edit' || !isAzureRelatedFlow(proposal.nodes, proposal.summary)) {
    return proposal
  }

  const enrichedNodes = proposal.nodes.map((node) => {
    // Never infer a different shape for a boundary, architecture component,
    // decision or note, or replace the author's explicit local illustration.
    if (node.icon || node.imageUrl || (node.type !== 'step' && node.type !== 'image')) return node

    const iconUrl = resolveAzureIcon(node.label)
    if (iconUrl) {
      return {
        ...node,
        type: 'image',
        imageUrl: iconUrl,
        // Ensure image nodes have appropriate dimensions
        width: node.width || 140,
        height: node.height || 140,
      }
    }
    return node
  })

  return {
    ...proposal,
    nodes: enrichedNodes,
  }
}

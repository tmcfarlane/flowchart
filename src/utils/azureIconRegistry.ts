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
import { AZURE_ICON_ALIASES } from '../../assets/icon-mappings/azure-icon-aliases'

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

const svgModules = import.meta.glob('/assets/icons/**/*.svg', {
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

const ALIASES: Record<string, string> = {
  // App Services
  'app service': 'app-services',
  'web app': 'app-services',
  'azure web app': 'app-services',

  // Function Apps
  'functions': 'function-apps',
  'azure functions': 'function-apps',
  'function app': 'function-apps',
  'serverless function': 'function-apps',
  'serverless functions': 'function-apps',

  // Key Vault
  'key vault': 'key-vaults',
  'keyvault': 'key-vaults',
  'azure key vault': 'key-vaults',

  // Storage
  'storage': 'storage-accounts',
  'storage account': 'storage-accounts',
  'blob storage': 'storage-accounts',
  'azure storage': 'storage-accounts',
  'azure blob storage': 'storage-accounts',
  'azure blob': 'storage-accounts',

  // Virtual Machines
  'vm': 'virtual-machine',
  'virtual machine': 'virtual-machine',
  'azure vm': 'virtual-machine',

  // SQL Database
  'sql': 'sql-database',
  'sql database': 'sql-database',
  'azure sql': 'sql-database',
  'azure sql database': 'sql-database',
  'sql db': 'sql-database',

  // Cosmos DB
  'cosmos db': 'azure-cosmos-db',
  'cosmosdb': 'azure-cosmos-db',
  'cosmos': 'azure-cosmos-db',
  'azure cosmos db': 'azure-cosmos-db',
  'azure cosmos': 'azure-cosmos-db',
  'azure cosmosdb': 'azure-cosmos-db',

  // Kubernetes / AKS
  'aks': 'kubernetes-services',
  'kubernetes': 'kubernetes-services',
  'azure kubernetes': 'kubernetes-services',
  'azure kubernetes service': 'kubernetes-services',
  'k8s': 'kubernetes-services',

  // API Management
  'api management': 'api-management-services',
  'apim': 'api-management-services',
  'azure api management': 'api-management-services',

  // Application Insights
  'application insights': 'application-insights',
  'app insights': 'application-insights',

  // Load Balancer
  'load balancer': 'load-balancers',
  'azure load balancer': 'load-balancers',

  // Virtual Network
  'vnet': 'virtual-networks',
  'virtual network': 'virtual-networks',
  'azure vnet': 'virtual-networks',

  // Service Bus
  'service bus': 'azure-service-bus',
  'azure service bus': 'azure-service-bus',

  // Logic Apps
  'logic app': 'logic-apps',
  'logic apps': 'logic-apps',
  'azure logic apps': 'logic-apps',
  'azure logic app': 'logic-apps',

  // Application Gateway
  'application gateway': 'application-gateways',
  'app gateway': 'application-gateways',
  'azure application gateway': 'application-gateways',

  // Event Hubs
  'event hub': 'event-hubs',
  'event hubs': 'event-hubs',
  'azure event hubs': 'event-hubs',
  'azure event hub': 'event-hubs',

  // Redis Cache
  'redis': 'cache-redis',
  'redis cache': 'cache-redis',
  'azure cache for redis': 'cache-redis',
  'azure redis': 'cache-redis',
  'azure cache': 'cache-redis',

  // Entra ID / Azure AD
  'entra': 'entra-id',
  'entra id': 'entra-id',
  'azure ad': 'entra-id',
  'azure active directory': 'entra-id',
  'active directory': 'entra-id',
  'aad': 'entra-id',

  // Container Instances
  'container instance': 'container-instances',
  'container instances': 'container-instances',
  'aci': 'container-instances',
  'azure container instances': 'container-instances',

  // Container Registry
  'container registry': 'container-registries',
  'acr': 'container-registries',
  'azure container registry': 'container-registries',

  // Front Door
  'front door': 'front-door-and-cdn-profiles',
  'azure front door': 'front-door-and-cdn-profiles',
  'frontdoor': 'front-door-and-cdn-profiles',

  // Azure OpenAI
  'openai': 'azure-openai',
  'azure openai': 'azure-openai',
  'gpt': 'azure-openai',
  'azure openai service': 'azure-openai',

  // Cognitive Services
  'cognitive services': 'cognitive-services',
  'azure cognitive services': 'cognitive-services',
  'ai services': 'cognitive-services',

  // AI Studio
  'ai studio': 'ai-studio',
  'azure ai studio': 'ai-studio',

  // Bot Service
  'bot service': 'bot-services',
  'azure bot service': 'bot-services',
  'bot': 'bot-services',

  // Machine Learning
  'machine learning': 'machine-learning',
  'azure ml': 'machine-learning',
  'azure machine learning': 'machine-learning',
  'ml': 'machine-learning',

  // DevOps
  'devops': 'azure-devops',
  'azure devops': 'azure-devops',

  // Data Factory
  'data factory': 'data-factories',
  'adf': 'data-factories',
  'azure data factory': 'data-factories',

  // Databricks
  'databricks': 'azure-databricks',
  'azure databricks': 'azure-databricks',

  // Synapse Analytics
  'synapse': 'azure-synapse-analytics',
  'synapse analytics': 'azure-synapse-analytics',
  'azure synapse': 'azure-synapse-analytics',

  // Sentinel
  'sentinel': 'azure-sentinel',
  'azure sentinel': 'azure-sentinel',
  'microsoft sentinel': 'azure-sentinel',

  // Defender for Cloud
  'defender': 'microsoft-defender-for-cloud',
  'defender for cloud': 'microsoft-defender-for-cloud',
  'security center': 'microsoft-defender-for-cloud',
  'azure security center': 'microsoft-defender-for-cloud',

  // Firewall
  'firewall': 'firewalls',
  'azure firewall': 'firewalls',

  // DNS
  'dns': 'dns-zones',
  'azure dns': 'dns-zones',

  // CDN
  'cdn': 'cdn-profiles',
  'azure cdn': 'cdn-profiles',
  'content delivery network': 'cdn-profiles',

  // ExpressRoute
  'expressroute': 'expressroute-circuits',
  'express route': 'expressroute-circuits',
  'azure expressroute': 'expressroute-circuits',

  // SignalR
  'signalr': 'signalr',
  'azure signalr': 'signalr',

  // Static Web Apps
  'static web app': 'static-apps',
  'static web apps': 'static-apps',
  'static app': 'static-apps',
  'swa': 'static-apps',

  // Spring Apps
  'spring apps': 'azure-spring-apps',
  'azure spring apps': 'azure-spring-apps',
  'spring cloud': 'azure-spring-apps',

  // PostgreSQL
  'postgresql': 'azure-database-postgresql-server',
  'postgres': 'azure-database-postgresql-server',
  'azure postgresql': 'azure-database-postgresql-server',
  'azure database for postgresql': 'azure-database-postgresql-server',

  // MySQL
  'mysql': 'azure-database-mysql-server',
  'azure mysql': 'azure-database-mysql-server',
  'azure database for mysql': 'azure-database-mysql-server',

  // Event Grid
  'event grid': 'event-grid-topics',
  'azure event grid': 'event-grid-topics',

  // Service Fabric
  'service fabric': 'service-fabric-clusters',
  'azure service fabric': 'service-fabric-clusters',

  // Batch
  'batch': 'batch-accounts',
  'azure batch': 'batch-accounts',

  // Notification Hubs
  'notification hub': 'notification-hubs',
  'notification hubs': 'notification-hubs',
  'push notifications': 'notification-hubs',

  // VPN Gateway
  'vpn': 'virtual-network-gateways',
  'vpn gateway': 'virtual-network-gateways',
  'azure vpn': 'virtual-network-gateways',

  // Bastion
  'bastion': 'bastions',
  'azure bastion': 'bastions',

  // NAT Gateway
  'nat gateway': 'nat',
  'nat': 'nat',

  // DDoS Protection
  'ddos': 'ddos-protection-plans',
  'ddos protection': 'ddos-protection-plans',

  // VM Scale Sets
  'vm scale set': 'vm-scale-sets',
  'vmss': 'vm-scale-sets',
  'scale set': 'vm-scale-sets',
  'virtual machine scale set': 'vm-scale-sets',

  // App Configuration
  'app configuration': 'app-configuration',
  'azure app configuration': 'app-configuration',

  // Cognitive Search / AI Search
  'cognitive search': 'cognitive-search',
  'ai search': 'cognitive-search',
  'azure search': 'cognitive-search',
  'azure ai search': 'cognitive-search',

  // Speech Services
  'speech': 'speech-services',
  'speech service': 'speech-services',
  'azure speech': 'speech-services',

  // Form Recognizer
  'form recognizer': 'form-recognizers',
  'document intelligence': 'form-recognizers',
  'azure form recognizer': 'form-recognizers',

  // Computer Vision
  'computer vision': 'computer-vision',
  'azure computer vision': 'computer-vision',

  // Content Safety
  'content safety': 'content-safety',
  'azure content safety': 'content-safety',

  // Monitor / Application Insights overlap
  'monitor': 'application-insights',
  'azure monitor': 'application-insights',

  // Data Lake
  'data lake': 'data-lake-storage-gen1',
  'azure data lake': 'data-lake-storage-gen1',

  // NetApp
  'netapp': 'azure-netapp-files',
  'azure netapp files': 'azure-netapp-files',

  // Power BI
  'power bi': 'power-bi-embedded',
  'powerbi': 'power-bi-embedded',

  // Intune
  'intune': 'intune',
  'azure intune': 'intune',
  'microsoft intune': 'intune',

  // Network Security Group
  'nsg': 'network-security-groups',
  'network security group': 'network-security-groups',

  // Traffic Manager
  'traffic manager': 'traffic-manager-profiles',
  'azure traffic manager': 'traffic-manager-profiles',

  // WAF
  'waf': 'web-application-firewall-policies(waf)',
  'web application firewall': 'web-application-firewall-policies(waf)',

  // Relay
  'relay': 'relays',
  'azure relay': 'relays',

  // IoT Hub (check iot directory)
  'iot hub': 'iot-hub',
  'iot': 'iot-hub',
  'azure iot hub': 'iot-hub',
  'azure iot': 'iot-hub',

  // Extended aliases from comprehensive mapping
  ...AZURE_ICON_ALIASES,
}

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
 * Post-processes an AI proposal: for any node whose label matches an
 * Azure service icon, upgrades it to an image node with the local SVG URL.
 * Only runs if the flow appears Azure-related (to avoid false positives).
 * Returns a new proposal object (does not mutate the input).
 */
export function resolveAzureIcons(proposal: FlowProposal): FlowProposal {
  if (!isAzureRelatedFlow(proposal.nodes, proposal.summary)) {
    return proposal
  }

  const enrichedNodes = proposal.nodes.map((node) => {
    // Skip nodes that already have an imageUrl set
    if (node.imageUrl) return node

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

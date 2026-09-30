// Shared flowchart document model used by the browser app, the REST API
// (api/flows) and the MCP server (api/mcp). Dependency-free on purpose: the
// browser imports this module, so it must not pull in zod, elkjs or icon data.

export const NODE_TYPES = [
  'step',
  'decision',
  'note',
  'image',
  'service',
  'database',
  'queue',
  'cache',
  'apiGateway',
  'externalActor',
  'container',
] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const ARCH_NODE_TYPES = ['service', 'database', 'queue', 'cache', 'apiGateway', 'externalActor'] as const
export type ArchNodeType = (typeof ARCH_NODE_TYPES)[number]

/** Node types that render an icon (image nodes show it large, architecture nodes as a glyph). */
export const ICON_NODE_TYPES: readonly NodeType[] = ['image', ...ARCH_NODE_TYPES]

export const CONTAINER_KINDS = ['group', 'vpc', 'cluster', 'region', 'zone', 'trustBoundary'] as const
export type ContainerKind = (typeof CONTAINER_KINDS)[number]

export const EDGE_STYLES = ['default', 'animated', 'step'] as const
export type EdgeStyle = (typeof EDGE_STYLES)[number]

export const HANDLE_POSITIONS = ['top', 'right', 'bottom', 'left'] as const
export type HandlePosition = (typeof HANDLE_POSITIONS)[number]

export const EDGE_PROTOCOLS = ['HTTPS', 'gRPC', 'REST', 'SQL', 'WebSocket', 'event'] as const
export type EdgeProtocol = (typeof EDGE_PROTOCOLS)[number]

export const COMM_STYLES = ['sync', 'async'] as const
export type CommStyle = (typeof COMM_STYLES)[number]

export const LAYOUT_DIRECTIONS = ['TB', 'LR'] as const
export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number]

export const LIMITS = {
  maxNodes: 500,
  maxEdges: 1000,
  maxBodyBytes: 256 * 1024,
  /** Serialized size of a stored chart (after applying operations). */
  maxChartBytes: 256 * 1024,
  maxOperations: 200,
  maxTitleLength: 200,
  maxLabelLength: 500,
  maxEdgeLabelLength: 200,
  maxIdLength: 100,
  maxEdgeIdLength: 200,
  maxImageUrlLength: 100_000,
  minNodeSize: 20,
  maxNodeSize: 5000,
  maxCoordinate: 1_000_000,
} as const

export interface Position {
  x: number
  y: number
}

/** A node as stored and returned by the API. Positions of nodes inside a container are relative to the container. */
export interface ChartNode {
  id: string
  type: NodeType
  label: string
  position: Position
  width?: number
  height?: number
  /** Stable Azure icon id (see search_azure_icons), e.g. "azure-cosmos-db". */
  icon?: string
  /** External image (https:// URL) or an image uploaded in the browser (data:image/...). */
  imageUrl?: string
  /** Id of the container node this node is nested in. */
  parentNode?: string
  /** Container nodes only. */
  containerKind?: ContainerKind
}

/** A node before layout: the position may still be missing. */
export type DraftNode = Omit<ChartNode, 'position'> & { position?: Position }

export interface ChartEdge {
  id: string
  source: string
  target: string
  label?: string
  style?: EdgeStyle
  sourceHandle?: HandlePosition
  targetHandle?: HandlePosition
  protocol?: EdgeProtocol
  commStyle?: CommStyle
}

export interface ChartContent {
  title: string
  nodes: ChartNode[]
  edges: ChartEdge[]
}

/** Who made the latest change: an AI agent through MCP, or a client of the REST API (usually the browser). */
export type UpdateSource = 'mcp' | 'api'

export interface Chart extends ChartContent {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  updatedVia?: UpdateSource
}

export interface NodeTypeInfo {
  type: NodeType
  category: 'flowchart' | 'architecture' | 'grouping'
  description: string
  defaultSize: { width: number; height: number }
  supportsIcon: boolean
}

export const NODE_TYPE_INFO: Record<NodeType, NodeTypeInfo> = {
  step: {
    type: 'step',
    category: 'flowchart',
    description: 'A process step or action, e.g. "Send welcome email". The default building block (rounded green box).',
    defaultSize: { width: 180, height: 80 },
    supportsIcon: false,
  },
  decision: {
    type: 'decision',
    category: 'flowchart',
    description:
      'A yes/no question or branch point, e.g. "Payment succeeded?" (orange diamond). Give each outgoing edge a short label such as "Yes"/"No".',
    defaultSize: { width: 160, height: 160 },
    supportsIcon: false,
  },
  note: {
    type: 'note',
    category: 'flowchart',
    description: 'A sticky-note annotation for tips or context. Usually not connected to other nodes.',
    defaultSize: { width: 200, height: 110 },
    supportsIcon: false,
  },
  image: {
    type: 'image',
    category: 'flowchart',
    description:
      'A large icon with a caption, typically an Azure service such as "Azure Cosmos DB". Requires `icon` (an id from search_azure_icons) or `imageUrl` (https).',
    defaultSize: { width: 140, height: 140 },
    supportsIcon: true,
  },
  service: {
    type: 'service',
    category: 'architecture',
    description: 'An application service, API, worker, or microservice. Optional `icon` renders as a small glyph.',
    defaultSize: { width: 180, height: 90 },
    supportsIcon: true,
  },
  database: {
    type: 'database',
    category: 'architecture',
    description: 'A database or persistent data store (cylinder).',
    defaultSize: { width: 160, height: 110 },
    supportsIcon: true,
  },
  queue: {
    type: 'queue',
    category: 'architecture',
    description: 'A message queue, topic, or event stream.',
    defaultSize: { width: 200, height: 80 },
    supportsIcon: true,
  },
  cache: {
    type: 'cache',
    category: 'architecture',
    description: 'A cache such as Redis.',
    defaultSize: { width: 160, height: 90 },
    supportsIcon: true,
  },
  apiGateway: {
    type: 'apiGateway',
    category: 'architecture',
    description: 'An API gateway, load balancer, or ingress (hexagon).',
    defaultSize: { width: 180, height: 100 },
    supportsIcon: true,
  },
  externalActor: {
    type: 'externalActor',
    category: 'architecture',
    description: 'A person or external system: end user, partner, third-party API.',
    defaultSize: { width: 150, height: 110 },
    supportsIcon: true,
  },
  container: {
    type: 'container',
    category: 'grouping',
    description:
      'A labeled boundary that groups other nodes (VPC, cluster, region, zone, trust boundary, or generic group). Nodes join it by setting `parentNode` to its id; the server sizes it to fit.',
    defaultSize: { width: 420, height: 300 },
    supportsIcon: false,
  },
}

export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value)
}

export function isHandlePosition(value: unknown): value is HandlePosition {
  return typeof value === 'string' && (HANDLE_POSITIONS as readonly string[]).includes(value)
}

export function isArchitectureChart(nodes: ReadonlyArray<{ type: string }>): boolean {
  return nodes.some(
    (n) => n.type === 'container' || (ARCH_NODE_TYPES as readonly string[]).includes(n.type),
  )
}

/**
 * When a communication style is set, it decides solid (sync) vs dashed (async)
 * rendering, so "animated" is redundant and normalizes to "default". This keeps
 * the stored document and the browser's rendering in agreement.
 */
export function canonicalEdgeStyle(style: EdgeStyle | undefined, commStyle: CommStyle | undefined): EdgeStyle {
  const s = style ?? 'animated'
  if (commStyle && s === 'animated') return 'default'
  return s
}

// Rough text metrics for the node label fonts (14px, weight 500).
const CHAR_WIDTH = 7.6
const LINE_HEIGHT = 19

function countLines(text: string, charsPerLine: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  let lines = 1
  let current = 0
  for (const word of words) {
    const len = Math.min(word.length, charsPerLine)
    if (current === 0) current = len
    else if (current + 1 + len <= charsPerLine) current += 1 + len
    else {
      lines += 1
      current = len
    }
  }
  return lines
}

/** Default rendered size for a node, growing with long labels so text never overflows. */
export function estimateNodeSize(type: NodeType, label: string): { width: number; height: number } {
  const base = NODE_TYPE_INFO[type]?.defaultSize ?? NODE_TYPE_INFO.step.defaultSize
  const text = label ?? ''
  switch (type) {
    case 'step':
    case 'note': {
      let width = base.width
      const padX = 44
      let lines = countLines(text, Math.floor((width - padX) / CHAR_WIDTH))
      if (lines > 3) {
        width = type === 'note' ? 240 : 220
        lines = countLines(text, Math.floor((width - padX) / CHAR_WIDTH))
      }
      return { width, height: Math.max(base.height, Math.ceil(40 + lines * LINE_HEIGHT)) }
    }
    case 'decision': {
      const side = text.length <= 18 ? 160 : text.length <= 34 ? 190 : text.length <= 60 ? 220 : 250
      return { width: side, height: side }
    }
    case 'image':
      return { ...base }
    case 'container':
      return { ...base }
    default: {
      // Architecture nodes: a glyph above one or two lines of text.
      const padX = 36
      const lines = countLines(text, Math.floor((base.width - padX) / CHAR_WIDTH))
      const width = lines > 2 ? Math.min(260, base.width + 40) : base.width
      return { width, height: base.height }
    }
  }
}

/** Next free numeric id, so ids created in the browser never collide with ids an agent chose. */
export function nextNumericNodeId(nodes: ReadonlyArray<{ id: string }>, floor = 1): number {
  let max = floor - 1
  for (const n of nodes) {
    if (/^\d+$/.test(n.id)) max = Math.max(max, Number(n.id))
  }
  return max + 1
}

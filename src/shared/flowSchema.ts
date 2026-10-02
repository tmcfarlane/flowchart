// Zod schemas and semantic validation for chart documents. Used by the REST API
// and the MCP server so both reject bad input with the same precise, fixable
// messages. The browser does not import this module (it would pull in zod).

import { z } from 'zod'
import {
  CONTAINER_KINDS,
  COMM_STYLES,
  EDGE_PROTOCOLS,
  EDGE_STYLES,
  HANDLE_POSITIONS,
  ICON_NODE_TYPES,
  LAYOUT_DIRECTIONS,
  LIMITS,
  NODE_TYPES,
  canonicalEdgeStyle,
  type ChartEdge,
  type DraftNode,
} from './flowTypes.js'

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const describeInput = (input: unknown) => (input === undefined ? 'nothing' : JSON.stringify(input))

function idSchema(what: string, maxLength: number = LIMITS.maxIdLength) {
  return z
    .string({ error: (iss) => (iss.input === undefined ? `${what} is required` : `${what} must be a string`) })
    .min(1, `${what} must not be empty`)
    .max(maxLength, `${what} must be at most ${maxLength} characters`)
    .regex(/^[^\u0000-\u001f\u007f]+$/, `${what} must not contain control characters`)
    .regex(/\S/, `${what} must not be blank`)
}

function enumSchema<const T extends readonly [string, ...string[]]>(values: T, what: string) {
  return z.enum(values, {
    error: (iss) =>
      iss.input === undefined
        ? `${what} is required: one of ${values.join(', ')}`
        : `${describeInput(iss.input)} is not a valid ${what}. Use one of: ${values.join(', ')}`,
  })
}

export const NodeTypeSchema = enumSchema(NODE_TYPES, 'node type')
export const ContainerKindSchema = enumSchema(CONTAINER_KINDS, 'containerKind')
export const EdgeStyleSchema = enumSchema(EDGE_STYLES, 'edge style')
export const HandleSchema = enumSchema(HANDLE_POSITIONS, 'handle')
export const ProtocolSchema = enumSchema(EDGE_PROTOCOLS, 'protocol')
export const CommStyleSchema = enumSchema(COMM_STYLES, 'commStyle')
export const DirectionSchema = enumSchema(LAYOUT_DIRECTIONS, 'layout direction')

const coordinate = (axis: string) =>
  z
    .number({ error: `position.${axis} must be a number` })
    .min(-LIMITS.maxCoordinate, `position.${axis} is out of range`)
    .max(LIMITS.maxCoordinate, `position.${axis} is out of range`)

export const PositionSchema = z
  .strictObject({ x: coordinate('x'), y: coordinate('y') })
  .describe('Top-left corner in canvas pixels (x grows right, y grows down).')

const sizeSchema = (what: string) =>
  z
    .number({ error: `${what} must be a number` })
    .min(LIMITS.minNodeSize, `${what} must be at least ${LIMITS.minNodeSize}`)
    .max(LIMITS.maxNodeSize, `${what} must be at most ${LIMITS.maxNodeSize}`)

const labelSchema = z
  .string({ error: (iss) => (iss.input === undefined ? 'label is required' : 'label must be a string') })
  .max(LIMITS.maxLabelLength, `label must be at most ${LIMITS.maxLabelLength} characters`)

const iconSchema = z.string({ error: 'icon must be a string' }).max(120, 'icon must be at most 120 characters')
const imageUrlSchema = z
  .string({ error: 'imageUrl must be a string' })
  .max(LIMITS.maxImageUrlLength, `imageUrl must be at most ${LIMITS.maxImageUrlLength} characters`)

export const TitleSchema = z
  .string({ error: (iss) => (iss.input === undefined ? 'title is required' : 'title must be a string') })
  .trim()
  .min(1, 'title must not be empty')
  .max(LIMITS.maxTitleLength, `title must be at most ${LIMITS.maxTitleLength} characters`)

// Hints for keys that agents commonly send in React Flow or other diagram shapes.
// A Map, so keys such as "__proto__" or "constructor" never match inherited properties.
const KEY_HINTS = new Map<string, string>([
  ['parent', 'parentNode'],
  ['parentId', 'parentNode'],
  ['parent_id', 'parentNode'],
  ['container', 'parentNode'],
  ['text', 'label'],
  ['name', 'label'],
  ['title', 'label'],
  ['kind', 'type'],
  ['shape', 'type'],
  ['data', 'top-level fields (label, icon, ...)'],
  ['style', 'width/height'],
  ['x', 'position: { x, y }'],
  ['y', 'position: { x, y }'],
  ['size', 'width and height'],
  ['image', 'icon or imageUrl'],
  ['from', 'source'],
  ['to', 'target'],
  ['sourceId', 'source'],
  ['targetId', 'target'],
  ['animated', 'style: "animated"'],
  ['edgeType', 'style'],
])

function unknownKeysError(allowed: string[]) {
  return (iss: { code?: string; keys?: string[] }) => {
    if (iss.code !== 'unrecognized_keys' || !iss.keys) return undefined
    const hints = iss.keys
      .map((k) => (KEY_HINTS.has(k) && !allowed.includes(k) ? `"${k}" -> use ${KEY_HINTS.get(k)}` : null))
      .filter(Boolean)
    return (
      `Unknown field${iss.keys.length > 1 ? 's' : ''} ${iss.keys.map((k) => `"${k}"`).join(', ')}. ` +
      `Allowed fields: ${allowed.join(', ')}.` +
      (hints.length ? ` Hint: ${hints.join('; ')}.` : '')
    )
  }
}

function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, { error: unknownKeysError(Object.keys(shape)) })
}

// ---------------------------------------------------------------------------
// Node and edge input schemas (what agents and the browser send)
// ---------------------------------------------------------------------------

const nodeShape = {
  id: idSchema('node id').describe('Unique node id, e.g. "signup" or "3". Edges and parentNode refer to it.'),
  type: NodeTypeSchema.describe(
    `One of: ${NODE_TYPES.join(', ')}. Flowcharts mostly use step, decision, note and image; see list_node_types.`,
  ),
  label: labelSchema.describe('Text shown on the node. Keep it short: 2-6 words.'),
  position: PositionSchema.nullish().describe(
    'Optional. Omit to let the server auto-layout. Top-left corner in pixels; for nodes inside a container it is relative to the container.',
  ),
  width: sizeSchema('width').nullish().describe('Optional pixel width; by default the server sizes nodes to fit the label.'),
  height: sizeSchema('height').nullish().describe('Optional pixel height.'),
  icon: iconSchema
    .nullish()
    .describe(
      'Local icon id from search_icons or search_azure_icons, e.g. "icon-robot" or "azure-cosmos-db". Only for image nodes (large icon + caption) and architecture nodes (small glyph).',
    ),
  imageUrl: imageUrlSchema
    .nullish()
    .describe('https:// image URL for image nodes when no local icon fits. Prefer icon.'),
  parentNode: idSchema('parentNode')
    .nullish()
    .describe('Id of a "container" node to place this node inside.'),
  containerKind: ContainerKindSchema.nullish().describe(
    `Container nodes only: ${CONTAINER_KINDS.join(' | ')} (default group).`,
  ),
}

export const NodeInputSchema = strictObject(nodeShape).describe('A flowchart node.')
export type NodeInput = z.infer<typeof NodeInputSchema>

const edgeShape = {
  id: idSchema('edge id', LIMITS.maxEdgeIdLength)
    .nullish()
    .describe('Optional unique edge id. Defaults to "e<source>-<target>".'),
  source: idSchema('edge source').describe('Id of the node the arrow starts from.'),
  target: idSchema('edge target').describe('Id of the node the arrow points to.'),
  label: z
    .string({ error: 'edge label must be a string' })
    .max(LIMITS.maxEdgeLabelLength, `edge label must be at most ${LIMITS.maxEdgeLabelLength} characters`)
    .nullish()
    .describe('Short text on the arrow, e.g. "Yes", "No", "Retry". Use it on edges leaving decision nodes.'),
  style: EdgeStyleSchema.nullish().describe(
    'animated (dashed, flowing; default) | default (solid curve) | step (right-angled).',
  ),
  sourceHandle: HandleSchema.nullish().describe(
    'Side of the source node the arrow leaves from: top | right | bottom | left. Omit to pick automatically.',
  ),
  targetHandle: HandleSchema.nullish().describe(
    'Side of the target node the arrow enters: top | right | bottom | left. Omit to pick automatically.',
  ),
  protocol: ProtocolSchema.nullish().describe(
    `Architecture diagrams: ${EDGE_PROTOCOLS.join(' | ')}, shown as a chip on the arrow.`,
  ),
  commStyle: CommStyleSchema.nullish().describe('Architecture diagrams: sync (solid line) or async (dashed line).'),
}

export const EdgeInputSchema = strictObject(edgeShape).describe('An arrow between two nodes.')
export type EdgeInput = z.infer<typeof EdgeInputSchema>

// ---------------------------------------------------------------------------
// Operations for incremental updates
// ---------------------------------------------------------------------------

export const NodeChangesSchema = strictObject({
  label: labelSchema.optional(),
  type: NodeTypeSchema.optional(),
  position: PositionSchema.nullish().describe('New position. null lets the server place the node automatically.'),
  width: sizeSchema('width').nullish().describe('null resets to the default size.'),
  height: sizeSchema('height').nullish().describe('null resets to the default size.'),
  icon: iconSchema.nullish().describe('Local icon id; null removes the icon.'),
  imageUrl: imageUrlSchema.nullish().describe('null removes the image URL.'),
  parentNode: idSchema('parentNode')
    .nullish()
    .describe('Move the node into this container; null moves it out to the top level.'),
  containerKind: ContainerKindSchema.nullish(),
}).describe('Fields to change. Omitted fields stay as they are.')

export const EdgeChangesSchema = strictObject({
  source: idSchema('edge source').optional(),
  target: idSchema('edge target').optional(),
  label: edgeShape.label.describe('New label; null removes it.'),
  style: EdgeStyleSchema.optional(),
  sourceHandle: HandleSchema.nullish().describe('null lets the server choose.'),
  targetHandle: HandleSchema.nullish().describe('null lets the server choose.'),
  protocol: ProtocolSchema.nullish().describe('null removes the protocol.'),
  commStyle: CommStyleSchema.nullish().describe('null removes the sync/async style.'),
}).describe('Fields to change. Omitted fields stay as they are.')

export const OperationSchema = z
  .discriminatedUnion(
    'op',
    [
      strictObject({
        op: z.literal('add_node'),
        node: NodeInputSchema,
      }).describe('Add a node. Omit node.position to place it automatically next to its connections.'),
      strictObject({
        op: z.literal('update_node'),
        id: idSchema('node id'),
        changes: NodeChangesSchema,
      }).describe('Change fields of an existing node.'),
      strictObject({
        op: z.literal('remove_node'),
        id: idSchema('node id'),
      }).describe('Remove a node and every edge connected to it. Children of a removed container stay, moved to the top level.'),
      strictObject({
        op: z.literal('add_edge'),
        edge: EdgeInputSchema,
      }).describe('Add an arrow between two existing (or just added) nodes.'),
      strictObject({
        op: z.literal('update_edge'),
        id: idSchema('edge id', LIMITS.maxEdgeIdLength),
        changes: EdgeChangesSchema,
      }).describe('Change fields of an existing edge.'),
      strictObject({
        op: z.literal('remove_edge'),
        id: idSchema('edge id', LIMITS.maxEdgeIdLength),
      }).describe('Remove an edge.'),
    ],
    {
      error: (iss) =>
        iss.code === 'invalid_union'
          ? 'Each operation needs "op": one of add_node, update_node, remove_node, add_edge, update_edge, remove_edge'
          : undefined,
    },
  )
  .describe('One change to apply. Operations run in order, all or nothing.')
export type Operation = z.infer<typeof OperationSchema>

export const NodesArraySchema = z
  .array(NodeInputSchema)
  .max(LIMITS.maxNodes, `a chart can have at most ${LIMITS.maxNodes} nodes`)
export const EdgesArraySchema = z
  .array(EdgeInputSchema)
  .max(LIMITS.maxEdges, `a chart can have at most ${LIMITS.maxEdges} edges`)
export const OperationsArraySchema = z
  .array(OperationSchema)
  .min(1, 'operations must contain at least one operation')
  .max(LIMITS.maxOperations, `at most ${LIMITS.maxOperations} operations per call`)

// ---------------------------------------------------------------------------
// REST request bodies
// ---------------------------------------------------------------------------

export const CreateFlowBodySchema = strictObject({
  title: TitleSchema.optional(),
  nodes: NodesArraySchema,
  edges: EdgesArraySchema.optional(),
  direction: DirectionSchema.optional(),
})

export const ReplaceFlowBodySchema = strictObject({
  title: TitleSchema.optional(),
  nodes: NodesArraySchema,
  edges: EdgesArraySchema.optional(),
  baseVersion: z.number().int().min(1).optional(),
  direction: DirectionSchema.optional(),
  relayout: z.boolean().optional(),
})

export const PatchFlowBodySchema = strictObject({
  operations: OperationsArraySchema,
  title: TitleSchema.optional(),
  baseVersion: z.number().int().min(1).optional(),
  direction: DirectionSchema.optional(),
  relayout: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Stored chart (output) schemas, used for MCP output schemas and docs
// ---------------------------------------------------------------------------

export const StoredNodeSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  label: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  width: z.number().optional(),
  height: z.number().optional(),
  icon: z.string().optional(),
  imageUrl: z.string().optional(),
  parentNode: z.string().optional(),
  containerKind: z.enum(CONTAINER_KINDS).optional(),
})

export const StoredEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  style: z.enum(EDGE_STYLES).optional(),
  sourceHandle: z.enum(HANDLE_POSITIONS).optional(),
  targetHandle: z.enum(HANDLE_POSITIONS).optional(),
  protocol: z.enum(EDGE_PROTOCOLS).optional(),
  commStyle: z.enum(COMM_STYLES).optional(),
})

export const StoredChartSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedVia: z.enum(['mcp', 'api']).optional(),
  nodes: z.array(StoredNodeSchema),
  edges: z.array(StoredEdgeSchema),
})

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  path: string
  message: string
}

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = ''
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`
    else out += out ? `.${String(part)}` : String(part)
  }
  return out
}

export function issuesFromZod(error: z.ZodError, prefix: ReadonlyArray<PropertyKey> = []): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath([...prefix, ...issue.path]),
    message: issue.message,
  }))
}

export function formatIssues(issues: ValidationIssue[], max = 25): string {
  const lines = issues.slice(0, max).map((i) => (i.path ? `- ${i.path}: ${i.message}` : `- ${i.message}`))
  if (issues.length > max) lines.push(`- ...and ${issues.length - max} more`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Semantic validation and normalization
// ---------------------------------------------------------------------------

export interface IconResolver {
  /** `suggest: false` skips the (comparatively expensive) search for close matches. */
  (ref: string, options?: { suggest?: boolean }): { id?: string; suggestions: Array<{ id: string; name: string }> }
}

export interface EdgeDraft extends Omit<ChartEdge, 'id'> {
  id?: string
}

/** Strip nulls (which mean "absent" on input) and copy only known fields. */
export function nodeFromInput(input: NodeInput): DraftNode {
  const node: DraftNode = { id: input.id, type: input.type, label: input.label }
  if (input.position) node.position = { x: input.position.x, y: input.position.y }
  if (input.width != null) node.width = input.width
  if (input.height != null) node.height = input.height
  if (input.icon != null && input.icon.trim() !== '') node.icon = input.icon.trim()
  if (input.imageUrl != null && input.imageUrl.trim() !== '') node.imageUrl = input.imageUrl.trim()
  if (input.parentNode != null) node.parentNode = input.parentNode
  if (input.containerKind != null) node.containerKind = input.containerKind
  return node
}

export function edgeFromInput(input: EdgeInput): EdgeDraft {
  const edge: EdgeDraft = { source: input.source, target: input.target }
  if (input.id != null) edge.id = input.id
  if (input.label != null && input.label !== '') edge.label = input.label
  if (input.style != null) edge.style = input.style
  if (input.sourceHandle != null) edge.sourceHandle = input.sourceHandle
  if (input.targetHandle != null) edge.targetHandle = input.targetHandle
  if (input.protocol != null) edge.protocol = input.protocol
  if (input.commStyle != null) edge.commStyle = input.commStyle
  return edge
}

/**
 * Edit distance where swapping two adjacent characters counts as one edit
 * ("dnoe" -> "done"). Stops early and returns max + 1 once the distance is
 * known to exceed `max`.
 */
function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > max) return max + 1
  let before = new Uint32Array(m + 1) // row i - 2
  let previous = new Uint32Array(m + 1) // row i - 1
  let current = new Uint32Array(m + 1)
  for (let j = 0; j <= m; j++) previous[j] = j
  for (let i = 1; i <= n; i++) {
    current[0] = i
    let rowMin = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1)
      current[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    const reuse = before
    before = previous
    previous = current
    current = reuse
  }
  return previous[m]
}

export function closestMatch(value: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined
  let bestScore = Infinity
  const lower = value.toLowerCase()
  for (const c of candidates) {
    // Only distances within the acceptance threshold below (and better than the
    // best so far) matter, which keeps this cheap for long ids.
    const threshold = Math.max(1, Math.floor(Math.max(value.length, c.length) / 3))
    const bound = Math.min(bestScore - 1, threshold)
    if (Math.abs(c.length - value.length) > bound) continue
    const d = editDistance(lower, c.toLowerCase(), bound)
    if (d <= bound) {
      bestScore = d
      best = c
    }
  }
  return best
}

function listIds(ids: string[], max = 25): string {
  const shown = ids.slice(0, max).map((id) => JSON.stringify(id))
  return ids.length > max ? `${shown.join(', ')}, ... (${ids.length} total)` : shown.join(', ')
}

/** `detailed: false` skips the "did you mean" search and the id list (for the long tail of a big batch of errors). */
export function unknownNodeMessage(id: string, knownIds: string[], detailed = true): string {
  if (!detailed) return `no node with id ${JSON.stringify(id)}.`
  const guess = closestMatch(id, knownIds)
  return (
    `no node with id ${JSON.stringify(id)}.` +
    (guess ? ` Did you mean ${JSON.stringify(guess)}?` : '') +
    (knownIds.length ? ` Existing node ids: ${listIds(knownIds)}.` : ' The chart has no nodes.')
  )
}

/** Detailed suggestions (closest ids, icon search) are computed for at most this many problems per chart. */
export const MAX_DETAILED_ISSUES = 20
/** At most this many problems are reported per chart; the rest are summarized. */
export const MAX_REPORTED_ISSUES = 100

const UNSAFE_URL_CHARS = /[\s\\\u0000-\u001f\u007f]/

/**
 * Images in shared charts render as <img src> for everyone who opens the link:
 * https URLs, inline data:image/ URLs, or same-origin paths ("/assets/...").
 * Whitespace, control characters and backslashes are refused because browsers
 * strip or normalize them ("/\evil.example" loads from evil.example).
 */
export function isAllowedImageUrl(url: string): boolean {
  if (/^data:image\//i.test(url)) return !/[\u0000-\u001f\u007f]/.test(url)
  if (UNSAFE_URL_CHARS.test(url)) return false
  if (/^\/(?!\/)/.test(url)) return true
  if (!/^https:\/\//i.test(url)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !!parsed.hostname && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

export interface ValidateOptions {
  resolveIcon?: IconResolver
  /** "index" -> nodes[3].icon (create/replace); "id" -> node "db".icon (after operations). */
  refStyle?: 'index' | 'id'
}

export interface ValidatedChart {
  nodes: DraftNode[]
  edges: ChartEdge[]
  issues: ValidationIssue[]
  /** Number of problems found; `issues` lists at most MAX_REPORTED_ISSUES of them. */
  issueCount?: number
}

/**
 * Validate cross-references and node rules, and normalize the document:
 * canonical icon ids, generated edge ids, canonical edge styles and default
 * container kinds. Returns every problem found so an agent can fix them all in
 * one retry.
 */
export function validateChart(nodesIn: DraftNode[], edgesIn: EdgeDraft[], options: ValidateOptions = {}): ValidatedChart {
  const issues: ValidationIssue[] = []
  const refStyle = options.refStyle ?? 'index'
  const nodeRef = (i: number, id: string) => (refStyle === 'id' ? `node ${JSON.stringify(id)}` : `nodes[${i}]`)
  const edgeRef = (i: number, id?: string) =>
    refStyle === 'id' && id ? `edge ${JSON.stringify(id)}` : `edges[${i}]`

  if (nodesIn.length > LIMITS.maxNodes) {
    issues.push({ path: 'nodes', message: `too many nodes (${nodesIn.length}); the limit is ${LIMITS.maxNodes}` })
  }
  if (edgesIn.length > LIMITS.maxEdges) {
    issues.push({ path: 'edges', message: `too many edges (${edgesIn.length}); the limit is ${LIMITS.maxEdges}` })
  }

  // Unique ids
  const firstIndex = new Map<string, number>()
  nodesIn.forEach((node, i) => {
    const prev = firstIndex.get(node.id)
    if (prev !== undefined) {
      issues.push({
        path: `${nodeRef(i, node.id)}.id`,
        message: `duplicate node id ${JSON.stringify(node.id)} (also used by nodes[${prev}]). Node ids must be unique.`,
      })
    } else {
      firstIndex.set(node.id, i)
    }
  })
  const byId = new Map(nodesIn.map((n) => [n.id, n]))
  const knownIds = Array.from(firstIndex.keys())
  // Suggestions cost CPU (edit distances, icon search); a huge batch of broken
  // references only gets them for the first few problems.
  let detailed = 0
  const detail = () => ++detailed <= MAX_DETAILED_ISSUES
  const unknownNode = (id: string) => unknownNodeMessage(id, knownIds, detail())

  const nodes: DraftNode[] = nodesIn.map((input, i) => {
    const node: DraftNode = { ...input }
    const ref = nodeRef(i, node.id)

    // Icons
    if (node.icon !== undefined) {
      if (!ICON_NODE_TYPES.includes(node.type)) {
        issues.push({
          path: `${ref}.icon`,
          message:
            `"${node.type}" nodes don't show icons. Use type "image" (large icon with caption) or an architecture type ` +
            `(service, database, queue, cache, apiGateway, externalActor), or remove "icon".`,
        })
      } else if (options.resolveIcon) {
        const resolved = options.resolveIcon(node.icon, { suggest: detailed < MAX_DETAILED_ISSUES })
        if (resolved.id) {
          node.icon = resolved.id
        } else {
          const tips = detail() ? resolved.suggestions.map((s) => `"${s.id}" (${s.name})`) : []
          issues.push({
            path: `${ref}.icon`,
            message:
              `unknown icon ${JSON.stringify(node.icon)}.` +
              (tips.length ? ` Did you mean ${tips.join(', ')}?` : '') +
              ' Use search_icons or search_azure_icons to find valid local icon ids.',
          })
        }
      }
      if (node.imageUrl !== undefined) delete node.imageUrl // the icon wins
    }

    if (node.imageUrl !== undefined) {
      if (!ICON_NODE_TYPES.includes(node.type)) {
        issues.push({
          path: `${ref}.imageUrl`,
          message: `"${node.type}" nodes don't show images. Use type "image" or remove "imageUrl".`,
        })
      } else if (!isAllowedImageUrl(node.imageUrl)) {
        issues.push({
          path: `${ref}.imageUrl`,
          message:
            'must be an https:// URL (or a data:image/ URL) without spaces or backslashes. Prefer "icon" with an id from search_icons or search_azure_icons.',
        })
      }
    }

    if (node.type === 'image' && node.icon === undefined && node.imageUrl === undefined) {
      issues.push({
        path: ref,
        message:
          'image nodes need an "icon" (local icon id from search_icons or search_azure_icons) or an "imageUrl". Use type "step" for a plain box.',
      })
    }

    // Containers
    if (node.type === 'container') {
      node.containerKind = node.containerKind ?? 'group'
    } else if (node.containerKind !== undefined) {
      issues.push({
        path: `${ref}.containerKind`,
        message: `containerKind is only valid on "container" nodes (this node is a "${node.type}").`,
      })
      delete node.containerKind
    }

    if (node.parentNode !== undefined) {
      const parent = byId.get(node.parentNode)
      if (node.parentNode === node.id) {
        issues.push({ path: `${ref}.parentNode`, message: "a node can't be its own parent." })
      } else if (!parent) {
        issues.push({ path: `${ref}.parentNode`, message: unknownNode(node.parentNode) })
      } else if (parent.type !== 'container') {
        issues.push({
          path: `${ref}.parentNode`,
          message: `node ${JSON.stringify(parent.id)} is a "${parent.type}", but only "container" nodes can hold other nodes.`,
        })
      }
    }
    return node
  })

  // Nesting cycles (a -> b -> a)
  const reported = new Set<string>()
  nodes.forEach((node, i) => {
    const chain = [node.id]
    const seen = new Set(chain)
    let current = node.parentNode ? byId.get(node.parentNode) : undefined
    while (current) {
      if (seen.has(current.id)) {
        if (!reported.has(node.id)) {
          chain.push(current.id)
          issues.push({
            path: `${nodeRef(i, node.id)}.parentNode`,
            message: `containers are nested in a cycle (${chain.join(' -> ')}).`,
          })
          chain.forEach((id) => reported.add(id))
        }
        break
      }
      seen.add(current.id)
      chain.push(current.id)
      current = current.parentNode ? byId.get(current.parentNode) : undefined
    }
  })

  // Edges
  const edgeIds = new Map<string, number>()
  const edges: ChartEdge[] = []
  edgesIn.forEach((input, i) => {
    const ref = edgeRef(i, input.id)
    let ok = true
    for (const end of ['source', 'target'] as const) {
      if (!byId.has(input[end])) {
        issues.push({ path: `${ref}.${end}`, message: unknownNode(input[end]) })
        ok = false
      }
    }
    if (input.id !== undefined) {
      const prev = edgeIds.get(input.id)
      if (prev !== undefined) {
        issues.push({
          path: `${ref}.id`,
          message: `duplicate edge id ${JSON.stringify(input.id)} (also used by edges[${prev}]). Omit edge ids to have them generated.`,
        })
        ok = false
      } else {
        edgeIds.set(input.id, i)
      }
    }
    if (!ok) return
    const { id, ...rest } = input
    const edge: ChartEdge = { id: id ?? '', ...rest }
    edge.style = canonicalEdgeStyle(input.style, input.commStyle)
    edges.push(edge)
  })

  // Generate ids for edges that have none: "e<source>-<target>", suffixed when taken.
  const taken = new Set(edges.map((e) => e.id).filter(Boolean))
  for (const edge of edges) {
    if (edge.id) continue
    const base = `e${edge.source}-${edge.target}`.slice(0, LIMITS.maxEdgeIdLength - 4)
    let candidate = base
    let n = 2
    while (taken.has(candidate)) candidate = `${base}-${n++}`
    edge.id = candidate
    taken.add(candidate)
  }

  if (issues.length > MAX_REPORTED_ISSUES) {
    const more = issues.length - MAX_REPORTED_ISSUES
    issues.length = MAX_REPORTED_ISSUES
    issues.push({ path: '', message: `...and ${more} more problem${more === 1 ? '' : 's'} like these.` })
    return { nodes, edges, issues, issueCount: MAX_REPORTED_ISSUES + more }
  }
  return { nodes, edges, issues, issueCount: issues.length }
}

/** Parse agent/browser input with zod, then run semantic validation. */
export function parseAndValidateChart(
  raw: { nodes: unknown; edges?: unknown },
  options: ValidateOptions = {},
): ValidatedChart {
  const parsed = z.object({ nodes: NodesArraySchema, edges: EdgesArraySchema.optional() }).safeParse(raw)
  if (!parsed.success) return { nodes: [], edges: [], issues: issuesFromZod(parsed.error) }
  return validateChart(
    parsed.data.nodes.map(nodeFromInput),
    (parsed.data.edges ?? []).map(edgeFromInput),
    options,
  )
}

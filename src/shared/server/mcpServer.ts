// The Flowchart AI MCP server. Stateless: a fresh server is created per HTTP
// request (see http.ts). Tools never call an LLM; the connected agent designs
// the chart and this server validates, lays out, stores, and links it.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  COMM_STYLES,
  CONTAINER_KINDS,
  EDGE_PROTOCOLS,
  EDGE_STYLES,
  HANDLE_POSITIONS,
  LAYOUT_DIRECTIONS,
  LIMITS,
  NODE_TYPES,
  NODE_TYPE_INFO,
  type Chart,
} from '../flowTypes.js'
import {
  DirectionSchema,
  EdgeInputSchema,
  EdgesArraySchema,
  NodeInputSchema,
  NodesArraySchema,
  OperationSchema,
  OperationsArraySchema,
  StoredChartSchema,
  TitleSchema,
  formatIssues,
} from '../flowSchema.js'
import { AZURE_ICONS, listIconCategories, searchAzureIcons } from '../icons.js'
import type { FlowService, ServiceError } from './flowService.js'
import { FLOWCHART_GUIDE, SERVER_INSTRUCTIONS } from './mcpGuide.js'
import { rateLimitMessage, writeQuota, type ClientRateLimit, type RateBucket, type WriteQuota } from './rateLimit.js'
import { StorageNotConfiguredError, StorageUnavailableError } from './store.js'
import { extractChartId, extractEditToken } from './tokens.js'

export interface McpServerContext {
  /** Lazily resolves the chart service; throws StorageNotConfiguredError when storage is missing. */
  getService: () => FlowService
  /** Public origin used in links, e.g. "https://flowchart.zeroclickdev.ai". */
  baseUrl: string
  /** Rate limits and budgets for the calling client (already bound to its IP). */
  rateLimit?: ClientRateLimit
}

export const SERVER_VERSION = '1.0.0'

export function chartLinks(baseUrl: string, id: string, editToken?: string) {
  const url = `${baseUrl}/f/${id}`
  return { url, editUrl: editToken ? `${url}#edit=${encodeURIComponent(editToken)}` : undefined }
}

function textResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return structuredContent
    ? { content: [{ type: 'text', text }], structuredContent }
    : { content: [{ type: 'text', text }] }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function serviceErrorResult(tool: string, error: ServiceError): CallToolResult {
  switch (error.code) {
    case 'validation':
      return errorResult(
        `${tool} failed: ${error.message} Fix ${error.issues.length === 1 ? 'it' : 'all of them'} and call ${tool} again.\n${formatIssues(error.issues)}`,
      )
    case 'conflict':
      return errorResult(
        `${tool} failed: ${error.message} Call get_flowchart to read version ${error.currentVersion}, re-apply your change to it, then retry with expectedVersion: ${error.currentVersion}.`,
      )
    default:
      return errorResult(`${tool} failed: ${error.message}`)
  }
}

async function guarded(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      console.error(`[flowchart] ${tool}: ${err.message}`)
      return errorResult(`${tool} failed: this Flowchart AI server has no chart storage configured. ${err.message}`)
    }
    if (err instanceof StorageUnavailableError) {
      return errorResult(`${tool} failed: ${err.message}`)
    }
    console.error(`[flowchart] ${tool} crashed`, err)
    return errorResult(`${tool} failed because of an internal server error. Try again in a moment.`)
  }
}

async function checkRate(ctx: McpServerContext, bucket: RateBucket, tool: string): Promise<CallToolResult | null> {
  if (!ctx.rateLimit) return null
  const result = await ctx.rateLimit(bucket)
  if (result.allowed) return null
  return errorResult(`${tool} failed: ${rateLimitMessage(bucket, result)}`)
}

function quotaFor(ctx: McpServerContext, bucket: RateBucket): WriteQuota | undefined {
  return ctx.rateLimit ? writeQuota(ctx.rateLimit, bucket) : undefined
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function describeChart(chart: Chart): string {
  return `"${chart.title}" (id ${chart.id}, version ${chart.version}, ${plural(chart.nodes.length, 'node')}, ${plural(chart.edges.length, 'edge')})`
}

function jsonSchemaOf(schema: z.ZodType, io: 'input' | 'output' = 'input') {
  return z.toJSONSchema(schema, { io, unrepresentable: 'any' })
}

let schemaDocument: string | undefined
export function chartSchemaDocument(): string {
  schemaDocument ??= JSON.stringify(
    {
      description:
        'JSON Schemas for Flowchart AI documents: what create_flowchart and update_flowchart accept (node, edge, operation) and what get_flowchart returns (chart).',
      node: jsonSchemaOf(NodeInputSchema),
      edge: jsonSchemaOf(EdgeInputSchema),
      operation: jsonSchemaOf(OperationSchema),
      chart: jsonSchemaOf(StoredChartSchema, 'output'),
      nodeTypes: Object.values(NODE_TYPE_INFO),
      containerKinds: CONTAINER_KINDS,
      edgeStyles: EDGE_STYLES,
      handles: HANDLE_POSITIONS,
      protocols: EDGE_PROTOCOLS,
      commStyles: COMM_STYLES,
      limits: LIMITS,
    },
    null,
    2,
  )
  return schemaDocument
}

const layoutValues = ['full', 'incremental', 'none'] as const

export function createFlowchartMcpServer(ctx: McpServerContext): McpServer {
  const server = new McpServer(
    {
      name: 'flowchart-ai',
      title: 'Flowchart AI',
      version: SERVER_VERSION,
      websiteUrl: 'https://flowchart.zeroclickdev.ai',
      description: 'Create shareable, editable flowcharts and architecture diagrams that you and the user can both edit.',
      icons: [{ src: `${ctx.baseUrl}/logo/logo_color.svg`, mimeType: 'image/svg+xml' }],
    },
    { instructions: SERVER_INSTRUCTIONS },
  )

  // -------------------------------------------------------------------------
  // create_flowchart
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_flowchart',
    {
      title: 'Create flowchart',
      description:
        'Create a new flowchart from nodes and edges you design, and get a link the user can open to view and edit it in Flowchart AI. ' +
        'Omit node positions: the server lays the chart out (top-to-bottom, or direction "LR"). ' +
        'Node types: step (an action), decision (a yes/no question; label its outgoing edges "Yes"/"No"), note (an annotation), ' +
        'image (an Azure service icon with a caption; set icon to an id from search_azure_icons), plus architecture types ' +
        '(service, database, queue, cache, apiGateway, externalActor) and container (groups nodes whose parentNode is its id). ' +
        'Always give the user the returned editUrl. Read the flowchart://guide resource for design rules and a full example.',
      inputSchema: {
        title: TitleSchema.describe('Short chart title, e.g. "SaaS signup to onboarding".'),
        nodes: NodesArraySchema.min(1, 'add at least one node').describe(
          'The nodes. Give each a unique id, a type and a short label. Omit position for automatic layout.',
        ),
        edges: EdgesArraySchema.optional().describe(
          'Arrows between nodes: { source, target, label? }. Label edges that leave decision nodes.',
        ),
        direction: DirectionSchema.optional().describe(
          'Automatic layout direction: TB (top-to-bottom, default; best for processes) or LR (left-to-right; best for architecture).',
        ),
      },
      outputSchema: {
        id: z.string(),
        version: z.number(),
        title: z.string(),
        url: z.string().describe('View link.'),
        editUrl: z.string().describe('Edit link to give the user. It contains the edit token.'),
        editToken: z.string().describe('Secret needed by update_flowchart.'),
        nodeCount: z.number(),
        edgeCount: z.number(),
        layout: z.enum(layoutValues),
      },
      annotations: {
        title: 'Create flowchart',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      guarded('create_flowchart', async () => {
        const limited = await checkRate(ctx, 'mcpCreate', 'create_flowchart')
        if (limited) return limited
        const result = await ctx.getService().create({
          title: args.title,
          nodes: args.nodes,
          edges: args.edges ?? [],
          direction: args.direction,
          source: 'mcp',
          quota: quotaFor(ctx, 'mcpCreate'),
        })
        if (!result.ok) return serviceErrorResult('create_flowchart', result)
        const { chart, editToken } = result
        const links = chartLinks(ctx.baseUrl, chart.id, editToken)
        const laidOut =
          result.layout === 'full'
            ? `, laid out ${result.direction === 'LR' ? 'left-to-right' : 'top-to-bottom'}`
            : ''
        return textResult(
          [
            `Created flowchart ${describeChart(chart)}${laidOut}.`,
            '',
            'Give the user this link to open and edit the chart:',
            links.editUrl!,
            '',
            `View-only link: ${links.url}`,
            `Chart id: ${chart.id}`,
            `Edit token: ${editToken} (keep it: update_flowchart needs it; anyone with it can edit the chart)`,
            '',
            'The user can keep editing in the browser. Before changing this chart later, call get_flowchart to load their latest version, ' +
              `then call update_flowchart with this id, the edit token, and expectedVersion (currently ${chart.version}).`,
          ].join('\n'),
          {
            id: chart.id,
            version: chart.version,
            title: chart.title,
            url: links.url,
            editUrl: links.editUrl!,
            editToken,
            nodeCount: chart.nodes.length,
            edgeCount: chart.edges.length,
            layout: result.layout,
          },
        )
      }),
  )

  // -------------------------------------------------------------------------
  // get_flowchart
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_flowchart',
    {
      title: 'Get flowchart',
      description:
        'Read the current state of a flowchart: title, version, nodes (with positions and sizes) and edges, including edits the user made in the browser. ' +
        'Call this before update_flowchart and pass the returned version as expectedVersion. Accepts the chart id or its URL.',
      inputSchema: {
        id: z.string().min(1).max(500).describe('Chart id (e.g. "Ab3dE5fG7h") or the chart URL.'),
      },
      outputSchema: {
        ...StoredChartSchema.shape,
        url: z.string(),
      },
      annotations: {
        title: 'Get flowchart',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      guarded('get_flowchart', async () => {
        const limited = await checkRate(ctx, 'read', 'get_flowchart')
        if (limited) return limited
        const id = extractChartId(args.id)
        const chart = await ctx.getService().get(id)
        if (!chart) {
          return errorResult(
            `get_flowchart failed: no flowchart with id ${JSON.stringify(id)}. Use the id from create_flowchart (the part after /f/ in the chart URL).`,
          )
        }
        const { url } = chartLinks(ctx.baseUrl, chart.id)
        const payload = { ...chart, url }
        const editedBy =
          chart.updatedVia === 'api' ? ' The latest change was made in the browser (by the user).' : ''
        return textResult(
          [
            `Flowchart ${describeChart(chart)}, last updated ${chart.updatedAt}.${editedBy}`,
            `To change it, call update_flowchart with expectedVersion: ${chart.version}.`,
            '',
            JSON.stringify(payload),
          ].join('\n'),
          payload,
        )
      }),
  )

  // -------------------------------------------------------------------------
  // update_flowchart
  // -------------------------------------------------------------------------
  server.registerTool(
    'update_flowchart',
    {
      title: 'Update flowchart',
      description:
        'Change an existing flowchart. Prefer small `operations` (add_node, update_node, remove_node, add_edge, update_edge, remove_edge); they apply in order, all or nothing. ' +
        'Use `replace` with complete nodes and edges only to rebuild the chart (it requires expectedVersion). ' +
        'Requires the editToken from create_flowchart. Pass expectedVersion (from get_flowchart) so you never overwrite edits the user made in the browser; ' +
        'on a version conflict, call get_flowchart and retry. New nodes without positions are placed next to their connections; set relayout: true to re-lay out everything. ' +
        "The user's open browser tab updates live.",
      inputSchema: {
        id: z.string().min(1).max(500).describe('Chart id or chart URL.'),
        editToken: z
          .string()
          .min(1)
          .max(1000)
          .describe('The editToken from create_flowchart (the part after "#edit=" in the edit link). The full edit link also works.'),
        operations: OperationsArraySchema.optional().describe('Changes to apply, in order.'),
        replace: z
          .strictObject({
            nodes: NodesArraySchema,
            edges: EdgesArraySchema.optional(),
          })
          .optional()
          .describe('Replace all nodes and edges instead of applying operations. Requires expectedVersion.'),
        title: TitleSchema.optional().describe('New chart title.'),
        expectedVersion: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('The version you last read. If the chart changed since then, the update is rejected instead of overwriting.'),
        relayout: z.boolean().optional().describe('Re-lay out the whole chart after applying the change.'),
        direction: DirectionSchema.optional().describe('Layout direction for placement and relayout: TB or LR.'),
      },
      outputSchema: {
        id: z.string(),
        version: z.number(),
        title: z.string(),
        url: z.string(),
        editUrl: z.string(),
        nodeCount: z.number(),
        edgeCount: z.number(),
        changes: z.array(z.string()),
        layout: z.enum(layoutValues),
      },
      annotations: {
        title: 'Update flowchart',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      guarded('update_flowchart', async () => {
        const hasOps = !!args.operations?.length
        const hasReplace = !!args.replace
        if (hasOps && hasReplace) {
          return errorResult('update_flowchart failed: pass either operations or replace, not both.')
        }
        if (!hasOps && !hasReplace && !args.title && !args.relayout) {
          return errorResult(
            'update_flowchart failed: nothing to change. Pass operations (preferred), replace, title, or relayout: true.',
          )
        }
        if (hasReplace && args.expectedVersion === undefined) {
          return errorResult(
            'update_flowchart failed: replace overwrites the whole chart, so it requires expectedVersion. Call get_flowchart and pass its version.',
          )
        }
        const limited = await checkRate(ctx, 'mcpWrite', 'update_flowchart')
        if (limited) return limited

        const id = extractChartId(args.id)
        const token = extractEditToken(args.editToken)
        const service = ctx.getService()
        const quota = quotaFor(ctx, 'mcpWrite')
        const result = hasReplace
          ? await service.replace(id, token, {
              title: args.title,
              nodes: args.replace!.nodes,
              edges: args.replace!.edges ?? [],
              expectedVersion: args.expectedVersion,
              direction: args.direction,
              relayout: args.relayout,
              source: 'mcp',
              quota,
            })
          : await service.applyOperations(id, token, {
              operations: args.operations ?? [],
              title: args.title,
              expectedVersion: args.expectedVersion,
              direction: args.direction,
              relayout: args.relayout,
              source: 'mcp',
              quota,
            })
        if (!result.ok) return serviceErrorResult('update_flowchart', result)

        const { chart } = result
        const links = chartLinks(ctx.baseUrl, chart.id, token)
        const changes = result.summary.length ? result.summary : ['no content changes']
        return textResult(
          [
            `Updated flowchart ${describeChart(chart)}: ${changes.join('; ')}.`,
            "The user's open browser tab shows the change within a few seconds while they're viewing it.",
            `Edit link: ${links.editUrl}`,
            `Next update: pass expectedVersion: ${chart.version} (call get_flowchart first if the user may have edited it).`,
          ].join('\n'),
          {
            id: chart.id,
            version: chart.version,
            title: chart.title,
            url: links.url,
            editUrl: links.editUrl!,
            nodeCount: chart.nodes.length,
            edgeCount: chart.edges.length,
            changes,
            layout: result.layout,
          },
        )
      }),
  )

  // -------------------------------------------------------------------------
  // list_node_types
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_node_types',
    {
      title: 'List node types',
      description:
        'List the node types (with descriptions, default sizes and icon support), container kinds, edge styles, handles, protocols and limits this server accepts.',
      inputSchema: {},
      outputSchema: {
        nodeTypes: z.array(
          z.object({
            type: z.enum(NODE_TYPES),
            category: z.string(),
            description: z.string(),
            defaultSize: z.object({ width: z.number(), height: z.number() }),
            supportsIcon: z.boolean(),
          }),
        ),
        containerKinds: z.array(z.string()),
        edgeStyles: z.array(z.string()),
        handles: z.array(z.string()),
        protocols: z.array(z.string()),
        commStyles: z.array(z.string()),
        directions: z.array(z.string()),
        limits: z.record(z.string(), z.number()),
      },
      annotations: {
        title: 'List node types',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const nodeTypes = NODE_TYPES.map((t) => NODE_TYPE_INFO[t])
      const lines = [
        'Node types:',
        ...nodeTypes.map(
          (n) =>
            `- ${n.type} (${n.category}${n.supportsIcon ? ', supports icon' : ''}, default ${n.defaultSize.width}x${n.defaultSize.height}): ${n.description}`,
        ),
        '',
        `Container kinds (containerKind): ${CONTAINER_KINDS.join(', ')}`,
        `Edge styles (style): ${EDGE_STYLES.join(', ')} (animated is the default)`,
        `Handles (sourceHandle/targetHandle): ${HANDLE_POSITIONS.join(', ')}`,
        `Architecture edge protocols (protocol): ${EDGE_PROTOCOLS.join(', ')}; commStyle: ${COMM_STYLES.join(', ')}`,
        `Layout directions: ${LAYOUT_DIRECTIONS.join(', ')}`,
        `Limits: ${LIMITS.maxNodes} nodes, ${LIMITS.maxEdges} edges, ${LIMITS.maxOperations} operations per update, labels up to ${LIMITS.maxLabelLength} characters.`,
      ]
      return textResult(lines.join('\n'), {
        nodeTypes,
        containerKinds: [...CONTAINER_KINDS],
        edgeStyles: [...EDGE_STYLES],
        handles: [...HANDLE_POSITIONS],
        protocols: [...EDGE_PROTOCOLS],
        commStyles: [...COMM_STYLES],
        directions: [...LAYOUT_DIRECTIONS],
        limits: {
          maxNodes: LIMITS.maxNodes,
          maxEdges: LIMITS.maxEdges,
          maxOperations: LIMITS.maxOperations,
          maxLabelLength: LIMITS.maxLabelLength,
          maxTitleLength: LIMITS.maxTitleLength,
          maxChartBytes: LIMITS.maxChartBytes,
        },
      })
    },
  )

  // -------------------------------------------------------------------------
  // search_azure_icons
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_azure_icons',
    {
      title: 'Search Azure icons',
      description:
        `Search the ${AZURE_ICONS.length} official Azure service icons by name or common alias (e.g. "cosmos", "aks", "key vault", "functions", "front door"). ` +
        'Returns icon ids to use in the `icon` field of image nodes and architecture nodes.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Service name or keywords, e.g. "cosmos db" or "api management".'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 10).'),
        category: z
          .string()
          .max(100)
          .optional()
          .describe(`Optional category filter, e.g. "databases", "networking", "ai + machine learning".`),
      },
      outputSchema: {
        query: z.string(),
        results: z.array(z.object({ id: z.string(), name: z.string(), category: z.string() })),
      },
      annotations: {
        title: 'Search Azure icons',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const results = searchAzureIcons(args.query, { limit: args.limit ?? 10, category: args.category }).map(
        ({ id, name, category }) => ({ id, name, category }),
      )
      const text = results.length
        ? [
            `Azure icons matching "${args.query}" (use the id as a node's "icon"):`,
            ...results.map((r) => `- ${r.id}: ${r.name} (${r.category})`),
          ].join('\n')
        : `No Azure icons match "${args.query}". Try a broader or different term (e.g. "database", "function", "gateway"), ` +
          `or use a plain step node. Categories: ${listIconCategories().join(', ')}.`
      return textResult(text, { query: args.query, results })
    },
  )

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------
  server.registerResource(
    'flowchart-guide',
    'flowchart://guide',
    {
      title: 'Flowchart AI authoring guide',
      description: 'How to design good flowcharts with these tools: workflow, node types, icons, containers, layout, editing, and examples.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: FLOWCHART_GUIDE }] }),
  )

  server.registerResource(
    'flowchart-schema',
    'flowchart://schema',
    {
      title: 'Flowchart JSON Schema',
      description: 'JSON Schemas for nodes, edges and update operations, plus the node vocabulary and limits.',
      mimeType: 'application/json',
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: chartSchemaDocument() }] }),
  )

  // -------------------------------------------------------------------------
  // Prompt
  // -------------------------------------------------------------------------
  server.registerPrompt(
    'design_flowchart',
    {
      title: 'Design a flowchart',
      description: 'Design a flowchart or architecture diagram for a topic, create it with create_flowchart, and share the edit link.',
      argsSchema: {
        topic: z.string().min(1).max(2000).describe('What to diagram, e.g. "SaaS signup, payment and onboarding".'),
        kind: z
          .enum(['flowchart', 'architecture'])
          .optional()
          .describe('flowchart (a process; default) or architecture (systems, services, and data stores).'),
      },
    },
    ({ topic, kind }) => {
      const isArchitecture = kind === 'architecture'
      const task = isArchitecture
        ? `Design a clear architecture diagram for: ${topic}\n\n` +
          'Use architecture node types (service, database, queue, cache, apiGateway, externalActor), group related parts in containers ' +
          '(vpc, cluster, region, zone, trustBoundary) via parentNode, set protocol/commStyle on edges where helpful, and use direction "LR".'
        : `Design a clear flowchart for: ${topic}\n\n` +
          'Use step nodes for actions, decision nodes for yes/no questions (label their outgoing edges), notes for context, and image nodes with Azure icons where a cloud service is involved.'
      return {
        description: `Design ${isArchitecture ? 'an architecture diagram' : 'a flowchart'} for ${topic}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `${task}\n\n` +
                'Steps:\n' +
                '1. Outline the process or system briefly.\n' +
                '2. Look up icon ids with search_azure_icons for any Azure services.\n' +
                '3. Call create_flowchart with a title, nodes and edges (omit positions).\n' +
                '4. If it returns problems, fix every listed problem and call it again.\n' +
                '5. Reply with a one-paragraph summary and the editUrl as a clickable link.\n\n' +
                'Follow this guide:\n\n' +
                FLOWCHART_GUIDE,
            },
          },
        ],
      }
    },
  )

  return server
}

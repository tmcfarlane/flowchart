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
  StoredChartSchema,
  TitleSchema,
  formatIssues,
} from '../flowSchema.js'
import { AZURE_ICONS, ICON_CATALOG, listAllIconCategories, listIconCategories, searchAzureIcons, searchIcons } from '../icons.js'
import { DIAGRAM_TEMPLATE_CATEGORIES, DIAGRAM_TEMPLATES, getDiagramTemplate, searchDiagramTemplates } from '../diagramTemplates.js'
import { auditDiagram } from '../diagramAudit.js'
import type { FlowService, ServiceError } from './flowService.js'
import { FLOWCHART_GUIDE, SERVER_INSTRUCTIONS } from './mcpGuide.js'
import { rateLimitMessage, writeQuota, type ClientRateLimit, type RateBucket, type WriteQuota } from './rateLimit.js'
import { StorageNotConfiguredError, StorageUnavailableError } from './store.js'
import { isValidChartId } from './tokens.js'
import { PLUGIN_UI_URI, pluginUiHtml } from './pluginUi.js'

export interface McpServerContext {
  /** Lazily resolves the chart service; throws StorageNotConfiguredError when storage is missing. */
  getService: () => FlowService
  /** Public origin used in links, e.g. "https://flowchart.zeroclickdev.ai". */
  baseUrl: string
  /** Rate limits and budgets for the calling client (already bound to its IP). */
  rateLimit?: ClientRateLimit
}

export const SERVER_VERSION = '2.1.0'

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
        'JSON Schemas for Flowchart AI documents: nodes, edges, chart and browser-only operations.',
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
  ctx = { ...ctx, baseUrl: new URL(ctx.baseUrl).origin }
  const server = new McpServer(
    {
      name: 'flowchart-ai',
      title: 'Flowchart AI',
      version: SERVER_VERSION,
      websiteUrl: 'https://flowchart.zeroclickdev.ai',
      description: 'Create link-shared flowcharts and revised copies. Browser editing is available through the private UI card.',
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
        'Save a new link-shared flowchart from nodes and edges you design; return a view link and a private browser-controls card. ' +
        'Omit node positions: the server lays the chart out (top-to-bottom, or direction "LR"). ' +
        'Node types: step (an action), decision (a yes/no question; label its outgoing edges "Yes"/"No"), note (an annotation), ' +
        'image (a local illustration with a caption; set icon to an id from search_icons or search_azure_icons), plus architecture types ' +
        '(service, database, queue, cache, apiGateway, externalActor) and container (groups nodes whose parentNode is its id). ' +
        'This saves a link-shared chart: anyone with its view link can read it; anyone with its private edit link can edit or delete it. ' +
        'Charts have no account ownership and are retained indefinitely unless the operator configures retention or the user deletes them. ' +
        'Explain this and obtain deliberate sharing consent before creating. Set sharing to link-shared only after consent. ' +
        'The private UI card provides browser editing and deletion; edit capabilities never appear in model-visible results. ' +
        'For revisions create a new chart from the latest get_flowchart data. Read flowchart://guide for design rules.',
      _meta: { ui: { resourceUri: PLUGIN_UI_URI }, securitySchemes: [{ type: 'noauth' }] },
      inputSchema: {
        sharing: z.literal('link-shared').describe('Deliberate consent to link sharing and disclosed retention. Do not set without user consent.'),
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
        sharing: z.literal('link-shared'),
        retention: z.string(),
        nodeCount: z.number(),
        edgeCount: z.number(),
        layout: z.enum(layoutValues),
      },
      annotations: {
        title: 'Create flowchart',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
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
        return {
          ...textResult(
            `Created flowchart ${describeChart(chart)}${laidOut}. View: ${links.url}. ` +
            'Anyone with the view link can read it. Charts have no account ownership. ' +
            'Retained indefinitely unless operator retention is configured or you delete it. ' +
            'Use the private chart card to open the browser editor or delete this chart. ' +
            'For a conversational revision, read the latest chart and create a revised copy; the original remains unchanged.',
            {
              id: chart.id, version: chart.version, title: chart.title, url: links.url,
              sharing: 'link-shared',
              retention: 'Retained indefinitely unless operator retention is configured or you delete it.',
              nodeCount: chart.nodes.length, edgeCount: chart.edges.length, layout: result.layout,
            },
          ),
          // MCP Apps hosts deliver this envelope only to the UI, never the model.
          _meta: {
            'flowchart/private': { id: chart.id, editUrl: links.editUrl, editToken },
            // Only public rendering fields are sent to the widget. No image
            // URLs, icon paths, timestamps or capabilities enter this payload.
            'flowchart/chart': {
              title: chart.title,
              nodes: chart.nodes.map(({ id, type, label, position, width, height, parentNode }) => ({
                id, type, label, position, ...(width ? { width } : {}), ...(height ? { height } : {}), ...(parentNode ? { parentNode } : {}),
              })),
              edges: chart.edges.map(({ source, target, label, style, commStyle }) => ({
                source, target, ...(label ? { label } : {}), ...(style ? { style } : {}), ...(commStyle ? { commStyle } : {}),
              })),
            },
          },
        }
      }),
  )

  // -------------------------------------------------------------------------
  // get_flowchart
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_flowchart',
    {
      _meta: { securitySchemes: [{ type: 'noauth' }] },
      title: 'Get flowchart',
      description:
        'Read the current state of a flowchart: title, version, nodes (with positions and sizes) and edges, including edits the user made in the browser. ' +
        'Read before making a revised copy with create_flowchart. Accepts a chart id only; never send an edit link or token.',
      inputSchema: {
        id: z.string().regex(/^[0-9A-Za-z]{10}$/).describe('Chart id only (10 letters and digits). Never send an edit link.'),
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
        openWorldHint: true,
      },
    },
    async (args) =>
      guarded('get_flowchart', async () => {
        const limited = await checkRate(ctx, 'read', 'get_flowchart')
        if (limited) return limited
        const id = args.id
        if (!isValidChartId(id)) return errorResult('Invalid chart id.')
        const chart = await ctx.getService().get(id)
        if (!chart) {
          return errorResult(
            `get_flowchart failed: no flowchart with id ${JSON.stringify(id)}. Use the id from create_flowchart (the part after /f/ in the chart URL).`,
          )
        }
        const { url } = chartLinks(ctx.baseUrl, chart.id)
        const payload = { ...chart, url }
        const editedBy =
          chart.updatedVia === 'api' ? ' The latest change was made by an edit-link holder.' : ''
        return textResult(
          [
            `Flowchart ${describeChart(chart)}, last updated ${chart.updatedAt}.${editedBy}`,
            'To change it conversationally, create a revised copy with create_flowchart; obtain sharing consent for the copy.',
            '',
            JSON.stringify(payload),
          ].join('\n'),
          payload,
        )
      }),
  )

  // -------------------------------------------------------------------------
  // list_node_types
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_node_types',
    {
      _meta: { securitySchemes: [{ type: 'noauth' }] },
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
        `Limits: ${LIMITS.maxNodes} nodes, ${LIMITS.maxEdges} edges, labels up to ${LIMITS.maxLabelLength} characters. Browser/API updates allow ${LIMITS.maxOperations} operations; existing-chart MCP updates are unavailable.`,
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
      _meta: { securitySchemes: [{ type: 'noauth' }] },
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
  // search_icons, templates and audit: pure local helpers, available even when
  // chart storage is unconfigured. Reading a template never shares a chart.
  // -------------------------------------------------------------------------
  const localAnnotations = {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  }
  const noAuth = { securitySchemes: [{ type: 'noauth' }] }

  server.registerTool('search_icons', {
    title: 'Search diagram icons',
    description: `Search the fixed local catalog of ${ICON_CATALOG.length} illustrations: Azure services plus original icons for people, business, infrastructure, science, nature and imaginative diagrams. Returns stable ids for image or architecture nodes; does not search the web.`,
    _meta: noAuth,
    inputSchema: {
      query: z.string().min(1).max(200).describe('A concept such as "payment", "robot", "portal", "database" or "cosmos".'),
      category: z.string().max(100).optional().describe('Optional local category, such as business, cosmic, people or infrastructure.'),
      provider: z.enum(['azure', 'flowchart']).optional().describe('Optional icon set: azure or the original flowchart illustrations.'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum results, default 12.'),
    },
    outputSchema: { query: z.string(), results: z.array(z.object({ id: z.string(), name: z.string(), category: z.string(), provider: z.enum(['azure', 'flowchart']) })), categories: z.array(z.string()) },
    annotations: localAnnotations,
  }, async (args) => {
    const results = searchIcons(args.query, args).map(({ id, name, category, provider }) => ({ id, name, category, provider }))
    return textResult(results.length ? `Local icons matching "${args.query}":\n${results.map((item) => `- ${item.id}: ${item.name} (${item.category}, ${item.provider})`).join('\n')}` : `No local icons match "${args.query}". Try a broader concept or use a plain node.`, { query: args.query, results, categories: listAllIconCategories() })
  })

  const templateSummary = (template: typeof DIAGRAM_TEMPLATES[number]) => ({
    id: template.id, title: template.title, description: template.description,
    category: template.category, direction: template.direction,
    nodeCount: template.nodes.length, edgeCount: template.edges.length,
  })
  const templateSummarySchema = z.object({
    id: z.string(), title: z.string(), description: z.string(),
    category: z.enum(DIAGRAM_TEMPLATE_CATEGORIES), direction: DirectionSchema,
    nodeCount: z.number().int(), edgeCount: z.number().int(),
  })
  server.registerTool('list_diagram_templates', {
    title: 'Find diagram templates',
    description: 'Browse a curated local catalog of practical process, business, cloud and imaginative diagrams. Returns template summaries, not saved charts. Use get_diagram_template to obtain a draft to adapt for the user.',
    _meta: noAuth,
    inputSchema: {
      query: z.string().max(200).optional().describe('Optional words to match against template IDs, titles, descriptions, categories and node labels. Every word must match; casing and punctuation are normalized.'),
      category: z.enum(DIAGRAM_TEMPLATE_CATEGORIES).optional().describe('Optional category filter.'),
    },
    outputSchema: { templates: z.array(templateSummarySchema), categories: z.array(z.string()), total: z.number().int() },
    annotations: localAnnotations,
  }, async (args) => {
    const templates = searchDiagramTemplates(args.query, args.category).map(templateSummary)
    return textResult(templates.length ? `Diagram templates:\n${templates.map((item) => `- ${item.id}: ${item.title} — ${item.description}`).join('\n')}` : 'No templates match. Try fewer keywords or another category.', { templates, categories: [...DIAGRAM_TEMPLATE_CATEGORIES], total: templates.length })
  })

  server.registerTool('get_diagram_template', {
    title: 'Get an editable diagram template',
    description: 'Read the nodes, edges and layout direction for a specific local template. Adapt the draft to the user’s intent, audit it, then obtain sharing consent before create_flowchart. This call does not create, save or share anything.',
    _meta: noAuth,
    inputSchema: { id: z.string().min(1).max(100).describe('Exact template id from list_diagram_templates, such as dream-observatory or checkout-journey.') },
    outputSchema: { template: z.object({ id: z.string(), title: z.string(), description: z.string(), category: z.enum(DIAGRAM_TEMPLATE_CATEGORIES), direction: DirectionSchema, nodes: NodesArraySchema, edges: EdgesArraySchema }) },
    annotations: localAnnotations,
  }, async ({ id }) => {
    const template = getDiagramTemplate(id)
    return template ? textResult(`Draft template "${template.title}" (${template.nodes.length} nodes, ${template.edges.length} edges). Adapt the labels and structure; no chart has been saved or shared.`, { template }) : errorResult(`Unknown diagram template "${id}". Use list_diagram_templates to find an available id.`)
  })

  server.registerTool('audit_diagram', {
    title: 'Check a diagram draft',
    description: 'Validate a proposed diagram without saving it and return actionable feedback: broken references, duplicate ids, invalid icons or nesting, unlabeled decision branches, isolated nodes and external images. Returns normalized nodes/edges when valid. Checks structure and readability, not the factual accuracy of the diagram’s content. Does not fetch image URLs or call an AI model.',
    _meta: noAuth,
    inputSchema: {
      nodes: NodesArraySchema.describe('Draft nodes to validate; positions are optional.'),
      edges: EdgesArraySchema.optional().describe('Draft edges, including decision outcome labels.'),
    },
    outputSchema: {
      valid: z.boolean(), summary: z.string(),
      findings: z.array(z.object({ severity: z.enum(['error', 'warning', 'info']), code: z.string(), path: z.string(), message: z.string(), suggestion: z.string() })),
      metrics: z.object({ nodeCount: z.number().int(), edgeCount: z.number().int(), decisionCount: z.number().int(), connectedComponents: z.number().int() }),
      normalized: z.object({ nodes: NodesArraySchema, edges: EdgesArraySchema }).nullable(),
    },
    annotations: localAnnotations,
  }, async (args) => {
    const report = auditDiagram(args)
    const details = report.findings.map((item) => `- ${item.severity.toUpperCase()} ${item.path}: ${item.message} ${item.suggestion}`)
    return textResult([report.summary, ...details].join('\n'), { ...report })
  })

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------
  server.registerResource('flowchart-card', PLUGIN_UI_URI, {
    title: 'Diagram preview and private controls', mimeType: 'text/html;profile=mcp-app',
    description: 'Preview the created diagram with local SVG shapes, then open the browser editor or delete it without sharing its edit capability with the model.',
  }, async () => ({ contents: [{
    uri: PLUGIN_UI_URI, mimeType: 'text/html;profile=mcp-app', text: pluginUiHtml(ctx.baseUrl),
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [new URL(ctx.baseUrl).origin], resourceDomains: [] } } },
  }] }))

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

  server.registerResource('flowchart-templates', 'flowchart://templates', {
    title: 'Diagram template catalog',
    description: 'Local starting points for process, business, cloud and imaginative diagrams. Reading the catalog does not create charts.',
    mimeType: 'application/json',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ categories: DIAGRAM_TEMPLATE_CATEGORIES, templates: DIAGRAM_TEMPLATES.map(templateSummary), usage: 'Use get_diagram_template for a draft. Adapt and audit it, then obtain sharing consent before saving.' }, null, 2) }] }))

  // -------------------------------------------------------------------------
  // Prompt
  // -------------------------------------------------------------------------
  server.registerPrompt(
    'design_flowchart',
    {
      title: 'Design a flowchart',
      description: 'Design a flowchart or architecture diagram for a topic, create it with create_flowchart, and share its view link with private browser controls.',
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
                '2. Browse list_diagram_templates when a starting point helps; use search_icons for local illustrations or search_azure_icons for Azure services.\n' +
                '3. Run audit_diagram on the draft and address blocking problems and relevant suggestions.\n' +
                '4. Explain link sharing and retention, obtain consent, then call create_flowchart with sharing: link-shared, a title, nodes and edges (omit positions).\n' +
                '5. If it returns problems, fix every listed problem and call it again.\n' +
                '6. Reply with a brief summary and the view URL. Direct the user to the private card for editing or deletion.\n\n' +
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

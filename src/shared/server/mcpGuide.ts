// Authoring guide served to AI agents as the MCP resource flowchart://guide and
// embedded in the design_flowchart prompt. Adapted from
// api/flowchart-generation-skill.md (the in-app AI prompt) for tool-calling
// agents: the agent composes the chart, the server validates, lays out, and
// stores it.

import {
  CONTAINER_KINDS,
  EDGE_PROTOCOLS,
  LIMITS,
  NODE_TYPES,
  NODE_TYPE_INFO,
} from '../flowTypes.js'

const nodeTable = NODE_TYPES.map((type) => {
  const info = NODE_TYPE_INFO[type]
  return `| \`${type}\` | ${info.category} | ${info.description} | ${info.supportsIcon ? 'yes' : 'no'} |`
}).join('\n')

const EXAMPLE_CREATE = {
  title: 'SaaS signup to onboarding',
  nodes: [
    { id: 'visit', type: 'step', label: 'Visitor clicks "Start free trial"' },
    { id: 'signup', type: 'step', label: 'Sign up with email or SSO' },
    { id: 'auth', type: 'image', label: 'Microsoft Entra ID', icon: 'microsoft-entra-id' },
    { id: 'verified', type: 'decision', label: 'Email verified?' },
    { id: 'resend', type: 'step', label: 'Resend verification email' },
    { id: 'plan', type: 'step', label: 'Choose a plan' },
    { id: 'pay', type: 'step', label: 'Enter payment details' },
    { id: 'paid', type: 'decision', label: 'Payment succeeded?' },
    { id: 'retry', type: 'step', label: 'Show error, try another card' },
    { id: 'db', type: 'image', label: 'Save account in Cosmos DB', icon: 'azure-cosmos-db' },
    { id: 'onboard', type: 'step', label: 'Guided onboarding checklist' },
    { id: 'tip', type: 'note', label: 'Trial users can skip payment for 14 days' },
  ],
  edges: [
    { source: 'visit', target: 'signup' },
    { source: 'signup', target: 'auth' },
    { source: 'auth', target: 'verified' },
    { source: 'verified', target: 'resend', label: 'No' },
    { source: 'resend', target: 'verified', label: 'Retry' },
    { source: 'verified', target: 'plan', label: 'Yes' },
    { source: 'plan', target: 'pay' },
    { source: 'pay', target: 'paid' },
    { source: 'paid', target: 'retry', label: 'No' },
    { source: 'retry', target: 'pay', label: 'Retry' },
    { source: 'paid', target: 'db', label: 'Yes' },
    { source: 'db', target: 'onboard' },
  ],
}

const EXAMPLE_UPDATE = {
  id: 'Ab3dE5fG7h',
  editToken: '<editToken from create_flowchart>',
  expectedVersion: 3,
  operations: [
    { op: 'add_node', node: { id: 'welcome', type: 'step', label: 'Send welcome email' } },
    { op: 'add_edge', edge: { source: 'onboard', target: 'welcome' } },
    { op: 'update_node', id: 'plan', changes: { label: 'Pick Starter, Pro or Team' } },
    { op: 'update_edge', id: 'epaid-retry', changes: { label: 'Declined' } },
    { op: 'remove_node', id: 'tip' },
  ],
}

export const FLOWCHART_GUIDE = `# Flowchart AI: authoring guide for AI agents

Flowchart AI (https://flowchart.zeroclickdev.ai) turns the JSON you write into a
polished, editable flowchart with a shareable link. **You design the chart**; this
server validates it, lays it out, stores it, and returns links. It never calls an
LLM itself.

## Workflow

1. Plan the steps, decisions and outcomes of the process you are diagramming.
2. For Azure services, call \`search_azure_icons\` to get icon ids (e.g. "cosmos" -> \`azure-cosmos-db\`).
3. Call \`create_flowchart\` with a \`title\`, \`nodes\` and \`edges\`. **Omit positions**: the server lays the chart out.
4. **Give the user the \`editUrl\`** from the result as a clickable link. It opens the chart in the
   browser, where they can drag, edit and present it. Anyone with that link can edit, so share it only
   with the user. The \`url\` is a view link.
5. To change the chart later: call \`get_flowchart\` first (the user may have edited it in the browser),
   then \`update_flowchart\` with small \`operations\` and \`expectedVersion\` set to the version you just read.
   Their open browser tab updates live within a few seconds.
6. If a call returns an error, it lists every problem with its location (e.g. \`nodes[3].icon\`). Fix them
   all and call again.

## Designing a good flowchart

- Aim for 5-15 nodes. Split bigger processes into several charts.
- One idea per node. Labels are 2-6 words; start steps with a verb ("Verify email", "Charge card").
- Begin with the trigger ("Visitor clicks Sign up") and end with clear outcomes ("Account active").
- Use \`decision\` nodes for yes/no questions, phrased as a question ("Payment succeeded?"), and label every
  edge leaving a decision ("Yes"/"No", "Pass"/"Fail").
- Loops are fine: point an edge back to an earlier node and label it ("Retry").
- Use \`note\` nodes for tips and context. They usually stay unconnected.
- Use short, meaningful node ids ("signup", "pay"). You will reference them in edges and later edits.
- For systems and cloud architecture, use the architecture node types and containers (below) and
  \`direction: "LR"\`.

## Node types

| type | category | use for | icon |
| --- | --- | --- | --- |
${nodeTable}

Node fields: \`id\` (unique), \`type\`, \`label\`, and optionally \`position\` {x, y}, \`width\`, \`height\`,
\`icon\`, \`imageUrl\`, \`parentNode\`, \`containerKind\`. Unknown fields are rejected, so do not send
React Flow fields such as \`data\` or \`style\`.

## Edges

\`{ "source": "pay", "target": "paid", "label": "Yes" }\`

- \`id\` is optional. Generated ids look like \`e<source>-<target>\` (for example \`epay-paid\`).
- \`style\`: \`animated\` (dashed, flowing; the default), \`default\` (solid curve) or \`step\` (right angles).
- \`sourceHandle\`/\`targetHandle\` (\`top\` | \`right\` | \`bottom\` | \`left\`) pick the sides the arrow attaches to.
  Omit them and the server chooses from the layout; decision branches leave the diamond's side corners.
- Architecture edges can set \`protocol\` (${EDGE_PROTOCOLS.join(', ')}) and \`commStyle\` (\`sync\` solid, \`async\` dashed).

## Icons (Azure)

- Call \`search_azure_icons\` with a service name ("key vault", "aks", "functions") and use the returned \`id\`.
  The server also accepts common names and aliases ("Cosmos DB", "k8s") and normalizes them.
- \`image\` nodes show the icon large with the label as a caption. They are good for the Azure services in a
  process flow.
- Architecture nodes (service, database, queue, cache, apiGateway, externalActor) show the icon as a small glyph.
- step, decision, note and container nodes don't show icons.
- If no Azure icon fits, use a plain \`step\`, or an \`image\` node with an https \`imageUrl\`
  (e.g. \`https://api.iconify.design/mdi/cart.svg\`).

## Containers (architecture diagrams)

A \`container\` node draws a labeled boundary: \`containerKind\` is one of ${CONTAINER_KINDS.join(', ')}.
Put nodes inside it by setting their \`parentNode\` to the container's id. Containers can be nested
(a cluster inside a VPC inside a region). The server sizes containers to fit their children. If you
give positions, children's positions are relative to the container's top-left corner, and the container
header needs about 56px at the top.

## Layout

- Omit every \`position\` in \`create_flowchart\` and the chart is laid out automatically: top-to-bottom by
  default, or \`direction: "LR"\` for left-to-right (better for architecture).
- If you do give positions (top-left corner, in pixels; y grows downward), they are kept.
- In \`update_flowchart\`, new nodes without a position are placed next to the nodes they connect to, so the
  user's hand-made arrangement is kept. Pass \`relayout: true\` to re-lay out the whole chart after a big change.

## Editing with update_flowchart

Operations run in order and are all-or-nothing:

- \`add_node\` { node }. Omit node.position to place it automatically.
- \`update_node\` { id, changes } changes any node fields. \`null\` clears optional fields; \`parentNode: null\`
  moves a node out of its container; \`position: null\` re-places it.
- \`remove_node\` { id } also removes its edges. Children of a removed container stay on the canvas.
- \`add_edge\` { edge }
- \`update_edge\` { id, changes } changes label, style, source, target, handles, protocol or commStyle.
- \`remove_edge\` { id }

Use \`replace\` { nodes, edges } only to rebuild the chart from scratch; it needs \`expectedVersion\`.
You can pass \`title\` to rename the chart.

## Versions and conflicts

Every change increments \`version\`. The user edits the same chart in the browser, and those edits are saved
back automatically. Always pass \`expectedVersion\` (from \`get_flowchart\` or your last result). If it no
longer matches, you get a conflict error instead of overwriting the user's work. Call \`get_flowchart\`
again, re-apply your change to what you see, and retry.

## Limits

Up to ${LIMITS.maxNodes} nodes, ${LIMITS.maxEdges} edges and ${LIMITS.maxOperations} operations per call. Labels are
at most ${LIMITS.maxLabelLength} characters and titles ${LIMITS.maxTitleLength}. The stored chart is limited to
${Math.round(LIMITS.maxChartBytes / 1024)} KB. The service is free and rate-limited; a refused call says how long to wait before retrying.

## Example: create_flowchart arguments

\`\`\`json
${JSON.stringify(EXAMPLE_CREATE, null, 2)}
\`\`\`

## Example: update_flowchart arguments

\`\`\`json
${JSON.stringify(EXAMPLE_UPDATE, null, 2)}
\`\`\`
`

export const SERVER_INSTRUCTIONS = `Flowchart AI creates shareable, editable flowcharts from JSON that you compose.
Call create_flowchart with a title, nodes and edges (omit positions for automatic layout), then give the user the returned editUrl so they can open and edit the chart in their browser.
Before changing an existing chart, call get_flowchart, because the user may have edited it in the browser. Then call update_flowchart with operations and expectedVersion.
Use search_azure_icons for Azure service icons and list_node_types for the node vocabulary. Read the resource flowchart://guide for design rules and examples.`

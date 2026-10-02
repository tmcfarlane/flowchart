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
  sharing: 'link-shared',
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

export const FLOWCHART_GUIDE = `# Flowchart AI: authoring guide for AI agents

Flowchart AI (https://flowchart.zeroclickdev.ai) turns the JSON you write into a
polished, editable flowchart with a shareable link. **You design the chart**; this
server validates it, lays it out, stores it, and returns links. It never calls an
LLM itself.

## Workflow

1. Plan the steps, decisions and outcomes of the process you are diagramming.
2. Browse \`list_diagram_templates\` for practical or imaginative starting points; \`get_diagram_template\`
   returns an editable draft without saving or sharing it. Use \`search_icons\` for local illustrations,
   or \`search_azure_icons\` for Azure services (e.g. "cosmos" -> \`azure-cosmos-db\`).
3. Before saving, explain that anyone with the view link can read the chart, anyone with the private edit
   link can edit or delete it, charts have no account ownership, and retention is indefinite unless the
   server configures retention or the user deletes the chart. Obtain deliberate consent to link sharing.
4. Call \`create_flowchart\` with \`sharing: "link-shared"\`, a \`title\`, \`nodes\` and \`edges\`.
   **Omit positions** for automatic layout. Give the user the returned view \`url\`.
   The private MCP Apps card opens the browser editor or deletes the chart. In hosts without UI, only
   the view link is available; do not recover or paste an edit capability into chat.
5. For a conversational revision, read the latest \`get_flowchart\` using the chart id only, revise its
   nodes and edges, then create a new link-shared copy with consent. The original remains available.
   Never ask for an edit token or edit link. Same-chart MCP writes are unavailable until secure authorization exists.
6. Run \`audit_diagram\` on a draft before saving when useful. It checks references, icons, nesting,
   decision labels, and disconnected nodes without storing a chart or contacting image hosts.
   Fix every blocking error and review design suggestions; it does not verify factual claims.
   Other validation errors list their locations (e.g. \`nodes[3].icon\`); fix them all before retrying.

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

## Local icons and illustrations

- Call \`search_azure_icons\` with a service name ("key vault", "aks", "functions") and use the returned \`id\`.
  The server also accepts common names and aliases ("Cosmos DB", "k8s") and normalizes them.
- Call \`search_icons\` for people, business, infrastructure, science, nature, and surreal illustrations.
  Examples include \`icon-credit-card\`, \`icon-robot\`, \`icon-moon\`, \`icon-crystal\`, and \`icon-portal\`.
  These are original local SVGs; no remote image service is used. Optional provider and category filters
  narrow the fixed local catalog. Stable ids work in both the browser and the MCP server.
- \`image\` nodes show the icon large with the label as a caption. They are good for the Azure services in a
  process flow.
- Architecture nodes (service, database, queue, cache, apiGateway, externalActor) show the icon as a small glyph.
- step, decision, note and container nodes don't show icons.
- If no local icon fits, use a plain \`step\`. External https \`imageUrl\` values are accepted, but viewing
  them may disclose the viewer's network address to that image host. Prefer a local illustration.

## Templates

\`flowchart://templates\` and \`list_diagram_templates\` list curated process, business, cloud and creative
starting points. \`get_diagram_template\` returns the nodes, edges and direction for one id. Adapt a
template to the user's actual task rather than presenting an example as verified business logic.
Creative templates such as Dream Observatory and Memory Garden are imaginative prompts, not claims
about real systems. Reading or choosing a template creates no stored chart and requires no sharing consent.
Saving it still follows the explicit sharing-consent workflow above.

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
- To preserve the latest browser arrangement in a revised copy, keep the returned positions.
  To arrange the revised chart anew, omit positions consistently.

## Browser editing and deletion

The private card receives edit access through tool-result \`_meta\` only. Use it to open the existing
browser editor, where edits save with version checks and live sync. The card and browser Share panel
also offer confirmed permanent deletion. The view URL never grants mutation access.
Deleting the stored chart invalidates its links but cannot remove copies in chat or downloaded files.
The server's \`FLOW_TTL_DAYS\` setting optionally expires Redis charts after inactivity; it does not
retroactively expire existing records until they are updated. There is no account library or recovery
of a lost edit capability.

## Limits

Up to ${LIMITS.maxNodes} nodes and ${LIMITS.maxEdges} edges per chart. Labels are
at most ${LIMITS.maxLabelLength} characters and titles ${LIMITS.maxTitleLength}. The stored chart is limited to
${Math.round(LIMITS.maxChartBytes / 1024)} KB. The service is free and rate-limited; a refused call says how long to wait before retrying.

## Example: create_flowchart arguments

\`\`\`json
${JSON.stringify(EXAMPLE_CREATE, null, 2)}
\`\`\`

`

export const SERVER_INSTRUCTIONS = `Flowchart AI saves link-shared flowcharts from JSON you compose.
Before create_flowchart, disclose view-link reading, edit-link editing/deletion, no account ownership and indefinite retention unless configured or deleted; obtain deliberate sharing consent and pass sharing: "link-shared".
Return the view url. Private UI controls open the browser editor or delete the chart; never ask for or send edit capabilities in chat/tool arguments.
For conversational revisions, get_flowchart by id, then create a revised copy with consent. Same-chart MCP updates are unavailable.
Use search_icons for local illustrations, search_azure_icons for Azure services, and list_node_types for vocabulary.
Browse list_diagram_templates and get_diagram_template for editable starting points; audit_diagram checks drafts without storing them.
Read flowchart://guide for design rules and examples.`

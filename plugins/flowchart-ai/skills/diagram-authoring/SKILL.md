---
name: diagram-authoring
description: Create link-shared process, architecture or imaginative diagrams with Flowchart AI using local templates and icons, and make conversational revisions as new copies.
---

Use Flowchart AI's MCP to persist diagrams the user asks to save. You supply the diagram reasoning; the tools validate, arrange and store it without calling an LLM.

Before creation, disclose: anyone with the view link can read the diagram; anyone with the private edit link can edit or delete it; charts have no account ownership and remain indefinitely unless operator retention is configured or an edit-link holder deletes them. Obtain deliberate consent to link sharing, including for a revised copy. If the user already consented to this disclosed scope, proceed. If they want a private diagram, explain that this integration does not support that and keep the draft in chat.

Browse `list_diagram_templates` when a starting point helps, then use `get_diagram_template` to obtain an independent editable draft. Categories cover process, business, cloud and creative work. Adapt the draft to the user's intent; imaginative examples are creative prompts, not factual descriptions of real systems. Reading templates does not save or share anything.

Use `list_node_types` when needed for vocabulary, `search_icons` for original local illustrations and Azure services, or `search_azure_icons` for Azure-specific names and aliases. Use returned stable ids in `icon`; prefer local icons over external image URLs. Design a clear trigger and outcome, short action labels, and labeled decision branches. Prefer `TB` for processes and `LR` with architecture nodes/containers for systems. Omit positions for automatic layout; use `{ id, type, label }` nodes and `{ source, target, label? }` edges. Read `flowchart://guide` for detailed schema/design rules.

Use `audit_diagram` to check a draft when useful before creation. Fix blocking validation errors and review suggestions about branches and connections; the audit verifies structure and readability, not factual content. Its normalized nodes and edges provide canonical icon and edge ids. Auditing makes no AI request and saves nothing.

Call `create_flowchart` with `sharing: "link-shared"`, title, nodes, edges and optional direction. Correct all reported validation issues before retrying. Creation is not idempotent: if a timeout leaves the outcome unknown, do not blindly retry and make duplicates; report uncertainty.

Return a concise explanation and the view `url`. The private card shows a responsive diagram preview with local shapes, connections and labels; large charts show a bounded subset, and full artwork is available in the browser. Direct the user to its browser-editing or confirmed-deletion controls. On hosts without MCP Apps UI, the view link still works but private controls are unavailable. Never request an edit token, paste an edit link into chat, or pass one in tool arguments. Never infer permission from host/session metadata.

For a requested revision, call `get_flowchart` with the chart id only to include the user's latest browser changes. Strip stored timestamps/version/id before creating; use the latest nodes and edges, make the requested changes, and create a new copy with sharing consent. Preserve positions if preserving the arrangement; omit them for a fresh layout. State that the original chart still exists. Existing charts are never updated through this MCP.

Browser editing uses the existing canvas, optimistic version checks and live sync. An edit-link holder can permanently delete via the card or the browser Share panel. Deletion invalidates stored-chart links, but cannot erase downloaded copies or diagram content already in chat. Lost edit capabilities cannot be recovered from chat.

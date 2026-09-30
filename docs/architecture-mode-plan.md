# FlowChart AI — Architecture Mode: Design & Phased Implementation Plan

_Planning deliverable from Fable. Baseline verified: 20/20 tests in `src/test/App.test.tsx` pass. No code written yet._

## Core model: mode is a lens, not a filter

`type DiagramMode = 'flowchart' | 'architecture'`, held as React state in `FlowChartEditor`, default `'flowchart'`. Switching mode changes exactly three things — the toolbar palette, the AI behavior (prompt/schema/starter chips), and the default edge styling for new edges. It never transforms existing canvas content; flowchart and architecture shapes coexist on one canvas. All node/edge types are registered unconditionally, so a mixed document always renders.

This guarantees the additive constraint structurally: in flowchart mode the output is byte-identical to today, so the existing tests pass untouched.

**Document state / export-import:** JSON becomes `{ "version": 2, "mode": "...", "nodes": [...], "edges": [...] }`. `mode`/`version` are additive; missing `mode` on import → `flowchart`, so every existing exported file still opens. Node-level arch data (`parentNode`, `extent`, kind fields) and edge-level data (`protocol`, `commStyle`) ride on the React Flow objects, so existing whole-object serialization carries them for free.

**Only decomposition:** the three duplicated `nodeTypes`/`edgeTypes` maps (App.tsx, AIInsertPreviewDialog, PreviewMode) move to a new `src/flow/registry.ts`. Nothing else in App.tsx is refactored.

## New vocabulary

**Arch nodes (6):** `service`, `database`, `queue`, `cache`, `apiGateway`, `externalActor` — one parameterized `ArchNode.tsx` base + six thin `memo` wrappers, reusing the existing 4-handle + inline-edit + NodeResizer pattern. Distinct CSS visuals (cylinder DB, hexagon gateway, dashed actor, etc.) with light+dark variants.

**Protocol-aware edges:** `EdgeStyle` unchanged (path/animation). Protocol semantics live in edge `data`: `protocol` (HTTPS/gRPC/REST/SQL/WebSocket/event) + `commStyle` (sync/async). Sync = solid, async = dashed+animated (reuses existing dash mechanism so GIF export keeps working). Protocol chip rendered next to the label; authored via the existing floating selection toolbar. `prefers-reduced-motion` pauses the animation.

**Containers (Phase 2):** one `container` node type with `containerKind` (vpc/cluster/region/zone/trustBoundary/group), using React Flow 11 native `parentNode` + `extent: 'parent'`. Explicit "Wrap in container" / "Detach" actions in v1. Handles nesting across copy/paste, undo/redo, export/import, delete, and the canvas geometry math.

## AI layer

All access stays behind `api/chat.ts`. Request grows two additive fields: `diagramMode` and `operation` (`generate | refine | edit | review | explain`) + optional `selection`.

- **Sibling skill file** `api/architecture-generation-skill.md` loaded in arch mode — documents the extended vocabulary and, critically, instructs the model to produce good architectures from vague jargon-free prompts via sensible defaults (client → gateway → services → stores, queues between async producers/consumers, trust boundaries around private parts).
- **Schemas:** `FlowchartProposal` extended per-mode (flowchart keeps its narrow enum so it can't drift); new `FlowchartDelta` for surgical edits (returns a diff, not the whole doc — structurally protects untouched nodes); `ArchitectureReview` and `ArchitectureExplanation` with node references for highlight-on-hover. `json_object` fallback retained throughout.
- **AI in context, not just the side chat:** new `CanvasContextMenu` (right-click node/selection/edge/pane → Edit with AI…/Explain/Review/Wrap), a selection-toolbar "AI" button for keyboard/touch parity, delta preview through the existing `AIInsertPreviewDialog` with highlight rings, and an `AIInsightsPanel` for review/explain output that focuses referenced nodes on click. Full keyboard operability and ARIA roles throughout.

## Phases (each independently shippable; existing tests stay green, unmodified)

1. **Architecture mode, vocabulary, protocol edges** — mode switcher, 6 arch nodes, protocol/sync-async edges, registry extraction, versioned export/import.
2. **Containers & boundaries** — container node, wrap/detach, nesting across paste/undo/export/delete, geometry fixes.
3. **Architecture-aware AI generation** — arch skill file, per-mode schema, arch starter chips, icon-as-badge enrichment.
4. **Contextual AI** — surgical edit (delta), review, explain; context menu + insights panel.

**De-prioritized (not in any phase):** auto-layout via `elkjs`, only if revisited after Phase 4.

## Open questions (Fable's recommendations)

1. **Mixed-vocabulary canvases** — allow (mode is a lens). _Rec: allow._
2. **Azure icons in arch mode** — render as a badge on the semantic node vs today's convert-to-`image`. _Rec: badge._
3. **Delete a container** — detach children (they survive) vs cascade delete (draw.io). _Rec: detach._
4. **Drag-into-container auto-attach** — deferred out of Phase 2 v1 in favor of explicit Wrap/Detach; auto-attach adds ~1/3 to Phase 2. _Rec: defer._
5. **Protocol set** — fixed chips HTTPS/gRPC/REST/SQL/WebSocket/event + free-text label. _Rec: as listed._
6. **Surgical-edit contract** — delta schema vs whole-doc refine. _Rec: delta._
7. **PreviewMode with containers** — container as its own step (simple) vs fade-in with first child. _Rec: simple for Phase 2._
8. **Paste id fragility** — `parseInt(node.id)` yields NaN for non-numeric ids; Phase 2 hardens to counter-based enumeration. _Rec: fix as part of Phase 2._
9. **Schema size/latency** — extended enum + new schemas are within limits; review/explain push flowContext tokens up on large canvases. _Low risk, watch._

**Dependencies:** zero new runtime deps through Phase 4.

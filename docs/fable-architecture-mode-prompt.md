# Prompt for Fable — Add a Software Architecture design mode to FlowChart AI

You are working in the **FlowChart AI** repo (`/Users/tmcfarlane/repo/flowchart`), an
open-source, AI-powered diagram tool. Today it generates **flowcharts** from
plain-English prompts. Your job is to extend it so it becomes **more than
flowcharts** — a genuinely good tool for **software architecture design**, in the
spirit of Excalidraw and draw.io: clean UX, simple controls, and AI help woven
throughout rather than bolted on.

Do this **additively**: flowchart functionality must keep working exactly as it does
today. Architecture is a new, first-class **mode** that sits alongside it.

---

## How to work (important — plan before you build)

1. **Explore the repo first.** Read the key files (listed below), run `pnpm install`
   and `pnpm dev` / `pnpm test` to confirm a working baseline.
2. **Propose a design + phased plan** and present it to me for approval. Include: the
   mode-switching model, the new node/edge/container types, how the AI layer changes,
   which files you'll touch, and the phase breakdown with acceptance criteria. Do
   **not** start implementing until I approve the plan.
3. **Build phase by phase.** After each phase: run `pnpm test` and `pnpm build`, add
   tests for new behavior, and give me a short summary + how to try it. Keep each
   phase independently shippable.
4. **Verify before claiming done** — actually run the app and exercise the new flows,
   don't just assert they work.

---

## Repo facts you can rely on

- **Stack:** Vite 6 + React 18 + TypeScript, **React Flow 11** (`reactflow@^11`),
  Vitest + Testing Library. Dev server runs on port **3004** (`pnpm dev`).
- **Core editor:** `src/App.tsx` (~1279 lines — the canvas, state, history/undo,
  keyboard shortcuts, copy/paste all live here). Node/edge type registries are here:
  `const nodeTypes = { step, decision, note, image }` and `const edgeTypes = {...}`.
- **Node components:** `src/components/nodes/` — `StepNode`, `DecisionNode`,
  `NoteNode`, `ImageNode`, plus `NodeStyles.css`. Each wires 4 source + 4 target
  handles and inline label editing.
- **Edges:** `src/components/edges/EditableEdge.tsx` (`EditableEdge`,
  `EditableSmoothStepEdge`).
- **Toolbar:** `src/components/Toolbar.tsx` — tool modes (select/hand/arrow),
  add-node buttons, undo/redo, dark mode, explorer, export.
- **AI (client):** `src/components/AIChat.tsx` and
  `src/components/AIInsertPreviewDialog.tsx` (review-before-insert preview).
- **AI (server):** `api/chat.ts` — a Vercel serverless proxy to **Azure OpenAI**
  that keeps credentials server-side. It uses **structured outputs**: a
  `FlowchartProposal` JSON schema (`summary`, `nodes`, `edges`) with a `json_object`
  fallback, plus `generate` vs `refine` modes. The system prompt lives in
  `api/flowchart-generation-skill.md`.
- **Icons:** `src/utils/azureIconRegistry.ts` builds a name→SVG map from
  `/assets/icons/**/*.svg` at build time (663+ Azure icons) with an alias table in
  `assets/icon-mappings/`. `resolveAzureIcons()` matches AI node labels to icons.
- **Shared types:** `BaseFlowNode`, `BaseFlowEdge`, `FlowProposal`, `EdgeStyle`,
  `HandlePosition` are exported from `src/App.tsx`.
- **Export:** `src/utils/exportUtils.ts` (PNG / SVG / animated GIF), JSON import/export.
- **No persistence layer today** — documents live in memory and via JSON
  import/export only.

---

## Design principles (hold to these)

- **Excalidraw/draw.io feel:** uncluttered canvas, few visible controls, sensible
  defaults, fast direct manipulation. Don't add chrome the user has to learn.
- **Additive, not disruptive:** flowchart mode is untouched. A clear **mode
  switcher** (Flowchart ⇄ Architecture) changes the palette, the AI's behavior, and
  the default node/edge styling — nothing else regresses.
- **AI woven in everywhere, not a corner chat box.** Contextual AI is the headline
  of this product. The user should be able to select a node, a boundary, or a
  region of canvas and ask the AI to act **on that selection in place** — e.g.
  right-click a service → "add a cache in front of this," select a boundary →
  "review this subsystem." The existing side chat can stay, but it must no longer be
  the only way to reach the AI.
- **Inclusive & approachable:** a non-expert should get good results from vague
  prompts ("put a database somewhere sensible") with good defaults and no required
  jargon. Also inclusive in the literal a11y sense — keyboard-navigable, screen-
  reader labels on every control (follow the existing `aria-label` / `title`
  pattern already in `Toolbar.tsx`), visible focus states, and `prefers-reduced-
  motion` respected on any new animation.

---

## Feature scope (prioritized)

Build in roughly this order; treat each as a phase or group of phases.

### 1. Architecture mode + node/edge vocabulary
- A **mode switcher** in the toolbar. Mode is part of document state and is included
  in export/import JSON so a saved architecture reopens in architecture mode.
- New **architecture node types**, registered in the `nodeTypes` map the same way
  the existing four are: at minimum `service`, `database`, `queue`, `cache`,
  `apiGateway`, and `externalActor` (user/third-party/browser). Give them distinct,
  clean visual identities in `NodeStyles.css` and reuse the existing handle + inline-
  edit pattern. Reuse the Azure icon registry where a node maps to a known service.
- **Protocol-aware edges** extending `EditableEdge`: label edges with a protocol
  (`HTTPS`, `gRPC`, `async`/event, `SQL`, etc.) and represent **sync vs async**
  distinctly (e.g. solid vs dashed/animated). Keep the existing `EdgeStyle` union
  working; extend, don't replace.

### 2. Containers & boundaries
- **Grouping/boundary nodes** — VPCs, clusters, regions, trust boundaries — using
  React Flow 11's native `parentNode` + `extent: 'parent'` so children move with the
  container and can be dragged in/out. This is the single biggest gap vs draw.io for
  architecture work.
- Boundaries render behind their children, are resizable (you already use
  `@reactflow/node-resizer`), and are labeled. Copy/paste, undo/redo, and export must
  all handle nested nodes correctly.

### 3. Contextual, incremental AI
- Extend the server (`api/chat.ts`) and system prompt with **architecture awareness**
  — either branch inside `flowchart-generation-skill.md` by mode or add a sibling
  skill file, and extend the structured-output schema to cover the new node/edge
  types and container/parent relationships. Keep the `json_object` fallback.
- Add AI operations beyond one-shot generate/refine:
  - **Surgical edits** — "add a cache in front of the DB" applied as a targeted diff
    to the selected node(s), not a full-canvas regeneration. Build on the existing
    `refine` mode + `AIInsertPreviewDialog` review-before-insert flow.
  - **Review / critique** — "review this architecture" returns findings (single
    points of failure, missing queues, chatty coupling) surfaced in the UI.
  - **Explain** — "explain this diagram" produces a plain-language walkthrough,
    reusing presentation/preview affordances where sensible.
- Wire these into **selection/right-click context actions** on the canvas, per the
  "woven in everywhere" principle above.

### Optional (only if it falls out cheaply — do NOT prioritize)
Auto-layout (elk/dagre) to clean up AI-generated positions. Skip unless a phase
naturally needs it; if you add it, keep it opt-in.

---

## Constraints & non-goals

- **Do not regress flowchart mode.** The existing tests in `src/test/App.test.tsx`
  must keep passing; add tests for new behavior.
- **Preserve the credentials-safe architecture** — all model calls stay behind
  `api/chat.ts`. No API keys in the client.
- **Keep dependencies lean.** React Flow already supports nesting natively; justify
  any new heavy dependency before adding it.
- **App.tsx is already large.** Decompose *only* what this feature touches (e.g.
  pull node/edge registries, mode state, or the AI action layer into their own
  modules). Don't do unrelated refactoring.
- No auth, no accounts, no backend database — this stays a free, no-sign-up tool.

---

## Definition of done

- A user can switch to Architecture mode, drop services/databases/queues/etc., wrap
  them in a labeled boundary, connect them with protocol-labeled sync/async edges,
  and export/re-import the result with mode and nesting preserved.
- The user can select a node or boundary and have the AI act on it in place
  (add/modify/review/explain) with a review-before-apply step.
- Flowchart mode is byte-for-byte unaffected; `pnpm test` and `pnpm build` are green.
- Everything new is keyboard-reachable and screen-reader-labeled.

Start by exploring the repo and coming back to me with your design and phased plan.

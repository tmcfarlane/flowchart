# Candidate A: extend the current Draw controller

Complete the remaining issue #15 tools and commands in custom Draw while preserving Architecture and Flowchart. This candidate keeps existing scene, graph, history, and persistence ownership. Source inspected at `85ec3050aa39248686f31a183420a0b2996d20b1` in `/workspace/flowchart-draw-parity`. This is a design artifact, not implemented behavior.

## Usage first

A new command uses the same action whether invoked through its shortcut, a toolbar button, or the command palette. All actions execute inside DrawCanvas, so they read its current refs and use its existing `preview`, `emit`, and `select` functions.

```tsx
// DrawCanvas: toolbar and palette share the action used by keyboard dispatch.
<button onClick={() => runCommand('flip-horizontal')}>Flip horizontally</button>
// DrawCanvas command branch: pure geometry returns one complete candidate scene.
case 'flip-horizontal':
	return emit(flipElements(draftRef.current, selectedRef.current, 'horizontal'))
// DrawCanvas: crop remains a preview until the session finishes.
const next = cropImage(cropSession.before, cropSession.elementId, nextCrop)
preview(next)
// Enter or Escape finishes cropping, as specified by the baseline.
finishCrop() // calls emit once, clears the crop session, and restores focus
// App: global ownership remains explicit; these are additional props.
<DrawCanvas
	{...existingDrawProps}
	onToggleTheme={() => setDarkMode(value => !value)}
	onRequestClear={() => setDrawClearOpen(true)}
	onEditSelection={ids => openDrawSelectionEdit(ids)}
/>
// App's confirmed dialog invokes existing clearAll once.
```

`runCommand` checks eligibility and settles existing transient work before a persistent edit. It returns without changes for unavailable actions. Commands use the current scene; command definitions never capture a scene snapshot. Snapshot capture belongs to gesture and asynchronous request sessions.

## Existing components and execution flow

`DrawCanvas.tsx` owns `draft`, `draftRef`, `committed`, selection, viewport, tool defaults, pointer gestures, text editing, pending multipoint connectors, and keyboard nudges. `preview` only changes the local drawing. `emit` runs `graphFromElements`, validates the complete scene, rolls back on validation failure, and calls `onChange` once. When App supplies `onUndo`, Draw's fallback local history is dormant.

`App.tsx:1626` routes `handleDrawChange` into `commitDocument`. `commitDocument` stores graph, scene, and mode in one document history entry. Autosave and `useSharedFlow` already consume that document state. Preserve this path for every completed Draw edit. The original React Flow canvases remain in their existing mode branches.

`DrawSceneSvg.tsx` renders saved geometry, frame clipping, image crop, image flips, text, paths, and relationship-driven labels. It does not own scene edits. Laser, lasso paths, crop handles, and search highlights belong beside the current selection overlays, outside `[data-draw-content]`, so they never export or persist.

`drawScene.ts` owns immutable geometry and relationships. `expandSelection` includes groups, frame contents, and bound labels. Deep selection skips group expansion while retaining frame and label expansion. `rerouteBindings` updates arrow endpoints, labels, and reciprocal references. New geometry functions use these helpers and preserve unknown element fields.

`architectureBridge.ts` translates only records with `customData.flowchart`. Freeform shapes remain freeform. Graph projections retain graph IDs, positions, metadata, and hierarchy; ordinary drawing additions must not fabricate graph metadata.

`architectureScene.ts` is the storage boundary. It already accepts image crop and link fields as JSON element metadata and supports embeddable record types, but validates only selected fields. Its appState permits background and grid size only. Editor UI flags, search queries, laser samples, and operation sessions must remain transient.

## Concrete type and signature sketch

These are additions or focused changes, not a new controller, store, or event bus.

```ts
// src/components/DrawCanvas.tsx, private to the controller
interface DrawCanvasProps {
	// Existing props remain unchanged.
	onToggleTheme?: () => void
	onRequestClear?: () => void
	onEditSelection?: (elementIds: readonly string[]) => void
}
type DrawPanel =
	| { kind: 'closed' }
	| { kind: 'search'; query: string; activeId: string | null }
	| { kind: 'commands'; query: string }
	| { kind: 'statistics' }
	| { kind: 'link'; elementId: string; value: string }
	| { kind: 'embed'; value: string }
	| { kind: 'mermaid'; value: string }
interface CropSession {
	elementId: string
	before: ArchitectureScene
	crop: ImageCrop
}
interface LaserSample extends Point { time: number }
type Direction = 'left' | 'right' | 'up' | 'down'
type DrawCommandId =
	| 'flip-horizontal' | 'flip-vertical' | 'link' | 'search'
	| 'commands' | 'statistics' | 'zen' | 'view' | 'theme'
	| 'clear' | 'copy-png' | 'paste-text' | 'crop'
	| 'embed' | 'mermaid' | 'edit-selection'
interface CommandDefinition {
	id: DrawCommandId
	label: string
	shortcut: string
	mutates: boolean
}
function runCommand(id: DrawCommandId): void { throw new Error('not implemented') }
function finishCrop(): void { throw new Error('not implemented') }
// src/utils/drawScene.ts: extend the existing pure domain module
interface ImageCrop extends Bounds {
	naturalWidth: number
	naturalHeight: number
}
function flipElements(scene: ArchitectureScene, ids: Iterable<string>, axis: 'horizontal' | 'vertical'): ArchitectureScene
function cropImage(scene: ArchitectureScene, id: string, crop: ImageCrop): ArchitectureScene
function selectInLasso(scene: ArchitectureScene, polygon: readonly Point[], deep: boolean): string[]
function connectedShape(scene: ArchitectureScene, id: string, direction: Direction): string | null
function createConnectedShape(scene: ArchitectureScene, id: string, direction: Direction): { scene: ArchitectureScene; selectedIds: string[] }
function recognizeStroke(points: readonly Point[]): { type: 'rectangle' | 'ellipse' | 'diamond' | 'line'; bounds: Bounds } | null
// src/utils/drawExport.ts: browser adapter shared by export and clipboard
// Render a captured scene through the same DrawSceneSvg renderer.
function renderDrawBlob(scene: ArchitectureScene, options: { format: 'svg' | 'png'; darkMode: boolean; ids?: readonly string[] }): Promise<Blob>
// src/shared/drawLinks.ts: validate external inputs once, before storage/use
// Http and https only for embeds; links may additionally permit mailto.
function parseDrawLink(input: string, purpose: 'hyperlink' | 'embed'): string
// src/utils/drawMermaid.ts: existing Mermaid parse/layout into drawing records
function mermaidToDrawScene(source: string): Promise<ArchitectureScene>
```

The command descriptor list supplies palette labels and help entries. Shortcut recognition stays close to `onKeyDown`, matching physical codes for Option-modified keys. Do not maintain independent arrays of new commands for help and palette. Discrete command dispatch does not replace pointer gesture dispatch or expose a generic command API to App.

The existing `viewMode` prop means forced read-only presentation. Add a local view toggle and derive `readOnly = viewMode || localViewMode` at one location. All mutation entrances use that value, including paste, cut, upload completion, properties, command actions, undo, redo, and gesture completion. Keep pan, zoom, search, links, and laser available. Local zen state controls chrome and preserves editing capability. Theme remains App-owned.

## Behavior and geometry contracts

- Laser K adds timestamped overlay points and fades them with an animation frame loop. Stop the loop on unmount, blur, and scene replacement. No scene record, history entry, or autosave results.
- Eyedropper I or Shift+S samples stroke; Shift+G samples fill. Use existing element hit testing and current authored paint for a cross-browser implementation. If native EyeDropper is offered for screen pixels, treat cancellation as no change and preserve a canvas fallback. Apply to unlocked selection or defaults through one controller path.
- Lasso records a polygon, determines intersecting geometry, then calls `expandSelection` with the deep-selection modifier. A bounding-box-only test is insufficient for rotated objects and concave lassos. Selection alone does not emit.
- Fill picks a supported closed shape at the pointer and changes its fill once. It does not create raster flood-fill assets. Draw-to-shape runs `recognizeStroke` on pointer release only. An unrecognized stroke remains freedraw. A recognized stroke replaces the preview with one native shape and one commit.
- Crop starts before generic image Enter/double-click label editing. Decode intrinsic image dimensions at the boundary, then operate in source-image pixel coordinates. Account for the image rotation, existing crop, and sign of scale when mapping handles. Enter and Escape finish the crop per baseline. Explicit Cancel and pointer cancellation restore the before scene. The renderer already supports the stored crop object.
- Flip reflects selected geometry around the selection center. Reflect path world points and reconstruct local coordinates; preserve pressures and interior points. Reflect image scale signs and placement. Keep text readable, reposition bound labels through their hosts, and reroute arrows once after the full transform. External bound targets remain unchanged. Reflect fixed binding coordinates only when the corresponding host is reflected. Locked records remain unchanged.
- Connected navigation uses arrow bindings, not proximity alone. Filter directional neighbors and use a stable tie-breaker. Connected creation clones one eligible shape with a fresh ID and fresh bound label IDs, then adds a bound arrow. Avoid copying its unrelated incident arrows or semantic metadata. One keypress produces one document transaction; repeated keydown events may be ignored to avoid accidental chains.
- Link editing uses a focused input and validates before commit. Opening a link requires an explicit user action and uses noopener/noreferrer. An embed is a validated saved URL with a first-party card and explicit open action. If inline content is required, use a small allowlist with sandboxed frames and no raw HTML insertion. Reject executable schemes and avoid automatic remote fetches.
- Search derives text/name matches from current scene and reveals the selected result without changing the document. Statistics derives counts from live elements, files, and serialized bytes. Neither keeps a parallel cached scene model.
- Ctrl+Delete opens a confirmation dialog in App. Confirm calls existing `clearAll`; cancel leaves document unchanged. Do not call `emit(empty())`: `graphFromElements` would preserve graph records absent from that empty element list.
- Plain-text paste inserts text as one element and preserves line breaks. Capture the Shift intent for the next native paste event; branch before the ordinary scene-JSON parser and before its internal clipboard fallback. A drawing JSON string must remain literal text for this command. Clear the intent on blur and after consumption.
- PNG clipboard exports the selection closure, including labels, images, and clip definitions, with tightly computed bounds. Share rasterization with normal image export. Clipboard permission or API failure reports a useful message and does not alter the scene. Copy captures its snapshot synchronously before asynchronous encoding.
- Mermaid conversion uses the existing parser/layout dependencies where supported, creates editable native Draw records, validates before inserting, and reuses `insertComponent` remapping. The async completion must not insert into a replaced document. Report unsupported Mermaid syntax rather than inserting a screenshot or pretending conversion succeeded.

## Selected Draw AI boundary

The existing selected-AI implementation is graph-only: App suppresses the selected edit entry point in Draw and `docs/selected-node-ai.md` declares only Flowchart and Architecture. Merely passing selected graph IDs would omit freeform objects and is not sufficient.

Add a Draw-specific selection contract to the existing authenticated chat route, with bounded IDs, a frozen scene snapshot identifier, and explicit operations over existing elements. Keep its transport validation in shared modules used by server and client. Geometry, relationships, lock checks, and scope checks belong in pure Draw proposal validation. Do not allow arbitrary replacement of `architectureScene` or model-supplied files/URLs.

App owns request cancellation, stale-state checking, the preview dialog, and final document application, reusing the selected-edit lifecycle. DrawCanvas passes selected element IDs on explicit invocation; this is request scope, not another selection store. The request context excludes image bytes. Validate implicit relationship effects, especially deleting a host, moving a frame, and changing bound arrows outside the selected set. Require explicit inclusion or reject the operation. Apply to current document state only after checking the frozen scope and document epoch; graph reconciliation and `commitDocument` must still happen exactly once. The AI design worker should specify the exact operation union before this slice starts.

## Gotchas and existing seams

`setElementProperties` currently mutates selected locked elements. Do not reuse it blindly for fill, eyedropper, link, or AI. Filter eligible IDs while preserving the special unlock action. Deep selection can select locked records, so selection membership is not edit authorization.

`onKeyDown` currently handles Undo/Redo before its viewMode guard, and clipboard handlers have no viewMode guard. A view toggle must close these entrances, not merely hide the toolbar. Zoom/fit bindings currently occur below the view guard; move the nonmutating ones above it.

`onKeyDown` maps Ctrl+/ to help. Change that to the palette and keep ? for help. Test Ctrl+Shift+P before the plain P tool binding, Ctrl+K before K laser, shifted H/V before tool aliases, and Ctrl+Delete before Delete. Preserve Ctrl+Shift+Arrow alignment before Ctrl+Arrow creation. Use `event.code` for Alt/Option commands because macOS can produce non-Latin key values.

External scene reconciliation currently cancels pointer, connector, and point sessions. Extend that same cancellation point to crop, lasso, pending paste intent, and asynchronous work tokens. Keep additive async insertion on the latest scene in the same document; reject results after replacement or mode departure. `draftRef` freshness alone does not distinguish another document.

The current export reads the live DOM. Its selected PNG extraction must not drop SVG definitions or frame ancestors. Prefer one renderer-driven export helper shared by both consumers over a second clipboard-only implementation.

## Safe implementation slices

1. Local command UI and App callbacks: palette, search, stats, zen, read-only view, theme, links, confirmed clear, and plain-text paste. Verify shortcut precedence, editable-target suppression, read-only mutation prevention, and clear undo across modes.
2. Pure geometry plus controller actions: flips and connected creation/navigation. Verify rotated paths, images, groups, frames, bound labels, fixed bindings, and locked elements with model tests and browser history/export checks.
3. Pointer additions: laser, eyedropper, lasso, fill, and draw-to-shape. Verify cancellation, transient overlays, one gesture per commit, and reload persistence for actual edits.
4. Image crop plus common export and PNG clipboard. Verify transformed/cropped images, selected export clipping/assets, native clipboard failure behavior, and crop history.
5. Embeds and Mermaid: validated URL boundary and editable conversion with stale-work protection. Verify native JSON roundtrip, shared persistence, and unsupported input outcomes.
6. Selected Draw AI after its operation contract is approved by the architecture synthesis. Verify actual gateway flow, scope and stale rejection, preview/apply/cancel, undo, and shared persistence.

Slices touching DrawCanvas must be implemented serially or integrated through explicitly assigned regions. Model helpers and dedicated export/AI modules can be authored independently after signatures agree. Each slice needs a rerunnable Chromium script and multiple screenshots in its own `docs/screenshots` directory. Do not claim native macOS execution; use Linux Chromium with explicit Meta/Option emulation labels.

## Rationale and screening

Model the Domain shaped the discriminated panel state and typed crop session instead of several independent modal booleans. Boundary Discipline keeps URL, clipboard, Mermaid, and AI input parsing outside pure geometry. Laziness Protocol keeps `emit`, App history, and the graph bridge as the existing ownership boundaries.

We accept a larger DrawCanvas in exchange for avoiding a second state owner and migrating every existing gesture. Pure model functions hide relationship and geometry complexity behind scene-in/scene-out calls. A global command bus or controller store would expose adapter plumbing to App, duplicate transient state during migration, and make the first feature slice larger. That alternative loses on interface depth and ownership risk for this task.

The red-flag screen finds no proposed parallel scene store, second undo implementation, or externally importable controller internals. The highest remaining risk is the controller's existing loosely typed Gesture interface. Add only the fields each new gesture needs, or narrow new variants with a discriminated union; do not redesign unrelated gesture behavior while completing parity.

Synthesis decision remains with the orchestrator. No implementation deviations exist yet. The first implementation step is the command descriptor/dispatch path plus App-owned theme and confirmed clear callbacks.

## Files read

- `src/components/DrawCanvas.tsx`, including state, emit, reconciliation, export, clipboard, text, shortcuts, pointers, and render sections.
- `src/components/DrawSceneSvg.tsx`, including image crop/flip rendering and record wrapper/export behavior.
- `src/utils/drawScene.ts` and relevant projection/reconciliation sections of `src/utils/architectureBridge.ts`.
- `src/shared/architectureScene.ts`.
- `src/App.tsx`, including history, commitDocument, clearAll, selected-AI call sites, Draw callbacks, presentation, and mode branches.
- `docs/draw-mode.md`, `docs/excalidraw-hotkeys.md`, `docs/selected-node-ai.md`.
- `scripts/verify-draw-hotkeys.py`, its setup and browser helper portion.
- pstack `poteto-mode/SKILL.md`, `poteto-mode/references/codex-tools.md`, `how/SKILL.md`, `architect/SKILL.md`, `architect/references/runner-prompt.md`, `architect/references/rationale-template.md`, and `architect/references/design-red-flags.md`.
- pstack leaf skills `principle-model-the-domain`, `principle-boundary-discipline`, `principle-laziness-protocol`, `unslop`, and `technical-writing`.

No source files changed. No tests or browser verification were run for this read-only design.

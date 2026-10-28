# Candidate B: Draw commands with a scoped AI patch

## Problem and grounding

Issue #15 asks for the remaining Draw tools and shortcuts in the custom SVG editor, while Flowchart and the original React Flow Architecture editor keep their behavior. The current `DrawCanvas` holds transient selection, viewport, pointer preview, and clipboard state. Its `emit` reconciles projected graph elements with `graphFromElements`, validates the whole `ArchitectureScene`, and calls App's `handleDrawChange`. App's `commitDocument` owns a single history transaction across scene, nodes, edges, and mode. Standalone autosave and `useSharedFlow` consume that same document. New tools must enter through this path. They must not create a second persisted drawing model.

## Usage, from the callers

Keyboard, toolbar, context menu, and command palette all resolve an action ID from one Draw command catalog, then call the same controller entry point. Transient tools return an interaction change; document edits return one candidate scene. The controller previews a gesture and calls `emit` once at completion.

```ts
// DrawCanvas keyboard and palette, same action and availability rule.
const action = resolveDrawShortcut(event, drawCommands);
if (action) runDrawCommand(action, currentDrawContext());
<DrawCommandPalette commands={availableDrawCommands(currentDrawContext())}
  onChoose={id => runDrawCommand(id, currentDrawContext())} />

// App integration. App alone owns global UI and document history.
<DrawCanvas onChange={handleDrawChange}
  onGlobalAction={action => action === 'theme' ? toggleDarkMode()
    : action === 'clear' ? requestClearConfirmation()
    : action === 'view' ? togglePreview() : setDrawZen(value => !value)}
  onEditSelection={snapshot => openDrawSelectionEdit(snapshot)} />

// AI apply, after user preview, against the latest document and selection.
const current = drawApi.current?.captureSelection();
if (!current || !drawSelectionIsCurrent(current, pending.scope)) throw new Error('Selection changed');
const result = applyValidatedDrawEdit(current.scene, pending.scope, pending.proposal);
drawApi.current?.replaceScene(result); // one emit, hence one App transaction
```

The exact clear confirmation belongs to App or the existing Toolbar confirmation. `Ctrl/Cmd+Delete` requests that same confirmation. `Alt/Option+R` uses presentation, `Alt/Option+Shift+D` uses App theme, and zen hides editor chrome through an App flag. Draw's local `viewMode` remains a rendering input, not a second global view state. These callbacks need to be optional so Draw presentation has no edit controls.

## Shape and signatures

```ts
type DrawActionId =
  | 'laser' | 'eyedropper' | 'lasso' | 'fill' | 'drawToShape'
  | 'crop' | 'link' | 'flipHorizontal' | 'flipVertical'
  | 'createConnected' | 'navigateConnected' | 'search' | 'statistics'
  | 'palette' | 'plainTextPaste' | 'copyPng' | 'insertEmbed'
  | 'insertMermaid' | 'clear' | 'zen' | 'view' | 'theme';
type DrawCommand = { id: DrawActionId; label: string; shortcut?: ShortcutSpec;
  enabled: (context: DrawContext) => boolean };
type DrawContext = { scene: ArchitectureScene; selectedIds: ReadonlySet<string>;
  tool: DrawTool; viewport: DrawViewport; readOnly: boolean };
type DrawCommandResult =
  | { kind: 'scene'; next: ArchitectureScene; selection?: readonly string[] }
  | { kind: 'interaction'; next: DrawInteraction }
  | { kind: 'global'; action: 'clear' | 'zen' | 'view' | 'theme' }
  | { kind: 'dialog'; dialog: 'search' | 'statistics' | 'palette' | 'embed' | 'mermaid' | 'link' }
  | { kind: 'effect'; effect: 'copyPng' | 'plainTextPaste' };
function executeDrawCommand(id: DrawActionId, context: DrawContext): DrawCommandResult;
function resolveDrawShortcut(event: KeyboardEvent, commands: readonly DrawCommand[]): DrawActionId | null;

type DrawInteraction =
  | { kind: 'idle' }
  | { kind: 'laser'; trail: readonly Point[] }
  | { kind: 'lasso'; points: readonly Point[]; baseSelection: ReadonlySet<string> }
  | { kind: 'crop'; imageId: string; before: ArchitectureScene; crop: ImageCrop }
  | { kind: 'eyedropper'; property: 'strokeColor' | 'backgroundColor' };

type ImageCrop = { x: number; y: number; width: number; height: number;
  naturalWidth: number; naturalHeight: number };
type DrawSelectionSnapshot = { scene: ArchitectureScene; selectedIds: readonly string[];
  documentEpoch: number; sceneFingerprint: string };
type DrawEditScope = { selectedIds: readonly string[]; snapshotId: string;
  sceneFingerprint: string };
type DrawEditOperation =
  | { op: 'update_element'; id: string; changes: DrawEditablePatch }
  | { op: 'remove_element'; id: string }
  | { op: 'add_element'; element: DrawSafeElement };
type DrawEditProposal = { summary: string; operations: readonly DrawEditOperation[] };
function validateDrawEdit(scope: DrawEditScope, context: DrawAiContext,
  untrusted: unknown): DrawEditProposal;
function applyValidatedDrawEdit(scene: ArchitectureScene, scope: DrawEditScope,
  proposal: DrawEditProposal): ArchitectureScene;
```

`DrawEditablePatch` is an explicit allowlist of bounded label, primitive type, finite position/size/angle, stroke/fill/text appearance and opacity fields. No `customData`, `files`, raw HTML, URL, `fileId`, `groupIds`, `frameId`, `containerId`, `boundElements`, or bindings arrive from AI. The client can change a bound label through its text element, but the model cannot forge relationships. Adds use server-issued IDs or validated fresh IDs and a safe primitive vocabulary, with no new assets or links. Remove must close over selected grouped/frame children and bound labels or be rejected. Locked or deleted elements are not editable. For projected `customData.flowchart` elements, the first implementation should reject AI mutation unless the operation is a label or appearance change that `graphFromElements` demonstrably reconciles; never let a patch replace the metadata. This is a meaningful selected Draw AI feature without giving the model arbitrary scene write access.

## Flow and boundaries

`DrawCanvas` remains the interaction shell. The command catalog owns shortcut names, palette entries, help text, and availability, avoiding four hand-synced lists. The executor owns pure scene operations such as flip, flood fill, and connected-shape creation. The canvas owns DOM input, pointer capture, viewport, laser/lasso/crop previews, dialogs, clipboard APIs, and a single call to `emit` for each completed edit. Lasso selects existing objects by geometry and never persists its path. Laser strokes are ephemeral and disappear without history. Eyedropper samples the editor's own rendered scene color, not cross-origin pixels. Fill targets closed editable geometry; draw-to-shape recognizes a completed freehand gesture and replaces that one preview with a primitive before commit. Connected creation uses a new shape and arrow with reciprocal bindings and stable IDs in one transaction; navigation changes selection only.

Clipboard reads are parsed at the DOM boundary. Plain-text paste inserts a text element at the viewport center and must bypass the JSON scene parser only on `Ctrl/Cmd+Shift+V`. Normal paste retains the existing custom MIME behavior. PNG clipboard shares a renderer helper with PNG download and writes a `ClipboardItem` after checking a secure context and user gesture; preserve existing SVG asset inlining and do not fetch arbitrary embed URLs. Image crop uses the existing imported `crop` shape but needs explicit typed bounds validation and a crop gesture with Enter to commit, Escape to restore. Image flips can use existing image `scale` in the SVG renderer; shape/path flips need geometric reflection of points and binding rerouting, not a bare `scale` field.

Embeds are currently admitted by `SUPPORTED_ARCHITECTURE_ELEMENT_TYPES`, but `DrawSceneSvg` renders them only as the generic unsupported placeholder. A working embed needs a supported record shape and a safe URL policy: parse only `https:`/approved same-origin URLs, display a sandboxed viewer outside exported SVG, and export a static link card/fallback. The persisted `ArchitectureScene` rejects top-level fields and `appState` permits only background/grid, so do not store zen, palette, search, or live embed state there. The scene validator accepts unknown per-element fields, but it does not validate crop, scale, link, or embed URL semantics; add narrow validators at creation/import/application, and preserve existing unknown fields. `excalidrawImport.ts` already validates crop geometry. Mermaid conversion should parse a bounded Mermaid subset into native Draw shapes, labels, and bound arrows; never execute Mermaid directives or remote resources. The import preview should report unsupported syntax before any commit.

For AI, extend `ChatRequestSchema` with a discriminated `mode: 'draw-edit'` strict request branch containing a bounded, text-only `DrawAiContext` and frozen selection scope. Do not send `files`, data URLs, arbitrary `customData`, or full raw scene JSON to the provider. Keep the current `generate/refine/edit` schemas and prompts unchanged. `src/shared/server/chat.ts` may choose a dedicated Draw prompt/validator branch but must reuse its existing Azure route, configuration, kill switch, admission lease, budget, timeout, response cap, and safe error handling. Validate the proposal on the server before returning it; validate again in the browser after the async request and immediately before apply. The client captures exact selected records plus relationship dependencies, document epoch, and a scene fingerprint. Abort stale requests. Any scene/selection change between capture and apply rejects the proposal and asks the user to regenerate. Preview a diff before one `replaceScene` call. The app's existing graph selected-node AI remains a separate `edit` contract; routing Draw through that contract would silently turn freeform objects into graph nodes.

## Module map

| Owner | Proposed change |
| --- | --- |
| `src/components/DrawCanvas.tsx` | Thin event adapters, transient interaction state, command dispatch, selection capture, one `emit` boundary. |
| `src/utils/drawCommands.ts` (new) | Authoritative action metadata, shortcut resolution, pure scene transforms and availability. Split pure geometry into `drawScene.ts` only where it is reused. |
| `src/components/DrawSceneSvg.tsx` | Embedded card fallback, safe link affordance, crop/flip rendering. |
| `src/components/DrawCommandPalette.tsx` (new) | Searchable action list derived from command catalog; search/stats dialogs may live here if small. |
| `src/App.tsx`, `src/components/Toolbar.tsx` | Global clear/theme/presentation/zen callbacks; Draw AI session and dialog; existing document commit unchanged. |
| `src/shared/architectureScene.ts`, `src/utils/excalidrawImport.ts` | Narrow crop/link/embed field validation at input boundaries; keep full-scene version 1. |
| `src/shared/drawSelectionEdit.ts` (new) | Dependency snapshot, bounded scope and sparse patch validation shared by browser/API. |
| `src/shared/server/chatSchema.ts`, `src/shared/server/chat.ts` | Strict `draw-edit` request branch and dedicated prompt/validation under existing admission. |
| `src/utils/drawExport.ts` (new, if needed) | One asset-inlining/rasterization path for PNG download and clipboard; no duplicate exporter. |

## Rationale and real cost

This candidate is structurally different from appending every missing feature to `DrawCanvas` branches. One typed command interface lets keyboard, toolbar, help, and palette share IDs and availability. The cost is a command context/result type and a dispatch adapter, plus moving some existing shortcuts into the catalog to avoid two competing paths. The pure executor hides geometry and selection policy behind one call. It does not absorb pointer lifecycles, file APIs, or App state, because that would force DOM and document ownership into a shallow abstraction. A direct-controller approach has fewer new files initially, but adds many branches to the current 847-line component and repeats availability rules in UI and keyboard handling. An App-wide command bus would be deeper in plumbing but leak Draw's transient selection and viewport into App, creating split ownership.

The design applies **Model the Domain** to the discriminated interaction and command results, **Boundary Discipline** to clipboard/import/server parsing, **Type System Discipline** to a separate Draw AI request and allowlisted patch, and **Minimize Reader Load** to the single catalog and short controller-to-model-to-emit path. Open tradeoff: fully live embeds need browser security and export decisions; the safe static card with validated open action should land before any live iframe support. First implementation step: move existing Draw shortcut metadata into the catalog without behavior changes, then add a pure flip command through `emit` and verify persistence, undo, and Architecture isolation.

## Files inspected

`src/App.tsx`, `src/components/DrawCanvas.tsx`, `src/components/DrawSceneSvg.tsx`, `src/components/Toolbar.tsx`, `src/utils/drawScene.ts`, `src/utils/architectureBridge.ts`, `src/utils/excalidrawImport.ts`, `src/shared/architectureScene.ts`, `src/shared/selectionEdit.ts`, `src/utils/selectionEdit.ts`, `src/shared/server/chatSchema.ts`, `src/shared/server/chat.ts`, `docs/draw-mode.md`, `docs/excalidraw-hotkeys.md`, and `/workspace/scratch/issue15-pstack/brief.md`.

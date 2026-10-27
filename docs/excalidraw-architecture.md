# Architecture drawing canvas

Architecture mode uses the official `@excalidraw/excalidraw` React editor (0.18.1).
It provides the drawing model and the same keyboard implementation as the
upstream editor. Flowchart mode keeps React Flow and its step-based presentation.

## Drawing and editing

Switch to **Architecture**, then choose a tool or use its upstream shortcut:

| Tool | Letter | Number |
| --- | --- | --- |
| Selection | V | 1 |
| Hand / pan | H | — |
| Rectangle | R | 2 |
| Diamond | D | 3 |
| Ellipse | O | 4 |
| Arrow | A | 5 |
| Line | L | 6 |
| Freehand | P | 7 |
| Text | T | 8 |
| Image | — | 9 |
| Eraser | E | 0 |
| Keep tool active | Q | — |

The editor's **?** button and **Menu → Help** open its accessible keyboard help,
including platform-specific macOS and Windows/Linux modifier bindings. The
[complete hotkey matrix](excalidraw-hotkeys.md) records every displayed binding,
its implementation owner and verification status. Native
text entry and the Flowchart AI prompt retain normal typing behavior. The
Flowchart editor's clipboard, arrow, undo and Ctrl-wheel handlers are disabled
while the drawing editor is active.

Draw at the pointer, select to format, double-click a shape or arrow to label it,
and use the native selection handles to resize or rotate. The contextual panel
provides color, fill, roughness, stroke style, opacity and typography. Native
groups, frames and semantic architecture containers remain distinct: frames
clip native drawings; groups collect visual objects; semantic containers keep
Graph parent/child metadata and use a reserved native group so their contents
move together.

The upper app palette adds semantic service, database, queue, cache, gateway,
actor, container and Azure icon objects. Their graph metadata remains available
in Flowchart mode, sharing, MCP and AI generation. Protocol and communication
metadata survive native edits. The selected semantic edge controls still allow
protocol and synchronous/asynchronous changes.

The official library supports reusable multi-element components and is saved in
this browser. Hosted library browsing, hosted collaboration, embeds and the
editor's separate AI service are disabled. Use Flowchart AI's **Share**, AI
assistant and import/export controls.

## Storage and compatibility

The version 3 native JSON envelope adds optional `architectureScene` alongside
`nodes`, `edges` and `mode`. Versions 1/2 graph-only documents still import and
retain their previous export format when there is no drawing scene.

```
architectureScene: {
  version: 1,
  elements: [...], // complete native geometry, style, bindings, groups, frames
  files: {...},   // embedded image data, keyed by native file ID
  appState: { viewBackgroundColor, gridSize }
}
```

The stored scene includes deleted-element tombstones for native undo. Only image
files referenced by scene elements are serialized; replacing a diagram does not
carry unrelated assets forward. Selection, open menus, viewport and pointer
positions are transient. The native editor is lazy-loaded and its fonts are
served from this deployment, with no dependency on Excalidraw's CDN.

Standalone documents autosave in browser local storage. A quota failure visibly
asks the user to export JSON or share their work. Share creation, debounced
scene-only edits, REST reads/updates, MCP reads and polling carry the complete
scene. Older graph-only clients' PUT/PATCH operations preserve it; an explicit
`architectureScene: null` in PUT clears it. The native scene is limited to 5,000
elements, 100 image assets and 4,032 KiB, with a 4 MiB total scene-document limit.
Graph-only charts retain the existing 256 KiB budget.

Semantic graph objects are represented by native shapes/arrows with namespaced
`customData.flowchart` metadata, including their original IDs/types/icons and
edge protocol information. Moving or renaming them in Architecture updates the
same graph objects. Duplicates receive independent semantic IDs and bindings.
Freeform objects remain native scene elements; they are retained when switching
to Flowchart and become editable again on returning to Architecture. Flowchart
view shows the semantic graph rather than trying to flatten pen strokes into
process nodes. Graph changes received from MCP are reconciled into the native
scene without erasing annotations or visual styling.

Native drawing operations use Excalidraw's precise undo/redo. Version 0.18.1 has
an upstream keyboard-nudge history gap: a plain arrow-key move changes geometry
without recording an undo increment, reproduced with the unmodified component.
The integration records each completed nudge through the public `updateScene`
API by replaying its cloned before/after elements synchronously under a feedback
guard. Repeated keydown events form one gesture; text fields, view mode and
Ctrl/Meta/Alt modifier actions are excluded. The browser regression script (`python scripts/verify-architecture-history.py
http://localhost:3004`) checks nudge undo/redo and text-entry behavior. No package internals are modified.
App **Undo diagram
import** / **Redo diagram import** restore complete before/after documents,
including the renderer mode, across a document replacement. Exporting JSON keeps
all editable data. Architecture PNG/SVG use native scene rendering; GIF captures
the complete scene as a still frame at the selected duration. Architecture
presentation is a pan/zoom view of the complete drawing; Flowchart presentation
keeps its existing incremental step behavior.

## Model decision

Extending React Flow would require a second drawing engine for freehand paths,
rotation, text editing, snapping, binding relationships, frames, native files and
all upstream shortcuts. Reusing the official editor provides those behaviors and
keeps its exact keyboard implementation. A semantic bridge preserves the
existing graph API instead of converting every imported drawing into a generic
service node. Native scene validation stays dependency-free in shared code; the
large browser editor is not imported into the REST or MCP runtime.

## Parity and verification matrix

The upstream editor and the keyboard help shipped with 0.18.1 are the baseline.
Checked entries have direct automated browser or focused regression evidence.
Other upstream capabilities are marked available rather than claimed as
individually tested on every operating system.

| Capability | State / evidence |
| --- | --- |
| Rectangle, ellipse, independent text, pen, bound arrow | **Verified:** keyboard-led real Chromium drawing workflow |
| Tool letter/number aliases, Q keep-tool toggle | **Verified:** each alias selects the expected native tool |
| Native undo/redo | **Verified:** Ctrl+Z / Ctrl+Shift+Z restores drawing elements |
| Bound arrows follow shapes | **Verified:** native bindings plus bridge endpoint/geometry regression tests |
| Contextual drawing and text properties | Available through the official editor; shown in PR screenshots |
| Rotation, groups, frames, stacking, connector point editing, snapping | Native editor behavior; complete scene fields roundtrip without conversion |
| Semantic container movement and duplicated hierarchy | **Verified:** bridge regression tests plus native Ctrl+D duplicate with independent parent/child references |
| Protocol labels and external endpoint changes | **Verified:** bridge tests preserve/reconcile graph metadata and native bindings |
| Embedded image asset persistence | **Verified:** real REST request above 256 KiB roundtrips through read, PATCH and legacy PUT |
| Local reload and switching modes | **Verified:** scene types/counts survive both operations |
| Native JSON and PNG exports | **Verified:** downloaded files contain/render the complete scene |
| Shared scene-only autosave and remote polling | **Verified:** hook regression and live REST/browser smoke checks |
| AI generation into an existing drawing | **Verified:** live Azure response inserts semantic nodes alongside native annotations |
| macOS modifier bindings | **Verified:** Meta+Z / Meta+Shift+Z with simulated MacIntel/macOS navigator in Chromium; no physical macOS run claimed |
| Lasso / cropping / laser / fill / draw-to-shape | Upstream extras retained where exposed by 0.18.1; not individually regression-tested |
| Mermaid conversion | Upstream extra; not a first-milestone verification target |
| Selected-object AI edits | Separate enhancement [#14](https://github.com/tmcfarlane/flowchart/issues/14) |
| Native `.excalidraw` picker/drop import | Companion PR for [#16](https://github.com/tmcfarlane/flowchart/issues/16) |
| Hosted encrypted collaboration / hosted autosave | Not embedded; Flowchart's existing sharing/storage is used |

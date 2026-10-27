# Draw mode

Flowchart AI has three views of a document:

| Mode | Canvas and purpose |
| --- | --- |
| Flowchart | The existing React Flow editor for process steps and decisions. |
| Architecture | The existing React Flow editor for services, databases, queues, containers, icons and protocol-aware connections. |
| Draw | Our first-party SVG editor for freeform drawing and annotation. |

Draw is implemented in this repository. It does not embed Excalidraw or load its
editor, styles, fonts, hosted service or runtime package. Excalidraw-compatible
file records are retained for import interoperability in the companion import PR.

## Drawing and editing

Choose **Draw** in the mode switcher. Select a tool, or use its letter/number
shortcut, and drag on the canvas. Rectangle, diamond, ellipse, arrow, line, pen,
text, image, eraser and frame tools have their own SVG rendering and editing
logic. **Q** keeps the active tool selected. Tooltips and **?** show shortcuts.

Select an object to change stroke/fill colors, thickness, dashes, hatch fills,
sketch texture, corners or opacity. Text has font-family, size and alignment
controls. Arrows have endpoint decorations and routing controls. Selection
handles resize or rotate objects; connector point handles edit paths. Hold
Shift to constrain drawing, movement or resizing. Hold the right mouse button and
drag to pan from any tool, or use Space-drag or Hand.

Shift-click or drag a selection box to work with multiple objects. Duplicate,
copy/paste, group, lock, align and stacking controls act on the selection. Frames
clip and move their contents. Visual groups and frames remain distinct from
semantic Architecture containers. The Components panel saves reusable selections
in this browser. See the [keyboard reference](excalidraw-hotkeys.md) for implemented
bindings and remaining parity items.

Draw keeps pointer previews separate from document commits. A completed drawing,
move, resize, rotation, erase or keyboard nudge is one undoable transaction. The
app's same Undo/Redo history restores drawings, graph data and mode through an
import or mode boundary. Text fields and the AI prompt retain normal typing and
clipboard behavior.

Text contrast follows the surface behind each label. Labels on filled objects
use the object's visible fill; captions and connector labels use the canvas.
Colors that are already readable stay as authored, and contrast adjustments do
not change the saved drawing colors.

## Existing diagrams and AI

Architecture retains its original canvas, node palette, hierarchy controls and
protocol editing. Selecting Draw does not replace that mode. Freeform drawing
content is retained when returning to either graph view and becomes editable
again in Draw.

Existing graph objects have a drawing projection with namespaced metadata. Moving
or relabeling those objects in Draw updates their existing graph IDs; duplicates
receive independent IDs and parent/connection references. Graph changes from AI
or MCP are reconciled without removing unrelated annotations. Freeform objects
remain drawing elements rather than being converted into generic service nodes.
Selected-object AI editing is separately tracked in issue #14.

## Storage and sharing

The selected mode is saved explicitly. A drawing retained in a document does not
force Architecture to reopen as Draw. Version 4 native JSON stores `mode`, graph
`nodes`/`edges`, and the complete versioned drawing payload. The historical field
name `architectureScene` remains for compatibility:

```json
{
  "version": 4,
  "mode": "draw",
  "nodes": [],
  "edges": [],
  "architectureScene": {
    "version": 1,
    "elements": [],
    "files": {},
    "appState": { "viewBackgroundColor": "#ffffff", "gridSize": 20 }
  }
}
```

Legacy graph documents remain compatible. Experimental version 3 documents that
used Architecture for a drawing migrate to Draw. Version 4 documents with an
explicit Architecture mode keep it, including when drawing content is retained.
Older shared documents without a mode infer Draw from a drawing payload,
Architecture from semantic nodes, or Flowchart otherwise.

Standalone documents autosave locally. A storage quota error prompts export or
sharing. Shared creation, debounced scene/mode-only edits, REST reads/updates,
MCP reads and polling preserve the document. Graph-only writes preserve omitted
drawing and mode fields; `architectureScene: null` explicitly clears a drawing.
The scene limit is 5,000 elements, 100 images and 4,032 KiB, with a 4 MiB complete
shared document limit. Graph-only documents retain the existing 256 KiB limit.

JSON export keeps editable data. Draw SVG/PNG exports use our SVG renderer;
GIF export records a still frame for the selected duration. Draw presentation
shows the complete drawing with pan/zoom. Architecture and Flowchart retain
existing graph presentation behavior. Imported fonts use documented system
fallbacks, and our own sketch/fill rendering can differ from another editor.

## Implementation

- `src/components/DrawCanvas.tsx`: tools, pointer transactions, history boundary,
  selection, properties, keyboard, viewport, assets and export.
- `src/components/DrawSceneSvg.tsx`: our SVG renderer, including paths, markers,
  typography, images, pressure strokes and frame clipping.
- `src/utils/drawScene.ts`: pure geometry, relationships, transforms and editing.
- `src/utils/architectureBridge.ts`: graph/drawing projection and reconciliation.
- `src/shared/architectureScene.ts`: dependency-free validation and limits.

The SVG editor is lazy-loaded. REST/MCP code never imports rendering components.
There are no implicit external drawing-service dependencies.

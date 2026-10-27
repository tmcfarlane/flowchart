# Importing Excalidraw drawings

Choose **Import Excalidraw** in the toolbar's import/export menu or in the welcome panel. You can also drop a `.excalidraw` file onto the canvas. Native Flowchart `.json` files still use the same picker and remain compatible. Format detection reads the file contents, so an empty operating-system MIME type does not prevent import.

Excalidraw drawings open in **Draw**, the dedicated freeform drawing mode. **Architecture** keeps the original React Flow canvas for semantic architecture diagrams, and **Flowchart** keeps its existing canvas. An Excalidraw drawing is validated before the document changes. The confirmation offers two destinations:

- **Insert into current diagram** retains the current graph and drawing, adds the imported scene, and switches to Draw. Imported elements move together to the drop position, or the center of the visible canvas for a picker import. When inserting into an open Draw canvas, its viewport is retained. An Architecture source diagram keeps its semantic nodes, connections, and containers; switching back to Architecture shows that graph in its original renderer.
- **Open as new diagram** replaces the current graph and drawing, switches to Draw, and fits the new drawing into view.

**Cancel** and validation failures leave the document unchanged. Use **Undo** and **Redo** in the top toolbar to restore the entire before/after document, including its mode. Undoing an insertion from Architecture restores the original Architecture canvas and graph. Drawing edits and imports share the application's complete-document Undo/Redo history; the Draw canvas controls use that same history.

Draw uses Flowchart AI's own SVG drawing surface and editing controls. The importer reads Excalidraw files into the shared drawing model, retaining supported element records and image assets as structured data. Shapes remain separate objects rather than a flattened image or generic service nodes. Imported scene data follows the existing local save, application JSON export/import, and shared-chart paths. The storage field remains named `architectureScene` for compatibility; that internal name does not select the editor mode.

Native JSON exports use document version **4** with an explicit `mode`: `flowchart`, `architecture`, or `draw`. That mode wins when reopening the file, so a version 4 Architecture document can retain drawing data while reopening in Architecture. Legacy version 3 documents with Architecture mode and a drawing scene migrate to Draw. Shared charts also store the selected mode explicitly. Older shared charts without a mode open in Draw when they contain a drawing scene; otherwise their semantic graph determines whether to use Architecture or Flowchart.

## File compatibility

Draw uses its own SVG renderer and editing controller. The importer validates both the file structure and the visual features Draw supports before showing the destination dialog.

| Content | Stored data | Draw behavior |
| --- | --- | --- |
| Excalidraw file envelopes, versions 1 and 2 | Supported element records and embedded image files. | Detected by contents, independent of filename or MIME type. |
| Rectangle, diamond, ellipse | Geometry, rotation, drawing order, corners, and paint fields. | Separate shapes with rotation, opacity, stroke color/width, solid/dashed/dotted strokes, solid/hachure/crosshatch/zigzag fills, and roughness. |
| Text and bound labels | Text, original text, typography fields, and container relationships. | Font size, local font-family fallbacks, alignment, and bound labels; labels follow their associated objects. |
| Lines and arrows | Multipoint geometry, arrowheads, elbow settings, labels, and endpoint bindings. | Multipoint, curved, and elbow paths with endpoint arrowheads; attached endpoints follow moved shapes. Pinned elbow constraints have the limitation described below. |
| Freehand drawing | Path points, pressure samples, and styles. | Saved pressure samples produce a variable-width outline when there is one sample per point. Paths without matching pressure samples use the saved stroke width. |
| Groups and frames | Group membership, frame references, frame names, and placement. | Group movement and frame clipping. Architecture semantic containers remain distinct from drawing groups and frames. |
| Embedded PNG, JPEG, GIF, WebP, SVG | Image bytes, dimensions, crop, and flip fields. | Embedded images render with saved cropping and flipping. Images must decode successfully before confirmation. |
| Deleted elements | Surviving element records. | Deleted objects are ignored; references to them are cleared without removing surviving geometry. |
| Embeds, iframes, magic frames, and unknown element types | Nothing is applied. | Import stops with an actionable error. |
| Newer or missing file versions, duplicate IDs, dangling references, malformed geometry/assets, unsupported visual fields | Nothing is applied. | Import stops before changing the document. |

### Rendering differences shown before import

The confirmation identifies compatibility differences before the drawing is applied:

- **Fonts:** Excalidraw's numeric font IDs remain in stored data until a user changes the font. Draw renders them with local handwritten, sans-serif, or monospace fallbacks, so line wrapping and text measurements can differ across machines.
- **Sketch strokes and fills:** Draw supplies its own SVG roughness and hatch textures. The saved geometry and styling fields remain available, while the texture can differ from Excalidraw's renderer.
- **Pinned elbows:** Saved `fixedSegments` and pinned elbow constraints remain in the element records. Draw renders the saved path geometry but does not enforce those constraints during path editing.
- **Pen pressure:** Matching saved samples affect the variable-width outline. Draw uses its own outline calculation, so the stroke texture can differ from Excalidraw's pressure rendering.

Opening and insertion assign new element, group, and file IDs, including repeated imports of the same drawing. Opening keeps every coordinate unchanged; insertion translates the drawing as one unit. Bound text, arrow endpoints, frame membership, and image references are remapped to those IDs. This also prevents reimported `fc-node-*` IDs from colliding with future semantic nodes. Only Flowchart's private `customData.flowchart` bridge metadata is removed from external imports, so a foreign file cannot accidentally edit an existing semantic node through a reused graph ID. Unrelated custom metadata remains intact.

Transient Excalidraw application state such as the original selection, collaboration state, and viewport is not imported. Canvas background and grid size are retained. Element geometry and image data remain in the shared drawing model.

## Limits and errors

The input file must fit within **4 MiB**, contain at most **5,000 elements**, and include no more than **100 image assets**. The restored drawing must also fit the shared drawing-scene limit of **4,032 KiB**, leaving room for the semantic graph and document envelope under the 4 MiB API limit. All geometry must be finite, within ±1,000,000 scene units, with non-negative dimensions. The combined current/imported scene is validated before insertion; large drawings can be opened separately instead.

These checks run through one shared loader for both file pickers and canvas drop. Invalid, empty, unsupported, or corrupt files never partially apply. Only file drags activate the drop target, preserving internal object dragging.

Use the **Image** tool in Draw for image uploads. PNG/SVG file drops show guidance to use that tool; embedded scene metadata in image files is not applied as a diagram import. Export an editable scene as `.excalidraw` to use the validated import and destination confirmation.

## Verification fixtures

`src/test/fixtures/excalidraw/architecture-complete.excalidraw` exercises bound text and arrows, groups and frames, rotation, pen pressure, embedded images, deleted elements, and negative coordinates. Unit tests derive ID-collision, malformed-asset, oversized, and unsupported-content cases from the same fixture. The `native-editor-roundtrip.excalidraw` fixture was exported by Excalidraw and exercises its actual file output. Browser verification imports through the picker and drag/drop, edits objects on the Draw canvas, repeats insertion at a changed pan/zoom, and checks undo/redo and persistence.

# Importing Excalidraw drawings

Choose **Import Excalidraw** in the toolbar's import/export menu or in the welcome panel. You can also drop a `.excalidraw` file onto the canvas. Native Flowchart `.json` files still use the same picker and remain compatible. Format detection reads the file contents, so an empty operating-system MIME type does not prevent import.

An Excalidraw drawing is validated before the document changes. The confirmation offers two destinations:

- **Insert into current diagram** retains the current graph and drawing. Imported elements move together to the drop position, or the center of the visible canvas for a picker import. The existing Architecture viewport is retained.
- **Open as new diagram** replaces the current graph and drawing, switches to Architecture mode, and fits the new drawing into view.

**Cancel** and validation failures leave the document unchanged. Use **Undo import** and **Redo import** in the top toolbar to restore the entire before/after document, including its mode. The native editor's history also covers inserting into a drawing that is already open.

The drawing remains native Excalidraw content, edited by the official editor introduced in #15. It is not flattened into an image or translated into generic service nodes. Imported scene data is saved in the versioned `architectureScene` field and follows the existing local save, native JSON export/import, and shared-chart paths.

## Compatibility

| Content | Import behavior |
| --- | --- |
| Excalidraw file envelopes, versions 1 and 2 | Accepted by content, independent of filename or MIME type. |
| Rectangle, diamond, ellipse | Native geometry, angle, drawing order, stroke/fill styles, opacity, corners, and custom metadata retained. |
| Text and bound labels | Text fields, typography, and container relationships retained. |
| Lines and arrows | Native path points, arrowheads, elbow settings, labels, and endpoint bindings retained. |
| Freehand drawing | Path points, pressure data, and styles retained. |
| Groups and frames | Group membership, frame references, frame names, and placement retained as native relationships. Architecture semantic containers remain distinct. |
| Embedded PNG, JPEG, GIF, WebP, SVG | Bytes and image fields retained. Images must decode successfully before confirmation. |
| Deleted elements | Ignored; surviving elements' references to deleted content are cleared without removing their geometry. |
| Embeds, iframes, magic frames, and unknown element types | Identified and rejected before application, with an actionable error. |
| Newer or missing file versions, duplicate IDs, dangling references, malformed geometry/assets | Rejected before application. |

Insertion always assigns new element, group, and file IDs, including repeated imports of the same drawing. Bound text, arrow endpoints, frame membership, and image references are remapped to those IDs. Only Flowchart's private `customData.flowchart` bridge metadata is removed from external imports, so a foreign file cannot accidentally edit an existing semantic node through a reused graph ID. Unrelated custom metadata remains intact.

Transient Excalidraw application state such as the original selection, collaboration state, and viewport is not imported. Canvas background and grid size are retained. Native element geometry and image data are preserved.

## Limits and errors

The input file must fit within **4 MiB**, contain at most **5,000 elements**, and include no more than **100 image assets**. The restored drawing must also fit the shared Architecture scene limit of **4,032 KiB**, leaving room for the native graph and document envelope under the 4 MiB API limit. All geometry must be finite, within ±1,000,000 scene units, with non-negative dimensions. The combined current/imported scene is validated before insertion; large drawings can be opened separately instead.

These checks run through one shared loader for both file pickers and canvas drop. Invalid, empty, unsupported, or corrupt files never partially apply. Only file drags activate the drop target, preserving internal object dragging.

## Verification fixtures

`src/test/fixtures/excalidraw/architecture-complete.excalidraw` exercises bound text and arrows, groups and frames, rotation, pen pressure, embedded images, deleted elements, and negative coordinates. Unit tests derive ID-collision, malformed-asset, oversized, and unsupported-content cases from the same fixture. Browser verification imports the fixture through both the picker and drag/drop, edits it in the native editor, repeats insertion at a changed pan/zoom, and checks undo/redo and persistence.

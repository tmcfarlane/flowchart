# Excalidraw import fixtures

`architecture-complete.excalidraw` is a deterministic native Excalidraw v2 JSON scene, built against the documented file schema. It deliberately keeps native element records rather than translating them into Flowchart nodes. It is small enough to inspect and use in a real editor when checking import behavior.

The scene contains a named frame; grouped, rotated and styled architecture shapes; container-bound text; a multi-point arrow with bindings and its own bound label; pressure-sensitive pen strokes; a standalone annotation; and an embedded one-pixel PNG. Geometry starts at negative coordinates. Deleted shapes and text exercise tombstone handling. App state includes transient viewport and selection values that should not become imported document data.

`empty.excalidraw`, `future-version.excalidraw`, and `corrupt.excalidraw` exercise failure cases. The unit tests also derive missing-reference, unsupported-content, oversized, duplicate-ID, and invalid-asset cases from the complete fixture.

`native-editor-roundtrip.excalidraw` was exported from Excalidraw 0.18.1 using its `serializeAsJSON` utility after loading the complete fixture. It includes that application's restoration defaults and drawing-order indices. The interoperability unit test verifies those exported records, relationships, and image bytes import unchanged; Flowchart AI's Draw renderer does not require the Excalidraw package. This exported fixture remains static. `python scripts/verify-excalidraw-import.py` uses the synthetic fixture to verify our own Draw surface and regenerate the PR screenshots; it does not load an external editor runtime.

The fixtures are checked in so browser tests and manual review can import exactly the same bytes through the picker and through canvas drag-and-drop. They are test data, not screenshots or flattened renderings.

`negative-local-path.excalidraw` isolates an up-left arrow whose local path points are negative while its width and height are positive. With no surrounding frame to mask its bounds, it verifies that the actual rendered path lands at the canvas drop point after zooming and panning. Local path geometry remains unchanged by insertion.

`dark-pastel-contrast.excalidraw` is a deterministic 12-element regression scene with an explicit dark canvas, three solid pastel-filled nodes, and dark bound labels. Dark-gray standalone captions and arrow labels exercise canvas-aware text contrast separately from text inside filled shapes. Stable `fixtureRole` metadata identifies each object after import assigns new IDs. The fixture contains no image assets or external resources.

# AI for the active board

AI generation now defaults to the active Flowchart, Architecture, or Draw board. The welcome and full prompts expose a **Generate for** selector. Choosing another output mode leaves the current board unchanged until Insert.

Draw proposals contain native editable shapes, standalone text, lines, arrows, and freehand paths. Preview, refinement, presentation, and insertion retain the proposal's captured mode. Insertion preserves the existing graph, authored drawing, and embedded files in one Undo/Redo transaction.

## Verification

The final source is `3cf4f6ad38751971a019f52a336a8a95e9f6eb13`. Later commits add verification artifacts only.

- `npx vitest run`: 728 passed, 3 optional Redis tests skipped, across 48 files.
- `npm run build`: passed, including browser and API TypeScript checks. The existing bundle-size warning remains.
- `python scripts/verify-ai-board-modes.py http://127.0.0.1:3054/`: browser checks cover defaults in all three modes, explicit cross-mode selection, native SVG preview, refinement and presentation, safe request context, exact retained content, atomic Undo/Redo, reload, JSON export, and cancellation with prompt retention.
- `python scripts/verify-ai-board-modes.py http://127.0.0.1:3053/ --live`: the browser called the local API through configured Azure, received a native Draw proposal, previewed without changing the document, and inserted while retaining existing graph, drawing, and asset bytes.

Independent reviews passed the API/shared contract, native materialization, prompt lifecycle, and App/preview integration. They also checked strict provider schemas, rejected injected metadata, shape-aware label containment, document limits, and stale-response handling.

Retention is byte-exact through insertion, Undo/Redo, reload, and export. After subsequent native edits, the browser checks retained graph values and custom data; the existing graph bridge can add normalized mirror fields.

See [deterministic browser results](verification-stub.json), [live browser results](verification-live.json), [live request telemetry](live-browser-telemetry.json), and the [exported document](draw-output-export.json). The live request succeeded on its first provider attempt with `gpt-chat-latest`. No credentials or asset bytes were sent in drawing context.

## Screenshots

- [Before: Draw opens the Flowchart prompt](00-before-draw-ai.png).
- [Draw prompt with its default target](02-full-draw.png).
- [Explicit Draw target while Flowchart remains active](03-cross-target-draw-dark.png).
- [Native preview in dark mode](04-native-draw-preview-dark.png) and [light mode](09-native-draw-preview-light.png).
- [Refined proposal](05-refined-native-draw-preview-dark.png), [presentation](05b-native-draw-presentation.png), and [inserted drawing](06-native-draw-inserted-dark.png).
- [Actual cloud-AI preview](11-live-native-draw-preview.png) and [insertion](12-live-native-draw-inserted.png).

## Scope

Generation accepts at most 100 native elements and 32 points per path. New images, files, groups, and frames are outside the generated proposal format; existing document assets remain intact. Selected-object AI retains its existing contracts. Live verification used the local Azure route; a production gateway and shared Redis were not exercised.

Model the Domain kept output mode attached to every proposal. Foundational Thinking put shared contracts before frontend work. Separate Before Serializing Shared State isolated writers in worktrees. Prove It Works required browser and cloud-AI evidence in addition to the test suite.

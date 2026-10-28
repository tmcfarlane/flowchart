# AI Draw generation

The backend returns a finished Excalidraw v2 drawing to the custom Draw editor. The model supplies a bounded authoring plan. Code owns native metadata, text measurements, shape fitting, final attachments, routing, and geometry validation.

## From a request to a drawing

`api/draw-generation-skill.md` is the runtime guide for Draw requests. It describes supported objects and includes two complete examples. Ordinary diagrams use restrained styling. Requested pen annotations remain supported.

`compileDrawProposal` fits text and shapes before it finalizes connector anchors. Clear authored routes remain intact. Blocked routes use a bounded obstacle search that protects shapes, text, captions, and frame titles. Frame borders remain traversable. Validation checks the resulting native geometry, including the rendered curves of pen strokes.

An invalid layout can receive one model repair within the existing two-request limit and deadline. A repair can change positions, sizes, and path points. It must preserve every element's identity and content, and it cannot add overlap permissions. If the repaired plan still fails, the API returns an error before preview and leaves the board unchanged.

The response retains the bounded source plan for later refinement and includes the required finalized `drawing` file. Preview, presentation, and insertion consume that file. Insertion remaps IDs and translates the scene. It does not compile or route the drawing again. User-requested refinements receive the source plan and can change content.

## Text and file behavior

Generated text uses bundled Noto Sans with shared font metrics and explicit line breaks. Browser editing and SVG export use the same font bytes. The font's license, generator, glyph coverage, and fallback limits are documented in [the font reference](../assets/fonts/noto-sans/README.md).

The renderer adapts low-contrast path ink to the actual canvas surface at a minimum 3:1 contrast. Shafts and arrowheads use the same visible color. Stored colors and geometry remain intact, and colors that already meet the threshold retain their authored appearance.

The Draw export menu downloads the current edited board as `.excalidraw`. Native bindings, frame membership, files, and custom metadata remain in the document. External Excalidraw applications can choose a different sans font, so structural compatibility does not guarantee identical foreign rendering.

The compiler can reject tightly packed drawings that a human could route through curved shapes. It uses conservative obstacle bounds and finite search limits. Explicit pairwise shape-overlap permissions support requested compositions without exempting unrelated text or connectors.

## Verification

Run the automated checks from the repository root:

```sh
npx vitest run
npm run build
```

The [browser evidence](screenshots/draw-quality/README.md) includes the saved crossing before and after compilation, ordinary cloud requests, native edits, history, persistence, JSON export, Excalidraw reimport, and standalone SVG rendering. The browser verifier uses an independent geometry oracle and the actual API handler.

# Selected Draw edits with AI

The custom Draw editor offers **Edit selection with AI** in the selection properties panel. The dialog accepts an instruction, shows the original and proposed drawing, and lists every changed field. **Apply changes** saves one document transaction. Cancel and Escape discard the proposal. Editing an instruction disables Apply until a new preview is generated.

`mode: "draw-edit"` is a separate request contract on the existing `/api/chat` endpoint. Flowchart and Architecture selected-node editing retain their existing `mode: "edit"` contract.

## Supported scope

A request contains at most 50 selected, existing, unlocked rectangles, diamonds, ellipses, lines, arrows, freehand strokes, images, frames, or text elements. A selection containing an unsupported element is rejected before a provider request. Text is limited to 2,000 characters per element; dependencies are limited to 100 records. All coordinates must be finite and within the scene limits.

The proposal contains a summary and at most 50 sparse `update_element` operations, with one operation per selected ID. The accepted changes are:

| Fields | Limits |
| --- | --- |
| `strokeColor`, `backgroundColor` | `#RGB`, `#RRGGBB`, or `transparent` |
| `strokeWidth`, `roughness`, `opacity` | 0–20, 0–3, and 0–100 |
| `strokeStyle` | `solid`, `dashed`, `dotted` |
| `fillStyle` | `solid`, `hachure`, `cross-hatch` |
| `x`, `y` | −1,000,000 through 1,000,000 |
| `width`, `height` | 1–5,000 |
| `angle` | −2π through 2π radians |
| `text` | Up to 2,000 characters |

Geometry changes require a standalone rectangle, diamond, or ellipse with no group, frame, label, binding, or graph projection. Geometry changes to associated shapes are rejected, including when all related objects are selected. Lines, arrows, freehand strokes, images, and frames support safe appearance changes only. Image bytes, crop, arrow points, endpoint bindings, pressure samples, and frame membership remain unchanged. Text changes recalculate width and height using the manual Draw editor sizing rules while preserving font size, font family, and line spacing. Browser glyph measurements widen the shared natural-width estimate for wide characters. Bound labels recenter on their existing host; a bound label requires its unlocked host in the selection. Projected graph labels reconcile through `graphFromElements` while preserving graph IDs, geometry, connections, and other metadata.

This version cannot add or remove objects, change shape types, edit arrow paths, create labels, directly set text geometry, or replace image assets and frame membership. Proposals cannot supply files, URLs, custom metadata, groups, frames, container IDs, or relationships. Unknown fields and explicit null values are rejected. Existing authored metadata, relationships, and assets remain in the local scene.

## Validation and ownership

`src/shared/drawSelectionEdit.ts` defines the strict request context and proposal schema used by the API and browser. Context includes safe selected shape fields and minimal dependency records. Image bytes, file records, links, and custom metadata are excluded.

`src/utils/drawSelectionEdit.ts` captures the full scene signature, sorted selection, dependency context, and document epoch. Any committed scene change conservatively invalidates the proposal, including an unrelated edit. App owns the request token, abort controller, preview state, and document epoch. A mode or presentation change cancels the session. Shared-document replacement and history changes invalidate it.

The API validates the provider response against the frozen context. App validates it again before preview. Immediately before Apply, App checks the live epoch, scene, and selection; the Draw API repeats the live scene and selection check and rejects view-only or unfinished gestures. The sparse patch is revalidated and reconciled through the existing Draw `emit` path. There is no await between the final checks and commit.

The existing Azure route, gateway authentication, kill switch, admission control, deadline, body limits, and provider response byte cap apply unchanged. A sparse proposal uses the existing `json_object` response format. No SDK or dependency was added.

## Verification

Focused commands:

```sh
npx vitest run src/test/drawSelectionEdit.test.ts src/test/server/drawSelectionEditChat.test.ts src/test/AIDrawEdit.test.tsx src/test/DrawSelectionEditBoundary.test.tsx
npx vitest run src/test/server/selectionEditChat.test.ts src/test/AISelectionEdit.test.tsx src/test/DrawCanvas.test.tsx src/test/server/chat.test.ts
npm run build
python scripts/verify-draw-selection-ai.py http://127.0.0.1:3035
python scripts/verify-draw-selection-ai.py http://127.0.0.1:3035 --live
python scripts/verify-draw-ai-text-layout.py http://127.0.0.1:3035
```

The Python verifier drives `/usr/bin/chromium` and writes [screenshots and reports](screenshots/draw-selection-ai/). Its default mode explicitly stubs `/api/chat`; `--live` uses the server's configured provider. Both verify preview isolation, selected scope, exact preservation of an unselected archive and bound arrow, Apply, one Undo/Redo, and reload persistence. The stub run additionally verifies Cancel and browser rejection of an unsafe geometry proposal.

The live run on 2026-10-28 returned HTTP 200 through the local API and configured Azure deployment. The server reported one provider attempt, model `gpt-chat-latest`, and reported token usage. The local run used `AI_ROUTING_MODE=direct`, memory admission, the configured `FLOWCHART_AI_*` values mapped to `AZURE_*`, and `AZURE_REASONING_EFFORT=medium`. This deployment rejects `low`. The managed environment requires Node 24's `NODE_USE_ENV_PROXY=1` with its inherited proxy and CA settings. Gateway authentication and admission are covered by server tests; the live run does not claim a deployed gateway test.

Linux Chromium provides the browser evidence. Native macOS was not available.

## Text layout regression evidence

AI text proposals stay sparse. The editor derives text width and height through `drawingTextSize`, shared with manual text commits. `positionBoundText` supplies the same centering and rotation rules used during manual binding updates. Only the edited label receives derived geometry. Its host, unselected records, relationships, files, and scene settings remain unchanged.

Text uses the manual editor's shared natural line width and explicit newlines, so a long label can extend beyond its unchanged host. Explicit imported line spacing contributes to its saved height. The browser measures wide glyphs with the same font fallback used by the renderer, using an ordinary canvas when OffscreenCanvas is unavailable. Non-browser runtimes retain the deterministic width estimate. The model cannot supply text geometry or font changes.

`python scripts/verify-draw-ai-text-layout.py http://127.0.0.1:3040` runs deterministic browser responses for a 140-character standalone sentence and a rotated, three-line bound label with 28px Mono and line height 1.8. The verifier also covers repeated wide Latin and CJK glyphs and renaming a selected connector label at its path midpoint. All cases start at 83% zoom. The verifier measures rendered text corners in the preview and downloaded SVG, checks PNG content margins and final-line pixels, and verifies one Undo/Redo and reload. It also checks dark and light action contrast, hover styling, and the disabled action for locked selections.

[Before and after screenshots, exported SVG and PNG files, and measurements](screenshots/draw-ai-text-layout/) record the Chromium run. `before.json` records both original clipping failures. `verification.json` records the fixed bounds. The existing live Azure evidence above remains valid; the layout regression uses browser stubs and makes no provider call.

Additional focused tests:

```sh
npm test -- --run src/test/drawSelectionEdit.test.ts src/test/DrawShapeLabels.test.tsx src/test/drawScene.test.ts src/test/AIDrawEdit.test.tsx src/test/DrawSelectionEditBoundary.test.tsx src/test/server/drawSelectionEditChat.test.ts
```

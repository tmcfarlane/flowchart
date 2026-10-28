# Draw media independent review

The goal is to complete issue 15 clipboard and image crop behavior in the custom Draw editor while preserving the existing graph modes, scene persistence, and one transaction per completed edit.

Verdict **ISSUES**. Four actionable correctness findings remain. The first has two independently reproduced paths.

Reviewed `/workspace/flowchart-draw-media` at exact HEAD `13218d6ac2159b27af231d1b1b57825ac172c098` against `85ec3050aa39248686f31a183420a0b2996d20b1`. This was a read-only source review and independent Linux Chromium execution against port 3033. No source edits, commits, PR operations, or nested agents occurred. The checkout is clean after removing Python import bytecode created by the review.

## Findings

### P1. Plain-text paste commits unfinished previews and leaves the displayed scene different from the saved scene

Locations are `src/components/DrawCanvas.tsx:375`, `:386`, `:552`, and `:568`.

`pasteText` appends to `draftRef.current`. The new Ctrl+Shift+V branch returns before the pending-connector cancellation block. Its asynchronous guard compares only the committed scene and scene epoch, neither of which changes when a crop or connector preview starts.

Reproduction A in real Chromium:

1. Import the two-object fixture in `review_media_browser.py`.
2. Press A, click once to start a multi-click arrow, and move the pointer to preview its next segment. The DOM contains three elements and the saved scene contains two.
3. Put `hello` on the real clipboard and press Ctrl+Shift+V.
4. After autosave, the saved scene contains the original two objects, the unfinished arrow, and the pasted text.
5. Press Escape. The DOM returns to two objects, while the saved scene still contains all four.

The arrow should be discarded before a standalone paste command commits. Escape must not hide a saved text insertion or leave the saved document different from the displayed document.

Reproduction B isolates asynchronous completion with a controlled clipboard promise in real Chromium:

1. Select the image, start Ctrl+Shift+V with `navigator.clipboard.readText` held pending, and press Enter to open crop.
2. Change the crop width from 320 to 250 without finishing.
3. Resolve the clipboard promise with `delayed paste`.
4. The crop dialog remains open, but the saved scene now includes both the crop and the pasted text.
5. Click Cancel crop. The DOM returns to two objects, while the saved scene retains three objects and the crop.

This violates crop cancellation and its single-transaction boundary even though committed-scene replacement guards pass. The paste completion must reconcile or reject active transient edits, and mutations must not accidentally commit their draft state.

Evidence is `review-media-browser.json` and `review-media-async.json`. Rerun `python /workspace/scratch/issue15-pstack/review_media_browser.py` and `python /workspace/scratch/issue15-pstack/review_media_async.py` from the reviewed checkout.

### P2. Keyboard users cannot enter the crop controls after opening the dialog

Locations are `src/components/DrawCanvas.tsx:478`, `:541`, and `:942`.

Select an image with the canvas focused and press Enter. Focus remains on the Draw canvas. Press Tab. Focus still remains on the Draw canvas because the crop guard prevents every remaining key, including Tab. There is no initial focus transfer into the dialog. The crop fields and Cancel button cannot be reached through the advertised keyboard entry path. The JSON reproduction records the same active-element markup before and after Tab.

Move focus into the crop dialog and allow normal keyboard navigation through its controls while suppressing canvas commands.

### P2. Enter on Cancel crop commits the crop

Location is `src/components/DrawCanvas.tsx:942`.

Open crop, change width from 320 to 250, focus the Cancel crop button, and press Enter. The dialog's bubbling key handler calls `finishCrop`, prevents the button's native activation, and closes the dialog. After autosave the image has a saved crop width of 250. A pointer click on Cancel correctly cancels, so the two activation methods disagree.

The dialog must preserve the focused button's Enter activation. This is independently reproducible after reaching the controls with the mouse, and is not resolved merely by fixing initial focus.

### P2. Dragging a crop on portrait images uses the wrong horizontal scale

Locations are `src/components/DrawCanvas.tsx:493` and `src/components/DrawCanvas.css:32`.

Import a 200 by 800 image, open crop, and set its crop width and height to 150 and 600. The preview SVG box measures 286 by 230 CSS pixels. Its default SVG aspect-ratio behavior letterboxes the source to 57.5 by 230 pixels. The actual screen CTM has scale 0.2875 on both axes.

Drag the southeast handle 10 CSS pixels left and up. The resulting crop width is 143.01 and height is 565.22. Both dimensions should decrease by approximately 34.78 source pixels, which would produce width 115.22 and height 565.22. The handler divides horizontal movement by the entire 286-pixel SVG width instead of the rendered image width. The crop handle therefore fails to follow the pointer horizontally.

Use the SVG screen transformation to map pointer positions into source coordinates, or size the SVG so its box matches its viewBox aspect ratio. The browser reproduction records the element rectangle, CTM, and resulting fields.

## Verification and limits

The focused command `npx vitest run src/test/DrawMedia.test.tsx src/test/DrawCanvas.test.tsx src/test/drawScene.test.ts src/test/DrawSceneSvg.test.tsx` passed all 58 tests across four files. The tests exercise literal JSON/text, own MIME remapping, rotated and flipped crop math, repeated crop equivalence, malformed crop validation, one commit on finish, no commit on pointer cancellation, view-mode cancellation during decode, and scene replacement during pasted-image decode.

The committed browser verifier passed unchanged except for redirecting its screenshot output to scratch. It produced a real 11,960-byte PNG and four screenshots. Its native Ctrl+Shift+V multiline paste and external PNG paste passed. It does not cover the modal focus or transient-state races found above. I inspected the committed crop screenshot and the independent selected PNG artifact.

Independent native Ctrl+C/Ctrl+V of a selected frame copied its child rectangle and attached label with new consistent frame and container references. Selected PNG export produced 728 by 528 pixels for a 300 by 200 frame plus the shared export padding at 2x scale. The PNG visibly contains the frame, attached label, and hatched fill. The distant unselected rectangle is absent. This confirms retained SVG definitions and selection closure in the exercised frame case. Source inspection confirms the same exporter and raster path handle download and clipboard output.

After finishing a crop, zooming and panning, and reloading, the saved architectureScene was identical. This is recorded in `review-media-additional.json`. `review_media_additional.py` is rerunnable from the checkout. Undo history across reload is outside this slice and was not treated as a requirement. Native macOS remains unverified in this Linux environment.

## Introduced-comment report

The exact source diff introduces no TypeScript or CSS comments and no lint or TypeScript suppressions. One new Python module docstring at `docs/screenshots/draw-media/verify_draw_media.py:1` narrates how to run the verifier. Under the supplied comment-sicko rules it is a removal candidate, since the same command is documented in `docs/draw-media.md` and it does not state a public API contract or an external constraint. This is non-blocking relative to the correctness findings.

No comments were deleted or restored in this read-only review. There are no HOLD comments, suppression findings, constraint encodings, or application-code MUST KILL flags. Existing exporter and pending-connector comments are unchanged and outside the introduced-comment scope.

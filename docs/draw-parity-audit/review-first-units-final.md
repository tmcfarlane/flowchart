# Independent final gates for issue 15 units 1 and 2

The goal is to complete the custom Draw editor commands and geometry while preserving Architecture and Flowchart behavior. This review rechecked the first two proposed PRs after the earlier findings were fixed. It made no source edits, commits, or PR actions and spawned no agents.

## Unit 1. ISSUES

Reviewed `42c0a814f8ddf224d0b5bb2f8e37e3d937407813` against `85ec3050aa39248686f31a183420a0b2996d20b1`.

One proved P2 remains. **Native Cut deletes the selection behind the statistics modal.** In the exact commands commit, `src/components/DrawCanvas.tsx:383-393` routes native cut events to `writeClipboard`. That function checks editable targets and read-only mode but does not check an open modal. Stopping the modal's keydown propagation does not suppress the native clipboard event.

Reproduction in Linux Chromium:

1. Import one rectangle, select it, and open Drawing statistics from the palette.
2. Keep focus on the dialog's Close panel button and press Ctrl+X.
3. Wait for draft persistence. The rectangle disappears and localStorage records `isDeleted: true` while Drawing statistics remains visible.

The rerunnable reproduction is `/workspace/scratch/issue15-pstack/review-first-final-browser/prove-modal-cut.py`. It passed its defect assertion against the exact commands archive at port 3049. The same reproduction also ran against the integrated detached checkout at port 3048. The screenshot is `/workspace/scratch/issue15-pstack/review-first-final-browser/statistics-cut-bug.png`. The fix must isolate native clipboard mutation events while a modal is open and preserve clipboard editing inside modal text inputs. Add a native Ctrl+X regression that waits for document persistence. An immediate localStorage comparison can miss this failure because autosave is delayed.

The previously reported focus and Delete defects pass their requested checks. Palette execution of View returns focus to the canvas and Alt+R exits without manual refocus. Closing search returns focus. Statistics and help receive focus, trap Tab, and block Delete. Clear confirmation initially focuses Cancel, wraps Tab, blocks Delete, accepts native Enter on Cancel, and restores canvas or toolbar-button focus. Confirmation followed by Undo restores the scene. Reentering edit mode after a prior clear request does not reopen the old confirmation.

Independent verification used a `git archive` of the exact commands SHA under `/workspace/scratch/issue15-pstack/review-first-final-browser/unit1` and a fresh Vite process on port 3049. `npx vitest run src/test/DrawCommands.test.tsx src/test/DrawHotkeys.test.tsx src/test/DrawCanvas.test.tsx src/test/App.test.tsx` passed all 70 tests. The supplied command browser verifier and the supplied focus verifier passed. The latter was copied to scratch and strengthened to select the rectangle before statistics and help, so Delete had an actual mutation target. Screenshot output went to scratch.

Source inspection confirms that App's local-view ref guards `commitDocument`, Undo, and Redo. Draw's `emit`, clipboard mutation paths, insertion, and image decode completion check read-only state. The toolbar initializes its consumed request from the current clear counter. Browser tests cover view deletion suppression and counter consumption. Delayed import or live AI races were not separately driven.

## Unit 2. PASS

Reviewed `c99b1c92af0b4f890d0657f2760c2cd828775c70` against parent `42c0a814f8ddf224d0b5bb2f8e37e3d937407813` in the stable detached checkout `/workspace/flowchart-draw-first-review`.

No new proved issue was found in this unit's delta. The inherited Unit 1 clipboard defect still blocks opening a verified contiguous stack until fixed and independently rechecked.

The bound-label fix excludes labels whose host is outside the eligible flip targets. Pure regressions cover both axes and unlocked and locked hosts. Controller regressions deep-select the label, press Shift+H and Shift+V, and assert no scene change or commit. These regressions pass.

The rotated path regression now checks authored width and height, world vertices, pressure samples, and rendered bounds for both axes. It no longer relies only on vertices that ignore dimension metadata. The fixed-binding regression checks both fixed-point records and both endpoints, including the moved endpoint against the transformed rotated host. A separate selected-arrow case checks its attached start endpoint, external end endpoint, and fixed-point records. These assertions directly cover the earlier missing invariants.

`npx vitest run src/test/DrawCommands.test.tsx src/test/DrawHotkeys.test.tsx src/test/DrawCanvas.test.tsx src/test/drawGeometry.test.ts src/test/App.test.tsx` passed all 85 tests at this exact head. A fresh Vite process served this checkout on port 3048. The geometry browser verifier passed connected creation, navigation without scene mutation, Undo and Redo, both path flips, dimension metadata and rendered size preservation, concave lasso selection, cancellation, and export-overlay separation. Its script copy redirected screenshots to scratch. Rotated path and fixed-binding proofs are unit tests, not Chromium claims.

Conflict-resolution inspection confirms that help retains the command catalog and the new connected-shape, navigation, and flip entries. The merged controller retains lasso cleanup on scene replacement, read-only transition, tool changes, Escape, pointer cancellation, and lost pointer capture. The supplied focus checks also pass at this head.

## Introduced-comments report

PASS for each exact unit. Neither unit introduces code comments, docstrings, lint suppressions, or TypeScript suppressions. The earlier geometry verifier docstring has been removed. Existing comments in surrounding source are outside this review's introduced-comment scope. Review deletions 0, restorations 0, HOLD 0, MUST KILL 0, comment reruns 0, encoding offers 0, encodings 0, and comment-related open work 0. No architecture sketch or source fixes were made.

## Method and limits

Read the task brief, design, both earlier reviews, poteto-mode and its Codex mapping, no-comments and comment-sicko, Prove It Works, unslop, and technical-writing. Prove It Works changed the method by requiring fresh Chromium runs against the exact artifacts and persisted-state proof for the clipboard finding. Both exact diffs pass `git diff --check`. The detached checkout remains clean at `c99b1c92af0b4f890d0657f2760c2cd828775c70`. No tracked screenshots were changed. Native macOS was unavailable. This review did not rerun a production build or the full repository suite.

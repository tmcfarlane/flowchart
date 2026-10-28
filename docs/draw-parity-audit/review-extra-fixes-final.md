# ISSUES

Review the remaining issue 15 tools in the custom Draw editor while preserving document history and the existing graph modes.

Reviewed exact head `8af65a1495e1df9bc665aa8c4cb956a5f4fd6573` against `85ec3050aa39248686f31a183420a0b2996d20b1` in `/workspace/flowchart-draw-extra-fixes`. Also compared the fix commit with the previously reviewed `cc06a759b5935bba68e4eee6f1559f6d7fdd40c4`. HEAD matched before and after review. The checkout remains clean. No source edits, commits, PR actions, or nested agents.

All four original findings are resolved at this head. One separate P3 parser issue remains.

## Finding

**P3. Trailing whitespace after an LR header silently changes the imported direction.** `src/utils/drawExtraTools.ts:77`. The parser trims each line before validating the header at lines 50 and 51, but direction detection re-reads the untrimmed first line. `flowchart LR\nA --> B` produces rectangles at `(0,0)` and `(260,0)`. `flowchart LR   \nA --> B` is also accepted but produces rectangles at `(0,0)` and `(0,140)`. A user pasting valid LR source with trailing spaces gets a vertical diagram. Capture the direction from the normalized validated header and use that value for layout. Add a whitespace regression for the accepted header forms.

Proved by importing the actual Vite-served module in Chromium. The rerunnable probe and captured result are `/workspace/scratch/issue15-pstack/extra-final-browser/header-direction.py` and `header-direction.json`. The integrator has received this finding. This verdict applies to the named head, not a future correction.

## Original findings

1. Interrupted laser trails now clear through `cancelLaser`. The focused tests cover undo, scene replacement, view mode, Escape, pointer cancellation, lost capture, and blur. The full Chromium verifier reproduces the former undo failure and passes. A separate real-component Chromium probe passed replacement, Escape, blur, lost capture, cancellation, and view transitions without a document commit. The cleanup tracks completed-trace timers and clears them on cancellation and unmount. The independent probe observed a scheduled 900 ms laser timer and its disposal on unmount.
2. Ordinary eyedropper activation now establishes `strokeColor`, including both I and the menu. Shift+G still explicitly chooses fill. Tests exercise a selected recipient and the browser verifier exercises both ordinary activation paths after fill sampling. Both pass.
3. Mermaid edge-label width now follows the text length, and LR column spacing reserves visible connector ends. Focused geometry assertions and Chromium DOM assertions pass for `go` and `Continue through the review`. Direct inspection of committed screenshots 09 and 11 confirms a visible line at each end and a visible destination arrowhead. The long label has generous horizontal spacing but remains readable and connected.
4. Opening either dialog cancels the pending click connector before submission. Both component tests and real-browser flows pass. Mermaid imports exactly six elements for the two-node labeled example, with one bound arrow and one commit. The embed flow adds exactly one card. Neither retains the unfinished arrow preview.

## Verification and limits

Ran `npx vitest run src/test/drawExtraTools.test.ts src/test/DrawCanvas.test.tsx`. Both files passed, 39 tests total. These tests include recognition, invalid embed URLs, Mermaid rejection, bound-label movement, transient laser behavior, and the four regressions.

Started an independent Vite server on port 3147 from the reviewed checkout. Ran the supplied Python Chromium verifier after changing only its output directory in a scratch copy. It passed with 12 retained elements, undo and redo, reload, JSON export and import, static SVG export, all four regressions, and eleven new scratch screenshots. The script is `/workspace/scratch/issue15-pstack/extra-final-browser/verify.py`. Tracked artifacts were not overwritten.

Ran additional checks against the actual DrawCanvas component in Chromium using a scratch script at `/workspace/scratch/issue15-pstack/extra-final-browser/independent.py`. It passed the six laser interruptions listed above, no laser commits, a dialog submit blocked after switching to view mode, an import retaining the current replacement scene, locked-shape fill rejection, and unmount timer disposal. Initial probe attempts needed harness corrections for CommonJS default imports and timer-check tool activation. The corrected final script passed. These setup failures are not application findings.

Read the full introduced source diff and the surrounding gesture, commit, selection, validation, and rendering paths. New pointer actions respect view mode, sampling filters locked recipients, fill checks locked targets, dialog submission checks current view mode, and imports use the current scene after a replacement. There is no new asynchronous scene-authoring operation in this unit. Laser timers alter transient overlay state only. Embed activation validates HTTPS again, uses `sandbox="allow-scripts"` without same-origin access, and exports a static card. No new stale-scene overwrite or executable URL bypass was proved.

`git diff --check 85ec305` passed. Native macOS was not tested. Cyclic Mermaid layouts may overlap as documented. This review does not claim exhaustive gesture concurrency or every topology and transform combination. The Prove It Works principle changed the review method by requiring observed browser behavior and current scene data rather than relying on passing tests or worker screenshots alone.

## Independent no-comments audit

Applied the requested no-comments and comment-sicko criteria to introduced lines in the entire unit diff. No introduced TypeScript, CSS, or Python narration comments, correctness suppressions, or type suppressions remain. The previously flagged verifier docstring is removed. Its author-side deletion count is one. Reviewer deletion count is zero because this checkout is read-only. No MUST KILL flags, restored comments, HOLD comments, comment-review reruns, architecture sketches, encoding offers, encodings, or unenforced constraints. Existing nearby comments are outside the introduced diff and were skipped. No nested comment agent was spawned, as the review assignment prohibited nested agents; this independent reviewer performed the audit directly.

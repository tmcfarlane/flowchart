# Commands review

ISSUES. The goal is to finish issue 15's custom Draw commands while preserving Architecture and Flowchart behavior.

Reviewed exact head `19cc43651c3f927d4bc7b755a03928a2e448bc9a` against `85ec3050aa39248686f31a183420a0b2996d20b1` in `/workspace/flowchart-draw-commands`. No application edits, commits, or PR actions were made.

## Concrete findings

1. **P2. Closing a command panel loses keyboard focus, including the view-mode exit shortcut.** `src/components/DrawCanvas.tsx:469` removes the focused palette without returning focus to the canvas. The close button at line 924 and successful link save at line 487 do the same. Browser reproduction: open Draw, focus canvas, press Ctrl+/, filter `view`, press Enter, then press Alt+R. View mode remains enabled. Chromium reports `document.activeElement.tagName === 'BODY'` both before and after Alt+R. Clicking the canvas restores the shortcut. A second reproduction opens search with Ctrl+F, clicks Close panel, then presses Ctrl+/. No palette opens, and focus is BODY. Restore canvas focus after panel dismissal and command execution; keep focus inside a replacement panel when the command opens one. Test this with actual keyboard events without manually refocusing between steps.

2. **P2. New modal entry paths allow drawing mutation underneath the modal.** `src/components/Toolbar.tsx:69` opens the confirmation from a shortcut without moving focus. `src/components/DrawCanvas.tsx:490` only focuses inputs, so statistics has the same problem; its key handler at line 493 also allows editing shortcuts from non-input panel controls to bubble through. Browser reproduction: import a Draw document containing one rectangle, click it, focus the canvas, press Ctrl+Delete, wait until the Clear the entire board? dialog is visible, then press Delete. The dialog remains visible while localStorage persists the selected rectangle with `isDeleted: true`; Cancel does not undo that edit. Chromium reports the active element as SECTION. Independently, select the restored rectangle, press Alt+/, wait for Drawing statistics, then press Delete. The same persisted deletion occurs behind statistics. Modal focus must move into the dialog, remain there while open, and editing shortcuts must not reach the canvas. Include native button activation and input editing in the regression checks.

## Method and evidence

- Read the brief, design, poteto-mode, Codex mapping, no-comments, and comment-sicko guidance. Applied Prove It Works by driving the exact checkout in real Chromium instead of relying on test success or saved screenshots.
- Inspected the full production diff and adjacent scene emit, keyboard, import, history, shared-document, and AI integration code. The App commit/undo/redo and Draw emit/clipboard/image guards block local writes while local view is active. Image upload rechecks the committed scene after decoding. Toolbar clear counters initialize from the current request, avoiding replay on remount. Existing graph shortcuts bypass Draw, and view state resets when diagram mode changes. These are source-inspection observations, not exhaustive async race proof.
- `npx vitest run src/test/DrawCommands.test.tsx src/test/DrawHotkeys.test.tsx src/test/DrawCanvas.test.tsx` passed 47 tests. `npx vitest run src/test/App.test.tsx` passed 23 tests, including existing confirmation and undo behavior.
- Reran the supplied `verify_draw_commands.py` against its existing Vite process on port 3031, confirmed that process serves this checkout, and redirected screenshots to `/workspace/scratch/issue15-pstack/review-commands-browser`. It passed. Its repeated `focus(page)` calls mask finding 1, and it never attempts editing while a modal is open.
- Inspected the committed palette and view-mode screenshots. They show the intended panels and hidden mutation chrome. Browser runs additionally exercised links, search, statistics, clear cancellation, clear confirmation, undo, and clear-counter remount behavior through the supplied verifier.
- Reproduced both findings with independent Python Playwright sessions in Linux Chromium. No native macOS runtime was available. No live AI service request or delayed import race was exercised. Original-mode history was covered by existing App tests and code inspection, not a new cross-mode browser sequence.

## Introduced-comments report

PASS. No introduced code comments or suppressions were found in the scoped diff. Existing comments remain outside this introduced-comments review. Deletions 0, restorations 0, HOLD 0, MUST KILL 0, reruns 0, encodings 0, and no comment-related open work. No nested agent was spawned, per the review brief.

The gate remains ISSUES until the two focus and modal keyboard defects are fixed and rechecked on the replacement SHA.

# Verify locked Draw selection

Start the development server, then run the browser verifier from the repository root. It requires Python Playwright and Chromium at `/usr/bin/chromium`.

```sh
npm run dev -- --host 0.0.0.0 --port 3051
python scripts/verify-draw-lock-selection.py http://127.0.0.1:3051/
```

Expect both lines to begin with `PASS`. The verifier checks ordinary selection after locking and deselecting, protected edits, copy/export, unlocking, dragging, undo/redo, reload, mixed selections, and switching modes with a retained graph node. It also checks locked groups, frame children, and deep-selected bound text. Unlocking a protected child explicitly unlocks its locked owner in the same transaction.

Inspect the generated evidence:

- [Locked selection in dark mode](01-locked-selection-dark.png).
- [Locked selection in light mode](02-locked-selection-light.png).
- [Unlocked object after dragging](03-unlocked-and-moved.png).
- [Mixed selection](04-mixed-selection.png).
- [Export containing locked objects](locked-selection.svg).

Run the focused regressions and build:

```sh
npx vitest run src/test/DrawCanvas.test.tsx src/test/drawScene.test.ts src/test/drawGeometry.test.ts src/test/DrawHotkeys.test.tsx src/test/DrawShapeLabels.test.tsx src/test/DrawCommands.test.tsx src/test/DrawMedia.test.tsx src/test/drawSelectionEdit.test.ts src/test/DrawSelectionEditBoundary.test.tsx src/test/drawExtraTools.test.ts
npm run build
```

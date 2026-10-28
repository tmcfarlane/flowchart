# Draw quality verification

Goal 37 passes at source `880b6834b180e42907c74a2b4fb6c21163abcca7`. The saved handoff arrow clears the action card, generated words remain intact, and shafts and arrowheads stay visible on both canvas themes. The independent reviews also verified fixes for pen curves crossing text, short markers overlapping their source, and layout repair dropping content.

The original morning and workshop cloud requests ran at `b478259`, before the final path contrast fix. Their exact API responses, screenshots, and [original functional report](verification-live.json) remain unchanged. The final runs replay those exact saved source plans through the real `handleChat` and compiler at `880b683`. They use a local provider fixture and make no new cloud requests. Both finalized files match the original cloud files with zero translation, zero ID changes, and unchanged stored colors.

| Final run | Result | Minimum dark path contrast | Minimum light path contrast |
| --- | --- | --- | --- |
| [Saved crossing](verification-captured.json) | Pass | 3.33:1 | 3.54:1 |
| [Exact morning replay](verification-morning-replay.json) | Pass | 15.41:1 | 7.58:1 |
| [Exact workshop replay](verification-workshop-replay.json) | Pass | 15.41:1 | 10.35:1 |

The checks use independent segment intersections and marker envelopes against unrelated objects and measured frame titles. Browser checks measure actual font ink, label fit, contrast, and rendered connector paths. Canonical geometry survives preview, presentation, insertion, undo, redo, reload, native edits, frame moves, edited-board exports, and Excalidraw reimport. An intentionally unrepairable layout returns HTTP 502 after two fixture provider calls, displays an error, and leaves the board unchanged.

The original crossing is independently reproduced in [the baseline report](verification-baseline.json). The original morning dark arrows are preserved in [the image before the contrast fix](before-contrast-morning-dark.png). [Pixel checks](verification-pixels.json) confirm identical dark and light pixels for all five captured shape labels, and OCR recognizes their full text in the original light PNG.

View the final screenshots.

| Case | Dark | Light | Standalone SVG |
| --- | --- | --- | --- |
| Saved crossing | [Board](captured-board-dark.png) | [Board](captured-board-light.png) | [Rendered export](captured-export-rendered.png) |
| Morning replay | [Board](morning-replay-board-dark.png) | [Board](morning-replay-board-light.png) | [Rendered export](morning-replay-export-rendered.png) |
| Workshop replay | [Board](workshop-replay-board-dark.png) | [Board](workshop-replay-board-light.png) | [Rendered export](workshop-replay-export-rendered.png) |

The portable [geometry review](reviews/geometry-review.md), [pipeline review](reviews/pipeline-review.md), and [comment review](reviews/comment-review.md) retain the initial findings and their final verdicts. [The manifest](manifest.json) records source hashes, artifact hashes, and run commands. [The implementation reference](../../ai-draw-generation.md) documents font and conservative-routing limits. These runs verify the custom editor and exported files. They do not test a deployed Vercel function or rendering inside an external Excalidraw application.

To rerun the captured case, start its local server from the repository root.

```bash
node scripts/start-draw-quality-verification.mjs --root "$PWD" --port 3062
```

Run the browser checks in another terminal.

```bash
python -B scripts/verify-draw-quality.py http://127.0.0.1:3062/ --source-revision 880b683
```

To replay a saved cloud plan, set the server proposal and the matching verifier case. Use `workshop` in both filenames and flags for the other saved plan.

```bash
node scripts/start-draw-quality-verification.mjs --root "$PWD" --port 3064 --proposal docs/screenshots/draw-quality/morning-replay-proposal.json
python -B scripts/verify-draw-quality.py http://127.0.0.1:3064/ --case morning --source-revision 880b683
```

The verifier also accepts `--live` for a configured cloud app, `--baseline` for the old app at `1d8073f`, and `--output PATH` for a separate artifact directory.

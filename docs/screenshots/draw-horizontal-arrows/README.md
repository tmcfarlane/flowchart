# Horizontal Draw arrows

The user wants straight arrows from each card's right edge to the next card's left edge. Replaying the exact captured cloud proposal isolates the application's geometry conversion from the model's output.

| Evidence | Result |
| --- | --- |
| [Before](horizontal-before-board-dark.png) | All four arrows acquire a 4.61157-pixel vertical difference after label fitting. |
| [After](horizontal-after-board-dark.png) | The same four arrows have zero vertical difference and remain 100 pixels long. |
| [After in light mode](horizontal-after-board-light.png) | The same horizontal connectors remain visible in the light theme. |
| [New cloud generation](../draw-horizontal-live/horizontal-after-board-dark.png) | All four new arrows are horizontal, with 100-pixel card gaps. |

The input already contains horizontal arrow points. Label fitting enlarges the cards, and the old center-based binding projection introduces the slope. The materializer now preserves explicit horizontal intent with native outline anchors after it fits every label. Rectangle, ellipse, and diamond attachments stay on their outlines. Intentional diagonal, bent, vertical, reversed, and unbound paths keep their existing routing.

The browser checks cover preview, insertion, one-step undo and redo, reload, JSON export, label containment, and page errors. The [before report](verification-horizontal-before.json) and [after report](verification-horizontal-after.json) record the numeric comparison. The [live report](../draw-horizontal-live/verification-horizontal-after.json) records the real cloud request `2a1df0d4-b59b-4a88-bf95-7313bcce7f83`. The server returned HTTP 200 through Azure on its first attempt, model `gpt-chat-latest`, with usage reported.

Run the replay against a server at the original PR head `9703003`, then against the fixed app:

```sh
python scripts/verify-draw-generation-layout.py http://127.0.0.1:3055/ --proposal docs/screenshots/draw-generation-layout/live-proposal.json --horizontal before --output docs/screenshots/draw-horizontal-arrows
python scripts/verify-draw-generation-layout.py http://127.0.0.1:3056/ --proposal docs/screenshots/draw-generation-layout/live-proposal.json --horizontal after --output docs/screenshots/draw-horizontal-arrows
python scripts/verify-draw-generation-layout.py http://127.0.0.1:3056/ --live --horizontal after --output docs/screenshots/draw-horizontal-live
```

The unit regression first failed with an expected endpoint at y265 and an actual endpoint at y280.4114. After the fix, all 746 tests passed, with three optional Redis tests skipped, and the production build passed. Existing saved drawings are not migrated. Later intentional shape moves and resizes can change a connector's angle while preserving its attachments.

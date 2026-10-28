# AI Draw tool palette

AI Draw supports rectangles, ellipses, diamonds, arrows, lines, pen strokes, standalone text, and native frames. The visible palette and examples describe these tools, while the generation prompt chooses them by purpose. An explicit request for rectangular cards can still produce rectangular cards.

Frames have native titles and explicit members. Their child objects and generated labels retain editable `frameId` links. The materializer expands frames around the final measured content so labels and paths remain visible. Arrows between frames stay outside them unless explicitly included. Images require a separate asset contract and are not part of this change.

The repeatable browser verifier exercises preview, insertion, native line editing, frame movement, undo, redo, reload, and JSON/SVG export. It also checks both prompt variants at 390 by 667 pixels. Run against a development server with the implementation:

```sh
python scripts/verify-ai-draw-tools.py http://127.0.0.1:3057/
python scripts/verify-ai-draw-tools.py http://127.0.0.1:3057/ --proposal docs/screenshots/ai-draw-tools/captured-diagonal-proposal.json
python scripts/verify-ai-draw-tools.py http://127.0.0.1:3057/ --live
```

The fixture includes all eight native types, two frames, a cross-frame connector, and text that grows its host. The captured provider proposal exercises a diagonal connector inside a frame. The live command uses the configured cloud AI provider and records the actual type counts and request ID. One successful request proves that request's tool use, not the distribution of every future response.

All three runs passed on source `c0211ca4678d476b7400628e6fe73fbfe2b3d220`:

| Evidence | Result |
| --- | --- |
| [Visible tool palette](fixture-prompt-tools.png) | The Draw prompt lists all eight supported tools and offers varied examples. |
| [Fixture preview](fixture-preview-dark.png) | Both native frame titles appear before insertion. |
| [Fixture, dark](fixture-board-dark.png) and [light](fixture-board-light.png) | All eight types, two frames and 13 member records remain editable and visible. |
| [Rendered SVG](fixture-export-rendered.png) | Frame titles, whole labels, divider, pen stroke and every native type survive export. |
| [Captured cloud replay](replay-board-dark.png) | Two frames and 20 member records pass the diagonal-arrow frame-movement regression. |
| [Fresh cloud generation](live-board-dark.png) | All eight types, two frames and 19 member records pass the complete flow. |
| [Compact welcome](fixture-mobile-welcome.png) and [full prompt](fixture-mobile-full.png) | At 390 by 667, scrolling keeps help, prompt, dismissal and submit reachable. The welcome screenshot shows its scrolled dismissal area. |

The [fixture report](verification-fixture.json), [replay report](verification-replay.json), and [live report](verification-live.json) retain the actual assertions and type counts. The fresh live request returned HTTP 200 with request ID `dd3affb8-653b-40dc-8839-e7964b12d177`. Native line editing, frame dragging, undo/redo, reload, exact JSON export and rendered SVG checks passed without browser page errors.

The verifier measures actual world bounds for paths, including negative local points and rotation. Frame movement must translate internal connectors and their captions once. An explicitly framed connector attached to an unmoved external host may legitimately reroute, so that case retains its bindings without a rigid-translation assertion.

The final full suite passed 767 tests, with three optional Redis tests skipped. The production build passed. The real cloud sample used the configured Azure route on its first provider attempt, model `gpt-chat-latest`, with token usage reported. Images and generated appearance options remain separate work.

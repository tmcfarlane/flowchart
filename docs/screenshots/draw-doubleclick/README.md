# Draw double-click text verification

This proof checks [issue #46](https://github.com/tmcfarlane/flowchart/issues/46). Double-clicking a shape's interior or outline must open its centered label editor. Arrow and line labels must remain attached. Existing standalone text must be edited in place.

Run the negative control against an isolated server at baseline `c3c37856b40293bf515ddb02fff044c34e17a075`.

```sh
python3 scripts/verify-draw-doubleclick.py --baseline-only \
  --baseline-url http://127.0.0.1:3107/
```

Then run the final proof against a server with the immutable reviewed source.

```sh
python3 scripts/verify-draw-doubleclick.py http://127.0.0.1:PORT/ \
  --source-revision FULL_40_CHARACTER_SHA \
  --baseline-report docs/screenshots/draw-doubleclick/negative-control.json
```

`--baseline-url` can run the negative control before the positive cases. `--output PATH` keeps a rerun separate from the committed evidence. A passing run writes `report.json`. A failure writes `failure.json` and exits with an error.

The negative control reproduces three specific failures. A native mouse double-click in the rectangle outline's rendered hit area opens a standalone editor and saves text with `containerId: null`. Double-clicking existing text opens an empty editor and creates a second text object. At a horizontal connector's midpoint, the decorative rotation stem intercepts the second pointer event, so the native mouse sequence emits no `dblclick` and opens no editor. The event trace records the SVG event target and the actual object hit. The baseline images show the detached editor and duplicated-text preview.

The positive cases use native `mouse.dblclick` and actual touchscreen taps. They cover 1440 by 960 desktop and 390 by 844 phone viewports in both themes. Each named theme is checked against the rendered app theme. The case matrix includes filled and hollow rectangle, ellipse, and diamond interiors and outlines, horizontal arrow and line labels, and existing standalone text. A rotated outline case also pans and zooms first. Two extra cases draw a new shape, verify the default return to Pointer, and then create its centered label.

The verifier checks focused editor bounds, matching text IDs, `containerId`, the host's reciprocal `boundElements` reference, centered and rotated saved geometry, label reuse, multiline commits, and blur. Selected cases check separate Undo and Redo transactions and a real reload. Native guard checks cover locked objects, local view mode, resize and rotation handles, connector point handles, blank-canvas text, empty-label discard, and image cropping with cancellation.

Screenshots use a device scale of 1. The report records CSS viewport dimensions, browser versions, source revision, exact cases, editor center errors, and successful same-origin entry asset hashes. API requests are blocked, so this proof sends no live AI or shared-board writes.

The committed report passed all 36 object cases, eight interaction guards, and the manual revision 3 patch-note check against `e73def4b186d25ba0429cfc846abd464c7fbe1cc`. This was one uninterrupted run with Chromium 154.0.8037.57 and Playwright 1.62.0. The process exited 0. Bound editor centers differed from their host centers by less than 0.01 CSS pixels. The point-handle equality guard passed without changing its fixture or relaxing the document assertion.

These are Chromium mouse and touch checks. Native WebKit and physical iPhone Safari remain unverified. Keyboard, browser chrome, notch, and safe-area behavior on physical Safari remain unverified.

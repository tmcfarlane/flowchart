# Draw arrowhead visibility

Thin Draw arrowheads were hard to see where a connector met a shape. At 50% zoom in dark mode, Chromium measured the isolated stroke width 2 tip at 5 by 6 pixels. The renderer now uses a minimum 16-unit head. The same tip measures 8 by 9 pixels. The stroke width 1 tip grew from 4 by 4 to 7 by 8 pixels. The stroke width 4 tip remains 12 by 12 pixels.

The paired `before-*` and `after-*` screenshots show the same scene at 100% and 50% zoom in dark and light mode. [`verification.json`](verification.json) records the measurements. The comparison removes one SVG marker attribute for each screenshot, then counts the pixels painted by that marker near its endpoint. The verifier checks 68 start and end markers, including open and filled tips, curved and elbow routes, and reversed heads. It also compares endpoint positions and saved scene records, and downloads SVG and PNG exports.

Run `python scripts/verify-draw-arrowheads.py --phase before --url http://127.0.0.1:3052/` against commit `85ec3050aa39248686f31a183420a0b2996d20b1`. Then run `python scripts/verify-draw-arrowheads.py --phase after --url http://127.0.0.1:3050/` against this branch. Both commands write their evidence to this directory.

# Independent geometry review

The goal is a finished, checked backend Draw file whose geometry survives the custom editor, rather than a browser layout pass.

Reviewed revision `ac014c353a49165756d12309310b292dbb54cba3` against `1d8073ff74d1506a1a027ebbd96a5de74459f2dd`. This reviewer did not implement the change. Review covered the compiler, router, quality validator, shared font metrics, browser text adapter, SVG renderer, editing adapter and geometry fixtures. Production source was not changed.

Verdict at this revision is changes required for one reproducible issue.

## P1. Freehand validation checks different geometry from the renderer

`src/shared/drawQuality.ts` checks freehand strokes with `segmentHitsBox` between their authored points. `src/components/DrawSceneSvg.tsx` renders every freehand stroke through `pathForPoints(points, true)`, which emits cubic curves. `roundness: null` does not make these freehand paths sharp.

This valid authoring input compiles successfully with no issues:

```json
{
  "outputMode": "draw",
  "summary": "Requested pen annotation",
  "elements": [
    { "id": "note", "type": "text", "x": 190, "y": -35, "text": "X", "fontSize": 12, "strokeColor": "#222222" },
    { "id": "pen", "type": "freedraw", "points": [{ "x": 0, "y": 0 }, { "x": 400, "y": 0 }, { "x": 400, "y": 400 }], "sourceId": null, "targetId": null, "label": "", "strokeColor": "#dd0000" }
  ]
}
```

The compiled note occupies `(190,-35)` to `(201.032,-13)`. Its two checked straight pen segments stay clear. Rendering the actual `DrawSceneSvg` through `renderToStaticMarkup` produces this first curve:

```text
M 0 0 C 66.66666666666667 0 333.3333333333333 -66.66666666666667 400 0
```

At parameter 0.5 it passes through `(200,-25)`, inside the protected text box. The second curve also overshoots the authored path bounds. An accepted backend file can therefore still place a pen stroke over text. Validate the actual rendered cubics with bounded conservative geometry, or ensure generated strokes render exactly the validated path. Retain existing requested pen support. Add a regression that exercises the actual SVG path rather than only its point segments.

Root was informed and accepted the finding for a fix. Commit `968b8dee50686bb07bb611512dab240fc2f54d11` was independently reviewed in the compiler worktree. The original input now returns `text-overlap`. Its regression extracts the actual rendered cubic and samples it independently. A clear requested pen remains curved and retains its authored points. The bounded De Casteljau subdivision checks the actual renderer control points, conservatively rejects intersecting terminal hulls, and stops at depth 16 or 100,000 checks. Sixteen focused tests passed. This finding is resolved by that commit.

## P2. A short accepted arrow places its marker inside its source

This additional case was requested by root after the initial review. At `ac014c3`, two empty rectangles of size 180 by 100 at `(0,0)` and `(184,0)` plus an arrow from `(180,50)` to `(184,50)` bound from the first to the second compile successfully. The final shaft is four pixels long. The object separation check accepts the four-pixel gap, `pathIsClear` exempts both endpoint hosts on its sole segment, and `captionFits` returns true for an absent caption.

The actual returned SVG marker has a 42 by 42 viewport and viewBox `-24 -18 48 36`. Its path is `M -16 -8 L 0 0 L -16 8`. The 0.875 scale puts both wing tips at world x 170 with y 43 and 57. Those points lie inside the source rectangle, which ends at x 180. Most of the arrowhead therefore overlaps the source rather than fitting the available shaft.

Add a geometric acceptance condition shared by routing and final validation. The rendered end marker, including its stroke, must remain clear of every obstacle other than its own target. This includes the source. Generated arrows also need enough terminal shaft to contain the marker and enough visible uncovered shaft. A conservative 16-pixel marker reservation plus stroke is sufficient for this fixed generated style. A 32-pixel total shaft minimum is a defensible visual floor, but the terminal segment also needs checking because a long route can end with a short bend. Existing fallback port leads are 14 pixels and must accommodate whichever terminal reservation is chosen. A guide-only spacing rule does not close this acceptance gap.

Root received the exact compiled result and SVG evidence. Commit `41e37bca51d6854eae7991069e0ae209910bd70b` was independently reviewed in the clean compiler worktree. The original four-pixel connection now routes below both cards with points `(90,100)`, `(90,134)`, `(274,134)`, `(274,100)`. Its terminal shaft is 34 units and its marker clears the opposite host. Final geometry inspection reports no issues. A four-pixel unbound arrow also gets a bounded detour with a 34-unit terminal segment instead of a marker laid over its own short shaft. Exact collinear reversals are rejected. The inspector independently rejects an otherwise long arrow with a four-unit last segment after a bend.

The marker check is used for authored routes, visibility routes, caption corridors and final inspection. It conservatively contains the actual generated SVG marker and its stroke. It exempts only its own target from object clearance and checks the current native caption separately. Four ports for both bound and unbound endpoints retain the 16-pair search bound and shared request budget. Nineteen tests in four focused geometry files passed. This finding is resolved by that commit.

## Final verdict

Pass for the scoped compiler and geometry changes at compiler revision `41e37bca51d6854eae7991069e0ae209910bd70b`, including the previously accepted cubic fix `968b8de`. Both concrete findings have independently verified fixes. No further must-fix finding remains in this review. The separate whole-app cloud and browser proof remains required before declaring the complete goal done. The conservative routing and unsupported-font limits below still apply.

## Checks and limits

Focused verification passed 21 tests in four files. These include compiler, routing, saved baseline and font tests. No broad full-suite run was repeated. I independently executed the freehand input through `compileDrawProposal`, then rendered the returned elements with the real `DrawSceneSvg`.

The contour projection, outward source/target leads, fixed bindings, midpoint caption checks, repeated native rerouting, frame-title obstacles, local overlap permissions and finite search budgets are coherent on inspection. The final validator protects unrelated object and caption bounds. Conservative rectangular obstacle bounds can reject an otherwise possible tight curved arrangement. This is an explicit limitation rather than a false acceptance.

The checked font policy contains the bundled mapped font metrics and reserves conservative fallback advances. It does not prove arbitrary unsupported script shaping. External Excalidraw applications can choose their own sans font. Those limits are accurately documented. End-to-end cloud and browser export proof remains with the separate verifier.

The scoped added application lines introduce no comments or TypeScript/lint suppressions. No comment deletions, restores, holds, encoding offers or application edits were made by this read-only review.

## Final artifact visual review

Reviewed the original-resolution captured, morning and workshop board screenshots in both themes, plus `verification-captured.json` and `verification-live.json`. The proof records source revision `b478259`. These are actual captured-provider and real cloud `/api/chat` cases, not manually redrawn examples.

The saved cross-frame handoff now has clear rectilinear segments and reaches the decision contour without crossing the launch card. Labels remain centered, readable and within their shapes in both themes. The original requested pen emphasis remains under its ellipse and clear of text. Morning text wraps at sensible word boundaries. Its arrows have meaningful shaft length and run straight left to right. The workshop uses a decision diamond, a frame and separate branches with readable captions. No unsolicited pen appears in either ordinary cloud case. The reports independently record zero connector crossings, marker crossings or shape collisions, and canonical geometry through preview, insertion, reload and export.

One visual finding remains in the morning dark artifact. Its five arrows use `#475569`, which `DrawSceneSvg` does not remap for a dark canvas. Against the actual `#0f1211` canvas, that source paint has a contrast ratio of about 2.49 to 1. The thin antialiased shafts are visibly weaker than the workshop arrows, whose `#334155` paint is already remapped. This is observable in `morning-board-dark.png` at original resolution and supported by `morning-api-response.json`. It directly affects the user's arrow visibility complaint. Theme-aware stroke handling needs to keep these arrows readable before the overall visual verdict can pass. Light morning geometry and text pass.

The compiler geometry verdict remains pass. Overall visual verdict at `b478259` is changes required for dark morning arrow contrast. This reviewer made no production edits.

Commit `880b6834b180e42907c74a2b4fb6c21163abcca7` independently passes source review for that contrast finding. The shared color helper retains 4.5 to 1 as its text default. Paths use a separate 3 to 1 threshold against the resolved canvas surface. A shaft and all its marker outlines and fills receive the same resolved color. Authored colors that already pass remain unchanged. Explicit transparent strokes remain invisible, and stored scene records are untouched. Thirty-one `DrawSceneSvg` tests pass, including the original `#475569` case and actual marker paint checks. Exact-plan browser replay is pending before the final visual signoff.

## Final visual signoff

Pass at `880b683`. Independently viewed the original-resolution morning and workshop replay boards in both themes and the final captured dark board. Morning shafts and arrowheads are now bright and clearly visible on the dark canvas. The light version retains its clear authored ink. Natural word wrapping, centered labels, straight morning connections and readable workshop branches remain intact. The captured handoff remains clear of the launch card, with its requested annotation preserved.

The exact-plan replay reports identify source `880b683`, use the real handler, and match the original cloud files with zero translation and zero changed IDs. They retain zero connector, marker and shape collisions. Recorded minimum shaft and marker paint contrast is 15.41 to 1 in dark morning and workshop, 7.58 to 1 in light morning, 10.35 to 1 in light workshop, and 3.33/3.54 to 1 for the final captured dark/light boards. These paint checks agree with the observed correction and exceed the path policy.

All three concrete findings from this independent review are closed. Final overall verdict for the scoped compiler, geometry and visual quality is pass. Conservative routing and unsupported-font limits remain as documented. This reviewer made no production source changes.

# Draw geometry commands

Draw supports horizontal and vertical reflection with Shift+H and Shift+V. Reflection uses the selection's world-space center, preserves rotated path geometry and pressure samples, flips image pixels, keeps labels readable, and updates bound endpoints and fixed attachment points. A deep-selected bound label stays in place when its host is outside the selection or locked. Locked records remain unchanged. Each changed flip is one document transaction.

Ctrl/Cmd+Arrow creates a connected copy of one selected rectangle, ellipse, or diamond and its bound labels. The new shape sits 80 scene units beyond the source's rotated bounds. It receives fresh IDs and a new bound arrow; semantic metadata, group membership, frame membership and unrelated incident edges are not copied. The new shape is selected. Undo removes the whole operation together.

Alt/Option+Arrow follows actual arrow bindings to an unlocked shape in that direction. Where several neighbors qualify, distance and perpendicular offset determine the nearest directional candidate. Navigation changes selection only. Ctrl/Cmd+Shift+Arrow keeps its existing alignment behavior.

The Lasso toolbar tool uses **J**, a custom Draw shortcut. K remains available for the baseline laser shortcut. Drag a closed region to select intersecting geometry; Shift adds to the selection, and Ctrl/Cmd performs deep selection inside groups. Bound labels and selected frame members follow existing selection expansion. Locked elements are excluded. Escape, pointer cancellation, lost pointer capture and switching tools cancel a lasso and restore the previous selection. The overlay is transient and sits outside exported drawing content.

Selection tests use polygon edges and containment, including concave regions, rotated shapes and path crossings. Ellipses use a 64-vertex outline. Paths use authored point segments; decorative arrowheads, stroke thickness, roughness and curved rendering between points are not additional selection contours. Frame membership expands selection; imported children retain their authored frame references.

Validation:

```sh
npx vitest run src/test/drawGeometry.test.ts src/test/DrawCanvas.test.tsx
npm run build
npm run dev -- --host 0.0.0.0 --port 3032
python scripts/verify-draw-geometry.py http://127.0.0.1:3032/
```

The real Chromium verifier imports a document, creates a connected copy, follows its binding, undoes and redoes the single transaction, reflects a pressure-bearing path on both axes, and exercises concave lasso selection and cancellation without changing the saved scene. It also asserts that the overlay is outside export content and no browser errors occur. Linux Chromium is covered; native macOS browser shortcuts have not been exercised here.

Screenshots:

- [Connected shape](screenshots/draw-geometry/01-connected-shape.png)
- [Bound navigation](screenshots/draw-geometry/02-bound-navigation.png)
- [Horizontal reflection](screenshots/draw-geometry/03-horizontal-flip.png)
- [Concave lasso preview](screenshots/draw-geometry/04-concave-lasso.png)
- [Completed lasso selection](screenshots/draw-geometry/05-lasso-selection.png)

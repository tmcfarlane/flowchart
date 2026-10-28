# Draw clipboard and image crop reference

Draw stores pasted text and images as native drawing elements in `architectureScene`. Ctrl or Cmd+Shift+V reads clipboard text and inserts it literally, including JSON and line breaks. A normal paste uses Draw's private MIME type for copied drawing elements. External plain text becomes one text element, and an external image becomes an embedded image asset. Pasted drawing elements receive new IDs; their included labels, bindings, groups, frames, and files point to the new copies.

Shift+Alt+C copies the selected drawing as PNG. The selection includes attached labels and framed children. PNG clipboard copy uses the same SVG snapshot, image inlining, and raster rendering as the PNG download. The snapshot excludes selection handles and other editor controls. Clipboard access requires browser permission; failures appear in the drawing message.

Double-click a selected image or press Enter to crop it. The crop dialog shows the full source image with a draggable crop rectangle and corner handles. The four pixel fields support precise edits and keyboard access. Enter, Escape, or **Finish crop** commits one history entry. **Cancel crop** restores the previous image without a history entry. The saved crop uses source pixel coordinates and retains the image's rotation, flips, and other metadata. Cropping cannot extend beyond the source image or produce an empty region.

Opening crop moves keyboard focus to the first pixel field. Tab stays within the crop dialog, and closing it returns focus to the previous control. Enter and Space activate a focused button normally, including **Cancel crop**. Dragging handles uses the SVG screen transform, so source-pixel movement tracks the pointer for portrait and landscape images. A paste or image upload that finishes after a new drawing preview or crop session begins is discarded. A plain-text paste during a pending connector first cancels that unfinished connector, then inserts the text as one committed edit.

The browser verifier uses Linux Chromium. It writes real clipboard text, reads the selected PNG bytes, pastes that PNG back into Draw, drags a crop corner, and checks persistence and cancellation:

```sh
npm run dev -- --host 127.0.0.1 --port 3033
python docs/screenshots/draw-media/verify_draw_media.py
```

The focused tests run with `npx vitest run src/test/DrawMedia.test.tsx src/test/DrawCanvas.test.tsx src/test/drawScene.test.ts src/test/DrawSceneSvg.test.tsx`. Browser clipboard read and write require a secure context and permission. The verifier grants that permission to the local origin. Native macOS shortcuts remain unverified because this environment runs Linux Chromium.

The verifier saves [literal text paste](screenshots/draw-media/01-plain-text-paste.png), [the selected PNG source](screenshots/draw-media/02-selected-png-clipboard.png), [the cropped image preview](screenshots/draw-media/04-crop-preview.png), and [the pasted PNG](screenshots/draw-media/03-external-png-paste.png).

The regression verifier covers pending-connector paste, delayed paste during crop, keyboard focus and Cancel activation, portrait and landscape drag mapping, and rotated flipped crop persistence:

```sh
npm run dev -- --host 127.0.0.1 --port 3039
python docs/screenshots/draw-media/verify_draw_media_fixes.py
```

It saves [connector paste](screenshots/draw-media/05-pending-connector-paste.png), [keyboard crop](screenshots/draw-media/06-keyboard-crop-preview.png), [portrait drag](screenshots/draw-media/07-portrait-crop-drag.png), and [landscape drag](screenshots/draw-media/07-landscape-crop-drag.png). Clipboard permissions and native macOS behavior have the same limits as the first verifier.

# Draw keyboard reference and parity

Draw implements its own handlers. This reference records familiar drawing
bindings without inheriting behavior from an embedded editor. Ctrl below means
Ctrl on Windows/Linux and Cmd on macOS, unless a platform difference is stated.
Text fields, contenteditable elements and the AI prompt keep normal typing.

## Tools

| Action | Letter | Number |
| --- | --- | --- |
| Select | V | 1 |
| Hand | H | — |
| Lasso | J | — |
| Laser pointer | K | — |
| Eyedropper | I | — |
| Fill | B | — |
| Rectangle | R | 2 |
| Diamond | D | 3 |
| Ellipse | O | 4 |
| Arrow | A | 5 |
| Line | L | 6 |
| Pen | P | 7 |
| Text | T | 8 |
| Image | — | 9 |
| Eraser | E | 0 |
| Frame | F | — |
| Keep tool selected | Q | — |

## Editing and navigation

| Action | Binding / gesture | Implementation |
| --- | --- | --- |
| Undo | Ctrl+Z | Unified document history |
| Redo | Ctrl+Shift+Z; Ctrl+Y | Unified document history |
| Select all | Ctrl+A | Unlocked drawing elements |
| Add/remove selection | Shift+click | Selection and group expansion |
| Deep selection | Ctrl+click | Individual grouped objects |
| Deep box selection | Ctrl+drag | Individual enclosed group members |
| Marquee | Drag empty space | Rectangle selection |
| Duplicate | Ctrl+D; Alt+drag | New element/group/file/relationship IDs |
| Copy / cut / paste | Ctrl+C / X / V | Drawing clipboard and independent copies |
| Group / ungroup | Ctrl+G / Ctrl+Shift+G | Visual groups |
| Lock / unlock | Ctrl+Shift+L | Selected objects |
| Move | Arrow keys | One scene unit |
| Move farther | Shift+Arrow | Five scene units |
| Align edges | Ctrl+Shift+Arrow | Left/right/top/bottom |
| Layer backward / forward | Ctrl+[ / Ctrl+] | One stacking position |
| Send to back / front | Ctrl+Shift+[ / Ctrl+Shift+] (macOS: Cmd+Option+[ / ]) | Full stacking change |
| Edit text / frame name | Enter; double-click | Own text editor |
| Edit connector points | Ctrl+Enter | Focusable points; arrow keys move the active point |
| Create multipoint arrow / line | A / L, then click points | Enter or double-click commits; Escape cancels |
| New text line | Enter; Shift+Enter | Text editing |
| Finish text editing | Ctrl+Enter; Escape | Commit edited text |
| Delete | Delete; Backspace | Selection and relationship cleanup |
| Constrain creation/move/resize | Shift+drag | Shape proportions/axis constraint |
| Rotate with fixed steps | Shift+rotation drag | 15-degree increments |
| Draw from center | Alt+shape drag | Centered geometry |
| Pan temporarily | Hold right mouse and drag; Space+drag; middle mouse | Temporary hand behavior without changing tools |
| Zoom | Ctrl+wheel; Ctrl++ / Ctrl+- | Drawing viewport |
| Reset zoom | Ctrl+0 | 100% |
| Fit all / selected | Shift+1 / Shift+2 | Uses physical digit codes for shifted keys |
| Grid | Ctrl+' | Grid snapping |
| Object snapping | Alt+S; Snap button | Object edges/centers |
| Stroke / fill controls | S / G | Focus the appearance control |
| Font properties | Shift+F | Focus font size |
| Font size | Ctrl+Shift+, / Ctrl+Shift+. | Decrease / increase text size |
| Copy / paste styles | Ctrl+Alt+C / Ctrl+Alt+V | Selection appearance |
| Pan one page | PageUp / PageDown; Shift for horizontal | Viewport navigation |
| Keyboard help | ? | Accessible help dialog |
| Command palette | Ctrl+/; Ctrl+Shift+P | Searchable Draw commands |
| Cancel | Escape | Restore unfinished gesture; clear selection/help |

## Verification and scope

Real component tests cover tool aliases, Q, pointer preview/cancel/commit,
contextual properties, grouping/duplication, text entry, parent history and actual
shifted key values. `DrawHotkeys.test.tsx` also covers centered Alt/Shift geometry,
Ctrl/Cmd deep marquee selection, labeled connector point editing, point insertion
and deletion, per-gesture history, multipoint creation/cancellation, bound-label
Enter, and the actual Option-produced glyphs for snapping/style shortcuts.
Browser verification covers the complete drawing/save/share
flow and original Architecture behavior. Pure model tests cover bindings,
rotations, paths, pressure, reference remapping, groups and frames.

This custom editor does not claim complete Excalidraw parity. The 18 rows that
were previously marked missing now have Draw implementations in the matrix below.
See [commands](draw-commands.md), [geometry](draw-geometry.md),
[clipboard and crop](draw-media.md), [extra tools](draw-extra-tools.md), and
[selected Draw AI](draw-selection-ai.md) for exact behavior and limits. Mermaid
import accepts a bounded flowchart subset; AI updates selected existing objects
only. Native macOS shortcuts have not been executed in this environment.

Issue #15 remains open until the stacked changes are reviewed and shipped. This
matrix describes implemented bindings in this custom editor, not every feature
or service of the external editor.

### Focused follow-up verification

| Required core workflow | Checked evidence |
| --- | --- |
| Alt/Option draws from the center, including Shift and reverse drags | [x] Real SVG controller tests; Linux Chromium Alt-drag geometry |
| Ctrl/Cmd marquee selects an individual grouped member | [x] Both modifier variants in controller tests; Linux Chromium selection/nudge/undo |
| Ctrl/Cmd+Enter edits a labeled connector without entering text | [x] Controller tests; imported bound connector in Chromium with Meta events |
| Points can be focused, moved, added and deleted with undoable geometry | [x] Controller tests; browser point movement preserves imported endpoint bindings and label |
| A/L click-click-click creates a multipoint path as one transaction | [x] Controller Enter/double-click/cancel/undo tests; browser creation, undo/redo and reload |
| Option-produced glyphs still trigger snapping/style actions | [x] Actual key/code pairs in controller tests; Option+S browser event emulation |
| Native macOS browser execution | [ ] Not run; Meta/Option behavior is emulated on Linux Chromium |

Reproduce the browser workflow and five screenshots with
`python scripts/verify-draw-hotkeys.py http://127.0.0.1:3025/`.

The full original 77-row upstream keyboard help was reviewed during the initial
spike. Final behavior is defined by the handlers and tests in this repository;
there is no native/inherited editor implementation behind these controls.

## Original keyboard-help baseline: all 77 bindings

This inventory retains the original baseline for comparison with our custom bindings.
“Implemented” identifies our handler; individual test evidence is linked above.
No hidden external editor supplies additional bindings.

| # | Baseline action | Windows / Linux | macOS | Custom Draw status |
| --- | --- | --- | --- | --- |
| 1 | Hand tool | H | H | Implemented in our Draw handlers |
| 2 | Selection tool | V or 1 | V or 1 | Implemented in our Draw handlers |
| 3 | Rectangle | R or 2 | R or 2 | Implemented in our Draw handlers |
| 4 | Diamond | D or 3 | D or 3 | Implemented in our Draw handlers |
| 5 | Ellipse | O or 4 | O or 4 | Implemented in our Draw handlers |
| 6 | Arrow | A or 5 | A or 5 | Implemented in our Draw handlers |
| 7 | Line | L or 6 | L or 6 | Implemented in our Draw handlers |
| 8 | Freehand drawing | P or 7 | P or 7 | Implemented in our Draw handlers |
| 9 | Text | T or 8 | T or 8 | Implemented in our Draw handlers |
| 10 | Image | 9 | 9 | Implemented in our Draw handlers |
| 11 | Eraser | E or 0 | E or 0 | Implemented in our Draw handlers |
| 12 | Frame | F | F | Implemented in our Draw handlers |
| 13 | Temporary laser pointer | K | K | Implemented: transient fading trail; no scene/history entry |
| 14 | Eyedropper | I, Shift+S or Shift+G | I, Shift+S or Shift+G | Implemented: sample stroke with I/Shift+S or fill with Shift+G |
| 15 | Edit line / arrow points | Ctrl+Enter | Cmd+Enter | Implemented: focused point mode, arrows, add/delete controls, Enter/Esc finish |
| 16 | Edit selected text / bound label | Enter | Enter | Implemented in our Draw handlers |
| 17 | New line while editing text | Enter or Shift+Enter | Enter or Shift+Enter | Implemented in our Draw handlers |
| 18 | Finish text editing | Esc or Ctrl+Enter | Esc or Cmd+Enter | Implemented in our Draw handlers |
| 19 | Draw a curved arrow | A, click, click, click | A, click, click, click | Implemented: multipoint creation, Enter/double-click commit, Escape cancel |
| 20 | Draw a curved line | L, click, click, click | L, click, click, click | Implemented: multipoint creation, Enter/double-click commit, Escape cancel |
| 21 | Start image cropping | Double-click or Enter | Double-click or Enter | Implemented: selected image opens a source-pixel crop dialog |
| 22 | Finish image cropping | Enter or Esc | Enter or Esc | Implemented: Finish/Enter/Escape commits one edit; Cancel restores the image |
| 23 | Keep active drawing tool selected | Q | Q | Implemented in our Draw handlers |
| 24 | Temporarily prevent arrow binding | Hold Ctrl | Hold Cmd | Implemented in our Draw handlers |
| 25 | Add / edit element hyperlink | Ctrl+K | Cmd+K | Implemented: selected element link dialog validates http, https, or mailto |
| 26 | Zoom in | Ctrl++ | Cmd++ | Implemented in our Draw handlers |
| 27 | Zoom out | Ctrl+- | Cmd+- | Implemented in our Draw handlers |
| 28 | Reset zoom | Ctrl+0 | Cmd+0 | Implemented in our Draw handlers |
| 29 | Fit complete drawing | Shift+1 | Shift+1 | Implemented in our Draw handlers |
| 30 | Zoom to selection | Shift+2 | Shift+2 | Implemented in our Draw handlers |
| 31 | Pan vertically one page | PgUp / PgDn | PgUp / PgDn | Implemented in our Draw handlers |
| 32 | Pan horizontally one page | Shift+PgUp / Shift+PgDn | Shift+PgUp / Shift+PgDn | Implemented in our Draw handlers |
| 33 | Toggle zen mode | Alt+Z | Option+Z | Implemented: hides Draw editor chrome; repeat to restore |
| 34 | Toggle object snapping | Alt+S | Option+S | Implemented in our Draw handlers |
| 35 | Toggle grid | Ctrl+' | Cmd+' | Implemented in our Draw handlers |
| 36 | Toggle view mode | Alt+R | Option+R | Implemented: local Draw read-only mode with pan, zoom, and search |
| 37 | Toggle editor theme | Alt+Shift+D | Option+Shift+D | Implemented: toggles the app theme |
| 38 | Drawing statistics | Alt+/ | Option+/ | Implemented: live element, file, and scene-byte counts |
| 39 | Search drawing text | Ctrl+F | Cmd+F | Implemented: finds element text, names, and IDs; selects and centers matches |
| 40 | Command palette | Ctrl+/ or Ctrl+Shift+P | Cmd+/ or Cmd+Shift+P | Implemented: searchable Draw command palette; ? opens keyboard help |
| 41 | Create connected flowchart shapes | Ctrl+Arrow key | Cmd+Arrow key | Implemented: connected copy from one selected rectangle, ellipse, or diamond |
| 42 | Navigate connected flowchart shapes | Alt+Arrow key | Option+Arrow key | Implemented: follows an arrow binding to a directional neighbor |
| 43 | Temporarily pan canvas | Space+drag or middle/wheel-button drag | Space+drag or middle/wheel-button drag | Implemented in our Draw handlers |
| 44 | Clear / reset canvas | Ctrl+Delete | Cmd+Delete | Implemented: opens app Clear All confirmation; one undoable transaction |
| 45 | Delete selected elements | Delete | Delete | Implemented in our Draw handlers |
| 46 | Cut | Ctrl+X | Cmd+X | Implemented in our Draw handlers |
| 47 | Copy | Ctrl+C | Cmd+C | Implemented in our Draw handlers |
| 48 | Paste | Ctrl+V | Cmd+V | Implemented in our Draw handlers |
| 49 | Paste as plain text | Ctrl+Shift+V | Cmd+Shift+V | Implemented: inserts literal clipboard text as one drawing text element |
| 50 | Select all | Ctrl+A | Cmd+A | Implemented in our Draw handlers |
| 51 | Add / remove selection | Shift+click | Shift+click | Implemented in our Draw handlers |
| 52 | Deep-select within a group | Ctrl+click | Cmd+click | Implemented in our Draw handlers |
| 53 | Deep box-select | Ctrl+drag | Cmd+drag | Implemented in our Draw handlers |
| 54 | Copy selected elements as PNG | Shift+Alt+C | Shift+Option+C | Implemented: selected-scene PNG through browser clipboard permission |
| 55 | Copy element styles | Ctrl+Alt+C | Cmd+Option+C | Implemented in our Draw handlers |
| 56 | Paste element styles | Ctrl+Alt+V | Cmd+Option+V | Implemented in our Draw handlers |
| 57 | Send to back | Ctrl+Shift+[ | Cmd+Option+[ | Implemented in our Draw handlers |
| 58 | Bring to front | Ctrl+Shift+] | Cmd+Option+] | Implemented in our Draw handlers |
| 59 | Send backward one layer | Ctrl+[ | Cmd+[ | Implemented in our Draw handlers |
| 60 | Bring forward one layer | Ctrl+] | Cmd+] | Implemented in our Draw handlers |
| 61 | Align top | Ctrl+Shift+Up | Cmd+Shift+Up | Implemented in our Draw handlers |
| 62 | Align bottom | Ctrl+Shift+Down | Cmd+Shift+Down | Implemented in our Draw handlers |
| 63 | Align left | Ctrl+Shift+Left | Cmd+Shift+Left | Implemented in our Draw handlers |
| 64 | Align right | Ctrl+Shift+Right | Cmd+Shift+Right | Implemented in our Draw handlers |
| 65 | Duplicate selection | Ctrl+D or Alt+drag | Cmd+D or Option+drag | Implemented in our Draw handlers |
| 66 | Lock / unlock selected elements | Ctrl+Shift+L | Cmd+Shift+L | Implemented in our Draw handlers |
| 67 | Undo drawing edit | Ctrl+Z | Cmd+Z | Implemented in our Draw handlers |
| 68 | Redo drawing edit | Ctrl+Shift+Z; Windows also Ctrl+Y | Cmd+Shift+Z | Implemented in our Draw handlers |
| 69 | Group | Ctrl+G | Cmd+G | Implemented in our Draw handlers |
| 70 | Ungroup | Ctrl+Shift+G | Cmd+Shift+G | Implemented in our Draw handlers |
| 71 | Flip horizontally | Shift+H | Shift+H | Implemented: reflects selected geometry, paths, images, and bindings |
| 72 | Flip vertically | Shift+V | Shift+V | Implemented: reflects selected geometry, paths, images, and bindings |
| 73 | Open stroke-color properties | S | S | Implemented in our Draw handlers |
| 74 | Open background-color properties | G | G | Implemented in our Draw handlers |
| 75 | Open font properties | Shift+F | Shift+F | Implemented in our Draw handlers |
| 76 | Decrease font size | Ctrl+Shift+< | Cmd+Shift+< | Implemented in our Draw handlers |
| 77 | Increase font size | Ctrl+Shift+> | Cmd+Shift+> | Implemented in our Draw handlers |

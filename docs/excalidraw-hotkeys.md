# Architecture keyboard and gesture parity

Baseline: the **77 shortcut rows** in the official `@excalidraw/excalidraw`
**0.18.1** keyboard-help dialog, inspected on October 27, 2026. The tables below
track every row, including aliases, contextual gestures and intentionally
disabled actions. This is a binding inventory, not a claim that every action
has been tested individually.

The source of truth is the installed package's
`dist/dev/index.js`: `components/HelpDialog.tsx` (approximately lines
15790–16400), `actions/shortcuts.ts`, and the associated action handlers.
`dist/dev/chunk-4FTI6OG3.js` defines platform detection and `getShortcutKey`:
`CtrlOrCmd` becomes **Ctrl** on Windows/Linux and **Cmd** on macOS; **Alt**
becomes **Option** on macOS. The platform-specific layer-order and Windows-only
redo differences are recorded explicitly.

Status legend:

- **Verified**: covered by the recorded real Chromium tool-alias or drawing
  undo/redo checks. macOS undo/redo used simulated `MacIntel` and a macOS user
  agent in Chromium; no physical macOS run is claimed.
- **Native**: supplied by the unmodified upstream editor, source-mapped here;
  this binding was not individually exercised in our browser checks.
- **Conditional**: upstream behavior depends on selection, editor state or a
  browser capability; not individually exercised.
- **Disabled / app control**: an intentional integration difference, with the
  replacement or limitation stated in the row.

Shortcuts apply while the Architecture editor has focus. Native text editing,
input fields and the AI prompt keep normal typing. The app's React Flow
clipboard, tool, undo and Ctrl-wheel handlers are gated off in Architecture
mode. Native drawing undo is separate from the app's **Undo diagram import** /
**Redo diagram import**, which restore entire documents across mode changes.

## Tools and editing context: help rows 1–25

| # | Action | Windows / Linux | macOS | Status |
| --- | --- | --- | --- | --- |
| 1 | Hand tool | H | H | Verified: tool alias |
| 2 | Selection tool | V or 1 | V or 1 | Verified: both aliases |
| 3 | Rectangle | R or 2 | R or 2 | Verified: both aliases |
| 4 | Diamond | D or 3 | D or 3 | Verified: both aliases |
| 5 | Ellipse | O or 4 | O or 4 | Verified: both aliases |
| 6 | Arrow | A or 5 | A or 5 | Verified: both aliases |
| 7 | Line | L or 6 | L or 6 | Verified: both aliases |
| 8 | Freehand drawing | P or 7 | P or 7 | Verified: both aliases |
| 9 | Text | T or 8 | T or 8 | Verified: both aliases |
| 10 | Image | 9 | 9 | Verified: tool alias; image chooser follows native browser behavior |
| 11 | Eraser | E or 0 | E or 0 | Verified: both aliases |
| 12 | Frame | F | F | Native |
| 13 | Temporary laser pointer | K | K | Native; not individually tested in this milestone |
| 14 | Eyedropper | I, Shift+S or Shift+G | I, Shift+S or Shift+G | Conditional: I/Shift+G pick background, Shift+S picks stroke; browser support applies |
| 15 | Edit line / arrow points | Ctrl+Enter | Cmd+Enter | Native: selected compatible line/arrow |
| 16 | Edit selected text / bound label | Enter | Enter | Native: text or compatible shape selected |
| 17 | New line while editing text | Enter or Shift+Enter | Enter or Shift+Enter | Native: text-entry context |
| 18 | Finish text editing | Esc or Ctrl+Enter | Esc or Cmd+Enter | Native |
| 19 | Draw a curved arrow | A, click, click, click | A, click, click, click | Native: ordered gesture, not alternative shortcuts |
| 20 | Draw a curved line | L, click, click, click | L, click, click, click | Native: ordered gesture |
| 21 | Start image cropping | Double-click or Enter | Double-click or Enter | Native: image selected; not individually tested in this milestone |
| 22 | Finish image cropping | Enter or Esc | Enter or Esc | Native: cropping context |
| 23 | Keep active drawing tool selected | Q | Q | Verified: keep-tool toggle; distinct from locking elements |
| 24 | Temporarily prevent arrow binding | Hold Ctrl | Hold Cmd | Native: released modifier restores binding behavior |
| 25 | Add / edit element hyperlink | Ctrl+K | Cmd+K | Native editing; opening an element link is intercepted by the app and offers a copy-link instruction |

## View and navigation: help rows 26–40

| # | Action | Windows / Linux | macOS | Status |
| --- | --- | --- | --- | --- |
| 26 | Zoom in | Ctrl++ | Cmd++ | Native |
| 27 | Zoom out | Ctrl+- | Cmd+- | Native |
| 28 | Reset zoom | Ctrl+0 | Cmd+0 | Native |
| 29 | Fit complete drawing | Shift+1 | Shift+1 | Native |
| 30 | Zoom to selection | Shift+2 | Shift+2 | Native: selection required |
| 31 | Pan vertically one page | PgUp / PgDn | PgUp / PgDn | Native; use the keyboard's page-key equivalents where needed |
| 32 | Pan horizontally one page | Shift+PgUp / Shift+PgDn | Shift+PgUp / Shift+PgDn | Native |
| 33 | Toggle zen mode | Alt+Z | Option+Z | Native |
| 34 | Toggle object snapping | Alt+S | Option+S | Native |
| 35 | Toggle grid | Ctrl+' | Cmd+' | Native |
| 36 | Toggle view mode | Alt+R | Option+R | Native; distinct from the app's presentation entry/exit |
| 37 | Toggle editor theme | Alt+Shift+D | Option+Shift+D | Disabled / app control: native `toggleTheme` is disabled; use the app's light/dark toggle |
| 38 | Drawing statistics | Alt+/ | Option+/ | Native |
| 39 | Search drawing text | Ctrl+F | Cmd+F | Native |
| 40 | Command palette | Ctrl+/ or Ctrl+Shift+P | Cmd+/ or Cmd+Shift+P | Conditional: upstream Firefox help advertises only the first alias |

## Selection, manipulation and history: help rows 41–77

| # | Action | Windows / Linux | macOS | Status |
| --- | --- | --- | --- | --- |
| 41 | Create connected flowchart shapes | Ctrl+Arrow key | Cmd+Arrow key | Native: compatible single shape selected; these are native drawing elements, not an AI request |
| 42 | Navigate connected flowchart shapes | Alt+Arrow key | Option+Arrow key | Native: connected shape selected |
| 43 | Temporarily pan canvas | Space+drag or middle/wheel-button drag | Space+drag or middle/wheel-button drag | Native: release Space to restore the active drawing tool |
| 44 | Clear / reset canvas | Ctrl+Delete | Cmd+Delete | Native: confirmation required; upstream also accepts Ctrl/Cmd+Backspace |
| 45 | Delete selected elements | Delete | Delete | Native: upstream also accepts Backspace |
| 46 | Cut | Ctrl+X | Cmd+X | Native: selection and clipboard permissions apply |
| 47 | Copy | Ctrl+C | Cmd+C | Native |
| 48 | Paste | Ctrl+V | Cmd+V | Native: clipboard format/browser permissions apply |
| 49 | Paste as plain text | Ctrl+Shift+V | Cmd+Shift+V | Native |
| 50 | Select all | Ctrl+A | Cmd+A | Native |
| 51 | Add / remove selection | Shift+click | Shift+click | Native |
| 52 | Deep-select within a group | Ctrl+click | Cmd+click | Native |
| 53 | Deep box-select | Ctrl+drag | Cmd+drag | Native |
| 54 | Copy selected elements as PNG | Shift+Alt+C | Shift+Option+C | Conditional: help row is shown only when the browser supports clipboard blobs or on Firefox |
| 55 | Copy element styles | Ctrl+Alt+C | Cmd+Option+C | Native |
| 56 | Paste element styles | Ctrl+Alt+V | Cmd+Option+V | Native |
| 57 | Send to back | Ctrl+Shift+[ | Cmd+Option+[ | Native: intentional upstream platform difference |
| 58 | Bring to front | Ctrl+Shift+] | Cmd+Option+] | Native: intentional upstream platform difference |
| 59 | Send backward one layer | Ctrl+[ | Cmd+[ | Native |
| 60 | Bring forward one layer | Ctrl+] | Cmd+] | Native |
| 61 | Align top | Ctrl+Shift+Up | Cmd+Shift+Up | Native: compatible multiselection |
| 62 | Align bottom | Ctrl+Shift+Down | Cmd+Shift+Down | Native: compatible multiselection |
| 63 | Align left | Ctrl+Shift+Left | Cmd+Shift+Left | Native: compatible multiselection |
| 64 | Align right | Ctrl+Shift+Right | Cmd+Shift+Right | Native: compatible multiselection |
| 65 | Duplicate selection | Ctrl+D or Alt+drag | Cmd+D or Option+drag | Native; semantic bridge remaps duplicated graph IDs and parent/edge references |
| 66 | Lock / unlock selected elements | Ctrl+Shift+L | Cmd+Shift+L | Native; distinct from Q keep-tool toggle |
| 67 | Undo native drawing edit | Ctrl+Z | Cmd+Z | Verified: Ctrl in Chromium; Cmd with simulated macOS navigator |
| 68 | Redo native drawing edit | Ctrl+Shift+Z; Windows also Ctrl+Y | Cmd+Shift+Z | Verified: Ctrl+Shift+Z and simulated Cmd+Shift+Z; Windows-only Ctrl+Y source-mapped, not individually tested |
| 69 | Group | Ctrl+G | Cmd+G | Native: visual grouping is distinct from a semantic architecture container |
| 70 | Ungroup | Ctrl+Shift+G | Cmd+Shift+G | Native |
| 71 | Flip horizontally | Shift+H | Shift+H | Native |
| 72 | Flip vertically | Shift+V | Shift+V | Native |
| 73 | Open stroke-color properties | S | S | Native: tool/selection must support a stroke |
| 74 | Open background-color properties | G | G | Native: tool/selection must support a fill |
| 75 | Open font properties | Shift+F | Shift+F | Native: text tool or compatible selected label |
| 76 | Decrease font size | Ctrl+Shift+< | Cmd+Shift+< | Native: upstream also accepts the comma key with these modifiers |
| 77 | Increase font size | Ctrl+Shift+> | Cmd+Shift+> | Native: upstream also accepts the period key with these modifiers |

## Additional bindings and modifier gestures in the same package

These are present in upstream action handlers or gesture utilities beyond the
77-row help inventory. They are source-mapped, not individually browser-tested.

| Action | Windows / Linux | macOS | Integration status |
| --- | --- | --- | --- |
| Open keyboard help | ? | ? | Native; also Menu → Help and the help button |
| Cancel / finish current drawing or point-edit operation | Esc; Enter for a multipoint drawing | Esc; Enter for a multipoint drawing | Native; context determines whether selection is cleared or editing ends |
| Nudge selection | Arrow keys | Arrow keys | Native; grid state controls step size |
| Alternate nudge step | Shift+Arrow keys | Shift+Arrow keys | Native; with grid off uses the larger step, with grid on uses the smaller step |
| Distribute horizontally | Alt+H | Option+H | Native: compatible multiselection; frame distribution is excluded upstream |
| Distribute vertically | Alt+V | Option+V | Native: compatible multiselection |
| Fit selection using the alternate fit action | Shift+3 | Shift+3 | Native action `zoomToFitSelection`; help's Shift+2 maps to `zoomToFitSelectionInViewport` |
| Alternate zoom-in / zoom-out / reset bindings | Shift+=, Shift+-, Shift+0 | Shift+=, Shift+-, Shift+0 | Native action aliases in addition to the help's Ctrl/Cmd forms; numpad codes are supported upstream |
| Resize from center | Alt+resize drag | Option+resize drag | Native modifier gesture |
| Constrain resize aspect ratio | Shift+resize drag | Shift+resize drag | Native modifier gesture |
| Rotate in discrete increments | Shift+rotation drag | Shift+rotation drag | Native modifier gesture |
| Add / remove line-edit points from selection | Shift+point click / box selection | Shift+point click / box selection | Native point-edit context |
| Cycle arrow routing when the arrow tool is already active | A again | A again | Native: cycles sharp, rounded and elbow routing |
| Save to the active native file | Ctrl+S | Cmd+S | Disabled / app control: `saveToActiveFile: false`; use the app's JSON export or autosave/share |
| Open a native file with the editor's own picker | Ctrl+O | Cmd+O | Disabled / app control: `loadScene: false`; app import owns document replacement and validation |
| Open native image-export dialog | Ctrl+Shift+E | Cmd+Shift+E | Disabled / app control: `saveAsImage: false` suppresses the native dialog; use the app's export controls |
| Native Save As action | Ctrl+Shift+S | Cmd+Shift+S | Upstream action remains in 0.18.1; its menu is hidden. It exports the native scene, whereas app JSON export keeps the full mixed document |
| Command-palette hint | Ctrl+P | Cmd+P | Native hint points to the command palette rather than printing |

Ctrl/Command-wheel zoom, scrolling, trackpad gestures and pointer snapping are
handled by the native canvas rather than remapped by the app. Their behavior is
browser/device dependent; the app's competing React Flow wheel listener is
disabled in Architecture mode.

## Deferred, disabled and companion-feature bindings

| Feature / entry point | Binding in the 0.18.1 help baseline | Status / follow-up |
| --- | --- | --- |
| Cropping and temporary laser pointer | Rows 13, 21 and 22 above | Native and retained; individual parity verification deferred |
| Lasso selection, fill and draw-to-shape extras | No dedicated binding advertised in this help baseline | Track future editor-version/tool exposure explicitly; no shortcut invented here |
| Mermaid conversion | No dedicated binding advertised | Upstream extra; individual verification deferred |
| Embeds / iframe activation | No dedicated tool binding advertised; hyperlink editor is row 25 | Embedded content is disabled by integration (`validateEmbeddable: false`); link opening is intercepted |
| Separate Excalidraw AI helpers | No dedicated binding advertised | Disabled (`aiEnabled: false`); Flowchart AI remains available through the app |
| Selected-object AI edits | No binding defined here | Separate enhancement [#14](https://github.com/tmcfarlane/flowchart/issues/14) |
| Native `.excalidraw` import / canvas drop | App picker and pointer drop; no new shortcut assigned | Companion enhancement [#16](https://github.com/tmcfarlane/flowchart/issues/16); Ctrl/Cmd+O remains reserved/disabled upstream |
| Native library save/reuse | No dedicated binding advertised | Local native library retained; hosted library browsing is not integrated |
| Hosted encrypted collaboration | No binding supplied by the embedded package | Flowchart sharing and live sync are used instead |

When upgrading Excalidraw, compare all 77 baseline rows, the additional-action
table and the integration-disabled actions again. Record newly exposed bindings
and browser evidence separately rather than marking inherited behavior as
individually verified.

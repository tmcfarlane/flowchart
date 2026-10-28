# Draw extra tools

The **More drawing tools** button opens Laser pointer, Eyedropper, Fill, Draw to shape, Embed URL, and Import Mermaid. These tools are available in Draw mode. View mode permits panning but does not create or edit content.

| Tool | Shortcut | Result |
| --- | --- | --- |
| Laser pointer | K | Draws a red trail that fades after 900 ms. Undo, scene replacement, view mode, Escape, lost capture, pointer cancellation, and window blur clear an unfinished trail. The trail is absent from document history and exports. |
| Eyedropper | I | Samples the clicked element's stroke into the unlocked selection, or into the defaults when nothing is selected. Shift+S samples stroke; Shift+G samples fill. Pressing I or choosing Eyedropper from the menu starts a fresh stroke sample. A blank click samples the current stroke default or canvas background. |
| Fill | B | Sets the clicked rectangle, ellipse, or diamond's fill to the current fill default. When the default is transparent, it uses mint (`#b2f2dc`). Locked shapes are unchanged. |
| Draw to shape | Menu | Draws a freehand stroke and recognizes a line, rectangle, ellipse, or diamond when the path is a clear match. Other strokes stay editable freehand paths. |
| Embed URL | Menu | Stores an HTTPS URL as a static card. **Load live content** opens a temporary iframe with `sandbox="allow-scripts"` and no same-origin grant. Exports always contain the static card. |
| Import Mermaid | Menu | Inserts editable native shapes, labels, and bound arrows in one undo step. |

## Mermaid syntax

The first line is `flowchart TB`, `flowchart TD`, `flowchart LR`, or the same directions with `graph`. Each later nonblank line contains one node or one link. Node IDs start with a letter and contain letters, digits, or underscores. These node forms are supported:

```text
A
A[Rectangle label]
B(Rounded label)
C{Decision label}
```

`A --> B`, `A --- B`, and `A -->|link label| B` create links. Either endpoint can use a node form, such as `A[Start] --> B{Choose}`. Labels are plain text. LR links reserve room for the label and visible arrow ends. Opening an import or embed dialog cancels an unfinished click connector before inserting content. The parser limits input to 10,000 characters, 80 nodes, and 120 links. It rejects directives, HTML, comments, chained links, semicolon statements, subgraphs, classes, click actions, and other Mermaid syntax before inserting any element. Cycles remain editable but may overlap in the simple row layout.

## Verification

Run `npx vitest run src/test/drawExtraTools.test.ts src/test/DrawCanvas.test.tsx` and `python scripts/verify-draw-extra-tools.py http://127.0.0.1:3037/` while the Vite development server runs on port 3037. The browser verifier checks persistence, undo and redo, JSON export and import, the static SVG export card, laser cancellation, eyedropper activation, short and long LR labels, and dialog cancellation of click connector previews. Its eleven screenshots are in `docs/screenshots/draw-extra-tools/`.

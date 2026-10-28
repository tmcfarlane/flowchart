# Draw issue 15 completion evidence

The custom Draw editor implements the 18 previously missing rows in the
[keyboard matrix](excalidraw-hotkeys.md). The five slices below also cover the
requested extra tools and selected-object AI. Flowchart and Architecture retain
their existing canvases, and Draw stores its scene in the existing document.

| Slice | Behavior and limits | Browser verifier | Screenshots |
| --- | --- | --- | --- |
| Commands | [Commands](draw-commands.md) | [Command workflow](screenshots/draw-commands/verify_draw_commands.py) and [dialog focus](../scripts/verify-draw-command-focus.py) | [Command screenshots](screenshots/draw-commands/) |
| Geometry | [Geometry](draw-geometry.md) | [Geometry workflow](../scripts/verify-draw-geometry.py) | [Geometry screenshots](screenshots/draw-geometry/) |
| Clipboard and crop | [Media](draw-media.md) | [Media workflow](screenshots/draw-media/verify_draw_media.py) | [Media screenshots](screenshots/draw-media/) |
| Extra tools | [Extra tools](draw-extra-tools.md) | [Tool workflow](../scripts/verify-draw-extra-tools.py) | [Tool screenshots](screenshots/draw-extra-tools/) |
| Selected Draw AI | [AI contract](draw-selection-ai.md) | [AI workflow](../scripts/verify-draw-selection-ai.py) and [text layout](../scripts/verify-draw-ai-text-layout.py) | [AI screenshots and reports](screenshots/draw-selection-ai/) and [text layout evidence](screenshots/draw-ai-text-layout/) |

Run the combined Linux Chromium workflow against a local Vite server:

```sh
npm run dev -- --host 127.0.0.1 --port 3030
python scripts/verify-draw-parity.py http://127.0.0.1:3030/
```

The last verifier stubs the AI request by default. With the server configured
for Azure AI, append `--live` to send the Draw selection request through the
local `/api/chat` endpoint. The production gateway route is unchanged. Run
`npm test -- --run` and `npm run build` for the full code checks.
At the combined source, 654 tests passed, three optional Redis tests were
skipped, the build passed, and all eight browser verifiers passed. A separate
local direct-Azure run of the Draw AI verifier returned HTTP 200 through
`/api/chat`, with one provider attempt and reported usage.

The [pre-change browser baseline](screenshots/draw-baseline/report.json)
recorded eight missing interactions before this stack. Mermaid import supports
only the bounded [flowchart subset](draw-extra-tools.md#mermaid-syntax), and Draw
AI proposes updates to selected existing objects only. This work does not claim
complete feature parity with an external editor. Native macOS keyboard execution
remains unverified; the browser evidence uses Linux Chromium.

The [decision trail](draw-parity-decisions.tsv) records the scope and review
findings that led to this stack.

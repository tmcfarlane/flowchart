# AI Draw text and connector layout

The same five-card proposal reproduces the word-wrapping bug on main and verifies the formatter fix. The fixture deliberately keeps its original 20-pixel card gaps in both runs. The separate live cloud response verifies the new default spacing instructions.

| Evidence | Result |
| --- | --- |
| [Before, dark](00-before-board-dark.png) | Ordinary words split across lines in all five cards. |
| [After, dark](after-board-dark.png) | Complete words and intentional blank paragraphs remain intact. |
| [After, light](after-board-light.png) | The same text remains readable in the light theme. |
| [Live cloud response, dark](live-board-dark.png) | Five cards have 100-pixel clear gaps and arrows about 100 pixels long. |
| [Live cloud response, light](live-board-light.png) | The generated native drawing remains readable in the light theme. |
| [Live preview](live-preview-dark.png) | The preview renders complete words before insertion. |

The browser checks also verify label containment, an unchanged document before insertion, one-step undo and redo, reload, JSON export, and no page errors. The live result is one real provider response, not a guarantee that every model response follows the spacing instructions.

The development server recorded the pictured live request as `682cc7c5-2deb-4028-93be-9d64003b9713`, model `gpt-chat-latest`, HTTP 200 on the first provider attempt, with token usage reported. A second live confirmation also passed, with 120-pixel card gaps. Its artifacts remain in the local verification scratch directory rather than replacing the pictured sample.

Run from the repository root with a development server:

```sh
python scripts/verify-draw-generation-layout.py http://127.0.0.1:3053/ --baseline
python scripts/verify-draw-generation-layout.py http://127.0.0.1:3055/
python scripts/verify-draw-generation-layout.py http://127.0.0.1:3055/ --live
```

The baseline server must serve the original formatter. The live command uses the server's configured AI provider. Use `--output <directory>` to keep additional runs outside these committed artifacts.

Full results are in [before](verification-before.json), [after](verification-after.json), and [live](verification-live.json). The [fixture](fixture-proposal.json) and [live proposal](live-proposal.json) contain the actual layout inputs. Exported native scene records are retained alongside the screenshots.

# Draw parity audit evidence

The [decision trail](../draw-parity-decisions.tsv) records the implementation
and review decisions. Its historical absolute workspace paths identify the
original working artifacts. This directory archives the relevant artifacts
for readers outside that workspace.

## Read the final evidence

- [Full tests](integrated-full-tests.log) record 654 passed and 3 optional Redis skips.
- [Build](integrated-final-build.log) records the successful production build.
- [Combined browser workflows](integrated-browser-all.log) record all eight verifiers passing.
- [Live Azure workflow](integrated-live-browser.log) records HTTP 200 and scope, history, and reload checks through the local API.
- [Commands, geometry, and media review](review-combined-editor-final.md) gives the final independent gates for those units.
- [Extra tools and AI review](review-combined-ai-extras-final.md) gives their final independent gates and the committed comment-fix confirmation.
- [Completion reference](../draw-parity-completion.md) links the rerunnable scripts, screenshots, and supported limits.

## Resolve the historical workspace paths

For a path under `/workspace/scratch/issue15-pstack/`, use the same basename
in this directory when listed below. The baseline report is
[draw-baseline/report.json](../screenshots/draw-baseline/report.json).
Paths under a source checkout resolve to the corresponding repository path.

The planning record is [candidate A](candidate-a.md), [candidate B](candidate-b.md),
the [design review](design-review.md), and the [accepted design](design.md).
The workflow came from [pstack at abd512a6](https://github.com/michael-denyer/pstack-claude/tree/abd512a6d97dffe30d715460b4d7c143c92f9814/plugins/pstack/skills/poteto-mode).

The initial review reports are [commands](review-commands.md),
[geometry](review-geometry.md), [media](review-media.md),
[extra tools](review-extra-tools.md), and [AI](review-draw-ai.md).
The follow-up reports are [first units](review-first-units-final.md),
[media fixes](review-media-fixes-final.md), and
[extra-tool fixes](review-extra-fixes-final.md).

Historical reports name local revisions before integration and rebasing.
The final reports identify the published stack revisions and record the
reviewed code. The committed regression scripts reproduce the fixed behavior.
Native macOS execution remains unverified. Mermaid and AI limits are stated
in the completion reference. The audit uses the owner's session digest and
saved evidence because this runtime does not expose a known chat-transcript path.

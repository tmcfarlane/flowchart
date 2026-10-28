# Selected design and ownership

Goal is complete remaining issue 15 in the custom Draw editor while keeping original graph modes. Baseline main is 85ec3050aa39248686f31a183420a0b2996d20b1. Real Chromium baseline proved eight missing behaviors, and the full suite passes 549 tests with 3 optional Redis skips.

Candidate A is the base. Keep DrawCanvas preview/emit/selection ownership and App document history. Graft Candidate B's authoritative added-command metadata for palette and help, plus its strict dedicated Draw AI request. Reject a full event/command executor rewrite because it would require migrating working gestures before adding user behavior. An independent arena judge checks this choice in design-review.md.

## Flow

DOM event -> DrawCanvas transient preview or command -> focused pure domain helper -> emit -> graphFromElements and whole-scene validation -> App handleDrawChange -> one commitDocument transaction -> autosave/share.

Transient view, zen, crop, lasso, sampling, and laser never become persisted appState. Each command/gesture commits once. A native shortcut is tested before generic letter aliases. Read-only guards apply at mutation boundaries, including clipboard and async completion, while pan/zoom/search remain usable.

## Decomposition

1. Editor commands, search, palette, statistics, links, zen/view/theme, confirmed clear.
2. Geometry flips, directional connected creation/navigation, and lasso.
3. Clipboard text/images and selected PNG plus image crop.
4. Extra tools laser, eyedropper, fill, draw-to-shape, safe embeds and editable Mermaid import.
5. Selected-object Draw AI.

Workers use independent worktrees from baseline, then root integrates in that order into a stack. Shared controller writes never happen in one checkout at the same time. Per-unit focused tests/build and browser proofs precede integration; the root runs the combined suite after conflict resolution.

## Draw AI contract

Extend the existing authenticated /api/chat with a distinct mode for Draw edits. Share a strict bounded transport validator between API and browser. Send selected shape metadata and nearby relationship context without assets, data URLs, arbitrary customData, or URLs. The first contract can use sparse update operations over selected existing unlocked elements and associated selected labels. Allow text, safe shape appearance, finite geometry, and supported primitive changes. Do not accept AI-authored IDs, relationships, files, frame/group membership, arbitrary scene replacement, or executable content. Reject edits that cannot preserve derived relationships and unselected records. Preview before Apply. Revalidate after request completion and immediately before commit. Freeze exact scene signature and document epoch; cancellation or replacement invalidates pending work. Reuse existing Azure configuration, admission, limits and provider route. Keep existing graph selected edit behavior.

## Interface depth and risks

Pure geometry helpers accept a scene and IDs and return the full scene plus selection as needed. They hide rotation/path/binding complexity. App does not learn pointer state. The image renderer/export path is shared by PNG download and clipboard. Imported crop fields remain compatible. New URLs are parsed at boundaries. Live embedded content is sandboxed and opt-in, with a persistent static export fallback. Mermaid has a documented supported subset and rejects unsupported input rather than returning an image.

## Implementation reconciliation

The independent judge agreed with the base and grafts. Root accepted its ownership and scope safety rules. Root deliberately narrows its optional add/remove AI union to update-only operations for this slice, as the user needs selection-aware refinement and implicit deletion/addition effects would require a broader context contract. This restriction was sent to the AI worker before implementation.

Independent review proved AI-renamed text retained stale bounds. Root accepted derived text sizing and bound positioning through shared manual/AI helpers, while preserving every unrelated record. Root also accepted appearance-only targets for arrows, freedraw, images, and frames, so connector-plus-label selections can be edited without permitting model-authored geometry, relationships, files, URLs, or assets. This additive shape correction was sent to the AI fix owner before final validation. Independent review may tighten async or read-only behavior without creating a second state owner.

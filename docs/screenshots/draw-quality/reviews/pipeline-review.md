# Independent final pipeline review

Goal 37 is to return a clean backend-generated Excalidraw file and preserve its finalized geometry in the custom Draw editor. Reviewed source at `ac014c353a49165756d12309310b292dbb54cba3` against `1d8073f`. This reviewer did not implement the change or modify production source.

## Must fix

- **P2. Quality repair may silently discard requested objects.** `src/shared/server/chat.ts:293-308` constrains only overlap permissions between the first plan and the repair. A repair that deletes a crowded card becomes valid and is returned as a successful drawing. This violates the internal repair instruction to preserve content and IDs. A replay through the real `handleChat` and compiler supplied two overlapping cards, `left` labeled `Prepare` and `right` labeled `Publish`, then a repair retaining only `left`. The result was HTTP 200 after two provider calls. The returned native file contained only `left` and its label. The user's requested Publish step was silently lost.

  Reproduce with `node /workspace/scratch/draw-quality-implementation/reproduce-repair-deletion.mjs /workspace/flowchart-draw-quality`. At the reviewed head it prints `{"status":200,"attempts":2,...,"nativeIds":["left","ai-label-0"]}`. Preserve the original element ID/type set and semantic content during this internal geometry repair. Reject dropped or added elements, changed labels/text/names, or changed binding/frame relationships. Layout coordinates, dimensions and routing points can change. Keep this distinct from user-requested refinement, which may change content.

## Scope gap

- The maintained guide supplies field patterns but no complete curated drawing examples. The goal called for a few good examples. Two small complete plans are sufficient. Compile each example as part of verification, and run an ordinary live cloud smoke after changing the loaded guide, since that changes the actual generation context.

## Checks and limits

- Backend and client agree on the required `drawing` envelope. Preview, presentation and insertion call `sceneFromDrawing`; these paths contain no `drawProposalToScene` fallback.
- Insertion uses the existing remapping and translation path. It preserves path-local coordinates and fixed-point bindings.
- Draw refinement sends the bounded authoring plan, rather than the native file. Graph response parsing and icon resolution remain present.
- The API enforces two provider calls total, bounds upstream and final response bytes, and checks the deadline after compilation. Repair cannot add or expand overlap permissions.
- The wire strips overlaps from legacy source JSON and carries nonempty validated permissions separately. Existing strict source consumers remain compatible.
- Current-board Excalidraw export reads the Draw API's current scene and retains native fields and embedded files. It does not serialize the stale generation proposal.
- `vercel.json` includes both runtime generation Markdown guides in the chat function. The existing runtime CWD convention is unchanged.
- Scoped added comments consist of one public API boundary contract in `parseGenerationResponse`, which is a permitted contract comment. No added lint or TypeScript suppressions, constraint comments, or workaround comments were found. No deletions, restorations, or HOLDs are requested.
- This review does not replace browser proof or a deployed Vercel invocation. Native geometry and font correctness are assigned to the independent geometry reviewer. No broad test suite was repeated.

## Follow-up verdict at ce25623

The P2 is fixed in `ce25623ce1f0ecfae6dfe5263397cae6d6a076dc`, independently reviewed in the clean pipeline worktree. The original real-handler deletion replay now returns HTTP 502 after exactly two provider calls, with no drawing file. It reports that a clear drawing could not be produced while preserving content.

The repair fingerprint removes only x/y, width/height and path points. It sorts elements by ID, then compares the remaining parsed fields. This enforces the complete ID/type set, labels/text, names, colors, font sizes, endpoint IDs and frame children. Summary wording and proposal element order are outside the fingerprint. User-requested refinement is outside this internal repair guard.

Focused verification passed seven cases. Dropped IDs, added IDs, changed type, changed label and changed color each return 502 despite independently compilable replacement geometry. Reordered elements with changed summary and corrected spacing return 200. The two new complete guide examples both parse and compile through the real compiler. Command was `npx vitest run src/test/server/chat.test.ts -t 'keeps the maintained clean examples|repairs layout once|rejects a quality repair'`.

The curated examples gap is closed. The API/UI pipeline review passes with no remaining must-fix findings. The changed guide still needs the ordinary live cloud verification that root owns. Browser and deployed-runtime limits above remain unchanged.

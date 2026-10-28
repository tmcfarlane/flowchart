# Verify patch notes

Serve the immutable source revision you want to verify. Run the browser verifier from the repository root with Python Playwright and Chromium at `/usr/bin/chromium`.

```sh
python scripts/verify-patch-notes.py http://127.0.0.1:3081/ --source-revision SOURCE_COMMIT
```

The verifier prints nine `PASS` scenario lines and a final summary. It writes the supplied source revision, browser versions, and completed checks to [report.json](report.json). The `OBSERVE` line reports focus and keyboard behavior after clicking release text.

The checks cover unseen visitors before the AI welcome, older and malformed records, equal and future revisions, explicit acknowledgment, reload, and manual reopening. All four dismissal routes preserve a saved graph and Draw board. Manual notes preserve an unsent AI prompt, trap Tab, restore focus, and leave an existing undo and redo transaction intact.

The verifier also checks both themes, a 390 by 667 viewport, unavailable acknowledgment storage, and shared loading and load errors. Shared responses use browser-routed fixtures. It sends no AI requests. The existing full AI overlay blocks toolbar clicks. The prompt check closes that overlay, opens notes, then reopens the assistant. Presentation is exercised after explicit acknowledgment. The pending unseen-release presentation condition needs the controller and App tests.

Acknowledgment is local to one browser profile and origin. If browser storage is unavailable, dismissal lasts for the current page session and may repeat after a full reload.

The report retains a measured negative control from `f3b3651`. Clicking release text moved focus to `BODY`. Control+Z then reduced both visible and persisted graph nodes from two to one, and Escape left notes open. The keyboard check observes visible nodes and history controls immediately after each key. It then waits 650ms through draft autosave before it checks persistence.

Inspect the generated screenshots:

- [Automatic notes for an unseen visitor in dark mode](01-unseen-dark.png).
- [Manual toolbar entry in dark mode](02-manual-entry-dark.png).
- [Manually opened notes in dark mode](03-manual-dialog-dark.png).
- [Manually opened notes in light mode](04-manual-dialog-light.png).
- [Compact notes in dark mode](05-compact-dark.png).
- [Compact notes in light mode](06-compact-light.png).
- [Compact manual toolbar entry in light mode](07-compact-manual-entry-light.png).

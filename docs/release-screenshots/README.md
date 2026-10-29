# Capture the v3.0.0 screenshots

Run these commands from the repository root after `npm ci`. The browser script requires Python Playwright and Chromium at `/usr/bin/chromium`.

1. Start the isolated asset server.

   ```bash
   node scripts/start-release-screenshots.mjs --port 3120 --cache-dir /tmp/flowchart-release-v3-vite
   ```

2. In another terminal, capture all ten screenshots.

   ```bash
   python scripts/capture-release-screenshots.py http://127.0.0.1:3120/
   ```

3. Inspect the PNGs in `public/releases/v3.0.0/`. Stop the server with Ctrl+C.

The script opens isolated browser contexts and seeds only the fictional samples in `fixtures/`. It uses the actual FlowChart interface for camera changes, theme changes, text editing, component saves, AI previews, and Excalidraw import. It does not modify screenshots or embed another editor. No customer boards, authentication state, credentials, or share links enter the capture process.

The asset server disables application API handlers. The browser aborts external requests and rejects every API request except the two explicit `/api/chat` response fixtures. Neither preview applies changes to the board. No provider request, paid AI call, or shared-board write occurs during capture.

`recorded-draw-response.json` is a byte-for-byte copy of `docs/screenshots/draw-quality/captured-api-response.json` at source revision `bb189326408478482d334f513c47c4b9e525cbbb`. That committed response already contains the backend-finalized native drawing. This capture replays the saved HTTP response directly in the browser. It does not rerun the backend or make a live provider call. The source response and its earlier verification are documented in [Draw quality verification](../screenshots/draw-quality/README.md).

`selection-response.json` is an authored public response fixture for the selected card and its bound text. It proposes a blue fill and the label "Our project". The screenshot shows the application's real before/proposed comparison and enabled Apply button. The fixture is not a provider recording.

`community-library.excalidraw` adapts `src/test/fixtures/excalidraw/architecture-complete.excalidraw` with public library labels, a dark background, Sans text, a catalog label, a pen underline, and a captioned embedded image. The script imports that file through **Import JSON or Excalidraw file** and **Open as new diagram**. The other fixtures are authored public sample documents.

The desktop viewport is 1440 × 960. The phone viewport is 390 × 844 with touch enabled. All images use device scale factor 1. [manifest.json](manifest.json) records the source revision, UTC capture time, browser and Playwright versions, routed fixture requests, actual PNG dimensions, fixture hashes, and PNG hashes. [SHA256SUMS](../../public/releases/v3.0.0/SHA256SUMS) contains the ten PNG hashes with relative filenames.

The capture verifies the shipped first-party editor at the recorded source revision. It does not test deployed API infrastructure or rendering in an external Excalidraw application.

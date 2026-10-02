# Local-copy browser regressions

These two Chromium tests exercise the compiled website through real browser input and full document reloads. They protect the saved local copy after a shared chart is detached:

1. Make an editable copy, edit and naturally save it, reload, explicitly preview and restore the saved draft, then edit again.
2. Commit a visible edit while storage still contains the earlier draft, reload within the actual 800 ms autosave window, and explicitly restore the latest edit saved by the natural page lifecycle.

Both cases preserve a six-node architecture with two container levels, three connections, exact positions and dimensions, a stable icon, handles, protocols and communication styles. They compare the saved graph and actual downloaded JSON. A scheduled shared poll must occur before detaching; no API traffic may resume during two real polling windows afterward.

## Run from a clean checkout

Use Node.js 20 or newer. The recorded clean-checkout run uses Node 24.

```sh
npm ci
npm run test:browser:install
npm run test:browser
```

The repository pins `@playwright/test` and its matching browser tooling in `package-lock.json`. On a Linux runner that needs browser system libraries, install them with `npx playwright install --with-deps chromium` instead of the browser-only install command. See [Playwright browser installation](https://playwright.dev/docs/browsers).

The test command type-checks the browser harness, builds to the ignored `.browser-test-dist/` directory, starts its own production preview at `http://127.0.0.1:4186`, runs the two cases with one worker and no retries, and stops that owned preview process. It preserves the ordinary `dist/` build and never reuses or stops an existing server. If port 4186 is occupied, choose a free port with `FLOWCHART_BROWSER_PORT`; the port must be an integer from 1024 to 65535. On a POSIX shell:

```sh
FLOWCHART_BROWSER_PORT=4187 npm run test:browser
```

The strict port and `reuseExistingServer: false` make an occupied-port error explicit. [Playwright manages the server lifecycle](https://playwright.dev/docs/test-webserver). No separately started dev server, global browser package, machine-specific path, or provider configuration is required.

## Evidence and limits

Each test gets fresh browser storage. The harness intercepts API traffic before navigation: only the synthetic chart GET is fulfilled, all other APIs are blocked without fallback, and off-origin traffic is blocked. It never seeds draft storage, replaces application timers, dispatches artificial lifecycle events or calls the draft flush function. Native Enter, page lifecycle events and new-document `performance.timeOrigin` establish the early reload boundary; the previously stored draft must still be present immediately before reload. A timing miss fails the test rather than claiming latest-edit loss or relaxing the boundary.

Screenshots, sanitized JSON receipts and actual exports are written under ignored `test-results/` and attached to the test result. Receipts identify source files and the served production bundle, whose hash must match the newly built local artifact. Git identity is recorded when available, with dirty state reported honestly. These are behavioral regressions; screenshots are evidence rather than pixel snapshots.

The early-reload test records native lifecycle observations with `console.timeStamp` and Chromium's browser timeline, which retains those records when the old document is destroyed. It keeps only the harness's prefixed scalar payloads, ends recording after reload, and releases its debugging session even on failure. It does not retain the full browser timeline.

The tests verify client persistence and detachment using mocked shared HTTP. They do not establish remote chart persistence, actual ChatGPT host installation, image-provider operation or physical-device behavior. Server title, ID, version, timestamps and private capabilities are outside the browser draft contract. The ordinary Vitest command remains scoped to `src/test/` and does not load Playwright tests.

See the [committed clean-checkout screenshots, receipts and exports](qa/browser-reload/README.md) for an actual passing run.

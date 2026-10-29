# Contribute to Flowchart AI

Flowchart AI is open source under the [MIT license](LICENSE). Fork the [repository](https://github.com/tmcfarlane/flowchart/fork), make a focused change, and open a pull request.

## Set up development

Use Node.js 20 or newer and npm. Install the dependencies from the tracked `package-lock.json`:

```sh
npm ci
npm run dev
```

Open `http://localhost:3004`. Vite also serves the local `/api/chat`, `/api/flows`, and `/api/mcp` handlers. The canvas runs without an environment file or AI credentials. Local sharing uses a file-backed development store when Redis is absent.

Run the tests once and build the frontend and API:

```sh
npm test -- --run
npm run build
```

Use `npm test` for watch mode. Use `npm run typecheck:api` to check the API separately.

## Configure optional AI

AI generation, refinement, and selected-object edits use the existing `/api/chat` handler and an operator-owned Azure deployment.

```sh
cp .env.example .env
```

Set `AI_ROUTING_MODE=direct` or `AI_ROUTING_MODE=gateway` deliberately. Both modes require `AZURE_RESOURCE_NAME`, `AZURE_DEPLOYMENT_NAME`, `AZURE_API_KEY`, `AI_INPUT_PRICE_PER_MILLION`, and `AI_OUTPUT_PRICE_PER_MILLION`. Verify the prices for your deployment. Gateway mode also requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_ID`, and `CLOUDFLARE_AI_GATEWAY_TOKEN`.

Keep every credential server-side without a `VITE_` prefix. Do not commit `.env` or include credentials in screenshots, browser code, requests, or logs. Production AI, sharing, and MCP require your own Redis settings. `AI_ENABLED=false` stops inference without disabling canvas editing.

See [`.env.example`](.env.example) and the [API configuration guide](api/README.md#apichat) for all settings, limits, privacy, and self-hosting requirements. The [MCP guide](docs/mcp.md#self-hosting) covers shared chart storage and agent access.

## Find the code

| Path | Contents |
| --- | --- |
| `src/` | React app, graph canvases, first-party SVG Draw editor, and shared logic. |
| `api/` | Vercel-compatible API handlers and AI runtime instructions. |
| `assets/` | Bundled Azure icons and fonts. |
| `public/` | Public static assets. |
| `docs/` | Feature guides and release documentation. |
| `scripts/` | Asset generation and browser verification tools. |

## Prepare a pull request

Keep the change focused. Add or adjust tests for new logic and bug fixes. Update the relevant guide when behavior changes. For UI changes, exercise the affected workflow in the browser and include public-safe evidence in the pull request.

Describe the problem, the resulting behavior, and the checks you ran. Use a clear, descriptive commit message. Follow [SECURITY.md](SECURITY.md) for vulnerability reports.

## Publish patch notes

Prepend a release to `PATCH_NOTES` in `src/patchNotes.ts`. Give it a positive safe integer `revision` higher than every published revision, an ISO date, a title, and user-facing highlights. Never reuse a revision, even for another release on the same date. Keep older entries below the latest release.

Run the patch-note checks:

```sh
npx vitest run src/test/patchNotes.test.ts src/test/usePatchNotes.test.tsx src/test/PatchNotesDialog.test.tsx src/test/PatchNotesApp.test.tsx src/test/PatchNotesReleaseUpdate.test.tsx
```

In a fresh browser, confirm that the notes open before the AI welcome. Dismiss them, reload, and reopen them with **What's new**. Check both themes and a compact viewport.


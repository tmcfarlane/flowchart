## Contributing

Thanks for taking the time to contribute!

### Development setup

- **Prerequisites**: Node.js 18+ and `pnpm`
- **Install**:

```bash
pnpm install
```

- **Run**:

```bash
pnpm dev
```

- **Test**:

```bash
pnpm test
```

### AI features (optional)

AI-assisted flowchart generation uses the Vercel function at `api/chat.ts` and requires Azure OpenAI credentials.

1. Copy `.env.example` to `.env`
2. Set:
   - `AZURE_DEPLOYMENT_NAME`
   - `AZURE_RESOURCE_NAME`
   - `AZURE_API_KEY`

> Note: These are server-side variables (do **not** use a `VITE_*` prefix).

### Project structure (quick map)

- **Frontend**: `src/` (main app is `src/App.tsx`)
- **Serverless API**: `api/` (Vercel functions)
- **Azure icons**: `assets/` (bundled locally)
- **Docs**: `docs/`

### Pull requests

- Keep PRs focused and scoped (small changes are easier to review).
- Add/adjust tests when fixing bugs or adding logic-heavy features.
- Update docs (`README.md`, `api/README.md`, or `docs/`) when behavior changes.

### Publish patch notes

Prepend a release to `PATCH_NOTES` in `src/patchNotes.ts`. Give it a positive safe integer `revision` higher than every published revision, an ISO date, a title, and user-facing highlights. Never reuse a revision, even for another release on the same date. Keep older entries below the latest release.

Run `npx vitest run src/test/patchNotes.test.ts src/test/usePatchNotes.test.tsx src/test/PatchNotesDialog.test.tsx src/test/PatchNotesApp.test.tsx src/test/PatchNotesReleaseUpdate.test.tsx`. In a fresh browser, confirm that the notes open before the AI welcome. Dismiss them, reload, and reopen them with **What's new**. Check both themes and a compact viewport.

### Commit style

No strict convention is required, but please use clear, descriptive messages.


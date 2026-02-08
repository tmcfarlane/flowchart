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

### Commit style

No strict convention is required, but please use clear, descriptive messages.


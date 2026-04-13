<div align="center">

<p>
  <a href="https://flowchart.zeroclickdev.ai/">
    <img src="docs/screenshots/flow.gif" alt="FlowChart AI — Free AI-powered flowchart designer" width="560" />
  </a>
</p>

<div style="font-size: 2.5em; font-weight: 800; letter-spacing: 0.08em; line-height: 1.1;">
  <strong>FLOWCHART AI</strong>
</div>

<div style="font-size: 1.1em; margin: 8px 0;">
  <strong>Describe your idea. Get a flowchart.</strong>
</div>

The open-source flowchart designer that turns plain-English prompts into polished diagrams in seconds.<br>
AI generation &nbsp;|&nbsp; 663+ Azure icons &nbsp;|&nbsp; Presentation mode &nbsp;|&nbsp; Export to PNG, SVG & GIF

<br>

[![Try it Live](https://img.shields.io/badge/Try_it_Live-00c896?style=for-the-badge&logo=vercel&logoColor=white)](https://flowchart.zeroclickdev.ai/)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/tmcfarlane/flowchart)](https://github.com/tmcfarlane/flowchart/stargazers)
[![Issues](https://img.shields.io/github/issues/tmcfarlane/flowchart)](https://github.com/tmcfarlane/flowchart/issues)
[![Free](https://img.shields.io/badge/Price-Free-brightgreen)](https://flowchart.zeroclickdev.ai/)
<br>

Created by <a href="https://zeroclickdev.ai/">ZeroClickDev</a>

</div>

---

## Features

- **AI-powered generation** — describe what you want in plain English, get a structured flowchart in seconds
- **Free to use** — no sign-up, no paywall, no limits on the canvas
- **Export to PNG, SVG & animated GIF** — share diagrams in docs, slides, or README files
- **Presentation mode** — step through your flowchart with arrow keys, perfect for walkthroughs
- **663+ Azure icons** — official [Azure icon library](https://learn.microsoft.com/en-us/azure/architecture/icons/) built in, auto-applied by AI
- **Dark mode** — charcoal UI with teal/cyan accents, toggleable in one click
- **Polished canvas UX** — snap-to-grid, undo/redo, copy/paste, minimap, multi-select
- **Multiple node & edge types** — step, decision, note, image nodes with editable labels and animated edges
- **AI proposal preview** — review, regenerate, and tweak AI suggestions before inserting
- **Deploy anywhere** — one-click Vercel deploy, serverless API keeps credentials safe

<details>
<summary><strong>Screenshots</strong></summary>

### AI Generation

Tell Flowchart what you want to make and watch it magically jump start you.

![Tell Flowchart what you want to make and watch it magically jump start you](docs/screenshots/vibes.png)

### Azure Icons

Official Azure icons are automatically applied to AI-generated nodes.

![Default support for official Azure icons library](docs/screenshots/azureicons.png)

### AI Proposal Preview

Review, regenerate, and modify AI suggestions before adding them to the canvas.

![AI proposal view to review, regenerate, and modify prior to adding your new flowchart to the canvas](docs/screenshots/ai-proposal.png)

### Presentation Mode

Walk through your flowchart step by step with arrow keys — great for meetings and demos.

![Presentation Mode will walk you through your flowchart from start to finish](docs/screenshots/presentation.png)

</details>

## Quickstart

```bash
# Prerequisites: Node.js 18+, pnpm 10.x
pnpm install
pnpm dev          # http://localhost:3004
pnpm test         # run tests
pnpm build        # production build
```

## AI Setup (optional)

The AI assistant uses **Azure OpenAI** through a serverless proxy (`api/chat.ts`) so credentials stay server-side.

```bash
cp .env.example .env
```

Set these variables (server-side only; do **not** use `VITE_*`):

| Variable                | Description                  |
| ----------------------- | ---------------------------- |
| `AZURE_DEPLOYMENT_NAME` | Your Azure OpenAI deployment |
| `AZURE_RESOURCE_NAME`   | Your Azure resource name     |
| `AZURE_API_KEY`         | Your Azure API key           |

For Vercel, add the same variables in your project settings.

<details>
<summary><strong>Architecture</strong></summary>

```mermaid
sequenceDiagram
  participant User
  participant UI as React UI
  participant API as Vercel Function
  participant Azure as Azure OpenAI

  User->>UI: Prompt (generate or refine)
  UI->>API: POST /api/chat (flow context optional)
  API->>Azure: Chat completions (structured output)
  Azure-->>API: JSON flowchart proposal
  API-->>UI: Message (JSON string) + finish reason
  UI-->>User: Preview then insert
```

- API: [`api/`](api/README.md)
- AI prompt skill: [`api/flowchart-generation-skill.md`](api/flowchart-generation-skill.md)
- Icon resolution: [`src/utils/azureIconRegistry.ts`](src/utils/azureIconRegistry.ts)

</details>

## Tech Stack

![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel&logoColor=white)

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

## Built With

This app was built 100% with AI assistance using Cursor, OpenCode, and [Oh My Cursor](https://github.com/tmcfarlane/oh-my-cursor).

## License

MIT. See [`LICENSE`](LICENSE).

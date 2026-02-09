# Flowchart API

## `/api/chat`

Vercel Serverless Function that proxies AI requests to Azure OpenAI (or compatible endpoint).

### Environment Variables

Server-side environment variables (NOT `VITE_*`):

- `AZURE_DEPLOYMENT_NAME` - Azure OpenAI deployment name
- `AZURE_RESOURCE_NAME` - Azure OpenAI resource name
- `AZURE_API_KEY` - Azure OpenAI API key

### Request Format

```typescript
POST /api/chat

{
  "messages": [
    { "role": "user", "content": "Create a login flow" }
  ],
  "flowContext": {
    "nodes": [...],  // Current flowchart nodes
    "edges": [...]   // Current flowchart edges
  }
}
```

### Response Format

```typescript
{
  "message": "```json\n{...}\n```",
  "role": "assistant"
}
```

The `message` field contains a JSON code block with the flowchart proposal.

### Flowchart Generation Skill

The API uses a **skill-based prompt engineering approach** defined in `flowchart-generation-skill.md`.

This skill file:
- Defines the exact JSON schema the AI must use
- Provides multiple correct/wrong examples
- Enforces strict flowchart-only output
- Is loaded at runtime and sent as the system prompt

**To modify AI behavior:** Edit `flowchart-generation-skill.md`, not `chat.ts`.

### Architecture

```
User Input → Frontend (AIChat.tsx)
    ↓
    → POST /api/chat (with flowContext)
    ↓
    → Loads flowchart-generation-skill.md
    ↓
    → Azure OpenAI API (with skill as system prompt)
    ↓
    → Returns flowchart JSON
    ↓
    → Frontend parses JSON → Shows preview → Inserts on confirm
```

### Error Handling

- **400** - Invalid request (missing messages)
- **405** - Method not allowed (non-POST)
- **500** - Server configuration error or Azure OpenAI API error
- **200** - Success (includes assistant message)

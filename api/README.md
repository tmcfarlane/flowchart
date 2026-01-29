# API Documentation

## `/api/chat` - AI Chat Proxy

This serverless function proxies AI chat requests to Azure OpenAI, ensuring API credentials never reach the browser.

### Endpoint

```
POST /api/chat
```

### Request Body

```typescript
{
  messages: Array<{
    role: 'user' | 'assistant' | 'system'
    content: string
  }>
  flowContext?: {
    nodes: Array<{
      id: string
      type: string
      label: string
      position: { x: number; y: number }
    }>
    edges: Array<{
      id: string
      source: string
      target: string
    }>
  }
}
```

### Response

**Success (200):**
```json
{
  "message": "Assistant response text",
  "role": "assistant"
}
```

**Error (400/500):**
```json
{
  "error": "Error description"
}
```

### Environment Variables

Configure these server-side environment variables in your Vercel project:

- `AZURE_DEPLOYMENT_NAME` - Your Azure OpenAI deployment name
- `AZURE_RESOURCE_NAME` - Your Azure OpenAI resource name
- `AZURE_API_KEY` - Your Azure OpenAI API key

**Important:** These are server-side only. Do NOT use `VITE_*` prefix as that would expose them to the browser.

### Local Development

For local development with Vercel CLI:

1. Copy `.env.example` to `.env`
2. Fill in your Azure OpenAI credentials
3. Run `vercel dev` to test the serverless function locally

The frontend will automatically call `/api/chat` whether in development or production.

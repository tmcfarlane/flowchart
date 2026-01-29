/// <reference types="vite/client" />

// No frontend environment variables needed - AI calls are proxied through /api/chat
interface ImportMetaEnv {
  // Add any frontend-specific env vars here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

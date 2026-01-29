/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_DEPLOYMENT_NAME: string
  readonly VITE_AZURE_RESOURCE_NAME: string
  readonly VITE_AZURE_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Serve fonts from this deployment. The editor must never depend on its CDN.
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const source = fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url))
const target = fileURLToPath(new URL('../public/excalidraw-assets/fonts/', import.meta.url))
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })

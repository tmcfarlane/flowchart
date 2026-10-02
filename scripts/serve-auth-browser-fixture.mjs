// This fixture never ships in a Vercel API function. It injects a signed mock
// OIDC transport into the real handlers and serves a separate compiled UI.
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const outfile = resolve('.browser-auth-test-dist/auth-fixture.mjs')
await build({
  entryPoints: ['tests/browser/openai-auth-server.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
})
await import(pathToFileURL(outfile).href)

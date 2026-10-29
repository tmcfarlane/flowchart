import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3120' },
  'cache-dir': { type: 'string' },
} })
const require = createRequire(join(root, 'package.json'))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const server = await createServer({
  root,
  configFile: false,
  cacheDir: values['cache-dir'] ? resolve(values['cache-dir']) : mkdtempSync(join(tmpdir(), 'flowchart-release-captures-')),
  plugins: [react(), {
    name: 'release-capture-static-only',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)) return next()
        response.writeHead(405, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'Release capture server serves first-party assets only.' }))
      })
    },
  }],
  server: { host: '127.0.0.1', port: Number(values.port), strictPort: true },
})
await server.listen()
console.log(`Release capture server ready at http://127.0.0.1:${values.port}/`)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await server.close()
  process.exit(0)
})

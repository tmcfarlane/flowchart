import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

// Serves /api/flows and /api/mcp during `npm run dev` by running the same
// handler modules Vercel deploys (api/*.ts), loaded through Vite's SSR module
// loader. src/shared/server/nodeAdapter.ts adds the req.body/req.query that
// Vercel provides.
const FLOW_ENV_KEYS = [
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'PUBLIC_BASE_URL',
]

function apiFlowsDevPlugin(mode: string): Plugin {
  return {
    name: 'api-flows-dev',
    configureServer(server) {
      if (process.env.VITEST) return

      const env = loadEnv(mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        const forwarded = FLOW_ENV_KEYS.includes(key) || ['FLOW_', 'CHAT_', 'AZURE_', 'STRIPE_', 'BILLING_', 'OPENAI_', 'PREMIUM_', 'IMAGE_'].some((prefix) => key.startsWith(prefix))
        if (forwarded && value && !process.env[key]) process.env[key] = value
      }
      // Without Redis, keep dev charts in a temp file so they survive restarts.
      process.env.FLOW_STORE_FILE ??= join(tmpdir(), 'flowchart-dev', 'flows.json')
      process.env.BILLING_STORE_FILE ??= join(tmpdir(), 'flowchart-dev', 'billing.json')

      server.httpServer?.once('listening', async () => {
        try {
          const store = await server.ssrLoadModule('/src/shared/server/store.ts')
          const redis = store.resolveRedisConfig(process.env)
          const address = server.httpServer?.address()
          const port = address && typeof address === 'object' ? address.port : 3004
          console.log(
            `[flowchart] Dev API: /api/flows and /api/mcp (MCP endpoint http://localhost:${port}/api/mcp). ` +
              `Storage: ${redis ? `Upstash Redis (${redis.source})` : `file-backed dev store at ${process.env.FLOW_STORE_FILE}`}`,
          )
        } catch (err) {
          console.error('[flowchart] Dev API failed to load', err)
        }
      })

      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith('/api/')) return next()
        try {
          const adapter = await server.ssrLoadModule('/src/shared/server/nodeAdapter.ts')
          const route = adapter.matchApiRoute(pathname)
          if (!route) return next()
          await adapter.prepareVercelStyleRequest(req, route.params)
          const handlerModule = await server.ssrLoadModule(adapter.API_ROUTE_MODULES[route.name])
          await handlerModule.default(req, res)
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err)
          console.error('[api-flows-dev]', err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiFlowsDevPlugin(mode)],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 3004,
    strictPort: !!process.env.PORT,
  },
  build: {
    // Keep the icon library addressable without embedding every SVG in the
    // initial JavaScript. Browsers fetch only the icons a diagram displays.
    assetsInlineLimit: 0,
    rollupOptions: {
      // mcp.html is the /mcp launch page: its own entry, so it ships without the React Flow app bundle.
      // `vite` and `vite preview` serve /mcp from mcp.html; vercel.json rewrites it in production.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        mcp: fileURLToPath(new URL('./mcp.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['src/test/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))

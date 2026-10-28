import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const { values } = parseArgs({ options: {
  root: { type: 'string', default: process.cwd() },
  port: { type: 'string', default: '3061' },
  proposal: { type: 'string', default: 'docs/screenshots/ai-draw-tools/live-proposal.json' },
  output: { type: 'string', default: '/workspace/scratch/draw-quality-implementation' },
} })
const root = resolve(values.root)
const output = resolve(values.output)
const fixturePath = resolve(root, values.proposal)
const fixtureText = readFileSync(fixturePath, 'utf8')
const fixture = JSON.parse(fixtureText)
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const fixtureSha256 = createHash('sha256').update(fixtureText).digest('hex')
const require = createRequire(join(root, 'package.json'))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
mkdirSync(output, { recursive: true })
process.chdir(root)

const env = {
  AI_ROUTING_MODE: 'direct', AZURE_RESOURCE_NAME: 'verification-fixture',
  AZURE_DEPLOYMENT_NAME: 'verification-fixture', AZURE_API_KEY: 'local-fixture-only',
  AI_INPUT_PRICE_PER_MILLION: '1', AI_OUTPUT_PRICE_PER_MILLION: '5',
  AI_CLIENT_REQUESTS_PER_MINUTE: '1000', AI_GLOBAL_REQUESTS_PER_MINUTE: '10000',
  AI_DAILY_BUDGET_USD: '100', AI_ENVIRONMENT: 'verification-fixture', NODE_ENV: 'test',
}
const rejected = { outputMode: 'draw', summary: 'Deliberately overlapping fixture', overlaps: [], elements:
  ['first', 'second'].map(id => ({ id, type: 'rectangle', x: 0, y: 0, width: 240, height: 150,
    label: id, strokeColor: '#234567', backgroundColor: '#eeeeee' })) }
let providerCalls = 0
const reportPath = join(output, `browser-fixture-api-${values.port}.jsonl`)
appendFileSync(reportPath, JSON.stringify({ event: 'verification_run', sourceRevision, fixtureSha256 }) + '\n')
const fixtureFetch = async (_url, init) => {
  const request = JSON.parse(String(init.body))
  const failing = request.messages.some(message => message.role === 'user' && message.content.includes('verification-reject-layout'))
  providerCalls += 1
  appendFileSync(reportPath, JSON.stringify({ event: 'fixture_provider', call: providerCalls,
    case: failing ? 'rejected' : 'captured', format: request.response_format?.type }) + '\n')
  return new Response(JSON.stringify({ model: 'verification-fixture',
    choices: [{ message: { content: JSON.stringify(failing ? rejected : fixture) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 100 } }))
}

const server = await createServer({ root, configFile: false, cacheDir: join(output, `vite-fixture-cache-${values.port}`),
  plugins: [react(), {
    name: 'draw-quality-real-chat-fixture',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/api/chat') return next()
        try {
          const { prepareVercelStyleRequest } = await vite.ssrLoadModule('/src/shared/server/nodeAdapter.ts')
          const { handleChat } = await vite.ssrLoadModule('/src/shared/server/chat.ts')
          await prepareVercelStyleRequest(req, {})
          await handleChat(req, res, { env, dependencies: { fetch: fixtureFetch,
            report: event => appendFileSync(reportPath, JSON.stringify(event) + '\n') } })
        } catch (error) {
          vite.ssrFixStacktrace(error)
          console.error(error)
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Local verification server failed' }))
        }
      })
    },
  }],
  server: { host: '127.0.0.1', port: Number(values.port), strictPort: true },
})
await server.listen()
const { parseDrawDocument } = await server.ssrLoadModule('/src/shared/drawDocument.ts')
const { ARCHITECTURE_SCENE_LIMITS } = await server.ssrLoadModule('/src/shared/architectureScene.ts')
const valid = { type: 'excalidraw', version: 2, source: 'verification', elements: [], files: {} }
parseDrawDocument(valid)
const invalidDocuments = {
  boundedSource: { ...valid, source: 'x'.repeat(2001) },
  boundedDocumentBytes: { ...valid, appState: { verificationPayload: 'x'.repeat(ARCHITECTURE_SCENE_LIMITS.maxBytes + 1) } },
}
const parserChecks = Object.fromEntries(Object.entries(invalidDocuments).map(([name, document]) => {
  try { parseDrawDocument(document) } catch { return [name, true] }
  throw new Error(`Native document parser accepted ${name}`)
}))
appendFileSync(reportPath, JSON.stringify({ event: 'native_parser', ...parserChecks }) + '\n')
console.log(JSON.stringify({ url: `http://127.0.0.1:${values.port}/`, method: 'real handleChat with fixture provider fetch',
  root, sourceRevision, fixturePath, fixtureSha256, reportPath }))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0) })

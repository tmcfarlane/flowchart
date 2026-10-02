import { expect, type CDPSession, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Chart, ChartEdge, ChartNode } from '../../src/shared/flowTypes'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const sourcePaths = [
  'src/App.tsx', 'src/hooks/useSharedFlow.ts', 'src/hooks/useLocalDraft.ts', 'src/utils/sharedFlow.ts',
  'tests/browser/local-copy-fixture.ts', 'tests/browser/local-copy-reload.spec.ts',
  'playwright.config.ts', 'package.json', 'package-lock.json', 'tsconfig.browser-tests.json',
]
const lifecyclePrefix = '__FLOWCHART_COPY_LIFECYCLE__'

export const MOCK_CHART: Chart & { fixtureMarker: string } = {
  id: 'DraftCopy1', version: 7, title: 'Mocked reload architecture',
  createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  fixtureMarker: 'local-copy-reload-browser-fixture-v1',
  nodes: [
    { id: 'region', type: 'container', label: 'Mocked shared region', position: { x: 0, y: 0 }, width: 520, height: 340, containerKind: 'region' },
    { id: 'vpc', type: 'container', label: 'Nested private network', position: { x: 24, y: 50 }, width: 460, height: 255, parentNode: 'region', containerKind: 'vpc' },
    { id: 'api', type: 'service', label: 'Source API', position: { x: 28, y: 56 }, width: 180, height: 100, parentNode: 'vpc', icon: 'icon-robot' },
    { id: 'queue', type: 'queue', label: 'Event queue', position: { x: 244, y: 56 }, width: 180, height: 100, parentNode: 'vpc' },
    { id: 'archive', type: 'database', label: 'Long-term archive', position: { x: 620, y: 170 }, width: 160, height: 100 },
    { id: 'client', type: 'externalActor', label: 'Mocked client', position: { x: -220, y: 140 }, width: 160, height: 100 },
  ],
  edges: [
    { id: 'request', source: 'client', target: 'api', label: 'Read request', style: 'default', sourceHandle: 'right', targetHandle: 'left', protocol: 'HTTPS', commStyle: 'sync' },
    { id: 'enqueue', source: 'api', target: 'queue', label: 'Queue event', style: 'step', sourceHandle: 'right', targetHandle: 'left', protocol: 'event', commStyle: 'async' },
    { id: 'archive-write', source: 'queue', target: 'archive', label: 'Archive write', style: 'animated', sourceHandle: 'bottom', targetHandle: 'left', protocol: 'SQL' },
  ],
}
const chartRaw = JSON.stringify(MOCK_CHART)

interface SavedDraft {
  version: 1
  savedAt: number
  diagramMode: 'architecture'
  flow: { nodes: ChartNode[]; edges: ChartEdge[] }
}
export interface DraftSnapshot { raw: string; draft: SavedDraft; sha256: string }
interface ApiCall { method: string; path: string; query: string; phase: string; epochMs: number; transport: string }
interface DocumentRequest { url: string; method: string; phase: string; epochMs: number }
interface CommitObservation { key: string; isTrusted: boolean; value: string; eventEpochMs: number; receivedAtMs: number; timeOrigin: number }
interface LifecycleObservation { kind: string; isTrusted: boolean; observedAtMs: number; timeOrigin: number; visibilityState: string; savedAt?: number; savedApiLabel?: string }
export interface PreReloadObservation {
  raw: string | null
  visibleLabel?: string | null
  inputCount: number
  commit: CommitObservation | null
  observedAtMs: number
  timeOrigin: number
}
interface PortableDiagram {
  version: number
  mode: string
  nodes: Array<{ id: string; type: string; position: ChartNode['position']; parentNode?: string; extent?: string; style: { width?: number; height?: number }; data: { label: string; icon?: string; containerKind?: string } }>
  edges: Array<{ id: string; source: string; target: string; label?: string; sourceHandle?: string; targetHandle?: string; type: string; animated: boolean; data: { protocol?: string; commStyle?: string } }>
}
declare global {
  interface Window {
    __copyProofCommit?: CommitObservation | null
  }
}

function expectedFlow(label: string) {
  return { nodes: MOCK_CHART.nodes.map(node => node.id === 'api' ? { ...node, label } : node), edges: MOCK_CHART.edges }
}
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(resolve(projectRoot, path)))])))
}
function sourceNumber(source: string, name: string) {
  const literal = source.match(new RegExp(`export const ${name} = ([\\d_]+)`))?.[1]
  expect(literal, `Missing actual source constant ${name}`).toBeTruthy()
  return Number(literal!.replace(/_/g, ''))
}

/** A disposable client fixture: all APIs are mocked or aborted, never forwarded. */
export class LocalCopyFixture {
  readonly calls: ApiCall[] = []
  readonly blockedExternal: Array<{ method: string; path: string; phase: string; epochMs: number; transport: string }> = []
  readonly blockedNonStatic: Array<{ method: string; path: string; phase: string; epochMs: number }> = []
  readonly documents: DocumentRequest[] = []
  readonly lifecycle: LifecycleObservation[] = []
  readonly details: Record<string, unknown> = {}
  phase = 'startup'
  draftKey = ''
  pollMs = 0
  debounceMs = 0
  origin = ''
  requestsAtDetach = 0
  passed = false
  failure?: string
  private initialSourceHashes: Record<string, string> = {}
  private lifecycleSession?: CDPSession
  private lifecycleTracing = false

  constructor(readonly page: Page, readonly testInfo: TestInfo) {}

  mark(phase: string) { this.phase = phase }
  nodes() { return this.page.locator('.react-flow-wrapper .react-flow__node') }
  apiLabel() { return this.page.locator('.react-flow-wrapper [data-id="api"] .node-label') }

  async startAndCopy() {
    const sharedSource = await readFile(resolve(projectRoot, 'src/hooks/useSharedFlow.ts'), 'utf8')
    const draftSource = await readFile(resolve(projectRoot, 'src/hooks/useLocalDraft.ts'), 'utf8')
    this.pollMs = sourceNumber(sharedSource, 'POLL_FAST_MS')
    this.debounceMs = sourceNumber(draftSource, 'LOCAL_DRAFT_DEBOUNCE_MS')
    this.draftKey = draftSource.match(/export const LOCAL_DRAFT_KEY = '([^']+)'/)?.[1] ?? ''
    expect(this.draftKey).not.toBe('')
    this.initialSourceHashes = await sourceHashes()
    let git: Record<string, string | number | boolean>
    try {
      git = {
        available: true,
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
        tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
      }
      const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: projectRoot, encoding: 'utf8' }).trim()
      git.dirty = status.length > 0
      git.changeCount = status ? status.split(/\r?\n/).length : 0
    } catch { git = { available: false, unavailable: 'Git identity unavailable; file and bundle hashes still checked.' } }
    this.details.source = { git, files: this.initialSourceHashes }
    const runnerPackage = JSON.parse(await readFile(resolve(projectRoot, 'node_modules/@playwright/test/package.json'), 'utf8')) as { version: string }
    this.details.runtime = { node: process.version, browser: this.page.context().browser()?.version(), playwright: runnerPackage.version }

    const configuredBase = this.testInfo.project.use.baseURL
    expect(configuredBase, 'A loopback baseURL must come from Playwright configuration').toBeTruthy()
    this.origin = new URL(configuredBase!).origin
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(this.origin).hostname)
    expect(new URL(this.origin).protocol).toBe('http:')
    await this.page.context().route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== this.origin) {
        this.blockedExternal.push({ method: request.method(), path: url.pathname.slice(0, 300), phase: this.phase, epochMs: Date.now(), transport: 'off-origin request aborted; no fallback or query logged' })
        return route.abort('blockedbyclient')
      }
      if (!url.pathname.startsWith('/api/')) {
        if (request.method() === 'GET' || request.method() === 'HEAD') return route.continue()
        this.blockedNonStatic.push({ method: request.method(), path: url.pathname, phase: this.phase, epochMs: Date.now() })
        return route.abort('blockedbyclient')
      }
      const allowed = request.method() === 'GET' && url.pathname === `/api/flows/${MOCK_CHART.id}` && (url.search === '' || url.search === `?since=${MOCK_CHART.version}`)
      const safeQuery = url.search === '' ? '' : url.search === `?since=${MOCK_CHART.version}` ? url.search : '[redacted]'
      this.calls.push({ method: request.method(), path: url.pathname, query: safeQuery, phase: this.phase, epochMs: Date.now(), transport: allowed ? 'in-memory mocked chart' : 'aborted; no fallback' })
      if (!allowed) return route.abort('blockedbyclient')
      return route.fulfill({ status: 200, contentType: 'application/json', body: url.searchParams.has('since') ? JSON.stringify({ changed: false, version: MOCK_CHART.version, fixtureMarker: MOCK_CHART.fixtureMarker }) : chartRaw })
    })
    this.page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === this.page.mainFrame()) this.documents.push({ url: request.url(), method: request.method(), phase: this.phase, epochMs: Date.now() })
    })
    await this.page.goto('/', { waitUntil: 'load' })
    expect(new URL(this.page.url()).origin).toBe(this.origin)
    expect(await this.readRaw()).toBeNull()
    const bundleUrl = await this.page.evaluate(() => [...document.scripts].map(script => script.src).find(src => src.includes('/assets/main-')))
    expect(bundleUrl).toBeTruthy()
    const bundlePath = new URL(bundleUrl!).pathname
    expect(new URL(bundleUrl!).origin).toBe(this.origin)
    expect(bundlePath).toMatch(/^\/assets\/main-[A-Za-z0-9_-]+\.js$/)
    const response = await this.page.request.get(bundleUrl!, { maxRedirects: 0 })
    expect(response.status()).toBe(200)
    const served = await response.body()
    const compiled = await readFile(resolve(projectRoot, '.browser-test-dist', bundlePath.slice(1)))
    expect(hash(served)).toBe(hash(compiled))
    this.details.build = { origin: this.origin, bundle: bundlePath, bytes: served.length, servedSha256: hash(served), localCompiledSha256: hash(compiled), identityRequest: 'Validated loopback static bundle GET with redirects disabled' }

    this.mark('guard-probe')
    const probe = await this.page.evaluate(async id => {
      const body = await (await fetch(`/api/flows/${id}`)).json()
      let blocked = false
      try { await fetch('/api/guard-probe') } catch { blocked = true }
      return { marker: body.fixtureMarker, blocked }
    }, MOCK_CHART.id)
    expect(probe).toEqual({ marker: MOCK_CHART.fixtureMarker, blocked: true })
    this.details.guardProbe = probe
    this.mark('shared-load-and-observed-poll')
    const poll = this.page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === `/api/flows/${MOCK_CHART.id}` && url.searchParams.has('since')
    })
    await this.page.goto(`/f/${MOCK_CHART.id}`, { waitUntil: 'load' })
    await this.page.getByRole('button', { name: 'Make editable copy', exact: true }).waitFor()
    await expect(this.nodes()).toHaveCount(6)
    await poll
    const observedPoll = this.calls.find(call => call.phase === this.phase && call.query === `?since=${MOCK_CHART.version}`)
    expect(observedPoll, 'A real scheduled shared poll must run before detaching').toBeTruthy()
    this.details.observedScheduledPoll = observedPoll
    expect(await this.readRaw()).toBeNull()
    this.mark('make-local-copy')
    await this.page.getByRole('button', { name: 'Make editable copy', exact: true }).click()
    await this.page.waitForURL(this.origin + '/')
    await expect(this.nodes()).toHaveCount(6)
    this.requestsAtDetach = this.calls.length
  }

  readRaw() { return this.page.evaluate(key => localStorage.getItem(key), this.draftKey) }
  assertDraft(raw: string, label: string): DraftSnapshot {
    const draft = JSON.parse(raw) as SavedDraft
    expect(Object.keys(draft).sort()).toEqual(['diagramMode', 'flow', 'savedAt', 'version'])
    expect(draft.version).toBe(1)
    expect(draft.diagramMode).toBe('architecture')
    expect(Number.isSafeInteger(draft.savedAt) && draft.savedAt > 0).toBe(true)
    expect(draft.flow).toEqual(expectedFlow(label))
    return { raw, draft, sha256: hash(raw) }
  }
  async waitForSaved(label: string) {
    await this.page.waitForFunction(({ key, label }) => {
      const raw = localStorage.getItem(key)
      return raw && JSON.parse(raw).flow.nodes.some((node: { id: string; label: string }) => node.id === 'api' && node.label === label)
    }, { key: this.draftKey, label })
    const raw = await this.readRaw()
    expect(raw).not.toBeNull()
    return this.assertDraft(raw!, label)
  }
  async editLabel(label: string) {
    await this.apiLabel().dblclick()
    const input = this.page.locator('.react-flow-wrapper [data-id="api"] input.node-input')
    await input.fill(label)
    await input.press('Enter')
    await expect(this.apiLabel()).toHaveText(label)
  }
  async observeNoPolling(name: string) {
    this.mark(name)
    const started = Date.now()
    // This real wait verifies timer inactivity across two actual fast-poll windows.
    await this.page.waitForTimeout(this.pollMs * 2 + 500)
    const observationMs = Date.now() - started
    expect(observationMs).toBeGreaterThanOrEqual(this.pollMs * 2)
    expect(this.calls).toHaveLength(this.requestsAtDetach)
    this.details[name] = { observationMs, requests: 0 }
  }
  async reloadForRecovery(expectedRaw: string) {
    this.mark('native-full-page-reload')
    const oldTimeOrigin = await this.page.evaluate(() => performance.timeOrigin)
    await this.page.reload({ waitUntil: 'load' })
    const newTimeOrigin = await this.page.evaluate(() => performance.timeOrigin)
    expect(newTimeOrigin).toBeGreaterThan(oldTimeOrigin)
    expect(this.page.url()).toBe(this.origin + '/')
    await this.expectRecovery()
    expect(await this.readRaw()).toBe(expectedRaw)
    return { oldTimeOrigin, newTimeOrigin }
  }
  async expectRecovery() {
    const recovery = this.page.getByRole('complementary', { name: 'Saved diagram recovery', exact: true })
    await expect(recovery).toBeVisible()
    await expect(recovery).toContainText('6 saved nodes')
    await expect(this.nodes()).toHaveCount(0)
  }
  async restore(label: string) {
    this.mark('explicit-preview-and-restore')
    await this.page.getByRole('button', { name: 'Preview saved draft', exact: true }).click()
    const restore = this.page.getByRole('button', { name: 'Restore saved draft', exact: true })
    await expect(restore).toBeVisible()
    await expect(this.nodes()).toHaveCount(0)
    await restore.click()
    await expect(this.apiLabel()).toHaveText(label)
    await expect(this.nodes()).toHaveCount(6)
    await expect(this.page.getByRole('button', { name: 'Architecture Mode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(this.page.getByRole('complementary', { name: 'Saved diagram recovery', exact: true })).toHaveCount(0)
    await this.page.waitForFunction(() => {
      const image = document.querySelector('.react-flow-wrapper [data-id="api"] img') as HTMLImageElement | null
      return image !== null && image.naturalWidth > 0
    })
  }

  async assertNativeExport(name: string, label: string) {
    await this.page.getByRole('button', { name: 'Export', exact: true }).click()
    const downloaded = this.page.waitForEvent('download')
    await this.page.getByRole('button', { name: 'Export as JSON', exact: true }).click()
    const download = await downloaded
    const path = this.testInfo.outputPath(`${name}.json`)
    await download.saveAs(path)
    const bytes = await readFile(path)
    const document = JSON.parse(bytes.toString()) as PortableDiagram
    expect(document.version).toBe(2)
    expect(document.mode).toBe('architecture')
    expect(document.nodes).toHaveLength(6)
    expect(document.edges).toHaveLength(3)
    for (const expected of expectedFlow(label).nodes) {
      const actual = document.nodes.find(node => node.id === expected.id)
      expect(actual, `Exported node ${expected.id}`).toBeTruthy()
      expect(actual!.type).toBe(expected.type)
      expect(actual!.data.label).toBe(expected.label)
      expect(actual!.position).toEqual(expected.position)
      expect(actual!.style.width).toBe(expected.width)
      expect(actual!.style.height).toBe(expected.height)
      expect(actual!.parentNode).toBe(expected.parentNode)
      expect(actual!.data.icon).toBe(expected.icon)
      expect(actual!.data.containerKind).toBe(expected.containerKind)
      if (expected.parentNode) expect(actual!.extent).toBe('parent')
    }
    for (const expected of MOCK_CHART.edges) {
      const actual = document.edges.find(edge => edge.id === expected.id)
      expect(actual, `Exported edge ${expected.id}`).toBeTruthy()
      for (const key of ['source', 'target', 'label', 'sourceHandle', 'targetHandle'] as const) expect(actual![key]).toBe(expected[key])
      expect(actual!.data.protocol).toBe(expected.protocol)
      expect(actual!.data.commStyle).toBe(expected.commStyle)
      expect(actual!.type).toBe(expected.style === 'step' ? 'smoothstep' : 'default')
      expect(actual!.animated).toBe(expected.commStyle ? expected.commStyle === 'async' : expected.style === 'animated')
    }
    this.details[name] = { file: basename(path), bytes: bytes.length, sha256: hash(bytes), suggestedName: download.suggestedFilename(), fullLiveGraphMetadataMatched: true }
    await this.testInfo.attach(name, { path, contentType: 'application/json' })
  }

  async installNativeObservers() {
    // Chromium can drop old-document Runtime/console deliveries during unload.
    // Browser tracing retains timeStamp records; only our scalar payloads survive here.
    const browser = this.page.context().browser()
    expect(browser, 'The native lifecycle observer requires the configured Chromium browser').not.toBeNull()
    const session = await browser!.newBrowserCDPSession()
    this.lifecycleSession = session
    session.on('Tracing.dataCollected', ({ value }) => {
      for (const record of value) {
        if (record.name !== 'TimeStamp') continue
        // CDP's generated args type differs from its nested runtime timestamp shape.
        const args: unknown = record.args
        if (typeof args !== 'object' || args === null || Array.isArray(args) || !('data' in args)) continue
        const data: unknown = args.data
        if (typeof data !== 'object' || data === null || Array.isArray(data) || !('message' in data)) continue
        const text: unknown = data.message
        if (typeof text !== 'string' || !text.startsWith(lifecyclePrefix)) continue
        try { this.lifecycle.push(JSON.parse(text.slice(lifecyclePrefix.length)) as LifecycleObservation) }
        catch { this.details.lifecycleObserverError = 'Could not parse the synthetic lifecycle timestamp.' }
      }
    })
    await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
    this.lifecycleTracing = true
    this.details.lifecycleObserver = 'Browser-level CDP Tracing TimeStamp records from native after-hook listeners; prefix-only scalar payloads, no full trace retained.'
    await this.page.evaluate(({ key, prefix }) => {
      window.__copyProofCommit = null
      // Observers never dispatch, prevent, flush, alter timers, or write storage.
      document.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.closest('.react-flow-wrapper [data-id="api"]')) {
          window.__copyProofCommit = { key: event.key, isTrusted: event.isTrusted, value: event.target.value, eventEpochMs: performance.timeOrigin + event.timeStamp, receivedAtMs: Date.now(), timeOrigin: performance.timeOrigin }
        }
      }, { capture: true })
      const observe = (kind: string, event: Event) => {
        const raw = localStorage.getItem(key)
        const draft = raw ? JSON.parse(raw) as SavedDraft : null
        console.timeStamp(prefix + JSON.stringify({ kind, isTrusted: event.isTrusted, observedAtMs: Date.now(), timeOrigin: performance.timeOrigin, visibilityState: document.visibilityState, savedAt: draft?.savedAt, savedApiLabel: draft?.flow.nodes.find(node => node.id === 'api')?.label }))
      }
      window.addEventListener('pagehide', event => observe('pagehide', event))
      document.addEventListener('visibilitychange', event => observe('visibilitychange', event))
    }, { key: this.draftKey, prefix: lifecyclePrefix })
  }
  async completeNativeObservers() {
    const session = this.lifecycleSession
    if (!session) return
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      if (this.lifecycleTracing) {
        const complete = new Promise<void>(resolve => session.once('Tracing.tracingComplete', () => resolve()))
        await session.send('Tracing.end')
        await Promise.race([complete, new Promise<void>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Native lifecycle tracing did not finish within 5 seconds.')), 5000)
        })])
      }
    } finally {
      clearTimeout(deadline)
      this.lifecycleTracing = false
      this.lifecycleSession = undefined
      await session.detach()
    }
  }
  readPreReload(): Promise<PreReloadObservation> {
    return this.page.evaluate(key => ({ raw: localStorage.getItem(key), visibleLabel: document.querySelector('.react-flow-wrapper [data-id="api"] .node-label')?.textContent, inputCount: document.querySelectorAll('.react-flow-wrapper [data-id="api"] input.node-input').length, commit: window.__copyProofCommit ?? null, observedAtMs: Date.now(), timeOrigin: performance.timeOrigin }), this.draftKey)
  }
  async finish() {
    expect(JSON.stringify(MOCK_CHART)).toBe(chartRaw)
    expect(this.calls.filter(call => call.method !== 'GET')).toEqual([])
    expect(this.blockedNonStatic).toEqual([])
    expect(this.calls.filter(call => call.path !== `/api/flows/${MOCK_CHART.id}` && call.path !== '/api/guard-probe')).toEqual([])
    expect(this.calls).toHaveLength(this.requestsAtDetach)
    expect(await sourceHashes()).toEqual(this.initialSourceHashes)
    await this.page.getByRole('button', { name: 'fit view', exact: true }).click()
    await this.page.waitForTimeout(400)
    const path = this.testInfo.outputPath('restored.png')
    await this.page.screenshot({ path })
    await this.testInfo.attach('Restored copied graph', { path, contentType: 'image/png' })
    this.passed = true
  }
  async attachReceipt() {
    const requestCounts: Record<string, number> = {}
    for (const call of this.calls) { const key = `${call.method} ${call.path}`; requestCounts[key] = (requestCounts[key] ?? 0) + 1 }
    const receipt = { result: this.passed ? 'PASS' : 'FAIL', failure: this.failure, checkedAt: new Date().toISOString(), test: this.testInfo.title, transport: 'Only same-origin GET/HEAD static/document requests continue. Synthetic GET chart is in-memory only; other APIs and all off-origin requests abort without fallback. No real shared/provider/payment writes.', contextLifecycle: 'Fresh context owned and automatically disposed by Playwright after each test.', pollMs: this.pollMs, debounceMs: this.debounceMs, draftMetadataContract: 'version/savedAt/diagramMode plus allowlisted graph; server title/id/version/timestamps and capabilities are intentionally excluded.', fixture: { nodes: 6, nestingLevels: 2, edges: 3, sha256: hash(chartRaw) }, details: this.details, requestCounts, requests: this.calls, blockedExternalRequests: this.blockedExternal, blockedNonStaticRequests: this.blockedNonStatic, documentRequests: this.documents, naturallyObservedLifecycleEvents: this.lifecycle }
    const path = this.testInfo.outputPath('receipt.json')
    await writeFile(path, JSON.stringify(receipt, null, 2) + '\n')
    await this.testInfo.attach('Native reload proof receipt', { path, contentType: 'application/json' })
  }
}

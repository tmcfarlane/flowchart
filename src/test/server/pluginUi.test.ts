// @vitest-environment node
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { pluginUiHtml } from '../../shared/server/pluginUi'

const ORIGIN = 'https://flowchart.test'
const ID = 'Ab3dE5fG7h'
const TOKEN = 'test-private-capability'
const unsafeLabel = '<script>alert("diagram")</script><img src=x onerror=alert(1)>'
const chart = {
  title: 'A local diagram preview',
  nodes: [
    { id: 'group', type: 'container', label: 'Private application region', position: { x: 100, y: 50 }, width: 720, height: 420 },
    { id: 'api', type: 'service', label: 'API worker', position: { x: 28, y: 56 }, parentNode: 'group', width: 180, height: 90 },
    { id: 'question', type: 'decision', label: unsafeLabel, position: { x: 300, y: 180 }, width: 160, height: 160 },
    { id: 'db', type: 'database', label: 'Persistent records', position: { x: 550, y: 180 }, width: 160, height: 110 },
    { id: 'art', type: 'image', label: 'Moonlight receiver', position: { x: 550, y: 350 }, imageUrl: 'https://attacker.test/tracker.svg', icon: 'https://attacker.test/icon.svg' },
  ],
  edges: [{ source: 'api', target: 'question' }, { source: 'question', target: 'db', label: unsafeLabel }, { source: 'db', target: 'art', commStyle: 'async' }],
}
const result = {
  content: [{ type: 'text', text: 'Created chart' }], structuredContent: { id: ID, title: '<img src=x onerror=alert(1)>', url: ORIGIN + '/f/' + ID },
  _meta: { 'flowchart/private': { id: ID, editToken: TOKEN, editUrl: ORIGIN + '/f/' + ID + '#edit=' + TOKEN }, 'flowchart/chart': chart },
}

type MountOptions = { initializeFailure?: boolean; openLinkError?: boolean; fetch?: () => Promise<{ ok: boolean; status: number }> }
async function mount(toolResult: unknown = result, options: MountOptions = {}) {
  const outbound: any[] = []
  const logs: unknown[] = []
  const fetchMock = vi.fn(options.fetch ?? (async () => ({ ok: true, status: 200 })))
  const virtualConsole = new VirtualConsole()
  for (const method of ['debug', 'log', 'warn', 'error']) virtualConsole.on(method, (...args) => logs.push(args))
  const dom = new JSDOM(pluginUiHtml(ORIGIN), {
    url: 'https://sandbox.host.test', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      window.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as any
      window.fetch = fetchMock as any
      window.postMessage = (message: any) => {
        outbound.push(message)
        const respond = (data: unknown) => window.dispatchEvent(new window.MessageEvent('message', { source: window, data }))
        if (message.method === 'ui/initialize') queueMicrotask(() => respond(options.initializeFailure ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported host' } } : { jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: message.params.protocolVersion,
          hostInfo: { name: 'Test MCP Apps host', version: '1' }, hostCapabilities: { openLinks: {} }, hostContext: { displayMode: 'inline' },
        } }))
        else if (message.method === 'ui/notifications/initialized') queueMicrotask(() => respond({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: toolResult }))
        else if (message.id !== undefined) queueMicrotask(() => respond({ jsonrpc: '2.0', id: message.id, result: message.method === 'ui/open-link' && options.openLinkError ? { isError: true } : {} }))
      }
    },
  })
  if (options.initializeFailure) await vi.waitFor(() => expect(dom.window.document.querySelector('#status')?.textContent).toContain('does not support private chart controls'))
  else await vi.waitFor(() => expect(outbound.some(m => m.method === 'ui/notifications/initialized')).toBe(true))
  await new Promise(resolve => setTimeout(resolve, 10))
  const notify = (params: unknown) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: dom.window, data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params } }))
  return { dom, outbound, logs, fetchMock, notify, button: (selector: string) => dom.window.document.querySelector<HTMLButtonElement>(selector)! }
}

const forbiddenMessages = ['tools/call', 'ui/message', 'ui/update-model-context']
describe('private MCP Apps diagram card with the actual bundled bridge', () => {
  it('preserves intentional blank and whitespace node and edge captions instead of inventing labels', async () => {
    const preview = { title: 'Intentionally blank', nodes: [
      { id: 'blank', type: 'step', label: '', position: { x: 0, y: 0 } },
      { id: 'space', type: 'note', label: '   ', position: { x: 240, y: 0 } },
      { id: 'container', type: 'container', label: '', position: { x: 0, y: 200 }, width: 300, height: 200 },
      { id: 'named', type: 'service', label: 'Named service', position: { x: 30, y: 40 }, parentNode: 'container' },
    ], edges: [{ source: 'blank', target: 'space', label: '   ' }] }
    const ui = await mount({ ...result, _meta: { ...result._meta, 'flowchart/chart': preview } })
    try {
      const svg = ui.dom.window.document.querySelector('#diagram')!
      expect(svg.querySelector('.node-step .node-label')?.textContent).toBe('')
      expect(svg.querySelector('.node-step title')?.textContent).toBe('')
      expect(svg.querySelector('.node-note .node-label')?.textContent).toBe('   ')
      expect(svg.querySelector('.node-note title')?.textContent).toBe('   ')
      expect(svg.querySelector('.node-container .container-label')?.textContent).toBe('')
      expect(svg.querySelector('.node-service .node-label')?.textContent).toBe('Named service')
      expect(svg.querySelector('.edge-label')?.textContent).toBe('   ')
      expect(svg.textContent).not.toContain('Untitled')
      expect(ui.fetchMock).not.toHaveBeenCalled()
    } finally { ui.dom.window.close() }
  })

  it('initializes, previews safely, opens only through the host, and never logs secrets', async () => {
    const ui = await mount()
    try {
      expect(ui.button('#edit').disabled).toBe(false)
      expect(ui.dom.window.document.querySelector('#title')?.textContent).toBe(result.structuredContent.title)
      expect(ui.dom.window.document.querySelector('#title img')).toBeNull()
      const svg = ui.dom.window.document.querySelector('#diagram')!
      expect(svg.querySelectorAll('[data-preview-node]')).toHaveLength(5)
      expect(svg.querySelectorAll('[data-preview-edge]')).toHaveLength(3)
      expect(svg.querySelector('.node-decision polygon')).not.toBeNull()
      expect(svg.querySelector('.node-database path')).not.toBeNull()
      expect(svg.querySelector('.node-container rect')).not.toBeNull()
      expect(svg.querySelector('.node-service rect')?.getAttribute('x')).toBe('128')
      expect(svg.querySelector('.node-service rect')?.getAttribute('y')).toBe('106')
      expect(svg.querySelector('.node-decision title')?.textContent).toBe(unsafeLabel)
      expect(svg.querySelector('script,img,image,foreignObject,a')).toBeNull()
      expect(svg.outerHTML).not.toContain('attacker.test')
      expect(svg.outerHTML).not.toContain(TOKEN)
      expect(ui.button('#zoom-in').disabled).toBe(false)
      ui.button('#zoom-in').click()
      expect((svg as SVGSVGElement).style.width).toBe('135%')
      expect(ui.button('#fit').disabled).toBe(false)
      ui.button('#fit').click()
      expect((svg as SVGSVGElement).style.width).toBe('100%')
      ui.button('#edit').click()
      await vi.waitFor(() => expect(ui.outbound.find(m => m.method === 'ui/open-link')?.params.url).toBe(result._meta['flowchart/private'].editUrl))
      expect(ui.outbound.some(m => forbiddenMessages.includes(m.method))).toBe(false)
      expect(JSON.stringify(ui.logs)).not.toContain(TOKEN)
      expect(ui.fetchMock).not.toHaveBeenCalled()
    } finally { ui.dom.window.close() }
  })

  it('bounds large previews and ignores malformed rendering data without loading images', async () => {
    const many = {
      title: 'A very large diagram',
      nodes: Array.from({ length: 500 }, (_, index) => ({ id: `n${index}`, type: 'step', label: `Node ${index}`, position: { x: index * 200, y: 0 } })),
      edges: Array.from({ length: 1000 }, (_, index) => ({ source: `n${index % 59}`, target: `n${index % 59 + 1}` })),
    }
    const ui = await mount({ ...result, _meta: { ...result._meta, 'flowchart/chart': many } })
    try {
      const svg = ui.dom.window.document.querySelector('#diagram')!
      expect(svg.querySelectorAll('[data-preview-node]')).toHaveLength(60)
      expect(svg.querySelectorAll('[data-preview-edge]')).toHaveLength(120)
      expect(ui.dom.window.document.querySelector('#preview-note')?.textContent).toContain('60 of 500 nodes')
      expect(ui.dom.window.document.querySelector('#preview-note')?.textContent).toContain('120 of 1000 connections')
      ui.notify({ ...result, _meta: { ...result._meta, 'flowchart/chart': { nodes: [{ id: 'bad', type: 'script', label: '<b>Hi</b>' }, { id: 'safe', type: 'step', label: 'Safe', position: { x: NaN, y: Infinity }, width: Infinity }] } } })
      await vi.waitFor(() => expect(svg.querySelectorAll('[data-preview-node]')).toHaveLength(1))
      expect(svg.getAttribute('viewBox')).not.toMatch(/NaN|Infinity/)
      expect(ui.fetchMock).not.toHaveBeenCalled()
    } finally { ui.dom.window.close() }
  })

  it('keeps the visible center when zooming a tall preview, bounds zoom and resets fit', async () => {
    const ui = await mount()
    try {
      const frame = ui.dom.window.document.querySelector<HTMLDivElement>('.preview-frame')!
      const svg = ui.dom.window.document.querySelector<SVGSVGElement>('#diagram')!
      Object.defineProperties(frame, { clientWidth: { value: 320 }, clientHeight: { value: 220 } })
      ui.button('#zoom-in').click()
      expect(frame.scrollLeft).toBeCloseTo(56)
      expect(frame.scrollTop).toBeCloseTo(38.5)
      frame.scrollLeft = 100
      frame.scrollTop = 200
      ui.button('#zoom-in').click()
      expect(frame.scrollLeft).toBeCloseTo(191)
      expect(frame.scrollTop).toBeCloseTo(308.5)
      for (let index = 0; index < 10; index++) ui.button('#zoom-in').click()
      expect(svg.style.width).toBe('600%')
      expect(ui.button('#zoom-in').disabled).toBe(true)
      ui.button('#zoom-out').click()
      expect(ui.button('#zoom-in').disabled).toBe(false)
      ui.button('#fit').click()
      expect(svg.style.width).toBe('100%')
      expect(frame.scrollLeft).toBe(0)
      expect(frame.scrollTop).toBe(0)
    } finally { ui.dom.window.close() }
  })

  it('requires explicit confirmation and sends deletion directly to REST, then clears the preview', async () => {
    const ui = await mount()
    try {
      ui.button('#delete').click()
      expect(ui.fetchMock).not.toHaveBeenCalled()
      expect(ui.dom.window.document.querySelector<HTMLDivElement>('#confirmation')?.hidden).toBe(false)
      ui.button('#cancel-delete').click()
      expect(ui.fetchMock).not.toHaveBeenCalled()
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Chart deleted'))
      expect(ui.button('#edit').disabled).toBe(true)
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(0)
      expect(ui.fetchMock).toHaveBeenCalledWith(ORIGIN + '/api/flows/' + ID, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN }, credentials: 'omit',
      })
      expect(ui.outbound.some(m => forbiddenMessages.includes(m.method))).toBe(false)
      expect(JSON.stringify(ui.outbound)).not.toContain(TOKEN)
      expect(JSON.stringify(ui.logs)).not.toContain(TOKEN)
      // Hosts can replay the original result notification after a rerender.
      ui.notify(result)
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Chart deleted'))
      expect(ui.button('#edit').disabled).toBe(true)
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(0)
    } finally { ui.dom.window.close() }
  })

  it('restores controls after deletion failure and reports host link failures', async () => {
    const ui = await mount(result, { openLinkError: true, fetch: async () => ({ ok: false, status: 503 }) })
    try {
      ui.button('#edit').click()
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('host could not open'))
      expect(ui.button('#edit').disabled).toBe(false)
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Could not delete'))
      expect(ui.button('#edit').disabled).toBe(false)
      expect(ui.button('#delete').disabled).toBe(false)
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(5)
    } finally { ui.dom.window.close() }
  })

  it('does not erase a newly delivered chart when an earlier deletion finishes', async () => {
    let resolveDelete!: (value: { ok: boolean; status: number }) => void
    const pending = new Promise<{ ok: boolean; status: number }>(resolve => { resolveDelete = resolve })
    const ui = await mount(result, { fetch: () => pending })
    try {
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      const nextId = 'Zz9Zz9Zz9Z'
      ui.notify({ ...result, structuredContent: { ...result.structuredContent, id: nextId, title: 'The next chart' }, _meta: { ...result._meta, 'flowchart/private': { id: nextId, editToken: TOKEN, editUrl: `${ORIGIN}/f/${nextId}#edit=${TOKEN}` } } })
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#title')?.textContent).toBe('The next chart'))
      resolveDelete({ ok: true, status: 200 })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(ui.button('#edit').disabled).toBe(false)
      expect(ui.dom.window.document.querySelector('#status')?.textContent).not.toContain('Chart deleted')
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(5)
    } finally { ui.dom.window.close() }
  })

  it('keeps same-chart replays disabled until deletion completes and remembers the deleted chart', async () => {
    let resolveDelete!: (value: { ok: boolean; status: number }) => void
    const pending = new Promise<{ ok: boolean; status: number }>(resolve => { resolveDelete = resolve })
    const ui = await mount(result, { fetch: () => pending })
    try {
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      ui.notify(result)
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toBe('Deleting chart…'))
      for (const selector of ['#edit', '#delete', '#confirm-delete', '#cancel-delete']) expect(ui.button(selector).disabled).toBe(true)
      ui.button('#confirm-delete').click()
      expect(ui.fetchMock).toHaveBeenCalledTimes(1)
      resolveDelete({ ok: true, status: 200 })
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Chart deleted'))
      expect(ui.button('#edit').disabled).toBe(true)
      expect(ui.button('#delete').disabled).toBe(true)
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(0)
      ui.notify(result)
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#preview-note')?.textContent).toBe('This chart has been deleted.'))
      expect(ui.button('#edit').disabled).toBe(true)
      expect(JSON.stringify(ui.outbound)).not.toContain(TOKEN)
      expect(JSON.stringify(ui.logs)).not.toContain(TOKEN)
    } finally { ui.dom.window.close() }
  })

  it('restores a replayed same-chart result after deletion failure and permits a deliberate retry', async () => {
    let resolveDelete!: (value: { ok: boolean; status: number }) => void
    const pending = new Promise<{ ok: boolean; status: number }>(resolve => { resolveDelete = resolve })
    const ui = await mount(result, { fetch: () => pending })
    try {
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      ui.notify(result)
      await vi.waitFor(() => expect(ui.button('#edit').disabled).toBe(true))
      resolveDelete({ ok: false, status: 503 })
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Could not delete'))
      for (const selector of ['#edit', '#delete', '#confirm-delete', '#cancel-delete']) expect(ui.button(selector).disabled).toBe(false)
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(5)
      ui.fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Chart deleted'))
      expect(ui.fetchMock).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(ui.outbound)).not.toContain(TOKEN)
      expect(JSON.stringify(ui.logs)).not.toContain(TOKEN)
    } finally { ui.dom.window.close() }
  })

  it('ignores an earlier chart deletion failure while a different chart deletion is pending', async () => {
    const releases: Array<(value: { ok: boolean; status: number }) => void> = []
    const ui = await mount(result, { fetch: () => new Promise(resolve => { releases.push(resolve) }) })
    try {
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      const nextId = 'Zz9Zz9Zz9Z'
      ui.notify({ ...result, structuredContent: { ...result.structuredContent, id: nextId, title: 'The next chart' }, _meta: { ...result._meta, 'flowchart/private': { id: nextId, editToken: TOKEN, editUrl: `${ORIGIN}/f/${nextId}#edit=${TOKEN}` } } })
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#title')?.textContent).toBe('The next chart'))
      ui.button('#delete').click()
      ui.button('#confirm-delete').click()
      expect(releases).toHaveLength(2)
      releases[0]({ ok: false, status: 503 })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(ui.dom.window.document.querySelector('#status')?.textContent).toBe('Deleting chart…')
      for (const selector of ['#edit', '#delete', '#confirm-delete', '#cancel-delete']) expect(ui.button(selector).disabled).toBe(true)
      releases[1]({ ok: true, status: 200 })
      await vi.waitFor(() => expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Chart deleted'))
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(0)
      expect(JSON.stringify(ui.outbound)).not.toContain(TOKEN)
      expect(JSON.stringify(ui.logs)).not.toContain(TOKEN)
    } finally { ui.dom.window.close() }
  })

  it('offers a view-link fallback when the host rejects initialization', async () => {
    const ui = await mount(result, { initializeFailure: true })
    try {
      expect(ui.button('#edit').disabled).toBe(true)
      expect(ui.button('#delete').disabled).toBe(true)
      expect(ui.dom.window.document.querySelector('#status')?.textContent).toContain('Use the view link')
      expect(ui.fetchMock).not.toHaveBeenCalled()
      expect(JSON.stringify(ui.outbound)).not.toContain(TOKEN)
    } finally { ui.dom.window.close() }
  })

  it.each([
    { content: [], structuredContent: result.structuredContent, _meta: { 'flowchart/chart': chart } },
    { ...result, _meta: { ...result._meta, 'flowchart/private': { ...result._meta['flowchart/private'], editUrl: 'https://attacker.test/#edit=' + TOKEN } } },
    { ...result, _meta: { ...result._meta, 'flowchart/private': { ...result._meta['flowchart/private'], editToken: 'header\r\ninjection' } } },
  ])('fails closed for missing capability metadata, wrong destinations or unsafe tokens', async (toolResult) => {
    const ui = await mount(toolResult)
    try {
      expect(ui.button('#edit').disabled).toBe(true)
      expect(ui.button('#delete').disabled).toBe(true)
      expect(ui.dom.window.document.querySelectorAll('#diagram [data-preview-node]')).toHaveLength(5)
      expect(ui.fetchMock).not.toHaveBeenCalled()
    } finally { ui.dom.window.close() }
  })

  it('keeps controls usable for an older result without preview data', async () => {
    const ui = await mount({ ...result, _meta: { 'flowchart/private': result._meta['flowchart/private'] } })
    try {
      expect(ui.button('#edit').disabled).toBe(false)
      expect(ui.dom.window.document.querySelector('#preview-note')?.textContent).toContain('preview is unavailable')
      expect(ui.button('#zoom-in').disabled).toBe(true)
    } finally { ui.dom.window.close() }
  })
})

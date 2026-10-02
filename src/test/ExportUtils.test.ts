import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportToPng, exportToSvg, exportToGif } from '../utils/exportUtils'

const capture = vi.hoisted(() => ({ png: vi.fn(), svg: vi.fn(), canvas: vi.fn(), fonts: vi.fn(), gifOptions: [] as unknown[], gifFrames: [] as unknown[], gifError: false }))
vi.mock('html-to-image', () => ({ toPng: capture.png, toSvg: capture.svg, toCanvas: capture.canvas, getFontEmbedCSS: capture.fonts }))
vi.mock('gif.js', () => ({ default: class {
  callbacks = new Map<string, (value: unknown) => void>()
  constructor(options: unknown) { capture.gifOptions.push(options) }
  addFrame(canvas: unknown, options: unknown) { capture.gifFrames.push({ canvas, options }) }
  on(event: string, callback: (value: unknown) => void) { this.callbacks.set(event, callback) }
  abort() {}
  render() { this.callbacks.get(capture.gifError ? 'error' : 'finished')?.(capture.gifError ? new Error('worker failed') : new Blob(['GIF89a'])) }
} }))

describe('Clean image export snapshots', () => {
  let wrapper: HTMLDivElement
  let app: HTMLDivElement
  let original: string
  const assetFetch = vi.fn<typeof fetch>()
  const revokeTimers: ReturnType<typeof setTimeout>[] = []
  beforeEach(() => {
    vi.clearAllMocks()
    capture.gifOptions.length = 0; capture.gifFrames.length = 0; capture.gifError = false
    capture.fonts.mockResolvedValue('@font-face{font-family:FixtureFont;src:url(data:font/woff2;base64,AAAA)}')
    capture.png.mockResolvedValue('data:image/png;base64,AAAA')
    capture.svg.mockResolvedValue('data:image/svg+xml;base64,AAAA')
    capture.canvas.mockImplementation(async () => Object.assign(document.createElement('canvas'), { width: 800, height: 600 }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    assetFetch.mockReset().mockResolvedValue(new Response(null, { status: 200, headers: { 'Content-Type': 'image/webp' } }))
    vi.stubGlobal('fetch', assetFetch)
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:export'); static revokeObjectURL = vi.fn() })
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      const timer = realSetTimeout(callback, delay, ...args)
      if (delay === 1000) revokeTimers.push(timer)
      return timer
    }) as typeof setTimeout)
    app = document.createElement('div')
    app.className = 'app dark-mode'; app.style.setProperty('--workspace-text', '#eef1fb'); app.style.fontFamily = 'FixtureFont'
    app.innerHTML = `<div class="react-flow-wrapper"><div class="react-flow react-flow-dark">
      <svg class="react-flow__background"><pattern><circle /></pattern></svg>
      <div class="react-flow__controls">Controls</div><svg class="react-flow__minimap"></svg>
      <div class="react-flow__node selected dragging changed"><div class="arch-node service-node selected">
        <div class="react-flow__resize-control node-resize-line"></div><div class="react-flow__resize-control node-resize-handle"></div>
        <div class="react-flow__handle">Handle</div><span class="node-label">Retained label</span>
        <img src="/assets/diagram-icons/icon-cloud.svg" alt="Cloud" />
        <img src="/api/images/123e4567-e89b-42d3-a456-426614174000?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" alt="Generated image" />
      </div></div>
      <svg class="react-flow__edges"><g class="react-flow__edge animated selected"><path class="react-flow__edge-path" style="animation-play-state:running;stroke-dashoffset:17" /><path class="react-flow__edge-interaction" /></g></svg>
      <div class="react-flow__edgelabel-renderer">Retained protocol</div><div class="react-flow__nodesselection"></div>
    </div></div>`
    document.body.appendChild(app)
    wrapper = app.querySelector('.react-flow-wrapper')!
    Object.defineProperties(wrapper, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } })
    original = wrapper.outerHTML
  })
  afterEach(() => { revokeTimers.splice(0).forEach(clearTimeout); app.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const noSnapshots = () => expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()

  it.each([['PNG', exportToPng, capture.png], ['SVG', exportToSvg, capture.svg]] as const)('exports %s from a clean themed snapshot without changing live selection or content', async (_format, exporter, mock) => {
    mock.mockImplementation(async (snapshot: HTMLDivElement, options: { filter: (node: Node) => boolean; fontEmbedCSS: string; includeQueryParams: boolean }) => {
      expect(snapshot).not.toBe(wrapper)
      expect(snapshot.isConnected).toBe(true)
      expect(snapshot.closest('.app')).toHaveClass('dark-mode')
      expect((snapshot.closest('.app') as HTMLElement).style.getPropertyValue('--workspace-text')).toBe('#eef1fb')
      expect(snapshot.querySelector('.react-flow__background,.react-flow__handle,.react-flow__resize-control,.react-flow__edge-interaction,.selected,.dragging,.changed')).toBeNull()
      expect(snapshot.textContent).toContain('Retained label')
      expect(snapshot.textContent).toContain('Retained protocol')
      expect(Array.from(snapshot.querySelectorAll('img'), img => img.getAttribute('src'))).toEqual(Array.from(wrapper.querySelectorAll('img'), img => img.getAttribute('src')))
      expect(options.fontEmbedCSS).toContain('FixtureFont')
      expect(options.includeQueryParams).toBe(true)
      expect(options.filter(wrapper.querySelector('.react-flow__background')!)).toBe(false)
      expect(wrapper.outerHTML).toBe(original)
      return 'data:image/png;base64,AAAA'
    })
    await exporter(wrapper, true)
    expect(mock).toHaveBeenCalledTimes(1)
    expect(assetFetch).toHaveBeenCalledTimes(1)
    expect(assetFetch).toHaveBeenCalledWith(new URL(wrapper.querySelectorAll('img')[1].getAttribute('src')!, window.location.href).href, expect.objectContaining({ method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }))
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('cleans up after capture or font failures and rejects unusable dimensions before making a snapshot', async () => {
    capture.png.mockRejectedValue(new Error('capture failed'))
    await expect(exportToPng(wrapper, false)).rejects.toThrow('capture failed'); noSnapshots()
    capture.fonts.mockRejectedValue(new Error('font failed'))
    await expect(exportToSvg(wrapper, false)).rejects.toThrow('font failed'); noSnapshots()
    Object.defineProperty(wrapper, 'clientWidth', { value: 0 })
    await expect(exportToPng(wrapper, false)).rejects.toThrow('viewport'); noSnapshots()
    expect(wrapper.outerHTML).toBe(original)
  })
  it('bounds raster dimensions while retaining the original viewport aspect ratio', async () => {
    Object.defineProperties(wrapper, { clientWidth: { value: 8000 }, clientHeight: { value: 6000 } })
    await exportToPng(wrapper, false)
    const options = capture.png.mock.calls[0][1]
    expect(options.width).toBe(8000); expect(options.height).toBe(6000)
    expect(options.width * options.pixelRatio).toBeLessThanOrEqual(4096)
    expect(options.height * options.pixelRatio).toBeLessThanOrEqual(4096)
    noSnapshots()
  })
  it('animates only cloned edge paths and reuses fonts across GIF frames', async () => {
    const offsets: string[] = []
    capture.canvas.mockImplementation(async (snapshot: HTMLDivElement) => {
      const path = snapshot.querySelector<SVGPathElement>('.react-flow__edge-path')!
      offsets.push(path.style.strokeDashoffset)
      expect(path.style.animation).toBe('none')
      expect(wrapper.outerHTML).toBe(original)
      return Object.assign(document.createElement('canvas'), { width: 800, height: 600 })
    })
    await exportToGif(wrapper, true, 0.2)
    expect(offsets).toEqual(['0', '-2'])
    expect(capture.gifFrames).toHaveLength(2)
    expect(capture.fonts).toHaveBeenCalledTimes(1)
    expect(assetFetch).toHaveBeenCalledTimes(1)
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('removes the snapshot after a GIF capture or worker error while preserving live animation styles', async () => {
    capture.canvas.mockRejectedValueOnce(new Error('frame failed'))
    await expect(exportToGif(wrapper, true, 0.1)).rejects.toThrow('frame failed'); noSnapshots()
    capture.gifError = true
    await expect(exportToGif(wrapper, true, 0.1)).rejects.toThrow('worker failed'); noSnapshots()
    expect(wrapper.outerHTML).toBe(original)
  })
  it('deduplicates exact same-origin generated reads without checking imported, remote or malformed routes', async () => {
    const generated = wrapper.querySelectorAll('img')[1]
    wrapper.appendChild(generated.cloneNode(true))
    const sources = [
      'https://remote.example/api/images/123e4567-e89b-42d3-a456-426614174000?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'https://remote.example/upload.png', '/uploads/local.webp', 'data:image/png;base64,AAAA',
      '/api/images/123e4567-e89b-42d3-a456-426614174000?key=short',
      '/api/images/123e4567-e89b-42d3-a456-426614174000?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&other=value',
      '/api/images/123e4567-e89b-42d3-a456-426614174000?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#fragment',
    ]
    for (const source of sources) { const image = document.createElement('img'); image.src = source; wrapper.appendChild(image) }
    original = wrapper.outerHTML
    await exportToPng(wrapper, false)
    expect(assetFetch).toHaveBeenCalledTimes(1)
    expect(capture.png).toHaveBeenCalledTimes(1)
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('checks encoded capability characters and fragment spellings of the same generated asset once', async () => {
    const image = wrapper.querySelectorAll('img')[1]
    image.setAttribute('src', '/api/images/123e4567-e89b-42d3-a456-426614174000?key=%41AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#image')
    wrapper.appendChild(image.cloneNode(true))
    original = wrapper.outerHTML
    assetFetch.mockResolvedValue(new Response(null, { status: 404 }))
    await expect(exportToSvg(wrapper, false)).rejects.toThrow('deleted or is no longer available')
    expect(assetFetch).toHaveBeenCalledTimes(1)
    expect(assetFetch.mock.calls[0][0]).toBe(new URL('/api/images/123e4567-e89b-42d3-a456-426614174000?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', window.location.href).href)
    expect(capture.svg).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it.each([404, 410, 503, 302])('rejects an unavailable generated asset (%s) before renderer fonts or capture, preserving the frozen viewport and live canvas', async status => {
    assetFetch.mockResolvedValue(new Response(null, { status }))
    const measure = vi.fn(() => 800)
    Object.defineProperty(wrapper, 'clientWidth', { get: measure })
    await expect(exportToPng(wrapper, true)).rejects.toThrow(status === 404 || status === 410 ? 'deleted or is no longer available' : 'could not be verified')
    expect(measure).toHaveBeenCalledOnce()
    expect(capture.fonts).not.toHaveBeenCalled()
    expect(capture.png).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('rejects a network failure or a non-image response without exposing its capability URL', async () => {
    assetFetch.mockRejectedValueOnce(new Error('sensitive capability URL'))
    await expect(exportToSvg(wrapper, false)).rejects.toThrow('Check your connection')
    assetFetch.mockResolvedValue(new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } }))
    await expect(exportToSvg(wrapper, false)).rejects.toThrow('could not be verified')
    expect(capture.svg).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('bounds a stalled HEAD check and aborts it before measuring or mounting a snapshot', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    assetFetch.mockImplementation((_url, options) => { signal = options?.signal ?? undefined; return new Promise<Response>(() => {}) })
    const result = exportToPng(wrapper, true)
    const rejected = expect(result).rejects.toThrow('could not be checked in time')
    await vi.advanceTimersByTimeAsync(8000)
    await rejected
    expect(signal?.aborted).toBe(true)
    expect(capture.fonts).not.toHaveBeenCalled()
    expect(capture.png).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('captures only the checked detached content when the live image changes during verification', async () => {
    let finish!: (response: Response) => void
    assetFetch.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const originalSource = wrapper.querySelectorAll('img')[1].getAttribute('src')
    const result = exportToPng(wrapper, false)
    wrapper.querySelectorAll('img')[1].setAttribute('src', '/api/images/fb6899e4-c083-45f7-97a1-56fa1cfde602?key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    const changed = wrapper.outerHTML
    finish(new Response(null, { status: 200, headers: { 'Content-Type': 'image/webp' } }))
    await result
    expect((capture.png.mock.calls[0][0] as HTMLDivElement).querySelectorAll('img')[1].getAttribute('src')).toBe(originalSource)
    expect(wrapper.outerHTML).toBe(changed)
    expect(assetFetch).toHaveBeenCalledTimes(1)
    noSnapshots()
  })

  const wholeDiagramNodes = () => [
    { id: 'parent', type: 'container', data: { label: 'Nested cluster' }, position: { x: -300, y: -200 }, width: 900, height: 500 },
    { id: 'child', type: 'service', data: { label: 'Nested service' }, parentNode: 'parent', position: { x: 40, y: 80 }, width: 180, height: 90 },
    { id: 'far', type: 'database', data: { label: 'Outside current view' }, position: { x: 6000, y: 1800 }, width: 160, height: 110 },
  ]
  const addViewport = () => {
    const flow = wrapper.querySelector('.react-flow')!
    const viewport = document.createElement('div')
    viewport.className = 'react-flow__viewport'
    viewport.style.transform = 'translate(-222px, 77px) scale(1.25)'
    while (flow.firstChild) viewport.appendChild(flow.firstChild)
    flow.appendChild(viewport)
    original = wrapper.outerHTML
  }

  it.each([['PNG', exportToPng, capture.png], ['SVG', exportToSvg, capture.svg]] as const)('exports the entire diagram as %s while preserving the live pan and zoom', async (_format, exporter, mock) => {
    addViewport()
    mock.mockImplementation(async (snapshot: HTMLDivElement, options: { width: number; height: number; pixelRatio: number }) => {
      expect(options.width).toBe(4096)
      expect(options.height).toBeGreaterThan(1000)
      expect(options.width * options.pixelRatio).toBeLessThanOrEqual(4096)
      expect(snapshot.style.width).toBe('4096px')
      expect(snapshot.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform).toContain('scale(0.')
      expect(snapshot.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform).not.toBe('translate(-222px, 77px) scale(1.25)')
      expect(wrapper.outerHTML).toBe(original)
      return 'data:image/png;base64,AAAA'
    })
    await exporter(wrapper, true, { area: 'diagram', nodes: wholeDiagramNodes() })
    expect(mock).toHaveBeenCalledOnce()
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('retains the selected current view and can export an empty canvas explicitly', async () => {
    addViewport()
    await exportToPng(wrapper, false, { area: 'viewport', nodes: [] })
    const [snapshot, options] = capture.png.mock.calls[0]
    expect(options).toMatchObject({ width: 800, height: 600 })
    expect(snapshot.querySelector('.react-flow__viewport').style.transform).toBe('translate(-222px, 77px) scale(1.25)')
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('cleans up an empty or missing whole-diagram viewport with an actionable error', async () => {
    await expect(exportToPng(wrapper, false, { area: 'diagram', nodes: wholeDiagramNodes() })).rejects.toThrow('canvas is not ready')
    noSnapshots()
    addViewport()
    await expect(exportToSvg(wrapper, false, { area: 'diagram', nodes: [] })).rejects.toThrow('Current view')
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('freezes the diagram geometry with the checked snapshot while the live graph changes during verification', async () => {
    addViewport()
    const nodes = wholeDiagramNodes()
    let finish!: (response: Response) => void
    assetFetch.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const result = exportToSvg(wrapper, false, { area: 'diagram', nodes })
    nodes[2].position.x = 300000
    finish(new Response(null, { status: 200, headers: { 'Content-Type': 'image/webp' } }))
    await result
    const options = capture.svg.mock.calls[0][1]
    expect(options.height).toBeGreaterThan(1000)
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('uses bounded whole-diagram geometry for each GIF frame without changing live animation', async () => {
    addViewport()
    await exportToGif(wrapper, true, 0.2, undefined, { area: 'diagram', nodes: wholeDiagramNodes() })
    expect(capture.canvas).toHaveBeenCalledTimes(2)
    for (const [snapshot, options] of capture.canvas.mock.calls) {
      expect(options.width).toBe(1280)
      expect(options.width * options.pixelRatio).toBeLessThanOrEqual(1280)
      expect(snapshot.querySelector('.react-flow__viewport').style.transform).toContain('scale(0.')
    }
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it.each([['PNG', exportToPng, capture.png], ['SVG', exportToSvg, capture.svg]] as const)('preserves stylesheet-defined SVG connection and marker drawing styles in %s', async (_format, exporter, mock) => {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = '.react-flow__edge-path { stroke: rgb(104, 80, 187); fill: none; stroke-width: 2.5px; stroke-linecap: round; stroke-dasharray: 5px 5px; } .export-marker-path { fill: rgb(104, 80, 187); stroke: none; }'
    document.head.appendChild(stylesheet)
    const edges = wrapper.querySelector('.react-flow__edges')!
    edges.insertAdjacentHTML('afterbegin', '<defs><marker id="fixture-arrow"><path class="export-marker-path" d="M0,0 L10,5 L0,10 z" /></marker></defs>')
    original = wrapper.outerHTML
    mock.mockImplementation(async (snapshot: HTMLDivElement) => {
      const path = snapshot.querySelector<SVGPathElement>('.react-flow__edge-path')!
      expect(path.style.stroke).toBe('rgb(104, 80, 187)')
      expect(path.style.fill).toBe('none')
      expect(path.style.strokeWidth).toBe('2.5px')
      expect(path.style.strokeLinecap).toBe('round')
      expect(path.style.strokeDasharray).toBe('5px 5px')
      expect(snapshot.querySelector<SVGPathElement>('.export-marker-path')!.style.fill).toBe('rgb(104, 80, 187)')
      expect(wrapper.querySelector<SVGPathElement>('.react-flow__edge-path')!.style.stroke).toBe('')
      return 'data:image/png;base64,AAAA'
    })
    try { await exporter(wrapper, false) } finally { stylesheet.remove() }
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
  it('removes selection-only edge editing hints while retaining real captions and protocol chips', async () => {
    wrapper.querySelector('.react-flow__edgelabel-renderer')!.innerHTML = '<div class="editable-edge-label selected"><span class="editable-edge-text hint">Double-click to edit</span></div><div class="editable-edge-label selected"><span class="edge-protocol-chip">gRPC</span><span class="editable-edge-text hint">Double-click to edit</span></div><div class="editable-edge-label"><span class="editable-edge-text">Actual caption</span></div>'
    original = wrapper.outerHTML
    capture.svg.mockImplementation(async (snapshot: HTMLDivElement) => {
      expect(snapshot.textContent).not.toContain('Double-click to edit')
      expect(snapshot.querySelectorAll('.editable-edge-label')).toHaveLength(2)
      expect(snapshot.textContent).toContain('gRPC')
      expect(snapshot.textContent).toContain('Actual caption')
      return 'data:image/svg+xml;base64,AAAA'
    })
    await exportToSvg(wrapper, false)
    expect(wrapper.outerHTML).toBe(original)
    noSnapshots()
  })
})

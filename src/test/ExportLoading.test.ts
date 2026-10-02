import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Deferred image export dependencies', () => {
  let wrapper: HTMLDivElement
  const renderer = {
    toPng: vi.fn(async () => 'data:image/png;base64,AAAA'),
    toSvg: vi.fn(async () => 'data:image/svg+xml;base64,AAAA'),
    toCanvas: vi.fn(async () => Object.assign(document.createElement('canvas'), { width: 800, height: 600 })),
    getFontEmbedCSS: vi.fn(async () => ''),
  }
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    wrapper = document.createElement('div')
    wrapper.innerHTML = '<div class="react-flow__viewport" style="transform:translate(20px,30px) scale(0.5)"><div class="react-flow__node">Original caption</div></div>'
    Object.defineProperties(wrapper, { clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 } })
    document.body.appendChild(wrapper)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })
  afterEach(() => {
    wrapper.remove()
    vi.doUnmock('html-to-image')
    vi.doUnmock('gif.js')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.head.querySelectorAll('[data-export-loading-fixture]').forEach(element => element.remove())
    document.body.className = ''
  })

  it('keeps JSON serialization and parsing synchronous without loading either image dependency', async () => {
    const imageFactory = vi.fn(() => renderer)
    const gifFactory = vi.fn(() => ({ default: class {} }))
    vi.doMock('html-to-image', imageFactory)
    vi.doMock('gif.js', gifFactory)
    const { serializeFlow, parseFlowJson } = await import('../utils/exportUtils')
    const nodes = [{ id: 'start', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Start' } }]
    const serialized = serializeFlow(nodes, [], 'architecture')
    expect(typeof serialized).toBe('string')
    expect(parseFlowJson(serialized)).toMatchObject({ mode: 'architecture', nodes })
    expect(imageFactory).not.toHaveBeenCalled()
    expect(gifFactory).not.toHaveBeenCalled()
  })

  it('freezes the graph and DOM before a cold renderer load and never loads GIF for PNG', async () => {
    let resolveRenderer!: () => void
    let signalLoading!: () => void
    const loading = new Promise<void>(resolve => { signalLoading = resolve })
    const ready = new Promise<void>(resolve => { resolveRenderer = resolve })
    vi.doMock('html-to-image', async () => { signalLoading(); await ready; return renderer })
    const gifFactory = vi.fn(() => ({ default: class {} }))
    vi.doMock('gif.js', gifFactory)
    const { exportToPng } = await import('../utils/exportUtils')
    const nodes = [
      { id: 'near', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Near' }, width: 200, height: 100 },
      { id: 'far', type: 'step', position: { x: 6000, y: 1800 }, data: { label: 'Far' }, width: 200, height: 100 },
    ]
    const result = exportToPng(wrapper, false, { area: 'diagram', nodes })
    await loading
    wrapper.querySelector('.react-flow__node')!.textContent = 'Edited during download'
    nodes[1].position.x = 300000
    const live = wrapper.outerHTML
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
    resolveRenderer()
    await result
    const [snapshot, options] = renderer.toPng.mock.calls[0] as unknown as [HTMLDivElement, { width: number; height: number }]
    expect(snapshot.textContent).toContain('Original caption')
    expect(snapshot.textContent).not.toContain('Edited during download')
    expect(options.width).toBe(4096)
    expect(options.height).toBeGreaterThan(1000)
    expect(gifFactory).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(live)
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
  })

  it('reports a renderer download failure without leaking its URL or changing the live canvas', async () => {
    vi.doMock('html-to-image', () => { throw new Error('Private download URL') })
    const { exportToPng } = await import('../utils/exportUtils')
    const live = wrapper.outerHTML
    await expect(exportToPng(wrapper, false)).rejects.toThrow('Image export tools could not be loaded. Check your connection and try exporting again.')
    expect(wrapper.outerHTML).toBe(live)
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
  })

  it('cleans up the mounted snapshot after a GIF download failure before capturing frames', async () => {
    vi.doMock('html-to-image', () => renderer)
    vi.doMock('gif.js', () => { throw new Error('Private download URL') })
    const { exportToGif } = await import('../utils/exportUtils')
    const live = wrapper.outerHTML
    await expect(exportToGif(wrapper, false, 1)).rejects.toThrow('GIF export tools could not be loaded. Check your connection and try exporting again.')
    expect(renderer.toCanvas).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(live)
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
  })

  it('freezes the cleaned HTML and SVG theme before a cold load even if body and app themes change', async () => {
    const app = document.createElement('div')
    app.className = 'app light-mode'
    app.style.setProperty('--caption-color', 'rgb(10, 20, 30)')
    wrapper.replaceWith(app); app.appendChild(wrapper)
    document.body.className = 'light-mode'
    wrapper.innerHTML = '<div class="react-flow__viewport"><span class="caption">Retained caption</span><svg><g class="selected"><path class="react-flow__edge-path" /></g></svg></div>'
    const stylesheet = document.createElement('style')
    stylesheet.dataset.exportLoadingFixture = 'true'
    stylesheet.textContent = '.light-mode .caption { color: var(--caption-color); background-color: rgb(245, 246, 247); font-size: 13px } .dark-mode .caption { color: rgb(220, 230, 240) !important; background-color: rgb(20, 30, 40); font-size: 18px } .light-mode .react-flow__edge-path { stroke: rgb(10, 20, 30) } .dark-mode .react-flow__edge-path { stroke: rgb(220, 230, 240) !important } .selected .react-flow__edge-path { stroke: rgb(255, 0, 0) !important }'
    document.head.appendChild(stylesheet)
    let signalLoading!: () => void, resolveRenderer!: () => void
    const loading = new Promise<void>(resolve => { signalLoading = resolve })
    const ready = new Promise<void>(resolve => { resolveRenderer = resolve })
    vi.doMock('html-to-image', async () => { signalLoading(); await ready; return renderer })
    renderer.toSvg.mockImplementation(async (snapshot: HTMLDivElement, options: { backgroundColor: string }) => {
      expect(options.backgroundColor).toBe('#ffffff')
      expect(snapshot.closest('.app')).toHaveClass('light-mode')
      expect(snapshot.closest('.app')?.classList.contains('dark-mode')).toBe(false)
      const caption = snapshot.querySelector<HTMLElement>('.caption')!
      expect(caption.style.backgroundColor).toBe('rgb(245, 246, 247)')
      expect(caption.style.fontSize).toBe('13px')
      expect((snapshot.closest('.app') as HTMLElement).style.getPropertyValue('--caption-color')).toBe('rgb(10, 20, 30)')
      expect(snapshot.querySelector<SVGPathElement>('path')!.style.stroke).toBe('rgb(10, 20, 30)')
      expect(snapshot.querySelector('.selected')).toBeNull()
      return 'data:image/svg+xml;base64,AAAA'
    })
    const { exportToSvg } = await import('../utils/exportUtils')
    const result = exportToSvg(wrapper, false)
    await loading
    app.className = 'app dark-mode'
    app.style.setProperty('--caption-color', 'rgb(220, 230, 240)')
    document.body.className = 'dark-mode'
    const live = wrapper.outerHTML
    resolveRenderer(); await result
    expect(wrapper.outerHTML).toBe(live)
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
    app.remove()
  })

  it('freezes Current view dimensions before HEAD and keeps image loading attributes absent during style capture', async () => {
    const source = '/api/images/123e4567-e89b-42d3-a456-426614174000?key=' + 'A'.repeat(43)
    const image = document.createElement('img'); image.src = source; wrapper.appendChild(image)
    const mounts: Array<string | null> = []
    const append = document.body.appendChild
    vi.spyOn(document.body, 'appendChild').mockImplementation(function<T extends Node>(this: HTMLElement, node: T): T {
      if (node instanceof HTMLElement && node.dataset.flowchartExportSnapshot) mounts.push(node.querySelector('img')?.getAttribute('src') ?? null)
      return append.call(this, node) as T
    })
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    vi.doMock('html-to-image', () => renderer)
    renderer.toSvg.mockImplementation(async (snapshot: HTMLDivElement, options: { width: number; height: number }) => {
      expect(options).toMatchObject({ width: 800, height: 600 })
      expect(snapshot.querySelector('img')?.getAttribute('src')).toBe(source)
      return 'data:image/svg+xml;base64,AAAA'
    })
    const { exportToSvg } = await import('../utils/exportUtils')
    const result = exportToSvg(wrapper, false, { area: 'viewport', nodes: [] })
    expect(mounts).toEqual([null])
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
    Object.defineProperties(wrapper, { clientWidth: { value: 400 }, clientHeight: { value: 300 } })
    const live = wrapper.outerHTML
    finish(new Response(null, { status: 200, headers: { 'Content-Type': 'image/webp' } }))
    await result
    expect(mounts).toEqual([null, source])
    expect(wrapper.outerHTML).toBe(live)
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
  })
})

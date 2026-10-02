import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportToGif } from '../utils/exportUtils'

const lifecycle = vi.hoisted(() => ({ encoders: [] as unknown[] }))
vi.mock('gif.js', async () => {
  // Exercise the installed browser implementation rather than a mock whose
  // finished/abort behavior could hide its idle-worker retention.
  const { default: ActualGIF } = await vi.importActual<typeof import('gif.js')>('gif.js/dist/gif.js')
  return { default: class extends ActualGIF {
    constructor(options: ConstructorParameters<typeof ActualGIF>[0]) { super(options); lifecycle.encoders.push(this) }
  } }
})
vi.mock('html-to-image', () => ({
  getFontEmbedCSS: async () => '',
  toCanvas: async () => Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
}))

describe('Installed GIF encoder disposal', () => {
  let wrapper: HTMLDivElement
  let behavior: 'success' | 'constructor-error' | 'post-error' | 'stall'
  const workers: Array<{ terminate: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent) => void) | null; onerror: unknown }> = []
  const urlTimers: ReturnType<typeof setTimeout>[] = []
  beforeEach(() => {
    behavior = 'success'
    workers.length = 0; lifecycle.encoders.length = 0
    class ControlledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror = null
      terminate = vi.fn()
      constructor() {
        if (behavior === 'constructor-error' && workers.length === 1) throw new Error('Worker construction failed')
        workers.push(this)
      }
      postMessage(task: { index: number }) {
        if (behavior === 'post-error') throw new Error('Worker post failed')
        if (behavior === 'stall') return
        queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: {
          index: task.index, pageSize: 4, cursor: 4, data: [new Uint8Array([71, 73, 70, 0])],
        } })))
      }
    }
    vi.stubGlobal('Worker', ControlledWorker)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:gif-lifecycle'); static revokeObjectURL = vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const setTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      const timer = setTimeout(callback, delay, ...args)
      if (delay === 1000) urlTimers.push(timer)
      return timer
    }) as typeof setTimeout)
    wrapper = document.createElement('div')
    wrapper.innerHTML = '<div class="react-flow__viewport">Retained live canvas</div>'
    Object.defineProperties(wrapper, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
    document.body.appendChild(wrapper)
  })
  afterEach(() => {
    urlTimers.splice(0).forEach(clearTimeout)
    wrapper.remove()
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  const expectDisposed = (original: string) => {
    expect(lifecycle.encoders).toHaveLength(1)
    const encoder = lifecycle.encoders[0] as {
      activeWorkers: unknown[]; freeWorkers: unknown[]; frames: unknown[]; imageParts: unknown[]
      running: boolean; listeners(event: string): unknown[]
    }
    expect(encoder.activeWorkers).toEqual([])
    expect(encoder.freeWorkers).toEqual([])
    expect(encoder.frames).toEqual([])
    expect(encoder.imageParts).toEqual([])
    expect(encoder.running).toBe(false)
    expect(encoder.listeners('finished')).toEqual([])
    expect(encoder.listeners('error')).toEqual([])
    workers.forEach(worker => {
      expect(worker.terminate).toHaveBeenCalledOnce()
      expect(worker.onmessage).toBeNull()
      expect(worker.onerror).toBeNull()
    })
    expect(wrapper.outerHTML).toBe(original)
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
  }

  it('terminates finished idle workers and releases copied frames after a successful export', async () => {
    const original = wrapper.outerHTML
    await exportToGif(wrapper, false, 0.2)
    expect(workers).toHaveLength(2)
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expectDisposed(original)
  })
  it.each(['constructor-error', 'post-error'] as const)('disposes partial worker pools after %s', async failure => {
    behavior = failure
    const original = wrapper.outerHTML
    await expect(exportToGif(wrapper, false, 0.2)).rejects.toThrow(failure === 'constructor-error' ? 'Worker construction failed' : 'Worker post failed')
    expect(workers).toHaveLength(failure === 'constructor-error' ? 1 : 2)
    expectDisposed(original)
  })
  it('disposes active workers and retained frames after the encoding deadline', async () => {
    vi.useFakeTimers()
    behavior = 'stall'
    const original = wrapper.outerHTML
    const result = exportToGif(wrapper, false, 0.2)
    const rejected = expect(result).rejects.toThrow('GIF encoding timed out')
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expectDisposed(original)
  })
  it('rejects a failed download and disposes finished workers immediately', async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error('Download failed') })
    const original = wrapper.outerHTML
    await expect(exportToGif(wrapper, false, 0.2)).rejects.toThrow('Download failed')
    expectDisposed(original)
  })
})

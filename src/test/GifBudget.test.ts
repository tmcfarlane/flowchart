import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportToGif, type GifExportMetadata } from '../utils/exportUtils'

const capture = vi.hoisted(() => ({
  canvas: vi.fn(), encoders: [] as unknown[], retainedBytes: [] as number[],
}))
vi.mock('html-to-image', () => ({ getFontEmbedCSS: async () => '', toCanvas: capture.canvas }))
vi.mock('gif.js', async () => {
  const { default: ActualGIF } = await vi.importActual<typeof import('gif.js')>('gif.js/dist/gif.js')
  return { default: class extends ActualGIF {
    constructor(options: ConstructorParameters<typeof ActualGIF>[0]) { super(options); capture.encoders.push(this) }
    render() {
      capture.retainedBytes.push((this as unknown as { frames: { data: Uint8ClampedArray }[] }).frames.reduce((bytes, frame) => bytes + frame.data.byteLength, 0))
      return super.render()
    }
  } }
})

describe('GIF copied-frame budget', () => {
  let wrapper: HTMLDivElement
  const workers: { terminate: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent) => void) | null; onerror: unknown }[] = []
  let copyActualRaster: boolean
  beforeEach(() => {
    vi.useFakeTimers()
    capture.canvas.mockReset()
    capture.encoders.length = 0; capture.retainedBytes.length = 0; workers.length = 0
    copyActualRaster = false
    capture.canvas.mockImplementation(async (_snapshot: HTMLElement, options: { width: number; height: number; pixelRatio: number }) => {
      // Match the installed html-to-image path: HTML canvas dimensions truncate
      // positive fractional width/height assignments to integers.
      const canvas = document.createElement('canvas')
      canvas.width = options.width * options.pixelRatio
      canvas.height = options.height * options.pixelRatio
      return canvas
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect() {}, drawImage() {}, getImageData(_x: number, _y: number, width: number, height: number) {
        return { data: new Uint8ClampedArray(copyActualRaster ? width * height * 4 : 4) }
      },
    } as unknown as CanvasRenderingContext2D)
    class ControlledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror = null
      terminate = vi.fn()
      constructor() { workers.push(this) }
      postMessage(task: { index: number }) {
        queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: {
          index: task.index, pageSize: 4, cursor: 4, data: [new Uint8Array([71, 73, 70, 0])],
        } })))
      }
    }
    vi.stubGlobal('Worker', ControlledWorker)
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:budget'); static revokeObjectURL = vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('devicePixelRatio', 1)
    wrapper = document.createElement('div')
    wrapper.innerHTML = '<div class="react-flow__viewport"><span>Original diagram</span></div>'
    document.body.appendChild(wrapper)
  })
  afterEach(() => {
    wrapper.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  const dimensions = (width: number, height: number) => Object.defineProperties(wrapper, {
    clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height },
  })
  const finish = async (job: Promise<void>) => {
    await vi.waitFor(() => expect(capture.canvas).toHaveBeenCalled())
    await vi.runAllTimersAsync()
    await job
  }
  const expectReleased = () => {
    for (const value of capture.encoders) {
      const encoder = value as { frames: unknown[]; activeWorkers: unknown[]; freeWorkers: unknown[]; imageParts: unknown[]; listeners(event: string): unknown[] }
      expect(encoder.frames).toEqual([]); expect(encoder.activeWorkers).toEqual([])
      expect(encoder.freeWorkers).toEqual([]); expect(encoder.imageParts ?? []).toEqual([])
      expect(encoder.listeners('finished')).toEqual([])
    }
    workers.forEach(worker => { expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull() })
    expect(document.querySelector('[data-flowchart-export-snapshot]')).toBeNull()
  }

  it.each([
    [1280, 1280, 1, 1280, 1280, false], [1280, 1280, 3, 747, 747, true], [1280, 1280, 10, 409, 409, true],
    [1280, 720, 1, 1280, 720, false], [1280, 720, 3, 997, 560, true], [1280, 720, 10, 546, 307, true],
  ])('bounds %i×%i for %i seconds with fixed raster dimensions and unchanged timing', async (width, height, seconds, pixelWidth, pixelHeight, resolutionAdjusted) => {
    dimensions(width, height)
    const original = wrapper.outerHTML
    const progress = vi.fn<(frame: number, total: number, metadata?: GifExportMetadata) => void>()
    await finish(exportToGif(wrapper, false, seconds, progress))
    const frames = seconds * 10
    expect(capture.canvas).toHaveBeenCalledTimes(frames)
    expect(progress).toHaveBeenCalledTimes(frames)
    expect(progress.mock.calls[0]).toEqual([1, frames, { pixelWidth, pixelHeight, resolutionAdjusted }])
    expect(progress.mock.calls.at(-1)).toEqual([frames, frames, { pixelWidth, pixelHeight, resolutionAdjusted }])
    expect(pixelWidth * pixelHeight * 4 * frames).toBeLessThanOrEqual(64 * 1024 * 1024)
    for (const [, options] of capture.canvas.mock.calls) expect(options.pixelRatio).toBeLessThanOrEqual(1)
    const encoder = capture.encoders[0] as { options: { width: number; height: number }; frames: unknown[] }
    expect(encoder.options).toMatchObject({ width: pixelWidth, height: pixelHeight })
    expect(wrapper.outerHTML).toBe(original)
    expectReleased()
  })

  it('bounds actual copied buffers in the installed encoder for a ten-second square capture', async () => {
    dimensions(1280, 1280)
    copyActualRaster = true
    await finish(exportToGif(wrapper, false, 10))
    expect(capture.retainedBytes).toEqual([409 * 409 * 4 * 100])
    expect(capture.retainedBytes[0]).toBeLessThanOrEqual(64 * 1024 * 1024)
    expect(workers).toHaveLength(2)
    expectReleased()
  })

  it('does not upscale a small capture or alter a legacy two-argument callback', async () => {
    dimensions(100, 50)
    const progress = vi.fn((frame: number, total: number) => ({ frame, total }))
    await finish(exportToGif(wrapper, false, 10, progress))
    expect(progress.mock.results.at(-1)?.value).toEqual({ frame: 100, total: 100 })
    expect(progress.mock.calls[0]).toEqual([1, 100, { pixelWidth: 100, pixelHeight: 50, resolutionAdjusted: false }])
    expect(capture.canvas.mock.calls.every(([, options]) => options.pixelRatio === 1)).toBe(true)
    expectReleased()
  })

  it('keeps internal fixed dimensions independent of changes to callback metadata', async () => {
    dimensions(100, 50)
    const seen: number[] = []
    await finish(exportToGif(wrapper, false, 0.2, (_frame, _total, metadata) => {
      seen.push(metadata!.pixelWidth)
      metadata!.pixelWidth = 1
    }))
    expect(seen).toEqual([100, 100])
    expect(capture.encoders).toHaveLength(1)
    expectReleased()
  })

  it.each([[0, 100], [100, 0], [1281, 1]])('rejects an unusable %i×%i raster before encoder creation or progress', async (width, height) => {
    dimensions(100, 50)
    capture.canvas.mockImplementation(async () => Object.assign(document.createElement('canvas'), { width, height }))
    const progress = vi.fn()
    const job = exportToGif(wrapper, false, 0.1, progress)
    const rejected = expect(job).rejects.toThrow('frame size could not be prepared')
    await vi.waitFor(() => expect(capture.canvas).toHaveBeenCalled())
    await vi.runAllTimersAsync(); await rejected
    expect(capture.encoders).toEqual([])
    expect(progress).not.toHaveBeenCalled()
    expectReleased()
  })

  it.each(['oversized', 'changed', 'capture', 'progress'] as const)('disposes a partial encoder after a later %s failure', async failure => {
    dimensions(1280, 720)
    const original = wrapper.outerHTML
    const firstCanvas = () => Object.assign(document.createElement('canvas'), { width: 997, height: 560 })
    capture.canvas.mockImplementationOnce(async () => firstCanvas()).mockImplementationOnce(async () => {
      if (failure === 'capture') throw new Error('A later frame failed')
      return Object.assign(document.createElement('canvas'), { width: failure === 'oversized' ? 1280 : 996, height: failure === 'oversized' ? 720 : 560 })
    })
    const progress = vi.fn((frame: number) => { if (failure === 'progress' && frame === 1) throw new Error('Progress failed') })
    const job = exportToGif(wrapper, false, 3, progress)
    const rejected = expect(job).rejects.toThrow(failure === 'oversized' ? 'frame size could not be prepared' : failure === 'changed' ? 'frame size changed' : failure === 'capture' ? 'later frame failed' : 'Progress failed')
    await vi.waitFor(() => expect(capture.canvas).toHaveBeenCalled())
    await vi.runAllTimersAsync(); await rejected
    expect(capture.encoders).toHaveLength(1)
    expect(capture.retainedBytes).toEqual([])
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.outerHTML).toBe(original)
    expectReleased()
  })

  it('checks actual renderer rounding before retaining an over-budget first frame', async () => {
    dimensions(1280, 720)
    capture.canvas.mockImplementation(async (_snapshot: HTMLElement, options: { width: number; height: number; pixelRatio: number }) => Object.assign(document.createElement('canvas'), {
      width: Math.ceil(options.width * options.pixelRatio), height: Math.ceil(options.height * options.pixelRatio),
    }))
    const progress = vi.fn()
    const job = exportToGif(wrapper, false, 3, progress)
    const rejected = expect(job).rejects.toThrow('frame size could not be prepared')
    await vi.waitFor(() => expect(capture.canvas).toHaveBeenCalled())
    await vi.runAllTimersAsync(); await rejected
    expect(capture.encoders).toEqual([])
    expect(progress).not.toHaveBeenCalled()
    expectReleased()
  })
})

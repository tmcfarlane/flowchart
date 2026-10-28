import { afterEach, describe, expect, it, vi } from 'vitest'

const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalGetContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext)
})

describe('Draw text measurement', () => {
  it('uses a cached ordinary canvas when OffscreenCanvas is unavailable', async () => {
    const measureText = vi.fn((value: string) => ({ width: value.length * 25, actualBoundingBoxLeft: 0, actualBoundingBoxRight: value.length * 25 }))
    const context = { font: '', measureText }
    const getContext = vi.fn(() => context)
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('CanvasRenderingContext2D', class {})
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: getContext })
    vi.resetModules()
    const { drawingTextSize } = await import('../utils/drawText')
    expect(drawingTextSize('WWWW', { fontSize: 20, fontFamily: 3 }).width).toBe(100)
    expect(drawingTextSize('配送先', { fontSize: 20, fontFamily: 3 }).width).toBe(75)
    expect(context.font).toContain('ui-monospace')
    expect(getContext).toHaveBeenCalledOnce()
    expect(measureText).toHaveBeenCalledTimes(2)
  })

  it('retains a deterministic pure fallback without browser canvas APIs', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('CanvasRenderingContext2D', undefined)
    vi.resetModules()
    const { drawingTextSize } = await import('../utils/drawText')
    expect(drawingTextSize('WWWW', { fontSize: 20 })).toEqual({ width: 48.8, height: 26 })
  })
})

import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DrawCanvas, { type DrawCanvasApi } from '../components/DrawCanvas'
import { validateArchitectureScene, type ArchitectureScene } from '../shared/architectureScene'
import { cropImageElement, type ImageCrop } from '../utils/drawMedia'
import type { DrawElement } from '../utils/drawScene'

const scene = (): ArchitectureScene => ({ version: 1, elements: [], files: {} })
const rect = (id: string): DrawElement => ({ id, type: 'rectangle', x: 100, y: 100, width: 120, height: 80, angle: 0 })

function drawing(initial = scene()) {
  const commit = vi.fn()
  let current = initial
  function Harness() {
    const [value, setValue] = useState(initial)
    return <DrawCanvas scene={value} nodes={[]} edges={[]} darkMode={false} onChange={next => { current = next; commit(next); setValue(next) }} />
  }
  render(<Harness />)
  return { canvas: screen.getByRole('region', { name: 'Draw canvas' }), surface: screen.getByTestId('draw-surface'), commit, current: () => current }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Draw clipboard and crop', () => {
  it('pastes external JSON and line breaks as one literal text element', () => {
    const { canvas, commit, current } = drawing()
    const text = '{"type":"flowchart-drawing"}\nsecond line'
    fireEvent.paste(canvas, { clipboardData: { getData: (type: string) => type === 'text/plain' ? text : '', files: [] } })
    expect(current().elements).toEqual([expect.objectContaining({ type: 'text', text, originalText: text })])
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('pastes own scene MIME with independent bound references', () => {
    const component = { ...scene(), elements: [
      { ...rect('box'), boundElements: [{ id: 'label', type: 'text' }] },
      { id: 'label', type: 'text', x: 120, y: 120, width: 50, height: 25, angle: 0, text: 'Label', containerId: 'box' },
    ] }
    const { canvas, commit, current } = drawing(component)
    const data = JSON.stringify({ type: 'flowchart-drawing', scene: component })
    fireEvent.paste(canvas, { clipboardData: { getData: (type: string) => type === 'application/x-flowchart-drawing' ? data : '', files: [] } })
    const added = current().elements.filter(item => !['box', 'label'].includes(String(item.id)))
    expect(added).toHaveLength(2)
    const box = added.find(item => item.type === 'rectangle')!
    const label = added.find(item => item.type === 'text')!
    expect(label.containerId).toBe(box.id)
    expect(box.boundElements).toEqual([{ id: label.id, type: 'text' }])
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('uses navigator plain text for Ctrl+Shift+V, including scene-shaped JSON', async () => {
    const readText = vi.fn().mockResolvedValue('{"type":"flowchart-drawing","scene":{}}')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    const { canvas, current } = drawing({ ...scene(), elements: [rect('original')] })
    fireEvent.keyDown(canvas, { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(current().elements).toHaveLength(2))
    expect(current().elements[1].text).toBe('{"type":"flowchart-drawing","scene":{}}')
    expect(readText).toHaveBeenCalledOnce()
  })

  it('maps source pixel crop through rotation and flips without changing pixel scale', () => {
    const element = { ...rect('image'), type: 'image', width: 200, height: 100, angle: Math.PI / 2, scale: [-1, 1] }
    const full: ImageCrop = { x: 0, y: 0, width: 100, height: 50, naturalWidth: 100, naturalHeight: 50 }
    const cropped = cropImageElement(element, full, { ...full, x: 20, width: 80 })
    expect(cropped).toMatchObject({ width: 160, height: 100, x: 120, y: 80, crop: { x: 20, width: 80 } })
    const second = cropImageElement(cropped, cropped.crop as ImageCrop, { ...full, x: 30, width: 70 })
    const direct = cropImageElement(element, full, { ...full, x: 30, width: 70 })
    expect(second).toMatchObject({ x: direct.x, y: direct.y, width: direct.width, height: direct.height, crop: direct.crop })
  })

  it('rejects malformed native crop dimensions but retains valid imported metadata', () => {
    const base = { ...scene(), elements: [{ ...rect('image'), type: 'image', fileId: 'asset' }], files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=' } } }
    const valid = { ...base, elements: [{ ...base.elements[0], crop: { x: 10, y: 5, width: 40, height: 20, naturalWidth: 100, naturalHeight: 50, extra: 'kept' } }] }
    expect(validateArchitectureScene(valid)).toEqual(valid)
    for (const crop of [{ x: 0, y: 0, width: 0, height: 1, naturalWidth: 10, naturalHeight: 10 }, { x: 8, y: 0, width: 4, height: 3, naturalWidth: 10, naturalHeight: 10 }]) {
      expect(() => validateArchitectureScene({ ...base, elements: [{ ...base.elements[0], crop }] })).toThrow(/crop/)
    }
  })

  it('finishes crop as one commit and explicit cancel restores the last committed crop', async () => {
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 320; naturalHeight = 200; decode() { return Promise.resolve() } })
    const image = { ...rect('image'), type: 'image', fileId: 'asset', width: 320, height: 200 }
    const initial = { ...scene(), elements: [image], files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=' } } }
    const { surface, commit, current } = drawing(initial)
    const object = surface.querySelector('[data-element-id="image"]')!
    fireEvent.pointerDown(object, { button: 0, buttons: 1, clientX: 120, clientY: 130 })
    fireEvent.pointerUp(surface, { button: 0, buttons: 0, clientX: 120, clientY: 130 })
    fireEvent.keyDown(surface, { key: 'Enter' })
    await screen.findByRole('dialog', { name: 'Crop image' })
    fireEvent.change(screen.getByLabelText('Crop width'), { target: { value: '250' } })
    expect(current().elements[0].crop).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Finish crop' }))
    expect(current().elements[0].crop).toMatchObject({ width: 250, naturalWidth: 320 })
    expect(commit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(surface, { key: 'Enter' })
    await screen.findByRole('dialog', { name: 'Crop image' })
    fireEvent.change(screen.getByLabelText('Crop height'), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel crop' }))
    expect(current().elements[0].crop).toMatchObject({ width: 250, height: 200 })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('drops an image decode when Draw switches to view mode', async () => {
    let resolveDecode!: () => void
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 320; naturalHeight = 200; decode() { return new Promise<void>(resolve => { resolveDecode = resolve }) } })
    const image = { ...rect('image'), type: 'image', fileId: 'asset', width: 320, height: 200 }
    const initial = { ...scene(), elements: [image], files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=' } } }
    const commit = vi.fn()
    function Harness() {
      const [viewMode, setViewMode] = useState(false)
      return <><button onClick={() => setViewMode(true)}>View only</button><DrawCanvas scene={initial} nodes={[]} edges={[]} darkMode={false} viewMode={viewMode} onChange={commit} /></>
    }
    render(<Harness />)
    const surface = screen.getByTestId('draw-surface')
    fireEvent.pointerDown(surface.querySelector('[data-element-id="image"]')!, { button: 0, buttons: 1, clientX: 120, clientY: 130 })
    fireEvent.pointerUp(surface, { button: 0, buttons: 0, clientX: 120, clientY: 130 })
    fireEvent.keyDown(surface, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'View only' }))
    await act(async () => resolveDecode())
    expect(screen.queryByRole('dialog', { name: 'Crop image' })).not.toBeInTheDocument()
    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps a pending plain-text read out of a crop preview and restores focus on cancel', async () => {
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 320; naturalHeight = 200; decode() { return Promise.resolve() } })
    let resolveText!: (text: string) => void
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => new Promise<string>(resolve => { resolveText = resolve }) } })
    const image = { ...rect('image'), type: 'image', fileId: 'asset', width: 320, height: 200 }
    const initial = { ...scene(), elements: [image], files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=' } } }
    const { canvas, surface, commit, current } = drawing(initial)
    fireEvent.pointerDown(surface.querySelector('[data-element-id="image"]')!, { button: 0, buttons: 1, clientX: 120, clientY: 130 })
    fireEvent.pointerUp(surface, { button: 0, buttons: 0, clientX: 120, clientY: 130 })
    canvas.focus()
    fireEvent.keyDown(canvas, { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(canvas, { key: 'Enter' })
    await screen.findByRole('dialog', { name: 'Crop image' })
    expect(document.activeElement).toBe(screen.getByLabelText('Crop x'))
    fireEvent.change(screen.getByLabelText('Crop width'), { target: { value: '250' } })
    await act(async () => resolveText('delayed paste'))
    expect(current().elements).toEqual(initial.elements)
    expect(commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel crop' }))
    expect(document.activeElement).toBe(canvas)
    expect(current().elements).toEqual(initial.elements)
    expect(commit).not.toHaveBeenCalled()
  })

  it('drops an image upload whose decode completes during a crop session', async () => {
    let finishUpload!: () => void
    let decodes = 0
    vi.stubGlobal('Image', class {
      src = ''; naturalWidth = 320; naturalHeight = 200
      decode() { return ++decodes === 1 ? new Promise<void>(resolve => { finishUpload = resolve }) : Promise.resolve() }
    })
    const image = { ...rect('image'), type: 'image', fileId: 'asset', width: 320, height: 200 }
    const initial = { ...scene(), elements: [image], files: { asset: { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=' } } }
    const { canvas, surface, commit, current } = drawing(initial)
    fireEvent.pointerDown(surface.querySelector('[data-element-id="image"]')!, { button: 0, buttons: 1, clientX: 120, clientY: 130 })
    fireEvent.pointerUp(surface, { button: 0, buttons: 0, clientX: 120, clientY: 130 })
    const file = new File(['clipboard image bytes'], 'clipboard.png', { type: 'image/png' })
    fireEvent.paste(canvas, { clipboardData: { getData: () => '', files: [file] } })
    await waitFor(() => expect(finishUpload).toBeTypeOf('function'))
    fireEvent.keyDown(canvas, { key: 'Enter' })
    await screen.findByRole('dialog', { name: 'Crop image' })
    fireEvent.change(screen.getByLabelText('Crop width'), { target: { value: '250' } })
    await act(async () => finishUpload())
    expect(current().elements).toEqual(initial.elements)
    expect(commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel crop' }))
    expect(current().elements).toEqual(initial.elements)
    expect(commit).not.toHaveBeenCalled()
  })

  it('drops a pasted image after the committed scene is replaced during decode', async () => {
    let resolveDecode!: () => void
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 320; naturalHeight = 200; decode() { return new Promise<void>(resolve => { resolveDecode = resolve }) } })
    const initial = { ...scene(), elements: [rect('original')] }
    const commit = vi.fn()
    let current = initial
    let api: DrawCanvasApi | null = null
    function Harness() {
      const [value, setValue] = useState(initial)
      return <DrawCanvas scene={value} nodes={[]} edges={[]} darkMode={false} onReady={ready => { api = ready }} onChange={next => { current = next; commit(next); setValue(next) }} />
    }
    render(<Harness />)
    const file = new File(['clipboard bytes'], 'image.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('region', { name: 'Draw canvas' }), { clipboardData: { getData: () => '', files: [file] } })
    await waitFor(() => expect(resolveDecode).toBeTypeOf('function'))
    act(() => api!.replaceScene({ ...scene(), elements: [rect('replacement')] }))
    await act(async () => resolveDecode())
    expect(current.elements).toEqual([expect.objectContaining({ id: 'replacement' })])
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

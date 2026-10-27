import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ArchitectureScene } from '../shared/architectureScene'
import { createElement } from '../utils/drawScene'
import DrawLibrary, { buildDrawingComponent } from '../components/DrawLibrary'

const shape = (id: string, x: number) => createElement('rectangle', { x, y: 0 }, { x: x + 120, y: 60 }, { id })
const makeScene = (): ArchitectureScene => ({
  version: 1,
  elements: [
    { ...shape('api', 0), boundElements: [{ id: 'label', type: 'text' }, { id: 'internal', type: 'arrow' }, { id: 'external', type: 'arrow' }] },
    shape('cache', 220), shape('outside', 500),
    createElement('text', { x: 5, y: 15 }, { x: 115, y: 40 }, { id: 'label', text: 'API', containerId: 'api' }),
    createElement('arrow', { x: 120, y: 30 }, { x: 220, y: 30 }, { id: 'internal', startBinding: { elementId: 'api' }, endBinding: { elementId: 'cache' } }),
    createElement('arrow', { x: 340, y: 30 }, { x: 500, y: 30 }, { id: 'external', startBinding: { elementId: 'cache' }, endBinding: { elementId: 'outside' } }),
  ],
  files: {},
})

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('drawing component library', () => {
  it('saves a connected multi-element selection including bound labels and internal arrows', () => {
    const original = makeScene()
    const component = buildDrawingComponent(original, new Set(['api', 'cache']))
    expect(component.elements.map(e => e.id)).toEqual(['api', 'cache', 'label', 'internal'])
    expect(component.elements.find(e => e.id === 'internal')).toMatchObject({ startBinding: { elementId: 'api' }, endBinding: { elementId: 'cache' } })
    expect(component.elements.find(e => e.id === 'api')?.boundElements).toEqual([{ id: 'label', type: 'text' }, { id: 'internal', type: 'arrow' }])
    expect(original.elements.find(e => e.id === 'api')?.boundElements).toHaveLength(3)
  })

  it('detaches external references while retaining selected path geometry', () => {
    const original = makeScene()
    const component = buildDrawingComponent(original, new Set(['external']))
    const saved = component.elements[0]
    expect(saved.startBinding).toBeNull()
    expect(saved.endBinding).toBeNull()
    expect(saved.points).toEqual(original.elements.find(e => e.id === 'external')?.points)
    expect(saved.x).toBe(340)
  })

  it('copies referenced image data and excludes unused assets', () => {
    const image = createElement('image', { x: 0, y: 0 }, { x: 100, y: 100 }, { id: 'logo', fileId: 'used' })
    const file = (id: string) => ({ id, dataURL: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' })
    const component = buildDrawingComponent({ version: 1, elements: [image], files: { used: file('used'), other: file('other') } }, new Set(['logo']))
    expect(Object.keys(component.files)).toEqual(['used'])
    expect(component.files.used.id).toBe('used')
  })

  it('removes semantic graph references outside the reusable component', () => {
    const child = { ...shape('child', 10), customData: { flowchart: { kind: 'node', id: 'child-graph', snapshot: { id: 'child-graph', type: 'service', label: 'API', parentNode: 'external-parent' } } } }
    const component = buildDrawingComponent({ version: 1, elements: [child], files: {} }, new Set(['child']))
    expect((component.elements[0].customData as typeof child.customData).flowchart.snapshot).not.toHaveProperty('parentNode')
    expect(child.customData.flowchart.snapshot.parentNode).toBe('external-parent')
  })

  it('saves, reloads, inserts, and deletes a named component', () => {
    const onInsert = vi.fn()
    const view = render(<DrawLibrary scene={makeScene()} selectedIds={new Set(['api', 'cache'])} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Components' }))
    fireEvent.change(screen.getByLabelText('Component name'), { target: { value: 'API with cache' } })
    fireEvent.click(screen.getByRole('button', { name: /Save selection/ }))
    expect(screen.getByRole('button', { name: 'Insert API with cache' })).toBeInTheDocument()
    view.unmount()
    render(<DrawLibrary scene={makeScene()} selectedIds={new Set()} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Components' }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert API with cache' }))
    expect(onInsert).toHaveBeenCalledOnce()
    expect(onInsert.mock.calls[0][0].elements).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Delete component API with cache' }))
    expect(screen.queryByRole('button', { name: 'Insert API with cache' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('flowchart-draw-components-v1')!).items).toEqual([])
  })

  it('preserves the saved library and reports a quota failure', () => {
    render(<DrawLibrary scene={makeScene()} selectedIds={new Set(['api'])} onInsert={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Components' }))
    fireEvent.change(screen.getByLabelText('Component name'), { target: { value: 'API' } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    fireEvent.click(screen.getByRole('button', { name: /Save selection/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is full')
    expect(screen.queryByRole('button', { name: 'Insert API' })).not.toBeInTheDocument()
  })

  it('does not claim insertion succeeded when the canvas refuses it', () => {
    const onInsert = vi.fn(() => false)
    render(<DrawLibrary scene={makeScene()} selectedIds={new Set(['api'])} onInsert={onInsert} />)
    fireEvent.click(screen.getByRole('button', { name: 'Components' }))
    fireEvent.change(screen.getByLabelText('Component name'), { target: { value: 'API' } })
    fireEvent.click(screen.getByRole('button', { name: /Save selection/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Insert API' }))
    expect(onInsert).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('isolates library keyboard input from canvas shortcuts and restores focus on Escape', () => {
    const onKeyDown = vi.fn()
    render(<div onKeyDown={onKeyDown}><DrawLibrary scene={makeScene()} selectedIds={new Set(['api'])} onInsert={() => {}} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Components' }))
    fireEvent.keyDown(screen.getByLabelText('Component name'), { key: 'z', ctrlKey: true })
    expect(onKeyDown).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Component name'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Your components' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Components' })).toHaveFocus()
  })
})

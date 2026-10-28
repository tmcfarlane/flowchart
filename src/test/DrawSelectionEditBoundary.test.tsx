import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DrawCanvas, { type DrawCanvasApi } from '../components/DrawCanvas'
import { captureDrawEdit } from '../utils/drawSelectionEdit'
import { createElement } from '../utils/drawScene'
import type { ArchitectureScene } from '../shared/architectureScene'

const scene: ArchitectureScene = { version: 1, elements: [createElement('rectangle', { x: 100, y: 100 }, { x: 300, y: 200 }, { id: 'shape' })], files: {} }
const proposal = { summary: 'Blue', operations: [{ op: 'update_element' as const, id: 'shape', changes: { backgroundColor: '#dbeafe' } }] }
function setup() {
  const onChange = vi.fn(), onEditSelection = vi.fn()
  let api: DrawCanvasApi | null = null
  const onReady = (next: DrawCanvasApi | null) => { api = next }
  const props = { scene, nodes: [], edges: [], darkMode: false, onChange, onReady, onEditSelection }
  const view = render(<DrawCanvas {...props} />)
  fireEvent.keyDown(screen.getByRole('region', { name: 'Draw canvas' }), { key: 'a', ctrlKey: true })
  return { ...view, props, api: () => api!, snapshot: () => captureDrawEdit(api!.getScene(), api!.getSelectedIds(), 0), onChange }
}

describe('Draw AI commit boundary', () => {
  it('commits one sparse update through Draw emit and preserves selection', () => {
    const view = setup(), snapshot = view.snapshot()
    act(() => expect(view.api().applySelectionEdit(snapshot, proposal)).toBe(true))
    expect(view.onChange).toHaveBeenCalledOnce()
    expect(view.onChange.mock.calls[0][0].elements[0]).toEqual({ ...scene.elements[0], backgroundColor: '#dbeafe' })
    expect(view.api().getSelectedIds()).toEqual(['shape'])
  })
  it('checks view-only mode at the mutation boundary', () => {
    const view = setup(), snapshot = view.snapshot()
    view.rerender(<DrawCanvas {...view.props} viewMode />)
    act(() => expect(view.api().applySelectionEdit(snapshot, proposal)).toBe(false))
    expect(view.onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Edit selection with AI' })).not.toBeInTheDocument()
  })
  it('rejects changed selection and replacement scenes', () => {
    const view = setup(), snapshot = view.snapshot()
    fireEvent.keyDown(screen.getByRole('region', { name: 'Draw canvas' }), { key: 'Escape' })
    act(() => expect(view.api().applySelectionEdit(snapshot, proposal)).toBe(false))
    fireEvent.keyDown(screen.getByRole('region', { name: 'Draw canvas' }), { key: 'a', ctrlKey: true })
    view.rerender(<DrawCanvas {...view.props} scene={{ ...scene, elements: scene.elements.map(element => ({ ...element, x: 500 })) }} />)
    act(() => expect(view.api().applySelectionEdit(snapshot, proposal)).toBe(false))
    expect(view.onChange).not.toHaveBeenCalled()
  })
  it('rejects transient text edits without committing or replacing the draft', () => {
    const view = setup(), snapshot = view.snapshot()
    fireEvent.keyDown(screen.getByRole('region', { name: 'Draw canvas' }), { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Edit drawing text' })).toBeInTheDocument()
    act(() => expect(view.api().applySelectionEdit(snapshot, proposal)).toBe(false))
    expect(view.onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Edit drawing text' })).toBeInTheDocument()
  })
})

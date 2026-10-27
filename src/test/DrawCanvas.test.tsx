import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import DrawCanvas from '../components/DrawCanvas'
import type { ArchitectureScene } from '../shared/architectureScene'
import type { DrawElement } from '../utils/drawScene'

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pressure: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pressure = init.pressure ?? 0.5
  }
}

beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const empty = (): ArchitectureScene => ({ version: 1, elements: [], files: {} })
const rectangle = (id: string, x: number): DrawElement => ({ id, type: 'rectangle', x, y: 100, width: 160, height: 100, angle: 0, strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100, groupIds: [] })

function renderDrawing(initial = empty(), parentHistory?: { onUndo: () => void; onRedo: () => void }) {
  const onCommit = vi.fn()
  let current = initial
  function Harness() {
    const [scene, setScene] = useState(initial)
    return <>
      <DrawCanvas scene={scene} nodes={[]} edges={[]} darkMode={false}
        onChange={next => { current = next; onCommit(next); setScene(next) }}
        {...parentHistory} canUndo={!!parentHistory} canRedo={!!parentHistory} />
      <textarea aria-label="Outside canvas prompt" />
    </>
  }
  const rendered = render(<Harness />)
  return { ...rendered, onCommit, scene: () => current, surface: screen.getByTestId('draw-surface'), canvas: screen.getByRole('region', { name: 'Draw canvas' }) }
}

const pointer = (x: number, y: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y })
function drawRectangle(surface: HTMLElement) {
  fireEvent.keyDown(surface, { key: 'r' })
  fireEvent.pointerDown(surface, pointer(100, 120))
  fireEvent.pointerMove(surface, pointer(260, 240))
  fireEvent.pointerUp(surface, pointer(260, 240))
}

describe('custom Draw canvas', () => {
  it('implements the familiar tool aliases and persistent-tool toggle in our toolbar', () => {
    const { surface } = renderDrawing()
    for (const [key, name] of [
      ['v', 'Selection'], ['1', 'Selection'], ['h', 'Hand'], ['r', 'Rectangle'], ['2', 'Rectangle'],
      ['d', 'Diamond'], ['3', 'Diamond'], ['o', 'Ellipse'], ['4', 'Ellipse'], ['a', 'Arrow'], ['5', 'Arrow'],
      ['l', 'Line'], ['6', 'Line'], ['p', 'Pen'], ['7', 'Pen'], ['t', 'Text'], ['8', 'Text'], ['9', 'Image'],
      ['e', 'Eraser'], ['0', 'Eraser'], ['f', 'Frame'],
    ]) {
      fireEvent.keyDown(surface, { key })
      expect(screen.getByRole('button', { name: `${name} tool`, exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    fireEvent.keyDown(surface, { key: 'q' })
    expect(screen.getByLabelText('Keep tool selected')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(surface, { key: 'q' })
    expect(screen.getByLabelText('Keep tool selected')).toHaveAttribute('aria-pressed', 'false')
  })

  it('previews a pointer drawing locally and commits it once on pointer release', () => {
    const { surface, onCommit, scene } = renderDrawing()
    fireEvent.click(screen.getByLabelText('Rectangle tool'))
    fireEvent.pointerDown(surface, pointer(100, 120))
    fireEvent.pointerMove(surface, pointer(260, 240))
    expect(surface.querySelector('[data-element-type="rectangle"]')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(surface, pointer(260, 240))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements).toEqual([expect.objectContaining({ type: 'rectangle', x: 100, y: 120, width: 160, height: 120 })])
    expect(screen.getByLabelText('Selection tool')).toHaveAttribute('aria-pressed', 'true')
  })

  it('cancels a pointer preview without modifying the document or its history', () => {
    const { surface, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'o' })
    fireEvent.pointerDown(surface, pointer(100, 120))
    fireEvent.pointerMove(surface, pointer(260, 240))
    fireEvent.pointerCancel(surface, pointer(260, 240))
    expect(surface.querySelector('[data-element-id]')).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Undo drawing')).toBeDisabled()
  })

  it('undoes and redoes a completed drawing and a keyboard move as separate transactions', () => {
    const { surface, scene } = renderDrawing()
    drawRectangle(surface)
    const original = scene().elements[0]
    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    fireEvent.keyUp(surface, { key: 'ArrowRight' })
    expect(scene().elements[0].x).toBe(Number(original.x) + 1)

    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(scene().elements[0].x).toBe(original.x)
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(scene().elements[0].x).toBe(Number(original.x) + 1)
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(scene().elements).toHaveLength(0)
  })

  it('applies contextual appearance to the selected object while preserving its geometry and id', () => {
    const { surface, scene } = renderDrawing()
    drawRectangle(surface)
    const original = scene().elements[0]
    fireEvent.change(screen.getByLabelText('Stroke color'), { target: { value: '#ff0000' } })
    fireEvent.change(screen.getByLabelText('Fill style'), { target: { value: 'cross-hatch' } })
    fireEvent.change(screen.getByLabelText('Opacity'), { target: { value: '55' } })
    expect(scene().elements[0]).toMatchObject({ id: original.id, x: original.x, y: original.y, width: original.width, height: original.height, strokeColor: '#ff0000', fillStyle: 'cross-hatch', opacity: 55 })
  })

  it('uses the parent document history when it is supplied', () => {
    const onUndo = vi.fn(), onRedo = vi.fn()
    const { surface, onCommit } = renderDrawing(empty(), { onUndo, onRedo })
    fireEvent.keyDown(surface, { key: 'z', metaKey: true })
    fireEvent.keyDown(surface, { key: 'z', metaKey: true, shiftKey: true })
    fireEvent.click(screen.getByLabelText('Undo drawing'))
    fireEvent.click(screen.getByLabelText('Redo drawing'))
    expect(onUndo).toHaveBeenCalledTimes(2)
    expect(onRedo).toHaveBeenCalledTimes(2)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('leaves input typing and browser text undo outside the drawing editor alone', () => {
    const onUndo = vi.fn(), onRedo = vi.fn()
    const { surface, onCommit } = renderDrawing(empty(), { onUndo, onRedo })
    fireEvent.keyDown(surface, { key: 'h' })
    fireEvent.keyDown(screen.getByLabelText('Stroke color'), { key: 'r' })
    fireEvent.keyDown(screen.getByLabelText('Stroke color'), { key: 'z', ctrlKey: true })
    fireEvent.keyDown(screen.getByLabelText('Outside canvas prompt'), { key: 'r' })
    fireEvent.keyDown(screen.getByLabelText('Outside canvas prompt'), { key: 'z', metaKey: true })
    expect(screen.getByLabelText('Hand tool')).toHaveAttribute('aria-pressed', 'true')
    expect(onUndo).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it.each([
    { modifier: 'Ctrl', ctrlKey: true, metaKey: false },
    { modifier: 'Cmd', ctrlKey: false, metaKey: true },
  ])('keeps multiline text editing open until $modifier+Enter commits it', ({ ctrlKey, metaKey }) => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 't' })
    fireEvent.pointerDown(surface, pointer(100, 120))
    const text = screen.getByLabelText('Edit drawing text')
    fireEvent.change(text, { target: { value: 'Orders API' } })
    const enter = createEvent.keyDown(text, { key: 'Enter' })
    fireEvent(text, enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(text).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    // JSDOM does not perform the browser's default textarea edit.
    fireEvent.change(text, { target: { value: 'Orders API\nShipping worker' } })
    const shiftEnter = createEvent.keyDown(text, { key: 'Enter', shiftKey: true })
    fireEvent(text, shiftEnter)
    expect(shiftEnter.defaultPrevented).toBe(false)
    expect(text).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(text, { target: { value: 'Orders API\nShipping worker\nEvent queue' } })
    fireEvent.keyDown(text, { key: 'Enter', ctrlKey, metaKey })

    expect(screen.queryByLabelText('Edit drawing text')).not.toBeInTheDocument()
    expect(scene().elements).toEqual([expect.objectContaining({ type: 'text', text: 'Orders API\nShipping worker\nEvent queue' })])
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('commits text on Escape and drops an empty new text object without changing the document', () => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 't' })
    fireEvent.pointerDown(surface, pointer(100, 120))
    fireEvent.change(screen.getByLabelText('Edit drawing text'), { target: { value: 'Saved with Escape' } })
    fireEvent.keyDown(screen.getByLabelText('Edit drawing text'), { key: 'Escape' })
    expect(scene().elements).toEqual([expect.objectContaining({ type: 'text', text: 'Saved with Escape' })])
    expect(screen.queryByLabelText('Edit drawing text')).not.toBeInTheDocument()
    const saved = scene()
    const commits = onCommit.mock.calls.length

    fireEvent.keyDown(surface, { key: 't' })
    fireEvent.pointerDown(surface, pointer(400, 120))
    fireEvent.keyDown(screen.getByLabelText('Edit drawing text'), { key: 'Escape' })
    expect(scene()).toEqual(saved)
    expect(onCommit).toHaveBeenCalledTimes(commits)
    expect(screen.queryByLabelText('Edit drawing text')).not.toBeInTheDocument()
  })

  it('groups and duplicates a selection with independent ids and one undoable command', () => {
    const { surface, scene } = renderDrawing({ version: 1, elements: [rectangle('one', 100), rectangle('two', 400)], files: {} })
    fireEvent.keyDown(surface, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(surface, { key: 'g', ctrlKey: true })
    const originals = scene().elements
    expect(originals[0].groupIds).toEqual(originals[1].groupIds)
    expect(originals[0].groupIds).toHaveLength(1)
    fireEvent.keyDown(surface, { key: 'd', ctrlKey: true })
    expect(scene().elements).toHaveLength(4)
    expect(new Set(scene().elements.map(element => element.id)).size).toBe(4)
    const duplicated = scene().elements.filter(element => !['one', 'two'].includes(String(element.id)))
    expect(duplicated[0].groupIds).toEqual(duplicated[1].groupIds)
    expect(duplicated[0].groupIds).not.toEqual(originals[0].groupIds)
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(scene().elements).toHaveLength(2)
  })

  it('recognizes actual shifted Digit keys for fit-all and fit-selection', () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 800))
    const { surface } = renderDrawing({ version: 1, elements: [rectangle('one', 100)], files: {} })
    fireEvent.wheel(surface, { deltaY: 100 })
    const beforeFit = surface.querySelector('[data-draw-viewport]')!.getAttribute('transform')
    fireEvent.keyDown(surface, { key: '!', code: 'Digit1', shiftKey: true })
    const fitAll = surface.querySelector('[data-draw-viewport]')!.getAttribute('transform')
    expect(fitAll).not.toBe(beforeFit)

    fireEvent.keyDown(surface, { key: 'a', ctrlKey: true })
    fireEvent.wheel(surface, { deltaY: 80 })
    const panned = surface.querySelector('[data-draw-viewport]')!.getAttribute('transform')
    fireEvent.keyDown(surface, { key: '@', code: 'Digit2', shiftKey: true })
    expect(surface.querySelector('[data-draw-viewport]')!.getAttribute('transform')).not.toBe(panned)
  })

  it('recognizes shifted bracket glyphs for bringing an object to front or back', () => {
    const { surface, scene } = renderDrawing({ version: 1, elements: [rectangle('one', 100), rectangle('two', 400), rectangle('three', 700)], files: {} })
    const first = surface.querySelector('[data-element-id="one"]')!
    fireEvent.pointerDown(first, pointer(110, 110))
    fireEvent.pointerUp(surface, pointer(110, 110))
    fireEvent.keyDown(surface, { key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true })
    expect(scene().elements.map(element => element.id)).toEqual(['two', 'three', 'one'])
    fireEvent.keyDown(surface, { key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true })
    expect(scene().elements.map(element => element.id)).toEqual(['one', 'two', 'three'])
  })
})

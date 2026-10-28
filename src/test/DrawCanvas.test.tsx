import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
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
  let replaceScene: (next: ArchitectureScene) => void = () => {}
  let changeViewMode: (next: boolean) => void = () => {}
  function Harness() {
    const [scene, setScene] = useState(initial)
    const [viewMode, setViewMode] = useState(false)
    replaceScene = next => { current = next; setScene(next) }
    changeViewMode = setViewMode
    return <>
      <DrawCanvas scene={scene} nodes={[]} edges={[]} darkMode={false} viewMode={viewMode}
        onChange={next => { current = next; onCommit(next); setScene(next) }}
        {...parentHistory} canUndo={!!parentHistory} canRedo={!!parentHistory} />
      <textarea aria-label="Outside canvas prompt" />
    </>
  }
  const rendered = render(<Harness />)
  return { ...rendered, onCommit, scene: () => current, replaceScene: (next: ArchitectureScene) => act(() => replaceScene(next)), setViewMode: (next: boolean) => act(() => changeViewMode(next)), surface: screen.getByTestId('draw-surface'), canvas: screen.getByRole('region', { name: 'Draw canvas' }) }
}

const pointer = (x: number, y: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y })
function drawRectangle(surface: HTMLElement) {
  fireEvent.keyDown(surface, { key: 'r' })
  fireEvent.pointerDown(surface, pointer(100, 120))
  fireEvent.pointerMove(surface, pointer(260, 240))
  fireEvent.pointerUp(surface, pointer(260, 240))
}

describe('custom Draw canvas', () => {
  it('selects a locked object with an ordinary click and unlocks it without recording failed edits', () => {
    const { surface, scene, onCommit } = renderDrawing({ ...empty(), elements: [rectangle('box', 100)] })
    const hit = () => surface.querySelector('[data-element-id="box"]')!
    fireEvent.pointerDown(hit(), pointer(160, 150))
    fireEvent.pointerUp(surface, pointer(160, 150))
    fireEvent.click(screen.getByRole('button', { name: 'Lock', exact: true }))
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(surface, { key: 'Escape' })
    fireEvent.pointerDown(hit(), pointer(160, 150))
    fireEvent.pointerMove(surface, pointer(210, 180))
    fireEvent.pointerUp(surface, pointer(210, 180))
    expect(hit()).toHaveAttribute('data-selected', 'true')
    expect(screen.getByRole('button', { name: 'Unlock', exact: true })).toBeEnabled()
    expect(surface.querySelector('[data-resize], [data-rotate], [data-point-index]')).toBeNull()
    expect(screen.queryByLabelText('Stroke color')).not.toBeInTheDocument()
    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    fireEvent.keyUp(surface, { key: 'ArrowRight' })
    fireEvent.keyDown(surface, { key: 'g', ctrlKey: true })
    fireEvent.keyDown(surface, { key: ']', code: 'BracketRight', ctrlKey: true })
    fireEvent.doubleClick(hit(), pointer(160, 150))
    expect(screen.queryByLabelText('Edit drawing text')).not.toBeInTheDocument()
    expect(scene().elements[0]).toMatchObject({ x: 100, y: 100, locked: true, groupIds: [] })
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Unlock', exact: true }))
    expect(onCommit).toHaveBeenCalledTimes(2)
    fireEvent.pointerDown(hit(), pointer(160, 150))
    fireEvent.pointerMove(surface, pointer(210, 180))
    fireEvent.pointerUp(surface, pointer(210, 180))
    expect(scene().elements[0]).toMatchObject({ x: 150, y: 130, locked: false })
    expect(onCommit).toHaveBeenCalledTimes(3)
  })

  it('keeps laser marks transient and fills only an unlocked closed shape', () => {
    const initial = { ...empty(), elements: [rectangle('open', 100), { ...rectangle('locked', 320), locked: true }] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    fireEvent.click(screen.getByLabelText('More drawing tools'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Laser pointer/ }))
    fireEvent.pointerDown(surface, pointer(450, 400))
    fireEvent.pointerMove(surface, pointer(470, 420))
    fireEvent.pointerUp(surface, pointer(470, 420))
    expect(surface.querySelector('.draw-laser-trace')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(surface, { key: 'b' })
    fireEvent.pointerDown(surface, pointer(160, 150))
    expect((scene().elements[0] as DrawElement).backgroundColor).toBe('#b2f2dc')
    fireEvent.pointerDown(surface, pointer(380, 150))
    expect((scene().elements[1] as DrawElement).backgroundColor).toBe('transparent')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it.each(['undo', 'scene replacement', 'view mode', 'Escape', 'pointer cancel', 'lost capture', 'blur'])('cancels an unfinished laser trace on %s', ending => {
    vi.useFakeTimers()
    try {
      const onUndo = vi.fn(), onRedo = vi.fn()
      const { surface, onCommit, replaceScene, setViewMode } = renderDrawing(empty(), { onUndo, onRedo })
      fireEvent.keyDown(surface, { key: 'k' })
      fireEvent.pointerDown(surface, pointer(450, 400))
      fireEvent.pointerMove(surface, pointer(470, 420))
      expect(surface.querySelector('.draw-laser-trace:not(.is-fading)')).toBeInTheDocument()
      if (ending === 'undo') fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
      if (ending === 'scene replacement') replaceScene({ ...empty(), appState: { viewBackgroundColor: '#ffeecc' } })
      if (ending === 'view mode') setViewMode(true)
      if (ending === 'Escape') fireEvent.keyDown(surface, { key: 'Escape' })
      if (ending === 'pointer cancel') fireEvent.pointerCancel(surface, pointer(470, 420))
      if (ending === 'lost capture') fireEvent.lostPointerCapture(surface)
      if (ending === 'blur') fireEvent.blur(window)
      fireEvent.pointerUp(surface, pointer(470, 420))
      act(() => vi.advanceTimersByTime(1200))
      expect(surface.querySelector('.draw-laser-trace')).not.toBeInTheDocument()
      expect(onCommit).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('resets ordinary eyedropper activation to stroke after explicit fill sampling', () => {
    const initial = { ...empty(), elements: [{ ...rectangle('source', 100), strokeColor: '#ab1234', backgroundColor: '#00aaff' }, rectangle('target', 320)] }
    const { surface, scene } = renderDrawing(initial)
    fireEvent.pointerDown(surface.querySelector('[data-element-id="target"]')!, pointer(380, 150))
    fireEvent.pointerUp(surface, pointer(380, 150))
    fireEvent.keyDown(surface, { key: 'G', shiftKey: true })
    fireEvent.pointerDown(surface, pointer(150, 150))
    expect((scene().elements[1] as DrawElement).backgroundColor).toBe('#00aaff')
    fireEvent.keyDown(surface, { key: 'i' })
    fireEvent.pointerDown(surface, pointer(150, 150))
    expect((scene().elements[1] as DrawElement).strokeColor).toBe('#ab1234')
    fireEvent.keyDown(surface, { key: 'G', shiftKey: true })
    fireEvent.click(screen.getByLabelText('More drawing tools'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Eyedropper/ }))
    fireEvent.pointerDown(surface, pointer(150, 150))
    expect(screen.getByRole('alert')).toHaveTextContent('Stroke sampled')
  })

  it('discards an unfinished click connector before opening Mermaid import', () => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'a' })
    fireEvent.pointerDown(surface, pointer(600, 400))
    fireEvent.pointerUp(surface, pointer(600, 400))
    fireEvent.pointerMove(surface, pointer(750, 500))
    expect(surface.querySelector('[data-element-type="arrow"]')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('More drawing tools'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Import Mermaid/ }))
    expect(surface.querySelector('[data-element-type="arrow"]')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mermaid source'), { target: { value: 'flowchart LR\nA[Start] -->|go| B[End]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import shapes' }))
    expect(scene().elements).toHaveLength(6)
    expect(scene().elements.filter(element => element.type === 'arrow')).toHaveLength(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('discards an unfinished click connector before opening the embed dialog', () => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'a' })
    fireEvent.pointerDown(surface, pointer(600, 400))
    fireEvent.pointerUp(surface, pointer(600, 400))
    fireEvent.pointerMove(surface, pointer(750, 500))
    fireEvent.click(screen.getByLabelText('More drawing tools'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Embed URL/ }))
    expect(surface.querySelector('[data-element-type="arrow"]')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Embed URL'), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    expect(scene().elements).toHaveLength(1)
    expect(scene().elements[0].type).toBe('embeddable')
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('samples paint into unlocked selection and imports Mermaid as one scene change', () => {
    const initial = { ...empty(), elements: [{ ...rectangle('source', 100), strokeColor: '#ab1234' }, rectangle('target', 320)] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    fireEvent.pointerDown(surface.querySelector('[data-element-id="target"]')!, pointer(380, 150))
    fireEvent.pointerUp(surface, pointer(380, 150))
    fireEvent.keyDown(surface, { key: 'i' })
    fireEvent.pointerDown(surface, pointer(150, 150))
    expect((scene().elements[1] as DrawElement).strokeColor).toBe('#ab1234')
    fireEvent.click(screen.getByLabelText('More drawing tools'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Import Mermaid/ }))
    fireEvent.change(screen.getByLabelText('Mermaid source'), { target: { value: 'flowchart TB\nA[Start] -->|go| B{Decide}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import shapes' }))
    expect(scene().elements.some(item => item.type === 'diamond')).toBe(true)
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('rejects unsafe embeds and stores a static HTTPS card', () => {
    const { scene, onCommit } = renderDrawing()
    fireEvent.click(screen.getByLabelText('More drawing tools'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Embed URL/ }))
    fireEvent.change(screen.getByLabelText('Embed URL'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Embed URL'), { target: { value: 'https://example.com/page' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }))
    expect(scene().elements[0]).toMatchObject({ type: 'embeddable', link: 'https://example.com/page' })
    expect(screen.queryByTitle('Live web embed')).not.toBeInTheDocument()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
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

  it.each(['Rectangle', 'Arrow', 'Pen', 'Text', 'Eraser'])('pans from blank canvas with the right button while %s is active', tool => {
    const initial: ArchitectureScene = { ...empty(), elements: [rectangle('existing', 100)] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    fireEvent.click(screen.getByLabelText(`${tool} tool`))
    const start = { ...pointer(500, 400), button: 2, buttons: 2 }
    fireEvent.pointerDown(surface, start)
    expect(surface).toHaveClass('is-panning')
    fireEvent.pointerMove(surface, { ...start, clientX: 580, clientY: 360 })
    expect(surface.querySelector('[data-draw-viewport]')).toHaveAttribute('transform', 'translate(80 -40) scale(1)')
    fireEvent.pointerUp(surface, { ...start, clientX: 580, clientY: 360, buttons: 0 })
    expect(surface).not.toHaveClass('is-panning')
    expect(scene()).toEqual(initial)
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByLabelText(`${tool} tool`)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Undo drawing')).toBeDisabled()
  })

  it('right-drags over selected objects without changing selection or parent history and ends on cancel', () => {
    const initial: ArchitectureScene = { ...empty(), elements: [rectangle('existing', 100)] }
    const onUndo = vi.fn(), onRedo = vi.fn()
    const { surface, scene, onCommit } = renderDrawing(initial, { onUndo, onRedo })
    const object = surface.querySelector('[data-element-id="existing"]')!
    fireEvent.pointerDown(object, pointer(100, 140))
    fireEvent.pointerUp(surface, pointer(100, 140))
    expect(object).toHaveAttribute('data-selected', 'true')
    fireEvent.click(screen.getByLabelText('Eraser tool'))
    const right = { ...pointer(120, 140), button: 2, buttons: 2 }
    fireEvent.pointerDown(object, right)
    fireEvent.pointerMove(surface, { ...right, clientX: 170, clientY: 170 })
    expect(surface).toHaveClass('is-panning')
    expect(object).toHaveAttribute('data-selected', 'true')
    fireEvent.pointerCancel(surface, { ...right, clientX: 170, clientY: 170 })
    expect(surface).not.toHaveClass('is-panning')
    const cancelledViewport = surface.querySelector('[data-draw-viewport]')!.getAttribute('transform')
    fireEvent.pointerMove(surface, { ...right, clientX: 270, clientY: 270 })
    expect(surface.querySelector('[data-draw-viewport]')).toHaveAttribute('transform', cancelledViewport)
    fireEvent.pointerDown(object, right)
    fireEvent.keyDown(surface, { key: 'Escape' })
    expect(surface).not.toHaveClass('is-panning')
    expect(object).toHaveAttribute('data-selected', 'true')
    expect(screen.getByLabelText('Eraser tool')).toHaveAttribute('aria-pressed', 'true')
    expect(scene()).toEqual(initial)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onUndo).not.toHaveBeenCalled()
    expect(onRedo).not.toHaveBeenCalled()
  })

  it('right-pans during text editing without committing or losing the unfinished text', () => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 't' })
    fireEvent.pointerDown(surface, pointer(100, 120))
    const editor = screen.getByLabelText('Edit drawing text')
    fireEvent.change(editor, { target: { value: 'Unfinished note' } })
    expect(document.activeElement).toBe(editor)
    const right = { ...pointer(500, 400), button: 2, buttons: 2 }
    fireEvent.pointerDown(surface, right)
    fireEvent.pointerMove(surface, { ...right, clientX: 560, clientY: 430 })
    fireEvent.pointerCancel(surface, right)
    expect(surface).not.toHaveClass('is-panning')
    expect(screen.getByLabelText('Edit drawing text')).toBe(editor)
    expect(editor).toHaveValue('Unfinished note')
    expect(document.activeElement).toBe(editor)
    expect(scene().elements).toHaveLength(0)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerDown(surface, right)
    fireEvent.pointerMove(surface, { ...right, clientX: 520, clientY: 410 })
    fireEvent.pointerUp(surface, { ...right, clientX: 520, clientY: 410, buttons: 0 })
    expect(editor).toHaveValue('Unfinished note')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements[0]).toMatchObject({ text: 'Unfinished note', x: 100, y: 120 })
  })

  it('suppresses the context menu only on the drawing surface', () => {
    const { surface } = renderDrawing()
    const canvasMenu = createEvent.contextMenu(surface, { button: 2 })
    fireEvent(surface, canvasMenu)
    expect(canvasMenu.defaultPrevented).toBe(true)
    const input = screen.getByLabelText('Stroke color')
    const propertyMenu = createEvent.contextMenu(input, { button: 2 })
    fireEvent(input, propertyMenu)
    expect(propertyMenu.defaultPrevented).toBe(false)
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


describe('Draw geometry commands', () => {
  it.each([false, true])('keeps a deep-selected bound label in place across flips (locked host: %s)', locked => {
    const host = { ...rectangle('host', 100), locked }
    const label: DrawElement = { id: 'label', type: 'text', x: 120, y: 120, width: 80, height: 30, angle: 0,
      strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100, groupIds: [], containerId: host.id, text: 'Bound label' }
    const { surface, canvas, scene, onCommit } = renderDrawing({ ...empty(), elements: [host, label] })
    const text = surface.querySelector('[data-element-id="label"]')!
    fireEvent.pointerDown(text, { ...pointer(130, 130), ctrlKey: true })
    fireEvent.pointerUp(surface, { ...pointer(130, 130), ctrlKey: true })
    expect(text).toHaveAttribute('data-selected', 'true')
    expect(surface.querySelector('[data-element-id="host"]')).not.toHaveAttribute('data-selected', 'true')
    fireEvent.keyDown(canvas, { key: 'H', code: 'KeyH', shiftKey: true })
    fireEvent.keyDown(canvas, { key: 'V', code: 'KeyV', shiftKey: true })
    expect(onCommit).not.toHaveBeenCalled()
    expect(scene().elements).toEqual([host, label])
  })

  it('creates and flips in single transactions, navigates without history and preserves alignment', () => {
    const { surface, canvas, scene, onCommit } = renderDrawing({ ...empty(), elements: [rectangle('source', 100)] })
    const source = surface.querySelector('[data-element-id="source"]')!
    fireEvent.pointerDown(source, pointer(150, 150)); fireEvent.pointerUp(surface, pointer(150, 150))
    onCommit.mockClear()
    fireEvent.keyDown(screen.getByLabelText('Stroke width'), { key: 'ArrowRight', ctrlKey: true })
    fireEvent.keyDown(screen.getByLabelText('Stroke width'), { key: 'H', shiftKey: true })
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(canvas, { key: 'ArrowRight', ctrlKey: true })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements).toHaveLength(3)
    const clone = scene().elements[1]
    expect(clone.x).toBe(340)
    fireEvent.keyDown(canvas, { key: 'ArrowLeft', altKey: true })
    expect(source).toHaveAttribute('data-selected', 'true')
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(canvas, { key: 'H', shiftKey: true })
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(scene().elements[0].x).toBe(340)
    fireEvent.keyDown(canvas, { key: 'ArrowLeft', ctrlKey: true, shiftKey: true })
    expect(scene().elements).toHaveLength(3)
    expect(scene().elements[0].x).toBe(scene().elements[1].x)
  })

  it('selects through lasso without history and restores selection on cancellation', () => {
    const { surface, canvas, onCommit } = renderDrawing({ ...empty(), elements: [rectangle('source', 100), rectangle('other', 500)] })
    fireEvent.keyDown(canvas, { key: 'j' })
    fireEvent.pointerDown(surface, pointer(90, 90))
    for (const [x, y] of [[280, 90], [280, 220], [90, 220]]) fireEvent.pointerMove(surface, pointer(x, y))
    expect(screen.getByTestId('draw-lasso')).toBeInTheDocument()
    expect(surface.querySelector('[data-draw-content] [data-testid="draw-lasso"]')).toBeNull()
    fireEvent.pointerUp(surface, pointer(90, 90))
    expect(surface.querySelector('[data-element-id="source"]')).toHaveAttribute('data-selected', 'true')
    expect(surface.querySelector('[data-element-id="other"]')).not.toHaveAttribute('data-selected')
    fireEvent.pointerDown(surface, pointer(490, 90)); fireEvent.pointerMove(surface, pointer(700, 240))
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(surface.querySelector('[data-element-id="source"]')).toHaveAttribute('data-selected', 'true')
    expect(screen.queryByTestId('draw-lasso')).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerDown(surface, pointer(490, 90)); fireEvent.pointerMove(surface, pointer(700, 240)); fireEvent.pointerCancel(surface)
    expect(surface.querySelector('[data-element-id="source"]')).toHaveAttribute('data-selected', 'true')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('suppresses geometry mutations in view mode', () => {
    const onCommit = vi.fn()
    render(<DrawCanvas scene={{ ...empty(), elements: [rectangle('source', 100)] }} nodes={[]} edges={[]} darkMode={false} viewMode onChange={onCommit} />)
    const surface = screen.getByTestId('draw-surface')
    fireEvent.keyDown(surface, { key: 'ArrowRight', ctrlKey: true })
    fireEvent.keyDown(surface, { key: 'H', shiftKey: true })
    expect(onCommit).not.toHaveBeenCalled()
  })
})

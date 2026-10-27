import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
const box = (id: string, x: number, properties: Partial<DrawElement> = {}): DrawElement => ({
  id, type: 'rectangle', x, y: 100, width: 160, height: 100, angle: 0,
  strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100, groupIds: [], boundElements: null, ...properties,
})
const connector = (points: [number, number][] = [[0, 0], [200, 0]]): DrawElement => ({
  id: 'connector', type: 'arrow', x: 100, y: 300, width: 200, height: 0, angle: 0,
  strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100, points,
  boundElements: [{ id: 'label', type: 'text' }],
})
const label: DrawElement = {
  id: 'label', type: 'text', x: 180, y: 287, width: 40, height: 26, angle: 0,
  text: 'HTTPS', originalText: 'HTTPS', fontSize: 20, containerId: 'connector',
  strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100,
}

function renderDrawing(initial = empty()) {
  const onCommit = vi.fn()
  let current = initial
  function Harness() {
    const [scene, setScene] = useState(initial)
    return <DrawCanvas scene={scene} nodes={[]} edges={[]} darkMode={false}
      onChange={next => { current = next; onCommit(next); setScene(next) }} />
  }
  const result = render(<Harness />)
  return { ...result, onCommit, scene: () => current, surface: screen.getByTestId('draw-surface') }
}

const pointer = (x: number, y: number, modifiers: Partial<PointerEventInit> = {}) => ({
  pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, ...modifiers,
})
function click(surface: Element, x: number, y: number, modifiers: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(surface, pointer(x, y, modifiers))
  fireEvent.pointerUp(surface, pointer(x, y, { ...modifiers, buttons: 0 }))
}
function select(surface: Element, id: string, x: number, y: number) {
  const element = surface.querySelector(`[data-element-id="${id}"]`)!
  fireEvent.pointerDown(element, pointer(x, y))
  fireEvent.pointerUp(surface, pointer(x, y, { buttons: 0 }))
}

describe('required Draw modifiers and connector keyboard workflows', () => {
  it.each(['Rectangle', 'Diamond', 'Ellipse'])('draws %s from the center with Alt/Option and commits one undoable operation', tool => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.click(screen.getByRole('button', { name: `${tool} tool`, exact: true }))
    fireEvent.pointerDown(surface, pointer(300, 300, { altKey: true }))
    fireEvent.pointerMove(surface, pointer(370, 340, { altKey: true }))
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(surface, pointer(370, 340, { altKey: true, buttons: 0 }))
    expect(scene().elements).toEqual([expect.objectContaining({ x: 230, y: 260, width: 140, height: 80 })])
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(scene().elements).toEqual([])
    fireEvent.keyDown(surface, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(scene().elements).toEqual([expect.objectContaining({ x: 230, y: 260, width: 140, height: 80 })])
  })

  it('combines centered drawing with Shift constraints in the reverse direction', () => {
    const { surface, scene } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'o' })
    fireEvent.pointerDown(surface, pointer(300, 300, { altKey: true, shiftKey: true }))
    fireEvent.pointerMove(surface, pointer(230, 260, { altKey: true, shiftKey: true }))
    fireEvent.pointerUp(surface, pointer(230, 260, { altKey: true, shiftKey: true, buttons: 0 }))
    expect(scene().elements).toEqual([expect.objectContaining({ type: 'ellipse', x: 230, y: 230, width: 140, height: 140 })])
  })

  it.each([{ ctrlKey: true }, { metaKey: true }])('deep-selects one grouped member with a modified marquee (%j)', modifier => {
    const initial: ArchitectureScene = { ...empty(), elements: [box('one', 100, { groupIds: ['group'] }), box('two', 400, { groupIds: ['group'] })] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    fireEvent.pointerDown(surface, pointer(90, 90, modifier))
    fireEvent.pointerMove(surface, pointer(270, 210, modifier))
    fireEvent.pointerUp(surface, pointer(270, 210, { ...modifier, buttons: 0 }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    fireEvent.keyUp(surface, { key: 'ArrowRight' })
    expect(scene().elements.find(element => element.id === 'one')).toMatchObject({ x: 101, groupIds: ['group'] })
    expect(scene().elements.find(element => element.id === 'two')).toMatchObject({ x: 400, groupIds: ['group'] })
    fireEvent.keyDown(surface, { key: 'z', ...modifier })
    expect(scene().elements).toEqual(initial.elements)
  })

  it('retains normal group expansion for an unmodified marquee', () => {
    const { surface } = renderDrawing({ ...empty(), elements: [box('one', 100, { groupIds: ['group'] }), box('two', 400, { groupIds: ['group'] })] })
    fireEvent.pointerDown(surface, pointer(90, 90))
    fireEvent.pointerMove(surface, pointer(270, 210))
    fireEvent.pointerUp(surface, pointer(270, 210, { buttons: 0 }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('snaps a deep-selected member using its own bounds rather than the whole group', () => {
    const { surface, scene } = renderDrawing({ ...empty(), elements: [box('one', 100, { groupIds: ['group'] }), box('two', 400, { groupIds: ['group'] }), box('target', 300)] })
    fireEvent.pointerDown(surface, pointer(90, 90, { ctrlKey: true }))
    fireEvent.pointerMove(surface, pointer(270, 210, { ctrlKey: true }))
    fireEvent.pointerUp(surface, pointer(270, 210, { ctrlKey: true, buttons: 0 }))
    fireEvent.click(screen.getByRole('button', { name: 'Snap to objects', exact: true }))
    const selected = surface.querySelector('[data-element-id="one"]')!
    fireEvent.pointerDown(selected, pointer(110, 110, { ctrlKey: true }))
    fireEvent.pointerMove(surface, pointer(146, 110, { ctrlKey: true }))
    fireEvent.pointerUp(surface, pointer(146, 110, { ctrlKey: true, buttons: 0 }))
    expect(scene().elements.find(element => element.id === 'one')).toMatchObject({ x: 140 })
    expect(scene().elements.find(element => element.id === 'two')).toMatchObject({ x: 400 })
    expect(scene().elements.find(element => element.id === 'target')).toMatchObject({ x: 300 })
  })

  it.each([{ ctrlKey: true }, { metaKey: true }])('edits a labeled connector with the familiar point-mode shortcut (%j)', modifier => {
    const { surface, scene, onCommit } = renderDrawing({ ...empty(), elements: [connector(), label] })
    select(surface, 'connector', 150, 300)
    fireEvent.keyDown(surface, { key: 'Enter', ...modifier })
    expect(screen.getByText('Editing connector points')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Edit drawing text' })).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add path point', exact: true }))
    expect(scene().elements.find(element => element.id === 'connector')).toMatchObject({ points: [[0, 0], [100, 0], [200, 0]] })
    fireEvent.keyDown(surface, { key: 'ArrowUp', shiftKey: true })
    expect(onCommit).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(surface, { key: 'ArrowUp', shiftKey: true })
    expect(scene().elements.find(element => element.id === 'connector')).toMatchObject({ points: [[0, 0], [100, -5], [200, 0]], boundElements: [{ id: 'label', type: 'text' }] })
    expect(scene().elements.find(element => element.id === 'label')).toMatchObject({ containerId: 'connector', text: 'HTTPS', x: 180, y: 282 })
    fireEvent.keyDown(surface, { key: 'z', ...modifier })
    expect(scene().elements.find(element => element.id === 'connector')).toMatchObject({ points: [[0, 0], [100, 0], [200, 0]] })
    fireEvent.keyDown(surface, { key: 'Escape' })
    expect(screen.queryByText('Editing connector points')).not.toBeInTheDocument()
    expect(scene().elements.find(element => element.id === 'connector')).toMatchObject({ points: [[0, 0], [100, 0], [200, 0]] })
  })

  it('removes an interior path point without deleting its connector or label', () => {
    const { surface, scene } = renderDrawing({ ...empty(), elements: [connector([[0, 0], [100, -70], [200, 0]]), label] })
    select(surface, 'connector', 150, 300)
    fireEvent.keyDown(surface, { key: 'Enter', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Edit path point 2', exact: true }))
    fireEvent.keyDown(surface, { key: 'Delete' })
    expect(scene().elements.find(element => element.id === 'connector')).toMatchObject({ points: [[0, 0], [200, 0]] })
    expect(scene().elements.find(element => element.id === 'label')).toMatchObject({ containerId: 'connector', text: 'HTTPS' })
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(screen.queryByText('Editing connector points')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Edit drawing text' })).not.toBeInTheDocument()
  })

  it('cancels a point drag without committing geometry or adding history', () => {
    const initial: ArchitectureScene = { ...empty(), elements: [connector([[0, 0], [100, -70], [200, 0]]), label] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    select(surface, 'connector', 150, 300)
    fireEvent.keyDown(surface, { key: 'Enter', ctrlKey: true })
    const midpoint = screen.getByRole('button', { name: 'Edit path point 2', exact: true })
    fireEvent.pointerDown(midpoint, pointer(200, 230))
    fireEvent.pointerMove(surface, pointer(200, 190))
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(surface, { key: 'Escape' })
    fireEvent.pointerUp(surface, pointer(200, 190, { buttons: 0 }))
    expect(scene()).toEqual(initial)
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undo drawing', exact: true })).toBeDisabled()
  })

  it('exits connector point mode when another object is selected', () => {
    const initial: ArchitectureScene = { ...empty(), elements: [connector(), label, box('other', 400)] }
    const { surface, scene } = renderDrawing(initial)
    select(surface, 'connector', 150, 300)
    fireEvent.keyDown(surface, { key: 'Enter', ctrlKey: true })
    select(surface, 'other', 450, 150)
    expect(screen.queryByText('Editing connector points')).not.toBeInTheDocument()
    fireEvent.keyDown(surface, { key: 'ArrowRight' })
    fireEvent.keyUp(surface, { key: 'ArrowRight' })
    expect(scene().elements.find(element => element.id === 'other')).toMatchObject({ x: 401 })
    expect(scene().elements.find(element => element.id === 'connector')).toMatchObject({ x: 100, y: 300, points: [[0, 0], [200, 0]] })
  })

  it('reopens a bound label with Enter after selecting its host', () => {
    const boundLabel: DrawElement = { ...label, containerId: 'host', text: 'Existing label', originalText: 'Existing label' }
    const { surface, scene } = renderDrawing({ ...empty(), elements: [box('host', 100, { boundElements: [{ id: 'label', type: 'text' }] }), boundLabel] })
    select(surface, 'host', 150, 150)
    fireEvent.keyDown(surface, { key: 'Enter' })
    const editor = screen.getByRole('textbox', { name: 'Edit drawing text' })
    expect(editor).toHaveValue('Existing label')
    fireEvent.change(editor, { target: { value: 'Updated label' } })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    expect(scene().elements.find(element => element.id === 'label')).toMatchObject({ containerId: 'host', text: 'Updated label' })
    expect(scene().elements.filter(element => element.type === 'text')).toHaveLength(1)
  })

  it.each(['a', 'l'])('creates a multipoint connector with %s and clicks as a single undo transaction', tool => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: tool })
    click(surface, 100, 300)
    fireEvent.pointerMove(surface, pointer(200, 240, { buttons: 0 }))
    click(surface, 200, 240)
    fireEvent.pointerMove(surface, pointer(300, 300, { buttons: 0 }))
    click(surface, 300, 300)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.keyDown(surface, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements).toEqual([expect.objectContaining({ type: tool === 'a' ? 'arrow' : 'line', x: 100, y: 300, points: [[0, 0], [100, -60], [200, 0]] })])
    const completed = scene()
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(scene().elements).toEqual([])
    fireEvent.keyDown(surface, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(scene().elements).toEqual(completed.elements)
  })

  it('cancels an unfinished multipoint connector without a document or history edit', () => {
    const initial: ArchitectureScene = { ...empty(), elements: [box('existing', 400)] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    fireEvent.keyDown(surface, { key: 'a' })
    click(surface, 100, 300)
    click(surface, 200, 240)
    fireEvent.pointerMove(surface, pointer(300, 300, { buttons: 0 }))
    fireEvent.keyDown(surface, { key: 'Escape' })
    expect(scene()).toEqual(initial)
    expect(onCommit).not.toHaveBeenCalled()
    expect(surface.querySelector('[data-element-type="arrow"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo drawing', exact: true })).toBeDisabled()
  })

  it('discards an unfinished connector when another tool is chosen', () => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'a' })
    click(surface, 100, 300)
    click(surface, 200, 240)
    fireEvent.keyDown(surface, { key: 'r' })
    expect(surface.querySelector('[data-element-type="arrow"]')).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerDown(surface, pointer(400, 300))
    fireEvent.pointerMove(surface, pointer(500, 400))
    fireEvent.pointerUp(surface, pointer(500, 400, { buttons: 0 }))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements).toEqual([expect.objectContaining({ type: 'rectangle', x: 400, y: 300, width: 100, height: 100 })])
  })

  it('finishes a multipoint line on double-click without duplicate terminal points', () => {
    const { surface, scene, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'l' })
    click(surface, 100, 300)
    click(surface, 200, 240)
    click(surface, 300, 300)
    click(surface, 300, 300)
    fireEvent.doubleClick(surface, { clientX: 300, clientY: 300, button: 0 })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements).toEqual([expect.objectContaining({ type: 'line', points: [[0, 0], [100, -60], [200, 0]] })])
    expect(screen.queryByRole('textbox', { name: 'Edit drawing text' })).not.toBeInTheDocument()
  })

  it('recognizes the actual macOS Option glyph when toggling object snapping', () => {
    const { surface, onCommit } = renderDrawing()
    fireEvent.keyDown(surface, { key: 'ß', code: 'KeyS', altKey: true })
    expect(screen.getByRole('button', { name: 'Snap to objects', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it.each([
    { copyKey: 'c', pasteKey: 'v', ctrlKey: true, metaKey: false },
    { copyKey: 'ç', pasteKey: '√', ctrlKey: false, metaKey: true },
  ])('copies and pastes styles with platform modifier keys (%j)', ({ copyKey, pasteKey, ...modifier }) => {
    const { surface, scene, onCommit } = renderDrawing({ ...empty(), elements: [box('source', 100, { strokeColor: '#c2255c', backgroundColor: '#ffd43b', strokeWidth: 5 }), box('target', 400)] })
    select(surface, 'source', 150, 150)
    fireEvent.keyDown(surface, { key: copyKey, code: 'KeyC', altKey: true, ...modifier })
    expect(onCommit).not.toHaveBeenCalled()
    select(surface, 'target', 450, 150)
    fireEvent.keyDown(surface, { key: pasteKey, code: 'KeyV', altKey: true, ...modifier })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(scene().elements).toHaveLength(2)
    expect(scene().elements.find(element => element.id === 'target')).toMatchObject({ id: 'target', x: 400, y: 100, width: 160, height: 100, strokeColor: '#c2255c', backgroundColor: '#ffd43b', strokeWidth: 5 })
  })
})

import { applyDrawEdit, captureDrawEdit } from '../utils/drawSelectionEdit'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import DrawCanvas from '../components/DrawCanvas'
import type { ArchitectureScene } from '../shared/architectureScene'
import type { DrawElement } from '../utils/drawScene'

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const empty = (): ArchitectureScene => ({ version: 1, elements: [], files: {} })
const shape = (properties: Partial<DrawElement> = {}): DrawElement => ({
  id: 'shape', type: 'rectangle', x: 100, y: 120, width: 240, height: 160,
  angle: 0, strokeColor: '#087f5b', backgroundColor: 'transparent', strokeWidth: 2,
  opacity: 100, groupIds: [], boundElements: null, ...properties,
})
const boundLabel = (properties: Partial<DrawElement> = {}): DrawElement => ({
  id: 'label', type: 'text', x: 160, y: 184.4, width: 120, height: 31.2,
  angle: 0, text: 'Existing label', originalText: 'Existing label',
  fontSize: 24, fontFamily: 3, textAlign: 'center', containerId: 'shape',
  strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100,
  groupIds: [], boundElements: null, ...properties,
})

function renderDrawing(initial = empty()) {
  const onCommit = vi.fn()
  let current = initial
  function Harness() {
    const [scene, setScene] = useState(initial)
    return <DrawCanvas scene={scene} nodes={[]} edges={[]} darkMode={false}
      onChange={next => { current = next; onCommit(next); setScene(next) }} />
  }
  const rendered = render(<Harness />)
  return { ...rendered, onCommit, scene: () => current, surface: screen.getByTestId('draw-surface') }
}

const pointer = (x: number, y: number, details: Partial<PointerEventInit> = {}) => ({
  pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, ...details,
})
const live = (scene: ArchitectureScene) => (scene.elements as DrawElement[]).filter(element => !element.isDeleted)
const element = (scene: ArchitectureScene, id: string) => live(scene).find(item => item.id === id)!
function expectCentered(label: DrawElement, host: DrawElement) {
  expect(label.x + label.width / 2).toBeCloseTo(host.x + host.width / 2)
  expect(label.y + label.height / 2).toBeCloseTo(host.y + host.height / 2)
}
function draw(surface: Element, tool = 'Rectangle') {
  fireEvent.click(screen.getByRole('button', { name: `${tool} tool`, exact: true }))
  fireEvent.pointerDown(surface, pointer(100, 120))
  fireEvent.pointerMove(surface, pointer(340, 280))
  fireEvent.pointerUp(surface, pointer(340, 280, { buttons: 0 }))
}
function doubleClick(surface: Element, target: Element = surface, x = 220, y = 200) {
  // Keep the pointer/click sequence preceding dblclick: selection overlays can
  // become the target between the first and second clicks in a real browser.
  for (const detail of [1, 2]) {
    fireEvent.pointerDown(target, pointer(x, y))
    fireEvent.pointerUp(surface, pointer(x, y, { buttons: 0 }))
    fireEvent.click(target, { clientX: x, clientY: y, button: 0, detail })
  }
  fireEvent.doubleClick(target, { clientX: x, clientY: y, button: 0, detail: 2 })
}
function finish(value: string, method: 'keyboard' | 'blur' = 'keyboard') {
  const editor = screen.getByRole('textbox', { name: 'Edit drawing text', exact: true })
  fireEvent.change(editor, { target: { value } })
  if (method === 'blur') fireEvent.blur(editor)
  else fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
}

describe('shape-bound Draw labels', () => {
  it.each(['Rectangle', 'Ellipse', 'Diamond'])('returns %s drawing to Pointer and binds a centered label through a surface-target double-click', tool => {
    const { surface, scene, onCommit } = renderDrawing()
    expect(screen.getByRole('button', { name: 'Keep tool selected' })).toHaveAttribute('aria-pressed', 'false')
    draw(surface, tool)
    expect(screen.getByRole('button', { name: 'Selection tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(onCommit).toHaveBeenCalledTimes(1)
    const host = live(scene())[0]
    expect(surface.querySelector('.draw-selection')).toBeInTheDocument()
    doubleClick(surface)
    const editor = screen.getByRole('textbox', { name: 'Edit drawing text', exact: true })
    expect(editor).toHaveFocus()
    expect(editor).toHaveValue('')
    expect(onCommit).toHaveBeenCalledTimes(1)
    finish('Orders service')
    const label = live(scene()).find(item => item.type === 'text')!
    expect(label).toMatchObject({ containerId: host.id, text: 'Orders service', textAlign: 'center' })
    expect(element(scene(), host.id).boundElements).toContainEqual({ id: label.id, type: 'text' })
    expectCentered(label, element(scene(), host.id))
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('opens the same bound editor from the actual shape target without duplicating the label', () => {
    const caption = boundLabel({ id: 'caption', containerId: null, x: 500, text: 'Unaffected caption', originalText: 'Unaffected caption' })
    const initial: ArchitectureScene = { ...empty(), elements: [shape({ boundElements: [{ id: 'label', type: 'text' }] }), boundLabel(), caption] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    doubleClick(surface, surface.querySelector('[data-element-id="shape"]')!)
    const editor = screen.getByRole('textbox', { name: 'Edit drawing text' })
    expect(editor).toHaveFocus()
    expect(editor).toHaveValue('Existing label')
    const graphic = surface.querySelector('[data-element-id="label"]')!
    // JSDOM does not resolve SVG presentation attributes into computed styles.
    expect(graphic).toHaveAttribute('visibility', 'hidden')
    expect(surface.querySelector('[data-element-id="caption"]')).not.toHaveAttribute('visibility', 'hidden')
    finish('Updated label', 'blur')
    expect(surface.querySelector('[data-element-id="label"]')).not.toHaveAttribute('visibility', 'hidden')
    expect(live(scene()).filter(item => item.type === 'text')).toHaveLength(2)
    expect(element(scene(), 'caption')).toEqual(caption)
    expect(element(scene(), 'label')).toMatchObject({ id: 'label', text: 'Updated label', containerId: 'shape', fontSize: 24, fontFamily: 3 })
    expectCentered(element(scene(), 'label'), element(scene(), 'shape'))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps Enter and Shift+Enter as newlines and commits multiline text with Ctrl+Enter', () => {
    const { surface, scene, onCommit } = renderDrawing({ ...empty(), elements: [shape()] })
    doubleClick(surface)
    const editor = screen.getByRole('textbox', { name: 'Edit drawing text' })
    for (const shiftKey of [false, true]) {
      const event = createEvent.keyDown(editor, { key: 'Enter', shiftKey, bubbles: true, cancelable: true })
      fireEvent(editor, event)
      expect(event.defaultPrevented).toBe(false)
      expect(editor).toBeInTheDocument()
    }
    expect(onCommit).not.toHaveBeenCalled()
    finish('Orders\nAPI')
    const label = live(scene()).find(item => item.type === 'text')!
    expect(label.text).toBe('Orders\nAPI')
    expectCentered(label, element(scene(), 'shape'))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('discards an empty new label on blur without a document or undo transaction', () => {
    const initial: ArchitectureScene = { ...empty(), elements: [shape()] }
    const { surface, scene, onCommit } = renderDrawing(initial)
    doubleClick(surface)
    fireEvent.blur(screen.getByRole('textbox', { name: 'Edit drawing text' }))
    expect(scene()).toEqual(initial)
    expect(onCommit).not.toHaveBeenCalled()
    expect(surface.querySelector('[data-element-type="text"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo drawing', exact: true })).toBeDisabled()
  })

  it('undoes and redoes the label as a separate transaction from its shape', () => {
    const { surface, scene } = renderDrawing()
    draw(surface)
    const hostId = live(scene())[0].id
    doubleClick(surface)
    finish('Orders')
    const labelId = live(scene()).find(item => item.type === 'text')!.id
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(live(scene()).map(item => item.id)).toEqual([hostId])
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true })
    expect(live(scene())).toEqual([])
    fireEvent.keyDown(surface, { key: 'Z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(surface, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(element(scene(), labelId)).toMatchObject({ text: 'Orders', containerId: hostId })
    expectCentered(element(scene(), labelId), element(scene(), hostId))
  })

  it('keeps a committed label centered while moving and resizing its selected host', () => {
    const { surface, scene } = renderDrawing()
    draw(surface)
    const hostId = live(scene())[0].id
    doubleClick(surface)
    finish('Orders')
    const labelId = live(scene()).find(item => item.type === 'text')!.id
    const host = surface.querySelector(`[data-element-id="${hostId}"]`)!
    fireEvent.pointerDown(host, pointer(120, 140))
    fireEvent.pointerMove(surface, pointer(170, 170))
    fireEvent.pointerUp(surface, pointer(170, 170, { buttons: 0 }))
    expect(element(scene(), hostId)).toMatchObject({ x: 150, y: 150, width: 240, height: 160 })
    expectCentered(element(scene(), labelId), element(scene(), hostId))
    const resize = surface.querySelector('[data-resize="se"]')!
    fireEvent.pointerDown(resize, pointer(390, 310))
    fireEvent.pointerMove(surface, pointer(470, 350))
    fireEvent.pointerUp(surface, pointer(470, 350, { buttons: 0 }))
    expect(element(scene(), hostId)).toMatchObject({ x: 150, y: 150, width: 320, height: 200 })
    expectCentered(element(scene(), labelId), element(scene(), hostId))
    expect(element(scene(), labelId)).toMatchObject({ text: 'Orders', containerId: hostId })
  })

  it('retains font and shape rotation when reopening and changing an imported bound label', () => {
    const angle = Math.PI / 6
    const { surface, scene } = renderDrawing({ ...empty(), elements: [shape({ angle, boundElements: [{ id: 'label', type: 'text' }] }), boundLabel({ angle })] })
    doubleClick(surface)
    const editor = screen.getByRole('textbox', { name: 'Edit drawing text' })
    expect(editor).toHaveFocus()
    expect(editor.style.fontSize).toBe('24px')
    expect(getComputedStyle(editor).fontFamily).toMatch(/mono|courier/i)
    finish('Rotated API')
    expect(element(scene(), 'label')).toMatchObject({ fontSize: 24, fontFamily: 3, angle, containerId: 'shape' })
    expectCentered(element(scene(), 'label'), element(scene(), 'shape'))
  })

  it('uses the same layout for manual and AI edits of rotated multiline labels', () => {
    const initial: ArchitectureScene = { ...empty(), elements: [
      shape({ angle: 0.35, boundElements: [{ id: 'label', type: 'text' }] }),
      boundLabel({ angle: 0.35, lineHeight: 1.8 }),
    ] }
    const value = 'Review incoming orders and validate delivery addresses before reserving warehouse inventory.\nSend confirmation.\nDispatch the shipment.'
    const { surface, scene } = renderDrawing(initial)
    doubleClick(surface)
    finish(value)
    const proposed = applyDrawEdit(initial, captureDrawEdit(initial, ['shape', 'label'], 0), {
      summary: 'Expand label', operations: [{ op: 'update_element', id: 'label', changes: { text: value } }],
    }, [], [])
    expect(element(proposed, 'label')).toEqual(element(scene(), 'label'))
    expect(element(proposed, 'label').height).toBeGreaterThan(3 * 24 * 1.3)
    expectCentered(element(proposed, 'label'), element(proposed, 'shape'))
  })

  it('retains the explicit Q option while keeping it disabled by default', () => {
    const { surface, scene } = renderDrawing()
    const keep = screen.getByRole('button', { name: 'Keep tool selected', exact: true })
    expect(keep).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(surface, { key: 'q' })
    draw(surface)
    expect(keep).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Rectangle tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(surface, { key: 'q' })
    draw(surface, 'Ellipse')
    expect(keep).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Selection tool', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(live(scene()).filter(item => item.type !== 'text')).toHaveLength(2)
  })
})

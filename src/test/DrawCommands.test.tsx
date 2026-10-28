import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DrawCanvas from '../components/DrawCanvas'
import type { ArchitectureScene } from '../shared/architectureScene'
import type { DrawElement } from '../utils/drawScene'

const box: DrawElement = {
  id: 'box', type: 'rectangle', x: 100, y: 100, width: 160, height: 100, angle: 0,
  strokeColor: '#087f5b', backgroundColor: 'transparent', opacity: 100, groupIds: [],
  name: 'Service box', text: 'Search target',
}
const initial: ArchitectureScene = { version: 1, elements: [box], files: {} }

function setup() {
  const onChange = vi.fn(), onToggleTheme = vi.fn(), onRequestClear = vi.fn()
  let current = initial
  function Harness() {
    const [scene, setScene] = useState(initial)
    return <DrawCanvas scene={scene} nodes={[]} edges={[]} darkMode={false} onChange={next => {
      current = next; onChange(next); setScene(next)
    }} onToggleTheme={onToggleTheme} onRequestClear={onRequestClear} />
  }
  render(<Harness />)
  const canvas = screen.getByRole('region', { name: 'Draw canvas' })
  const surface = screen.getByTestId('draw-surface')
  const select = () => {
    fireEvent.pointerDown(surface.querySelector('[data-element-id="box"]')!, { clientX: 130, clientY: 130, button: 0, pointerId: 1 })
    fireEvent.pointerUp(surface, { clientX: 130, clientY: 130, button: 0, pointerId: 1 })
  }
  return { canvas, surface, select, onChange, onToggleTheme, onRequestClear, scene: () => current }
}

describe('Draw editor commands', () => {
  it('validates a selected link and commits its removal', () => {
    const { canvas, select, onChange, scene } = setup()
    select()
    fireEvent.keyDown(canvas, { key: 'k', code: 'KeyK', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: 'Element link' })
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Use an http, https, or mailto link.')
    fireEvent.change(input, { target: { value: 'https://example.com/path' } })
    expect(screen.getByRole('link', { name: 'Open link' })).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
    expect(scene().elements[0]).toMatchObject({ link: 'https://example.com/path' })
    fireEvent.keyDown(canvas, { key: 'k', code: 'KeyK', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(scene().elements[0]).toMatchObject({ link: null })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('finds and reveals an element without committing the document', () => {
    const { canvas, onChange, onRequestClear } = setup()
    fireEvent.keyDown(canvas, { key: 'f', code: 'KeyF', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: 'Search drawing' })
    fireEvent.change(input, { target: { value: 'Search target' } })
    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace', metaKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('1 results')
    expect(screen.getByRole('button', { name: 'Search target' })).toHaveAttribute('aria-current', 'true')
    expect(onChange).not.toHaveBeenCalled()
    expect(onRequestClear).not.toHaveBeenCalled()
  })

  it('uses one catalog in palette and help, and executes theme and clear callbacks', () => {
    const { canvas, onToggleTheme, onRequestClear } = setup()
    fireEvent.keyDown(canvas, { key: '/', code: 'Slash', ctrlKey: true })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search commands' }), { target: { value: 'theme' } })
    fireEvent.click(screen.getByRole('button', { name: /Toggle app theme/ }))
    expect(onToggleTheme).toHaveBeenCalledOnce()
    fireEvent.keyDown(canvas, { key: '?', code: 'Slash', shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Drawing shortcuts' })).toHaveTextContent('Toggle app theme')
    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }))
    fireEvent.keyDown(canvas, { key: 'Delete', code: 'Delete', ctrlKey: true })
    expect(onRequestClear).toHaveBeenCalledOnce()
    fireEvent.keyDown(canvas, { key: 'Backspace', code: 'Backspace', ctrlKey: true })
    expect(onRequestClear).toHaveBeenCalledOnce()
    fireEvent.keyDown(canvas, { key: 'Backspace', code: 'Backspace', metaKey: true })
    expect(onRequestClear).toHaveBeenCalledTimes(2)
  })

  it('keeps native clipboard events in dialogs from editing the selection', () => {
    const { canvas, select, onChange, scene } = setup()
    select()
    fireEvent.keyDown(canvas, { key: '/', code: 'Slash', altKey: true })
    const dialog = screen.getByRole('dialog', { name: 'Drawing statistics' })
    const clipboardData = { setData: vi.fn(), getData: vi.fn(() => '') }
    fireEvent.cut(dialog, { clipboardData })
    fireEvent.paste(dialog, { clipboardData })
    expect(clipboardData.setData).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(scene().elements[0]).not.toHaveProperty('isDeleted', true)
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    fireEvent.cut(canvas, { clipboardData })
    expect(onChange).toHaveBeenCalledOnce()
    expect(scene().elements[0]).toHaveProperty('isDeleted', true)
  })

  it('view mode blocks editing and undo while allowing search and exit', () => {
    const { canvas, surface, select, onChange } = setup()
    select()
    fireEvent.keyDown(canvas, { key: 'r', code: 'KeyR', altKey: true })
    expect(screen.getByText(/View mode/)).toBeInTheDocument()
    fireEvent.keyDown(canvas, { key: 'Delete', code: 'Delete' })
    fireEvent.keyDown(canvas, { key: 'z', code: 'KeyZ', ctrlKey: true })
    fireEvent.pointerDown(surface, { clientX: 140, clientY: 140, button: 0, pointerId: 1 })
    fireEvent.pointerUp(surface, { clientX: 160, clientY: 160, button: 0, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(canvas, { key: 'f', code: 'KeyF', ctrlKey: true })
    const input = screen.getByRole('textbox', { name: 'Search drawing' })
    expect(input).toBeInTheDocument()
    expect(fireEvent.cut(input)).toBe(true)
    expect(fireEvent.paste(input)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    fireEvent.keyDown(canvas, { key: 'r', code: 'KeyR', altKey: true })
    expect(screen.queryByText(/View mode/)).not.toBeInTheDocument()
  })
})

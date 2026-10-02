import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ReactFlow from 'reactflow'
import TemplateGallery from '../components/TemplateGallery'

function space(target: HTMLElement, type: 'keydown' | 'keyup') {
  const event = new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true })
  fireEvent(target, event)
  return event
}

describe('Template gallery keyboard boundary', () => {
  it('preserves native Space activation inside the gallery while the actual canvas Space listener is active', () => {
    render(<>
      <button aria-label="Outside gallery control">Canvas tool</button>
      <ReactFlow nodes={[]} edges={[]} style={{ width: 600, height: 400 }} />
      <TemplateGallery isOpen onClose={vi.fn()} onSelect={vi.fn()} />
    </>)

    // Confirm the canvas listener is attached: without a modal boundary it
    // prevents Space's browser default even on a noneditable button.
    const outside = screen.getByRole('button', { name: 'Outside gallery control' })
    outside.focus()
    expect(space(outside, 'keydown').defaultPrevented).toBe(true)
    space(outside, 'keyup')

    const favorite = screen.getByRole('button', { name: 'Favorite The dream observatory template' })
    favorite.focus()
    expect(space(favorite, 'keydown').defaultPrevented).toBe(false)
    expect(space(favorite, 'keyup').defaultPrevented).toBe(false)
    expect(favorite).toHaveFocus()

    const close = screen.getByRole('button', { name: 'Close template gallery' })
    close.focus()
    expect(space(close, 'keydown').defaultPrevented).toBe(false)
    expect(space(close, 'keyup').defaultPrevented).toBe(false)
  })
})

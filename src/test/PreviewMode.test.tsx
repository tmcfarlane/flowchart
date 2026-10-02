import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PreviewMode from '../components/PreviewMode'

const nodes = [
  { id: 'first', type: 'step', position: { x: 0, y: 0 }, data: { label: 'First presentation step' } },
  { id: 'second', type: 'step', position: { x: 300, y: 0 }, data: { label: 'Second presentation step' } },
]

describe('Presentation controls', () => {
  it('focuses a labeled exit, keeps inactive nodes out of the tab order, and announces arrow navigation', () => {
    const onExit = vi.fn()
    const { container } = render(<PreviewMode nodes={nodes} edges={[]} darkMode onExit={onExit} />)
    expect(screen.getByRole('region', { name: 'Diagram presentation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exit presentation mode' })).toHaveFocus()
    expect(container.querySelector('.react-flow__node')).not.toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Previous presentation step' })).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Presentation progress' })).toHaveTextContent('1 / 2')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByRole('status', { name: 'Presentation progress' })).toHaveTextContent('2 / 2')
    expect(screen.getByRole('button', { name: 'Next presentation step' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('status', { name: 'Presentation progress' })).toHaveTextContent('1 / 2')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('preserves native Space activation on a focused exit while allowing Space navigation on the canvas', () => {
    const onExit = vi.fn()
    render(<PreviewMode nodes={nodes} edges={[]} darkMode={false} onExit={onExit} />)
    const exit = screen.getByRole('button', { name: 'Exit presentation mode' })
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    act(() => { exit.dispatchEvent(space) })
    expect(space.defaultPrevented).toBe(false)
    expect(screen.getByRole('status', { name: 'Presentation progress' })).toHaveTextContent('1 / 2')
    fireEvent.click(exit)
    expect(onExit).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('region', { name: 'Diagram presentation' }), { key: ' ' })
    expect(screen.getByRole('status', { name: 'Presentation progress' })).toHaveTextContent('2 / 2')
  })

})

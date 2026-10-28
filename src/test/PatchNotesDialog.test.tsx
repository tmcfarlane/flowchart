import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import PatchNotesDialog from '../components/PatchNotesDialog'

afterEach(() => vi.restoreAllMocks())

describe('patch notes dialog', () => {
  it('names the modal and shows the latest release with its date and highlights', () => {
    render(<PatchNotesDialog onDismiss={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: "What's new" })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('heading', { name: 'Draw with more clarity' })).toBeInTheDocument()
    expect(within(dialog).getByText('October 28, 2026')).toHaveAttribute('dateTime', '2026-10-28')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(4)
  })

  it.each(['Close patch notes', 'Got it', 'Escape', 'backdrop'])('dismisses through %s', (method) => {
    const dismiss = vi.fn()
    const { container } = render(<PatchNotesDialog onDismiss={dismiss} />)
    if (method === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    else if (method === 'backdrop') fireEvent.mouseDown(container.querySelector('.patch-notes-overlay')!)
    else fireEvent.click(screen.getByRole('button', { name: method }))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('keeps clicks within the card open', () => {
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Draw with more clarity' }))
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('focuses close, traps both Tab directions, and restores a connected opener', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const { unmount } = render(<PatchNotesDialog onDismiss={() => {}} />)
    const close = screen.getByRole('button', { name: 'Close patch notes' })
    const done = screen.getByRole('button', { name: 'Got it' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(done).toHaveFocus()
    fireEvent.keyDown(done, { key: 'Tab' })
    expect(close).toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it.each(['z', 'c', 'x', 'v', 'Delete', 'Escape'])('contains the %s keyboard event before editor shortcuts', (key) => {
    const background = vi.fn()
    window.addEventListener('keydown', background)
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key, ctrlKey: true })
    expect(background).not.toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalledTimes(key === 'Escape' ? 1 : 0)
    window.removeEventListener('keydown', background)
  })
})

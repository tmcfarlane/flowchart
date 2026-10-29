import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import PatchNotesDialog from '../components/PatchNotesDialog'
import { PATCH_NOTES } from '../patchNotes'
import { V3_SCREENSHOTS } from '../releaseScreenshots'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('patch notes dialog', () => {
  it('opens a native modal boundary and closes it before returning focus', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    const { unmount } = render(<PatchNotesDialog onDismiss={() => {}} />)
    expect(screen.getByRole('dialog', { name: "What's new" })).toBeInstanceOf(HTMLDialogElement)
    expect(showModal).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
    unmount()
    expect(close).toHaveBeenCalledOnce()
  })

  it('names the modal and shows the latest release with its date and highlights', () => {
    render(<PatchNotesDialog onDismiss={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: "What's new" })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(PATCH_NOTES.map(note => note.title))
    for (const note of PATCH_NOTES) {
      expect(dialog.querySelector(`time[datetime="${note.publishedOn}"]`)).toBeInTheDocument()
      for (const highlight of note.highlights) expect(within(dialog).getByText(highlight, { selector: 'li' })).toBeInTheDocument()
    }
    expect(within(dialog).getAllByText('Latest')).toHaveLength(1)
  })

  it.each(['Close patch notes', 'Got it', 'Escape', 'backdrop'])('dismisses through %s', (method) => {
    const dismiss = vi.fn()
    const { container } = render(<PatchNotesDialog onDismiss={dismiss} />)
    if (method === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    else if (method === 'backdrop') fireEvent.mouseDown(container.querySelector('.patch-notes-overlay')!)
    else fireEvent.click(screen.getByRole('button', { name: method }))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('shows captioned screenshots linked to full-size images without dismissing', () => {
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    const release = screen.getByRole('region', { name: 'Flowchart v3.0.0' })
    const links = within(release).getAllByRole('link')
    expect(links).toHaveLength(V3_SCREENSHOTS.length)
    expect(within(release).getByText('Select a screenshot to open the full-size image in a new tab.')).toBeInTheDocument()
    for (const [index, image] of V3_SCREENSHOTS.entries()) {
      const link = links[index]
      expect(link).toHaveAttribute('href', image.src)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAccessibleName(`Open full-size image: ${image.caption} (opens in a new tab)`)
      const screenshot = within(link).getByRole('img', { name: image.alt })
      expect(screenshot).toHaveAttribute('src', image.src)
      expect(screenshot).toHaveAttribute('width', String(image.width))
      expect(screenshot).toHaveAttribute('height', String(image.height))
      expect(screenshot).toHaveAttribute('loading', 'lazy')
      expect(screenshot).toHaveAttribute('decoding', 'async')
      expect(within(release).getByText(image.caption, { selector: 'figcaption' })).toBeInTheDocument()
      fireEvent.click(link)
    }
    expect(dismiss).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveAttribute('open')
  })

  it('keeps screenshot links between dismissal buttons in the keyboard order', () => {
    const background = vi.fn()
    window.addEventListener('keydown', background)
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    const controls = [...screen.getByRole('dialog').querySelectorAll('button, a[href]')]
    expect(controls).toEqual([
      screen.getByRole('button', { name: 'Close patch notes' }),
      ...screen.getAllByRole('link'),
      screen.getByRole('button', { name: 'Got it' }),
    ])
    for (const link of screen.getAllByRole('link')) {
      link.focus()
      expect(link).toHaveFocus()
      expect(fireEvent.keyDown(link, { key: 'Tab' })).toBe(true)
      expect(fireEvent.keyDown(link, { key: 'Tab', shiftKey: true })).toBe(true)
    }
    expect(dismiss).not.toHaveBeenCalled()
    expect(background).not.toHaveBeenCalled()
    window.removeEventListener('keydown', background)
  })

  it('keeps clicks within the card open', () => {
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    fireEvent.mouseDown(screen.getByRole('heading', { name: PATCH_NOTES[0].title }))
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('routes native cancellation through explicit dismissal', () => {
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(screen.getByRole('dialog'), cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('contains keyboard input and Tab navigation when the native modal itself has focus', () => {
    const background = vi.fn()
    window.addEventListener('keydown', background)
    const dismiss = vi.fn()
    render(<PatchNotesDialog onDismiss={dismiss} />)
    const dialog = screen.getByRole('dialog')
    dialog.tabIndex = -1
    dialog.focus()
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'z', ctrlKey: true })
    expect(background).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close patch notes' })).toHaveFocus()
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus()
    dialog.focus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dismiss).toHaveBeenCalledOnce()
    expect(background).not.toHaveBeenCalled()
    window.removeEventListener('keydown', background)
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

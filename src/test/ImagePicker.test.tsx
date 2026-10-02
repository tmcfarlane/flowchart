import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ImagePicker from '../components/ImagePicker'
import { getIconUrl } from '../utils/azureIconIds'

function callbacks() { return { isOpen: true, onClose: vi.fn(), onSelectImage: vi.fn() } }

describe('Image picker keyboard flow', () => {
  it('contains keyboard focus in the library and restores its opener on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<ImagePicker {...callbacks()} />)
    const dialog = screen.getByRole('dialog', { name: 'Add Image' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('textbox', { name: 'Search icon library' })).toHaveFocus()
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('link', { name: /Azure/ })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    opener.focus()
    expect(close).toHaveFocus()
    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('preserves Search focus across callback changes and applies the latest Close handler', () => {
    const original = callbacks()
    const view = render(<ImagePicker {...original} />)
    const search = screen.getByRole('textbox', { name: 'Search icon library' })
    fireEvent.change(search, { target: { value: 'moon' } })
    const nextClose = vi.fn()
    view.rerender(<ImagePicker {...original} onClose={nextClose} />)
    expect(search).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(nextClose).toHaveBeenCalledOnce()
    expect(original.onClose).not.toHaveBeenCalled()
  })

  it('focuses the preview label, returns to Search with Escape, and adds the chosen icon', () => {
    const props = callbacks()
    render(<ImagePicker {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search icon library' }), { target: { value: 'moon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Moon' }))
    expect(screen.getByRole('dialog', { name: 'Customize Icon' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('textbox', { name: 'Search icon library' })).toHaveFocus()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search icon library' }), { target: { value: 'moon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Moon' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Evening observatory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Flowchart' }))
    expect(props.onSelectImage).toHaveBeenCalledWith(getIconUrl('icon-moon'), 'Evening observatory')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('closes the category choices before the dialog and keeps upload keyboard accessible', () => {
    const props = callbacks()
    render(<ImagePicker {...props} />)
    const category = screen.getByRole('button', { name: 'Icon category' })
    fireEvent.click(category)
    expect(category).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(category).toHaveAttribute('aria-expanded', 'false')
    expect(category).toHaveFocus()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    const upload = screen.getByRole('button', { name: /Click to upload/ })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(fileInput, 'click')
    upload.focus()
    fireEvent.keyDown(upload, { key: 'Enter' })
    expect(click).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveAttribute('aria-pressed', 'true')
  })
})

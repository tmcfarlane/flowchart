import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExcalidrawImportDialog from '../components/ExcalidrawImportDialog'

afterEach(cleanup)
const scene = { version: 1 as const, elements: [{ id: 'drawing', type: 'rectangle' }], files: {} }

describe('Excalidraw import destination dialog', () => {
  it('isolates clipboard and history keys from the background canvas', () => {
    const background = vi.fn()
    window.addEventListener('keydown', background)
    try {
      render(<ExcalidrawImportDialog filename="drawing.excalidraw" scene={scene} onOpen={vi.fn()} onInsert={vi.fn()} onCancel={vi.fn()} />)
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'z', ctrlKey: true })
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'v', ctrlKey: true })
      expect(background).not.toHaveBeenCalled()
    } finally { window.removeEventListener('keydown', background) }
  })

  it('keeps keyboard focus within the dialog and cancels with Escape', () => {
    const cancel = vi.fn()
    render(<ExcalidrawImportDialog filename="drawing.excalidraw" scene={scene} onOpen={vi.fn()} onInsert={vi.fn()} onCancel={cancel} />)
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    const insertButton = screen.getByRole('button', { name: /Insert into current diagram/ })
    expect(cancelButton).toHaveFocus()
    fireEvent.keyDown(cancelButton, { key: 'Tab' })
    expect(insertButton).toHaveFocus()
    fireEvent.keyDown(insertButton, { key: 'Tab', shiftKey: true })
    expect(cancelButton).toHaveFocus()
    fireEvent.keyDown(cancelButton, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('leaves Cancel available while a drawing is being prepared', () => {
    render(<ExcalidrawImportDialog filename="drawing.excalidraw" scene={scene} onOpen={vi.fn()} onInsert={vi.fn()} onCancel={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: /Insert into current diagram/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Open as new diagram/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})

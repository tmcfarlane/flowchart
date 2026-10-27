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

  it('shows accessible Draw compatibility notes before either destination action', () => {
    const onOpen = vi.fn()
    const onInsert = vi.fn()
    const notes = [
      'Excalidraw fonts use local font fallbacks in Draw.',
      'Fixed elbow segments can move when you edit their path in Draw.',
    ]
    render(<ExcalidrawImportDialog filename="drawing.excalidraw" scene={scene} onOpen={onOpen} onInsert={onInsert} onCancel={vi.fn()} compatibilityNotes={notes} />)
    const note = screen.getByRole('note', { name: 'Draw compatibility' })
    expect(note).toHaveTextContent(notes[0])
    expect(note).toHaveTextContent(notes[1])
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const insert = screen.getByRole('button', { name: /Insert into current diagram/ })
    const open = screen.getByRole('button', { name: /Open as new diagram/ })
    expect(note.compareDocumentPosition(insert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
    expect(onInsert).not.toHaveBeenCalled()
    fireEvent.click(insert)
    expect(onInsert).toHaveBeenCalledOnce()
  })

  it('omits the compatibility note when there are no rendering differences', () => {
    render(<ExcalidrawImportDialog filename="drawing.excalidraw" scene={scene} onOpen={vi.fn()} onInsert={vi.fn()} onCancel={vi.fn()} compatibilityNotes={[]} />)
    expect(screen.queryByRole('note', { name: 'Draw compatibility' })).not.toBeInTheDocument()
    expect(screen.getByText(/stay editable in Draw mode/)).toBeInTheDocument()
  })

  it('leaves Cancel available while a drawing is being prepared', () => {
    render(<ExcalidrawImportDialog filename="drawing.excalidraw" scene={scene} onOpen={vi.fn()} onInsert={vi.fn()} onCancel={vi.fn()} busy />)
    expect(screen.getByRole('button', { name: /Insert into current diagram/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Open as new diagram/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})

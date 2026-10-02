import { describe, expect, it, vi } from 'vitest'
import { createRef, type ComponentProps } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Toolbar from '../components/Toolbar'

const props = (): ComponentProps<typeof Toolbar> => ({ onAddNode: vi.fn(), onAddContainer: vi.fn(), onAddImage: vi.fn(), onTogglePreview: vi.fn(), onToggleExplorer: vi.fn(), sidebarMode: 'none', onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false, onClearAll: vi.fn(), toolMode: 'select', onSetToolMode: vi.fn(), darkMode: true, onToggleDarkMode: vi.fn(), diagramMode: 'flowchart', onSetDiagramMode: vi.fn(), reactFlowWrapper: createRef<HTMLDivElement>(), nodes: [], edges: [], onImportJson: vi.fn() })

describe('Lazy image library', () => {
  it('allows keyboard cancellation while loading and never opens after a canceled import resolves', async () => {
    const callbacks = props()
    render(<Toolbar {...callbacks} />)
    const opener = screen.getByRole('button', { name: 'Add Image' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Opening the image library' })).toBeInTheDocument()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    await act(async () => { await import('../components/ImagePicker') })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(callbacks.onAddImage).not.toHaveBeenCalled()
    fireEvent.click(opener)
    await screen.findByRole('dialog', { name: 'Add Image' })
    expect(screen.getByRole('textbox', { name: 'Search icon library' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})

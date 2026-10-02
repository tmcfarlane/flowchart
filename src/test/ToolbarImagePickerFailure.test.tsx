import { describe, expect, it, vi } from 'vitest'
import { createRef, type ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Toolbar from '../components/Toolbar'

vi.mock('../components/ImagePicker', () => { throw new Error('Simulated image library download failure') })

describe('Image library download failure', () => {
  it('keeps the canvas tools available and gives the user a focused way to close the failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const callbacks: ComponentProps<typeof Toolbar> = { onAddNode: vi.fn(), onAddContainer: vi.fn(), onAddImage: vi.fn(), onTogglePreview: vi.fn(), onToggleExplorer: vi.fn(), sidebarMode: 'none', onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false, onClearAll: vi.fn(), toolMode: 'select', onSetToolMode: vi.fn(), darkMode: true, onToggleDarkMode: vi.fn(), diagramMode: 'flowchart', onSetDiagramMode: vi.fn(), reactFlowWrapper: createRef<HTMLDivElement>(), nodes: [], edges: [], onImportJson: vi.fn() }
    try {
      render(<Toolbar {...callbacks} />)
      const opener = screen.getByRole('button', { name: 'Add Image' })
      opener.focus()
      fireEvent.click(opener)
      await screen.findByRole('dialog', { name: 'Image library unavailable' })
      expect(screen.getByRole('alert')).toHaveTextContent('reload the page')
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Add Step Node' })).toBeInTheDocument()
      expect(callbacks.onAddImage).not.toHaveBeenCalled()
    } finally { consoleError.mockRestore() }
  })
})

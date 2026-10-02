import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRef, type ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Toolbar from '../components/Toolbar'

const props = (): ComponentProps<typeof Toolbar> => ({ onAddNode: vi.fn(), onAddContainer: vi.fn(), onAddImage: vi.fn(), onTogglePreview: vi.fn(), onToggleExplorer: vi.fn(), sidebarMode: 'none', onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false, onClearAll: vi.fn(), toolMode: 'select', onSetToolMode: vi.fn(), darkMode: true, onToggleDarkMode: vi.fn(), diagramMode: 'flowchart', onSetDiagramMode: vi.fn(), reactFlowWrapper: createRef<HTMLDivElement>(), nodes: [], edges: [], onImportJson: vi.fn() })
function readerContent(content: string) {
  vi.stubGlobal('FileReader', class {
    onload: ((event: { target: { result: string } }) => void) | null = null
    readAsText() { this.onload?.({ target: { result: content } }) }
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('Toolbar file import', () => {
  it('passes a validated chart with icon and protocol metadata to the App hydrator', () => {
    readerContent(JSON.stringify({ version: 2, mode: 'architecture', nodes: [{ id: 'api', type: 'service', position: { x: 0, y: 0 }, data: { label: 'Imported service', icon: 'icon-robot', onLabelChange: 'untrusted callback' } }, { id: 'db', type: 'database', position: { x: 240, y: 0 }, data: { label: 'Archive' } }], edges: [{ id: 'save', source: 'api', target: 'db', data: { protocol: 'SQL', commStyle: 'async' } }] }))
    const callbacks = props()
    render(<Toolbar {...callbacks} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [new File(['{}'], 'diagram.json', { type: 'application/json' })] } })
    expect(callbacks.onImportJson).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'api', data: expect.objectContaining({ label: 'Imported service', icon: 'icon-robot' }) })]), expect.arrayContaining([expect.objectContaining({ id: 'save', data: expect.objectContaining({ protocol: 'SQL', commStyle: 'async' }) })]), 'architecture')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports an invalid graph and never applies its partially valid nodes', () => {
    readerContent(JSON.stringify({ nodes: [{ id: 'api', position: 'not coordinates', data: { label: 'Broken import' } }], edges: [{ source: 'missing', target: 'api' }] }))
    const callbacks = props()
    render(<Toolbar {...callbacks} />)
    const exportButton = screen.getByRole('button', { name: 'Export' })
    exportButton.focus()
    fireEvent.click(exportButton)
    const importButton = screen.getByRole('button', { name: 'Import from JSON' })
    importButton.focus()
    fireEvent.click(importButton)
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [new File(['{}'], 'broken.json', { type: 'application/json' })] } })
    expect(callbacks.onImportJson).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('position with numeric x and y')
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()
    expect(importButton.isConnected).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(exportButton).toHaveFocus()
  })
})

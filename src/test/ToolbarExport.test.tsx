import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { GifExportMetadata } from '../utils/exportUtils'
import Toolbar from '../components/Toolbar'

const capture = vi.hoisted(() => ({ png: vi.fn(), svg: vi.fn(), gif: vi.fn(), json: vi.fn() }))
vi.mock('../utils/exportUtils', () => ({ exportToPng: capture.png, exportToSvg: capture.svg, exportToGif: capture.gif, exportToJson: capture.json }))
const props = (): ComponentProps<typeof Toolbar> => ({
  onAddNode: vi.fn(), onAddContainer: vi.fn(), onAddImage: vi.fn(), onTogglePreview: vi.fn(), onToggleExplorer: vi.fn(), sidebarMode: 'none',
  onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false, onClearAll: vi.fn(), toolMode: 'select', onSetToolMode: vi.fn(),
  darkMode: true, onToggleDarkMode: vi.fn(), diagramMode: 'architecture', onSetDiagramMode: vi.fn(), reactFlowWrapper: { current: document.createElement('div') },
  nodes: [{ id: 'visible', type: 'service', position: { x: 0, y: 0 }, data: { label: 'Visible node' } }, { id: 'far', type: 'database', position: { x: 5000, y: 3000 }, data: { label: 'Offscreen node' } }],
  edges: [{ id: 'link', source: 'visible', target: 'far' }], onImportJson: vi.fn(),
})
function open() {
  const callbacks = props()
  render(<Toolbar {...callbacks} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
  return callbacks
}
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
beforeEach(() => {
  capture.png.mockReset().mockResolvedValue(undefined)
  capture.svg.mockReset().mockResolvedValue(undefined)
  capture.gif.mockReset().mockResolvedValue(undefined)
  capture.json.mockReset()
})

describe('Toolbar image exports', () => {
  it.each([['PNG', capture.png], ['SVG', capture.svg]])('exports %s with all nodes and Entire diagram by default', async (format, exporter) => {
    const callbacks = open()
    expect(screen.getByRole('combobox', { name: 'Image export area' })).toHaveValue('diagram')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: `Export as ${format}` })))
    expect(exporter).toHaveBeenCalledWith(callbacks.reactFlowWrapper.current, true, { area: 'diagram', nodes: callbacks.nodes })
    expect(screen.queryByRole('combobox', { name: 'Image export area' })).not.toBeInTheDocument()
  })

  it('passes Current view to SVG while retaining full-graph JSON export', async () => {
    const callbacks = open()
    fireEvent.change(screen.getByRole('combobox', { name: 'Image export area' }), { target: { value: 'viewport' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' })))
    expect(capture.svg).toHaveBeenCalledWith(callbacks.reactFlowWrapper.current, true, { area: 'viewport', nodes: callbacks.nodes })
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(screen.getByRole('combobox', { name: 'Image export area' })).toHaveValue('viewport')
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }))
    expect(capture.json).toHaveBeenCalledWith(callbacks.nodes, callbacks.edges, 'architecture')
    expect(capture.json.mock.calls[0]).toHaveLength(3)
  })

  it('passes GIF duration and area, reports frame/encoding progress and disables export controls until completion', async () => {
    const pending = deferred()
    capture.gif.mockReturnValue(pending.promise)
    const callbacks = open()
    fireEvent.change(screen.getByRole('combobox', { name: 'Image export area' }), { target: { value: 'viewport' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'GIF duration in seconds' }), { target: { value: 3 } })
    fireEvent.click(screen.getByRole('button', { name: 'Record GIF' }))
    expect(capture.gif).toHaveBeenCalledWith(callbacks.reactFlowWrapper.current, true, 3, expect.any(Function), { area: 'viewport', nodes: callbacks.nodes })
    expect(screen.getByRole('combobox', { name: 'Image export area' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: 'GIF duration in seconds' })).toBeDisabled()
    for (const name of ['Export as PNG', 'Export as SVG', 'Export as JSON', 'Record GIF', 'Import from JSON']) expect(screen.getByRole('button', { name })).toBeDisabled()
    const progress = capture.gif.mock.calls[0][3] as (frame: number, total: number) => void
    act(() => progress(8, 30))
    expect(screen.getByRole('status')).toHaveTextContent('Capturing GIF… 8/30')
    act(() => progress(30, 30))
    expect(screen.getByRole('status')).toHaveTextContent('Encoding GIF')
    await act(async () => pending.resolve())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toHaveAttribute('aria-busy', 'false')
  })

  it('guards rapid duplicate activation and keeps an active export alive when its popover closes', async () => {
    const pending = deferred()
    capture.png.mockReturnValue(pending.promise)
    open()
    const png = screen.getByRole('button', { name: 'Export as PNG' })
    const svg = screen.getByRole('button', { name: 'Export as SVG' })
    act(() => { png.click(); svg.click(); png.click() })
    expect(capture.png).toHaveBeenCalledOnce()
    expect(capture.svg).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Exporting PNG')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('combobox', { name: 'Image export area' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Exporting PNG')
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(screen.getByRole('button', { name: 'Export as SVG' })).toBeDisabled()
    await act(async () => pending.resolve())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    expect(screen.getByRole('button', { name: 'Export as SVG' })).not.toBeDisabled()
  })

  it('shows actual reduced dimensions through capture, encoding and completion without exposing memory metrics', async () => {
    const pending = deferred()
    capture.gif.mockReturnValue(pending.promise)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Record GIF' }))
    const progress = capture.gif.mock.calls[0][3] as (frame: number, total: number, metadata?: GifExportMetadata) => void
    act(() => progress(1, 30, { pixelWidth: 997, pixelHeight: 560, resolutionAdjusted: true }))
    expect(screen.getByRole('status')).toHaveTextContent('997 × 560 px · Reduced resolution keeps the full animation.')
    act(() => progress(30, 30))
    expect(screen.getByRole('status')).toHaveTextContent('Encoding GIF…997 × 560 px')
    await act(async () => pending.resolve())
    expect(screen.getByRole('status')).toHaveTextContent('GIF exported at 997 × 560 px with reduced resolution. Duration and frame rate were kept.')
    expect(screen.getByRole('status')).not.toHaveTextContent(/MiB|bytes/)
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' })))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows full-resolution dimensions without a reduction notice and ignores late metadata from a completed job', async () => {
    const first = deferred(), second = deferred()
    capture.gif.mockReturnValue(first.promise)
    capture.png.mockReturnValue(second.promise)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Record GIF' }))
    const progress = capture.gif.mock.calls[0][3] as (frame: number, total: number, metadata?: GifExportMetadata) => void
    act(() => progress(1, 20, { pixelWidth: 800, pixelHeight: 600, resolutionAdjusted: false }))
    expect(screen.getByRole('status')).toHaveTextContent('800 × 600 px')
    expect(screen.getByRole('status')).not.toHaveTextContent('Reduced resolution')
    await act(async () => first.resolve())
    act(() => progress(20, 20, { pixelWidth: 500, pixelHeight: 300, resolutionAdjusted: true }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' }))
    act(() => progress(20, 20, { pixelWidth: 500, pixelHeight: 300, resolutionAdjusted: true }))
    expect(screen.getByRole('status')).toHaveTextContent('Exporting PNG')
    expect(screen.getByRole('status')).not.toHaveTextContent('500')
    await act(async () => second.resolve())
  })

  it('clears partial GIF metadata on capture failure and restores export-button focus when Escape closes the popover', async () => {
    const pending = deferred()
    capture.gif.mockReturnValue(pending.promise)
    open()
    screen.getByRole('spinbutton', { name: 'GIF duration in seconds' }).focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Record GIF' }))
    const progress = capture.gif.mock.calls[0][3] as (frame: number, total: number, metadata?: GifExportMetadata) => void
    act(() => progress(1, 30, { pixelWidth: 997, pixelHeight: 560, resolutionAdjusted: true }))
    await act(async () => pending.reject(new Error('A later frame failed.')))
    expect(screen.getByRole('dialog', { name: 'Export unavailable' })).toHaveTextContent('A later frame failed.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => progress(2, 30, { pixelWidth: 997, pixelHeight: 560, resolutionAdjusted: true }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toHaveFocus()
  })

  it('shows the actionable exporter error and permits a subsequent export after dismissal', async () => {
    const message = 'A generated image was deleted or is no longer available. Remove or replace it before exporting.'
    capture.png.mockRejectedValueOnce(new Error(message))
    open()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' })))
    expect(screen.getByRole('dialog', { name: 'Export unavailable' })).toHaveTextContent(message)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export as SVG' })))
    expect(capture.svg).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('restores Export button focus after successful GIF/JSON closure without stealing focus moved elsewhere', async () => {
    const first = deferred(), second = deferred()
    capture.gif.mockReturnValue(first.promise)
    capture.png.mockReturnValue(second.promise)
    open()
    screen.getByRole('button', { name: 'Record GIF' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Record GIF' }))
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Record GIF' })).toBeDisabled()
    await act(async () => first.resolve())
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    screen.getByRole('button', { name: 'Export as JSON' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }))
    expect(screen.getByRole('button', { name: 'Export', exact: true })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Export', exact: true }))
    screen.getByRole('button', { name: 'Export as PNG' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Export as PNG' }))
    screen.getByRole('button', { name: 'Hand Tool' }).focus()
    await act(async () => second.resolve())
    expect(screen.getByRole('button', { name: 'Hand Tool' })).toHaveFocus()
  })
})

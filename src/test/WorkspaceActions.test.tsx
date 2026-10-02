import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'

const layout = vi.hoisted(() => ({ arrange: vi.fn() }))
vi.mock('../shared/layout', () => ({ arrangeChart: layout.arrange }))
afterEach(() => { vi.unstubAllGlobals(); layout.arrange.mockReset(); sessionStorage.clear() })

describe('Workspace actions', () => {
  it('finds an existing node through the keyboard palette and selects it', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Note'))
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(screen.getByRole('combobox', { name: 'Find a node or action' }), { target: { value: 'Note' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('.react-flow__node-note')).toHaveClass('selected')
  })

  it('discards a layout result when the user changes the canvas during arrangement', async () => {
    let release!: (value: unknown) => void
    const pending = new Promise((resolve) => { release = resolve })
    layout.arrange.mockReturnValue(pending)
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    fireEvent.click(screen.getByRole('button', { name: 'Find nodes and actions' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'left to right' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(layout.arrange).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('Add Note'))
    await act(async () => { release({ nodes: [{ id: '2', type: 'step', label: 'Stale layout', position: { x: 10, y: 20 } }], edges: [] }); await pending })
    expect(screen.getByText('Your diagram changed while arranging it. Try again with the latest canvas.')).toBeInTheDocument()
    expect(screen.getByText('Step')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.queryByText('Stale layout')).not.toBeInTheDocument()
  })
})

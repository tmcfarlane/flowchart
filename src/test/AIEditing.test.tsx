import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import App from '../App'

function response(label: string, keepNote = false) {
  return { ok: true, json: async () => ({ message: JSON.stringify({ summary: label, nodes: [{ id: '2', type: 'step', label, position: { x: 10, y: 20 } }, ...(keepNote ? [{ id: '3', type: 'note', label: 'Note', position: { x: 250, y: 20 } }] : [])], edges: [] }), finishReason: 'stop' }) }
}
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

async function requestEdit(text: string) {
  fireEvent.click(screen.getByLabelText('Open diagram chat'))
  fireEvent.change(screen.getByLabelText('What would you like to change?'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }))
  await screen.findByText('Preview AI Proposal')
}

describe('Applying AI edits to the canvas', () => {
  it('previews a complete edit, applies it to existing ids, and sends refinement context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('Reviewed step'))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    await requestEdit('Rename this step')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).mode).toBe('refine')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).flowContext.nodes[0].label).toBe('Step')
    expect(screen.getByText('Step')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument())
    expect(screen.getByText('Reviewed step')).toBeInTheDocument()
    expect(screen.queryByText('Step')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(screen.getByText('Step')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Redo'))
    expect(screen.getByText('Reviewed step')).toBeInTheDocument()
  })

  it('rejects an edit when the canvas changes before Apply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('Old proposal')))
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    await requestEdit('Rename this step')
    fireEvent.click(screen.getByLabelText('Add Note'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(within(screen.getByRole('dialog', { name: 'Preview AI Proposal' })).getByRole('alert')).toHaveTextContent('Your canvas changed after this request')
    expect(screen.getByText('Step')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('ignores a cancelled deferred refinement after a newer proposal gets its own baseline', async () => {
    let release!: (value: ReturnType<typeof response>) => void
    const delayed = new Promise<ReturnType<typeof response>>((resolve) => { release = resolve })
    const fetchMock = vi.fn().mockResolvedValueOnce(response('Proposal A')).mockImplementationOnce(() => delayed).mockResolvedValueOnce(response('Proposal B', true))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    await requestEdit('First edit')
    fireEvent.change(screen.getByPlaceholderText('Describe how to refine this flowchart…'), { target: { value: 'An older refinement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByLabelText('Add Note'))
    await requestEdit('A newer edit')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages).not.toContainEqual({ role: 'user', content: 'An older refinement' })
    await act(async () => { release(response('Stale refinement A')); await delayed })
    expect(screen.queryByText('Stale refinement A')).not.toBeInTheDocument()
    expect(screen.getAllByText('Proposal B').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument())
    expect(screen.getByText('Proposal B')).toBeInTheDocument()
    expect(screen.queryByText('Stale refinement A')).not.toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })
})

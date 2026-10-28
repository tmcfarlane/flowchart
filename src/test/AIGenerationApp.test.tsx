import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { parseFlowJson, serializeFlow } from '../utils/exportUtils'
import type { DrawProposal } from '../shared/drawGeneration'
import type { ArchitectureScene } from '../shared/architectureScene'

vi.mock('../components/DrawCanvas', async () => import('./mocks/DrawCanvas'))

const draftKey = 'flowchart-editor-draft-v3'
const proposal: DrawProposal = {
  outputMode: 'draw', summary: 'Workshop sketch', elements: [
    { id: 'box', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, label: 'Plan', strokeColor: '#111827', backgroundColor: 'transparent' },
    { id: 'result', type: 'ellipse', x: 300, y: 0, width: 160, height: 80, label: 'Result', strokeColor: '#111827', backgroundColor: 'transparent' },
    { id: 'arrow', type: 'arrow', points: [{ x: 160, y: 40 }, { x: 300, y: 40 }], sourceId: 'box', targetId: 'result', label: '', strokeColor: '#111827' },
    { id: 'heading', type: 'text', x: 0, y: -80, text: 'Workshop title', fontSize: 24, strokeColor: '#111827' },
    { id: 'line', type: 'line', points: [{ x: 0, y: 150 }, { x: 460, y: 150 }], sourceId: null, targetId: null, label: '', strokeColor: '#111827' },
  ],
}
const retainedScene: ArchitectureScene = {
  version: 1,
  elements: [{ id: 'old-note', type: 'text', x: 20, y: 400, width: 180, height: 24, angle: 0, text: 'Keep this annotation', fontSize: 20, customData: { owner: 'user' } }],
  files: { asset: { id: 'asset', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=' } },
}
const fetchMock = vi.fn()
const response = (value: unknown) => ({ ok: true, json: async () => ({ message: JSON.stringify(value), finishReason: 'stop' }) })
const draft = () => parseFlowJson(localStorage.getItem(draftKey)!)

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function generateDrawing() {
  fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'draw' } })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sketch a workshop' } })
  fireEvent.click(screen.getByRole('button', { name: /Generate drawing/i }))
  await screen.findByText('Preview AI Proposal')
}

describe('AI proposal document transactions', () => {
  it('shares the target across prompt surfaces and defaults to the active board each time it opens', async () => {
    render(<App />)
    expect(screen.getByLabelText('Generate for')).toHaveValue('flowchart')
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(screen.getByLabelText('Generate for')).toHaveValue('architecture')
    fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'draw' } })
    expect(screen.getByLabelText('Architecture Mode')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('No, thank you'))
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    expect(screen.getByLabelText('Generate for')).toHaveValue('architecture')
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    expect(screen.getByLabelText('Generate for')).toHaveValue('draw')
  })

  it('previews native drawing objects, retains old content, and commits Draw plus insertion as one undo step', async () => {
    const nodes = [{ id: 'old-node', type: 'step', position: { x: 600, y: 400 }, data: { label: 'Existing graph' } }]
    localStorage.setItem(draftKey, serializeFlow(nodes, [], 'flowchart', retainedScene))
    fetchMock.mockResolvedValueOnce(response(proposal))
    const rendered = render(<App />)
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    await generateDrawing()
    expect(screen.getByText('Insert into Draw')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Draw proposal preview' }).querySelector('[data-element-id]')).toBeTruthy()
    expect(screen.getByLabelText('Flowchart Mode')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByText('Present'))
    expect(screen.getByRole('img', { name: 'Draw proposal preview' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Exit presentation'))
    fireEvent.click(screen.getByText('Insert into Canvas'))
    await screen.findByText('Workshop title')
    await waitFor(() => expect(draft().mode).toBe('draw'))
    const inserted = draft()
    expect(inserted.nodes.map(node => node.id)).toEqual(['old-node'])
    expect(inserted.architectureScene?.files).toEqual(retainedScene.files)
    expect(inserted.architectureScene?.elements.find(element => element.id === 'old-note')).toEqual(retainedScene.elements[0])
    const additions = inserted.architectureScene!.elements.filter(element => !('customData' in element))
    expect(additions.some(element => element.type === 'line')).toBe(true)
    expect(additions.find(element => element.text === 'Workshop title')?.containerId).toBeNull()
    const arrow = additions.find(element => element.type === 'arrow')!
    const boundId = (arrow.startBinding as { elementId: string }).elementId
    expect(additions.find(element => element.id === boundId)?.type).toBe('rectangle')
    fireEvent.click(screen.getByLabelText('Undo'))
    await waitFor(() => expect(screen.getByLabelText('Flowchart Mode')).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(draft().architectureScene).toEqual(retainedScene))
    fireEvent.click(screen.getByLabelText('Redo'))
    await waitFor(() => expect(draft().architectureScene).toEqual(inserted.architectureScene))
    rendered.unmount()
    render(<App />)
    await screen.findByText('Workshop title')
    expect(screen.getByLabelText('Draw Mode')).toHaveAttribute('aria-pressed', 'true')
  })

  it('refines using captured Draw target and exact previous DTO, retaining the instruction after failure and cancellation', async () => {
    fetchMock.mockResolvedValueOnce(response(proposal))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'Try again later' }) })
    render(<App />)
    await generateDrawing()
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    const input = screen.getByPlaceholderText(/Describe how to refine/)
    fireEvent.change(input, { target: { value: 'Add another stage' } })
    fireEvent.click(screen.getByText('Regenerate'))
    await screen.findByText('Try again later')
    expect(input).toHaveValue('Add another stage')
    const request = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(request).toEqual({ mode: 'refine', diagramMode: 'draw', messages: expect.any(Array), drawProposal: proposal })
    let complete!: (value: ReturnType<typeof response>) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    fireEvent.click(screen.getByText('Regenerate'))
    expect(screen.getByText('Present')).toBeDisabled()
    fireEvent.click(screen.getByText('Present'))
    expect(screen.queryByText('Exit presentation')).not.toBeInTheDocument()
    expect(input).toHaveValue('Add another stage')
    fireEvent.click(screen.getByText('Cancel refinement'))
    expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(true)
    await act(async () => { complete(response({ ...proposal, summary: 'Stale refinement' })) })
    expect(screen.queryByText('Stale refinement')).not.toBeInTheDocument()
    expect(input).toHaveValue('Add another stage')
    expect(screen.getByText('Insert into Draw')).toBeInTheDocument()
  })

  it('inserts a graph proposal from Draw while retaining the native scene and undoing the mode atomically', async () => {
    localStorage.setItem(draftKey, serializeFlow([], [], 'draw', retainedScene))
    fetchMock.mockResolvedValueOnce(response({ outputMode: 'architecture', summary: 'Services', nodes: [{ id: 'api', type: 'service', label: 'New API', position: { x: 0, y: 0 } }], edges: [] }))
    render(<App />)
    await screen.findByTestId('draw-canvas-adapter')
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'architecture' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add an API' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate architecture/i }))
    await screen.findByText('Preview AI Proposal')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ diagramMode: 'architecture', drawContext: { elements: [expect.objectContaining({ type: 'text', text: 'Keep this annotation' })] } })
    fireEvent.click(screen.getByText('Insert into Canvas'))
    await waitFor(() => expect(draft().mode).toBe('architecture'))
    expect(draft().architectureScene).toEqual(retainedScene)
    expect(draft().nodes).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Undo'))
    await waitFor(() => expect(draft().mode).toBe('draw'))
    expect(draft().nodes).toHaveLength(0)
    expect(draft().architectureScene).toEqual(retainedScene)
  })

  it.each(['node count', 'document bytes'] as const)('rejects graph insertion beyond the %s limit without changing the document or history', async (limit) => {
    const nodes = Array.from({ length: limit === 'node count' ? 500 : 440 }, (_, index) => ({
      id: `old-${index}`, type: 'step', position: { x: index * 10, y: 0 },
      data: { label: limit === 'node count' ? `Existing ${index}` : 'A'.repeat(500) },
    }))
    localStorage.setItem(draftKey, serializeFlow(nodes, [], 'flowchart'))
    fetchMock.mockResolvedValueOnce(response({ outputMode: 'architecture', summary: 'More services', nodes: Array.from({ length: limit === 'node count' ? 1 : 30 }, (_, index) => ({ id: `new-${index}`, type: 'service', label: 'B'.repeat(500), position: { x: index * 10, y: 0 } })), edges: [] }))
    render(<App />)
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    fireEvent.change(screen.getByLabelText('Generate for'), { target: { value: 'architecture' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'More services' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate architecture/i }))
    await screen.findByText('Preview AI Proposal')
    fireEvent.click(screen.getByText('Insert into Canvas'))
    expect(await screen.findByRole('alert')).toHaveTextContent(limit === 'node count' ? '500 node' : '256 KiB')
    expect(screen.getByLabelText('Flowchart Mode')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Undo')).toBeDisabled()
    expect(screen.getByText('Preview AI Proposal')).toBeInTheDocument()
    expect(draft().nodes).toHaveLength(nodes.length)
  })

  it('invalidates an in-flight refinement on document replacement', async () => {
    fetchMock.mockResolvedValueOnce(response(proposal))
    let complete!: (value: ReturnType<typeof response>) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    render(<App />)
    await generateDrawing()
    fireEvent.change(screen.getByPlaceholderText(/Describe how to refine/), { target: { value: 'Another stage' } })
    fireEvent.click(screen.getByText('Regenerate'))
    fireEvent.click(screen.getByLabelText('Clear All'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear board', exact: true }))
    await act(async () => { complete(response({ ...proposal, summary: 'Obsolete replacement' })) })
    expect(screen.queryByText('Preview AI Proposal')).not.toBeInTheDocument()
    expect(screen.queryByText('Obsolete replacement')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Edge, Node } from 'reactflow'
import App from '../App'
import { serializeFlow } from '../utils/exportUtils'

const DRAFT = 'flowchart-editor-draft-v3'
const originalFetch = global.fetch
const drawing = { version: 1 as const, elements: [{ id: 'sketch', type: 'text', x: -50, y: -50, width: 100, height: 24, angle: 0, text: 'Keep sketch' }], files: {} }
let fetchMock: ReturnType<typeof vi.fn>

function seed(mode: 'flowchart' | 'architecture' = 'flowchart', multiple = true) {
  const nodes: Node[] = [
    { id: 'a', type: mode === 'architecture' ? 'service' : 'step', position: { x: 0.123456, y: 0.987654 }, data: { label: 'Receive a customer order', custom: { retained: true } }, style: { width: 180.123456, height: 90.987654 }, selected: true },
    { id: 'b', type: mode === 'architecture' ? 'service' : 'step', position: { x: 350, y: 0 }, data: { label: 'Send an order receipt' }, style: { width: 180, height: 90 }, selected: multiple },
    { id: 'c', type: mode === 'architecture' ? 'database' : 'note', position: { x: 700, y: 180 }, data: { label: 'Unselected archive', untouched: 'metadata' }, selected: false },
  ]
  const edges: Edge[] = [{ id: 'ab', source: 'a', target: 'b', label: 'Confirmed', sourceHandle: 'right', targetHandle: 'left' }, { id: 'ac', source: 'a', target: 'c', label: 'Audit', sourceHandle: 'bottom', targetHandle: 'left' }]
  localStorage.setItem(DRAFT, serializeFlow(nodes, edges, mode, drawing))
  return { nodes, edges }
}
function response(operations: unknown[] = [
  { op: 'update_node', id: 'a', changes: { label: 'Receive order' } },
  { op: 'update_node', id: 'b', changes: { label: 'Send receipt' } },
]) {
  return { ok: true, json: async () => ({ role: 'assistant', finishReason: 'stop', message: JSON.stringify({ summary: 'Shorten the selected labels.', operations }) }) }
}
const canvasNode = (container: HTMLElement, id: string) => container.querySelector(`.react-flow-wrapper .react-flow__node[data-id="${id}"]`) as HTMLElement
async function prompt(text = 'Shorten these labels') {
  fireEvent.click(screen.getByRole('button', { name: 'Edit with AI', exact: true }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit with AI' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'What should change?' }), { target: { value: text } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes', exact: true }))
  return dialog
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  fetchMock = vi.fn(async () => response())
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks() })

describe('selected-node AI editing in the app', () => {
  it.each(['flowchart', 'architecture'] as const)('previews then atomically edits selected %s nodes in place with undo/redo and persistence', async mode => {
    seed(mode)
    const { container } = render(<App />)
    const dialog = await prompt()
    const apply = await within(dialog).findByRole('button', { name: 'Apply changes' })
    await waitFor(() => expect(apply).toBeEnabled())
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive a customer order')
    expect(canvasNode(container, 'b')).toHaveTextContent('Send an order receipt')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request).toMatchObject({ mode: 'edit', diagramMode: mode, selection: { nodeIds: ['a', 'b'], edgeIds: ['ab'], revision: expect.any(Number), snapshotId: expect.any(String) } })
    expect(request.flowContext.nodes.map((node: Node) => node.id)).toContain('c')
    fireEvent.click(apply)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit with AI' })).not.toBeInTheDocument())
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive order')
    expect(canvasNode(container, 'b')).toHaveTextContent('Send receipt')
    expect(canvasNode(container, 'c')).toHaveTextContent('Unselected archive')
    expect(container.querySelectorAll('.react-flow-wrapper .react-flow__node')).toHaveLength(3)
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(DRAFT) ?? '{}')
      expect(saved.nodes.find((node: Node) => node.id === 'a')).toMatchObject({ position: { x: 0.123456, y: 0.987654 }, style: { width: 180.123456, height: 90.987654 }, data: { label: 'Receive order', custom: { retained: true } } })
      expect(saved.nodes.find((node: Node) => node.id === 'c').data.untouched).toBe('metadata')
      expect(saved.architectureScene).toEqual(drawing)
    })
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive a customer order')
    expect(canvasNode(container, 'b')).toHaveTextContent('Send an order receipt')
    fireEvent.click(screen.getByLabelText('Redo'))
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive order')
    expect(canvasNode(container, 'b')).toHaveTextContent('Send receipt')
  })

  it.each(['flowchart', 'architecture'] as const)('supports a single selected %s node through the assistant entry point', async mode => {
    seed(mode, false)
    fetchMock.mockResolvedValueOnce(response([{ op: 'update_node', id: 'a', changes: { label: 'Receive order' } }]))
    const { container } = render(<App />)
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    fireEvent.click(screen.getByRole('button', { name: /Edit selected nodes/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit with AI' })
    expect(within(dialog).getByText('1 node')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Shorten this label' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes', exact: true }))
    const apply = await within(dialog).findByRole('button', { name: 'Apply changes' })
    await waitFor(() => expect(apply).toBeEnabled())
    fireEvent.click(apply)
    await waitFor(() => expect(canvasNode(container, 'a')).toHaveTextContent('Receive order'))
    expect(canvasNode(container, 'b')).toHaveTextContent('Send an order receipt')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).selection.nodeIds).toEqual(['a'])
  })

  it('requires deliberate inclusion of connections to unselected nodes', async () => {
    seed()
    fetchMock.mockResolvedValueOnce(response([{ op: 'remove_node', id: 'a' }]))
    const { container } = render(<App />)
    const dialog = await prompt('Remove the first selected node')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/connection outside the approved scope/i)
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive a customer order')
    expect(within(dialog).queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument()
    const boundary = within(dialog).getByRole('checkbox', { name: /Include 1 connection/ })
    expect(boundary).not.toBeChecked()
    fireEvent.click(boundary)
    fetchMock.mockResolvedValueOnce(response([{ op: 'remove_node', id: 'a' }]))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes', exact: true }))
    const apply = await within(dialog).findByRole('button', { name: 'Apply changes' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).selection.edgeIds).toEqual(['ab', 'ac'])
    expect(within(dialog).getAllByText('Audit').length).toBeGreaterThan(0)
    fireEvent.click(boundary)
    expect(apply).toBeDisabled()
    expect(within(dialog).getByRole('status')).toHaveTextContent(/connection scope changed/i)
    fireEvent.click(boundary)
    fireEvent.click(apply)
    await waitFor(() => expect(canvasNode(container, 'a')).toBeNull())
    expect(canvasNode(container, 'c')).toHaveTextContent('Unselected archive')
  })

  it('cancel during generation ignores a late response and leaves the graph unchanged', async () => {
    seed()
    let resolve!: (value: ReturnType<typeof response>) => void
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { container } = render(<App />)
    const dialog = await prompt()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await act(async () => resolve(response()))
    expect(screen.queryByRole('dialog', { name: 'Edit with AI' })).not.toBeInTheDocument()
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive a customer order')
    expect(canvasNode(container, 'b')).toHaveTextContent('Send an order receipt')
  })

  it('rejects a proposal when the selected content changes during generation', async () => {
    seed()
    let resolve!: (value: ReturnType<typeof response>) => void
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { container } = render(<App />)
    fireEvent.click(screen.getByLabelText('Toggle Explorer'))
    const input = screen.getAllByPlaceholderText('Node name').find(node => (node as HTMLInputElement).value === 'Receive a customer order')!
    const dialog = await prompt()
    fireEvent.change(input, { target: { value: 'My latest local edit' } })
    await act(async () => resolve(response()))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/changed while AI was working/i)
    expect(within(dialog).queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument()
    expect(canvasNode(container, 'a')).toHaveTextContent('My latest local edit')
  })

  it('keeps the submitted target IDs when the canvas selection changes during generation', async () => {
    seed()
    let resolve!: (value: ReturnType<typeof response>) => void
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { container } = render(<App />)
    const dialog = await prompt()
    fireEvent.keyDown(canvasNode(container, 'c'), { key: 'Enter' })
    expect(canvasNode(container, 'c')).toHaveClass('selected')
    await act(async () => resolve(response()))
    const apply = await within(dialog).findByRole('button', { name: 'Apply changes' })
    await waitFor(() => expect(apply).toBeEnabled())
    fireEvent.click(apply)
    await waitFor(() => expect(canvasNode(container, 'a')).toHaveTextContent('Receive order'))
    expect(canvasNode(container, 'b')).toHaveTextContent('Send receipt')
    expect(canvasNode(container, 'c')).toHaveTextContent('Unselected archive')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).selection.nodeIds).toEqual(['a', 'b'])
  })

  it('disables an already previewed proposal after affected content changes', async () => {
    seed()
    const { container } = render(<App />)
    fireEvent.click(screen.getByLabelText('Toggle Explorer'))
    const input = screen.getAllByPlaceholderText('Node name').find(node => (node as HTMLInputElement).value === 'Receive a customer order')!
    const dialog = await prompt()
    const apply = await within(dialog).findByRole('button', { name: 'Apply changes' })
    await waitFor(() => expect(apply).toBeEnabled())
    fireEvent.change(input, { target: { value: 'Edited after preview' } })
    expect(apply).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Regenerate the preview/i)
    expect(canvasNode(container, 'a')).toHaveTextContent('Edited after preview')
  })

  it('rejects invalid/out-of-scope responses without showing an applyable proposal', async () => {
    seed()
    fetchMock.mockResolvedValueOnce(response([{ op: 'update_node', id: 'c', changes: { label: 'Forbidden rename' } }]))
    const { container } = render(<App />)
    const dialog = await prompt()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/outside the captured selection/i)
    expect(within(dialog).queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument()
    expect(canvasNode(container, 'c')).toHaveTextContent('Unselected archive')
  })

  it('keeps no-op responses non-applicable and supports canceling a reviewed preview', async () => {
    seed()
    fetchMock.mockResolvedValueOnce(response([]))
    const { container } = render(<App />)
    const dialog = await prompt()
    expect(await within(dialog).findByRole('button', { name: 'Apply changes' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive a customer order')
    expect(container.querySelectorAll('.react-flow-wrapper .react-flow__node')).toHaveLength(3)
  })

  it('shows server failures without changing the diagram', async () => {
    seed()
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'AI is temporarily unavailable.' }) })
    const { container } = render(<App />)
    const dialog = await prompt()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('AI is temporarily unavailable.')
    expect(canvasNode(container, 'a')).toHaveTextContent('Receive a customer order')
    expect(within(dialog).queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument()
  })

  it('does not offer an unrestricted edit for an empty selection', () => {
    const fixture = seed()
    localStorage.setItem(DRAFT, serializeFlow(fixture.nodes.map(node => ({ ...node, selected: false })), fixture.edges, 'flowchart'))
    render(<App />)
    expect(screen.queryByRole('button', { name: 'Edit with AI', exact: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    expect(screen.getByRole('button', { name: /Edit selected nodes/ })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('synchronizes an applied edit through the existing shared-chart save with its base version', async () => {
    const fixture = seed('architecture', false)
    const chart = {
      id: 'Ab3dE5fG7h', version: 3, title: 'Shared order system', mode: 'architecture', architectureScene: drawing,
      nodes: fixture.nodes.map(node => ({ id: node.id, type: node.type, label: node.data.label, position: node.position, width: 180, height: 90 })),
      edges: fixture.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, style: 'default' })),
      createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
    }
    localStorage.clear()
    window.history.replaceState(null, '', '/f/Ab3dE5fG7h#edit=test-edit-token-1234567890')
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/chat') return response([{ op: 'update_node', id: 'a', changes: { label: 'Receive order' } }])
      if (init.method === 'PUT') return { ok: true, status: 200, json: async () => ({ ...chart, ...JSON.parse(String(init.body)), version: 4 }) }
      return { ok: true, status: 200, json: async () => chart }
    })
    const { container } = render(<App />)
    await screen.findByText('Receive a customer order')
    fireEvent.keyDown(canvasNode(container, 'a'), { key: 'Enter' })
    const dialog = await prompt('Shorten the service name')
    const apply = await within(dialog).findByRole('button', { name: 'Apply changes' })
    await waitFor(() => expect(apply).toBeEnabled())
    fireEvent.click(apply)
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true), { timeout: 3000 })
    const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    const body = JSON.parse(init.body)
    expect(body.baseVersion).toBe(3)
    expect(body.mode).toBe('architecture')
    expect(body.architectureScene).toEqual(drawing)
    expect(body.nodes.find((node: { id: string }) => node.id === 'a').label).toBe('Receive order')
    expect(body.nodes.find((node: { id: string }) => node.id === 'c').label).toBe('Unselected archive')
    expect(body.nodes).toHaveLength(3)
  })
})

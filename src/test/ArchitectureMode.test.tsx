import { seedReturningVisitor } from './helpers/returningVisitor'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App'
import { serializeFlow, parseFlowJson } from '../utils/exportUtils'
import type { Node as FlowNode, Edge } from 'reactflow'

vi.mock('../components/DrawCanvas', async () => import('./mocks/DrawCanvas'))

beforeEach(() => {
  localStorage.clear()
  seedReturningVisitor()
  window.history.replaceState(null, '', '/')
})

describe('Architecture Mode', () => {
  it('shows the mode switcher with Flowchart active by default', () => {
    render(<App />)
    const flowchartButton = screen.getByLabelText('Flowchart Mode')
    const architectureButton = screen.getByLabelText('Architecture Mode')
    const drawButton = screen.getByLabelText('Draw Mode')
    expect(flowchartButton).toBeInTheDocument()
    expect(architectureButton).toBeInTheDocument()
    expect(drawButton).toBeInTheDocument()
    expect(flowchartButton).toHaveAttribute('aria-pressed', 'true')
    expect(architectureButton).toHaveAttribute('aria-pressed', 'false')
    expect(drawButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the flowchart palette by default without architecture buttons', () => {
    render(<App />)
    expect(screen.getByLabelText('Add Step Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Decision Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Note')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add Service Node')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add Database Node')).not.toBeInTheDocument()
  })

  it('swaps to the architecture palette when switching modes', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))

    expect(screen.getByLabelText('Architecture Mode')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Add Service Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Database Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Queue Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add Cache Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add API Gateway Node')).toBeInTheDocument()
    expect(screen.getByLabelText('Add External Actor Node')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add Step Node')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add Decision Node')).not.toBeInTheDocument()
  })

  it('switches back to the flowchart palette', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(screen.getByLabelText('Add Service Node')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Flowchart Mode'))
    expect(screen.getByLabelText('Add Step Node')).toBeInTheDocument()
    expect(screen.queryByLabelText('Add Service Node')).not.toBeInTheDocument()
  })

  it('uses React Flow for Architecture and the separate drawing editor only for Draw', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(container.querySelector('.react-flow')).toBeInTheDocument()
    expect(screen.queryByTestId('draw-canvas-adapter')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Draw Mode'))
    expect(await screen.findByTestId('draw-canvas-adapter')).toBeInTheDocument()
    expect(container.querySelector('.react-flow')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(container.querySelector('.react-flow')).toBeInTheDocument()
    expect(screen.queryByTestId('draw-canvas-adapter')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Add Service Node')).toBeInTheDocument()
  })

  it('adds each architecture node type to the existing React Flow canvas', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))

    fireEvent.click(screen.getByLabelText('Add Service Node'))
    expect(await screen.findByText('Service')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Add Database Node'))
    expect(screen.getByText('Database')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Add Queue Node'))
    expect(screen.getByText('Queue')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Add Cache Node'))
    expect(screen.getByText('Cache')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Add API Gateway Node'))
    expect(screen.getByText('API Gateway')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Add External Actor Node'))
    expect(screen.getByText('External Actor')).toBeInTheDocument()
  })

  it('keeps architecture nodes on the canvas when switching back to flowchart mode', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    expect(await screen.findByText('Service')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Flowchart Mode'))
    expect(screen.getByText('Service')).toBeInTheDocument()

    // Flowchart nodes can be added alongside them
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    expect(screen.getByText('Step')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
  })

  it('keeps drawing label edits when returning to the Architecture canvas', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    await screen.findByText('Service')
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    await screen.findByTestId('draw-canvas-adapter')
    fireEvent.change(screen.getByLabelText('Drawing label 2'), { target: { value: 'Orders API' } })
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(screen.getByText('Orders API')).toBeInTheDocument()
  })

  it('autosaves scene-only edits and restores them after reload', async () => {
    const first = render(<App />)
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    fireEvent.click(await screen.findByText('Add drawing annotation'))
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('flowchart-editor-draft-v3') ?? '{}')
      expect(saved.architectureScene?.elements[0]).toMatchObject({ text: 'Drawing annotation', x: -120, angle: 0.2 })
    })
    first.unmount()
    render(<App />)
    expect(await screen.findByText('Drawing annotation')).toBeInTheDocument()
    expect(screen.getByLabelText('Draw Mode')).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses the document Undo/Redo stack for a committed drawing edit', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    fireEvent.click(await screen.findByText('Add drawing annotation'))
    expect(screen.getByText('Drawing annotation')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Undo'))
    expect(screen.queryByText('Drawing annotation')).not.toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Redo'))
    expect(await screen.findByText('Drawing annotation')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(screen.getByText('Service')).toBeInTheDocument()
  })

  it('retains a drawing while explicitly saving and reopening Architecture mode', async () => {
    const first = render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    fireEvent.click(await screen.findByText('Add drawing annotation'))
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('flowchart-editor-draft-v3') ?? '{}')
      expect(saved.mode).toBe('architecture')
      expect(saved.architectureScene.elements[0].text).toBe('Drawing annotation')
    })
    first.unmount()

    const reloaded = render(<App />)
    expect(screen.getByLabelText('Architecture Mode')).toHaveAttribute('aria-pressed', 'true')
    expect(reloaded.container.querySelector('.react-flow')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.queryByTestId('draw-canvas-adapter')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    expect(await screen.findByText('Drawing annotation')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Flowchart Mode'))
    expect(screen.getByText('Service')).toBeInTheDocument()
  })

  it('allocates fresh semantic IDs after restoring a saved local diagram', async () => {
    localStorage.setItem('flowchart-editor-draft-v3', JSON.stringify({ version: 2, mode: 'architecture', nodes: [{ id: '2', type: 'service', position: { x: 0, y: 0 }, data: { label: 'Saved service' } }], edges: [] }))
    const { container } = render(<App />)
    await screen.findByText('Saved service')
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    expect(container.querySelector('.react-flow__node[data-id="2"]')).toHaveTextContent('Saved service')
    expect(container.querySelector('.react-flow__node[data-id="3"]')).toHaveTextContent('Service')
  })

  it('rehydrates editable edge callbacks when restoring a local diagram', async () => {
    localStorage.setItem('flowchart-editor-draft-v3', JSON.stringify({ version: 4, mode: 'draw', nodes: [{ id: '2', type: 'service', position: { x: 0, y: 0 }, data: { label: 'API' } }, { id: '3', type: 'database', position: { x: 300, y: 0 }, data: { label: 'Database' } }], edges: [{ id: 'request', source: '2', target: '3', label: 'Before reload', type: 'default', data: {} }] }))
    render(<App />)
    const input = await screen.findByLabelText('Restored edge label request')
    fireEvent.change(input, { target: { value: 'After reload edit' } })
    expect(input).toHaveValue('After reload edit')
  })

  it('undoes and redoes a Draw JSON import across the diagram mode boundary', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    fireEvent.click(screen.getByLabelText('Export'))
    const file = new File([JSON.stringify({ version: 4, mode: 'draw', nodes: [], edges: [], architectureScene: { version: 1, elements: [{ id: 'annotation', type: 'text', text: 'Imported drawing', x: 0, y: 0, width: 160, height: 24, angle: 0 }], files: {} } })], 'architecture.json', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Import JSON or Excalidraw file'), { target: { files: [file] } })
    await screen.findByText('Imported drawing')
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(screen.getByLabelText('Flowchart Mode')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Step')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Redo'))
    expect(await screen.findByText('Imported drawing')).toBeInTheDocument()
    expect(screen.getByLabelText('Draw Mode')).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not apply graph clipboard commands to the Draw canvas selection', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    await screen.findByText('Service')
    fireEvent.click(screen.getByLabelText('Draw Mode'))
    await screen.findByTestId('draw-canvas-adapter')
    fireEvent.click(screen.getByLabelText('Select drawing node 2'))
    fireEvent.keyDown(screen.getByTestId('draw-canvas-adapter'), { key: 'x', ctrlKey: true })
    expect(screen.getByText('Service')).toBeInTheDocument()
  })
})

describe('Versioned flow document (export/import)', () => {
  const nodes: FlowNode[] = [
    { id: '1', type: 'service', position: { x: 0, y: 0 }, data: { label: 'API' } },
  ]
  const edges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', data: { protocol: 'gRPC', commStyle: 'async' } },
  ]

  it('serializes with version and mode while keeping nodes/edges shape', () => {
    const parsed = JSON.parse(serializeFlow(nodes, edges, 'architecture'))
    expect(parsed.version).toBe(2)
    expect(parsed.mode).toBe('architecture')
    expect(parsed.nodes).toHaveLength(1)
    expect(parsed.nodes[0].id).toBe('1')
    expect(parsed.edges[0].data.protocol).toBe('gRPC')
    expect(parsed.edges[0].data.commStyle).toBe('async')
  })

  it('defaults serialization to flowchart mode', () => {
    const parsed = JSON.parse(serializeFlow(nodes, edges))
    expect(parsed.mode).toBe('flowchart')
  })

  it('imports a legacy file without mode as flowchart', () => {
    const legacy = JSON.stringify({
      nodes: [{ id: '1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'A' } }],
      edges: [],
    })
    const result = parseFlowJson(legacy)
    expect(result.mode).toBe('flowchart')
    expect(result.nodes).toHaveLength(1)
  })

  it('round-trips an architecture document including edge protocol data', () => {
    const result = parseFlowJson(serializeFlow(nodes, edges, 'architecture'))
    expect(result.mode).toBe('architecture')
    expect(result.nodes[0].type).toBe('service')
    expect(result.edges[0].data.protocol).toBe('gRPC')
    expect(result.edges[0].data.commStyle).toBe('async')
  })

  it('treats an unknown mode value as flowchart', () => {
    const weird = JSON.stringify({ mode: 'mindmap', nodes: [], edges: [] })
    expect(parseFlowJson(weird).mode).toBe('flowchart')
  })
})

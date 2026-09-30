import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App'
import { serializeFlow, parseFlowJson } from '../utils/exportUtils'
import type { Node as FlowNode, Edge } from 'reactflow'

describe('Architecture Mode', () => {
  it('shows the mode switcher with Flowchart active by default', () => {
    render(<App />)
    const flowchartButton = screen.getByLabelText('Flowchart Mode')
    const architectureButton = screen.getByLabelText('Architecture Mode')
    expect(flowchartButton).toBeInTheDocument()
    expect(architectureButton).toBeInTheDocument()
    expect(flowchartButton).toHaveAttribute('aria-pressed', 'true')
    expect(architectureButton).toHaveAttribute('aria-pressed', 'false')
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

  it('adds each architecture node type to the canvas', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))

    fireEvent.click(screen.getByLabelText('Add Service Node'))
    expect(screen.getByText('Service')).toBeInTheDocument()

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

  it('keeps architecture nodes on the canvas when switching back to flowchart mode', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))
    expect(screen.getByText('Service')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Flowchart Mode'))
    expect(screen.getByText('Service')).toBeInTheDocument()

    // Flowchart nodes can be added alongside them
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    expect(screen.getByText('Step')).toBeInTheDocument()
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

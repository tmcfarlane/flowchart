import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App'
import { sortParentsFirst, getAbsolutePosition, remapPastedNodes } from '../utils/nesting'
import { serializeFlow, parseFlowJson } from '../utils/exportUtils'
import type { Node as FlowNode, Edge } from 'reactflow'

describe('Containers UI', () => {
  it('shows Add Container only in the architecture palette', () => {
    render(<App />)
    expect(screen.queryByLabelText('Add Container')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    expect(screen.getByLabelText('Add Container')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Flowchart Mode'))
    expect(screen.queryByLabelText('Add Container')).not.toBeInTheDocument()
  })

  it('adds a container with its default label and kind badge', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Container'))

    expect(screen.getByText('Container')).toBeInTheDocument()
    expect(screen.getByText('Group')).toBeInTheDocument()
  })

  it('renders containers alongside architecture nodes', () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Architecture Mode'))
    fireEvent.click(screen.getByLabelText('Add Container'))
    fireEvent.click(screen.getByLabelText('Add Service Node'))

    expect(screen.getByText('Container')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
  })
})

describe('sortParentsFirst', () => {
  it('moves parents before their children', () => {
    const nodes = [
      { id: 'child', parentNode: 'parent' },
      { id: 'parent' },
    ]
    const sorted = sortParentsFirst(nodes)
    expect(sorted.map((n) => n.id)).toEqual(['parent', 'child'])
  })

  it('handles nested chains and preserves order otherwise', () => {
    const nodes = [
      { id: 'grandchild', parentNode: 'child' },
      { id: 'a' },
      { id: 'child', parentNode: 'parent' },
      { id: 'b' },
      { id: 'parent' },
    ]
    const sorted = sortParentsFirst(nodes).map((n) => n.id)
    expect(sorted.indexOf('parent')).toBeLessThan(sorted.indexOf('child'))
    expect(sorted.indexOf('child')).toBeLessThan(sorted.indexOf('grandchild'))
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
    expect(sorted).toHaveLength(5)
  })

  it('keeps an already-valid ordering unchanged', () => {
    const nodes = [
      { id: 'parent' },
      { id: 'child', parentNode: 'parent' },
      { id: 'x' },
    ]
    expect(sortParentsFirst(nodes).map((n) => n.id)).toEqual(['parent', 'child', 'x'])
  })

  it('tolerates missing parents and cycles without dropping nodes', () => {
    const nodes = [
      { id: 'orphan', parentNode: 'ghost' },
      { id: 'a', parentNode: 'b' },
      { id: 'b', parentNode: 'a' },
    ]
    const sorted = sortParentsFirst(nodes)
    expect(sorted).toHaveLength(3)
    expect(sorted.map((n) => n.id).sort()).toEqual(['a', 'b', 'orphan'])
  })
})

describe('getAbsolutePosition', () => {
  const nodes = [
    { id: 'outer', position: { x: 100, y: 50 } },
    { id: 'inner', parentNode: 'outer', position: { x: 20, y: 30 } },
    { id: 'leaf', parentNode: 'inner', position: { x: 5, y: 5 } },
  ]

  it('returns top-level positions unchanged', () => {
    expect(getAbsolutePosition(nodes[0], nodes)).toEqual({ x: 100, y: 50 })
  })

  it('resolves nested chains by summing parent offsets', () => {
    expect(getAbsolutePosition(nodes[1], nodes)).toEqual({ x: 120, y: 80 })
    expect(getAbsolutePosition(nodes[2], nodes)).toEqual({ x: 125, y: 85 })
  })

  it('tolerates a missing parent', () => {
    const orphan = { id: 'o', parentNode: 'ghost', position: { x: 7, y: 8 } }
    expect(getAbsolutePosition(orphan, [orphan])).toEqual({ x: 7, y: 8 })
  })
})

describe('remapPastedNodes (paste id hardening)', () => {
  it('derives ids by enumeration, never by parsing existing ids', () => {
    const clipboardNodes = [
      { id: 'svc-api', type: 'service', position: { x: 0, y: 0 }, data: {} },
      { id: 'not a number!', type: 'database', position: { x: 10, y: 10 }, data: {} },
    ] as FlowNode[]
    const { nodes, nextCounter } = remapPastedNodes(clipboardNodes, [], 7)

    expect(nodes.map((n) => n.id)).toEqual(['7', '8'])
    expect(nodes.every((n) => !Number.isNaN(Number(n.id)))).toBe(true)
    expect(nextCounter).toBe(9)
  })

  it('remaps parentNode references within the clipboard', () => {
    const clipboardNodes = [
      { id: 'box', type: 'container', position: { x: 0, y: 0 }, data: {} },
      { id: 'svc', type: 'service', parentNode: 'box', extent: 'parent', position: { x: 30, y: 60 }, data: {} },
    ] as FlowNode[]
    const { nodes } = remapPastedNodes(clipboardNodes, [], 10)

    expect(nodes[0].id).toBe('10')
    expect(nodes[1].parentNode).toBe('10')
    expect(nodes[1].extent).toBe('parent')
    expect(nodes[1].position).toEqual({ x: 30, y: 60 })
  })

  it('drops a parentNode pointing outside the clipboard', () => {
    const clipboardNodes = [
      { id: 'svc', type: 'service', parentNode: 'missing', extent: 'parent', position: { x: 1, y: 2 }, data: {} },
    ] as FlowNode[]
    const { nodes } = remapPastedNodes(clipboardNodes, [], 3)

    expect(nodes[0].parentNode).toBeUndefined()
    expect(nodes[0].extent).toBeUndefined()
  })

  it('remaps edges and filters dangling ones', () => {
    const clipboardNodes = [
      { id: 'a', type: 'service', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'database', position: { x: 0, y: 100 }, data: {} },
    ] as FlowNode[]
    const clipboardEdges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'not-copied' },
    ] as Edge[]
    const { edges } = remapPastedNodes(clipboardNodes, clipboardEdges, 5)

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ id: 'e5-6', source: '5', target: '6', selected: false })
  })

  it('preserves arbitrary imported ids without inherited object keys', () => {
    const clipboardNodes = [
      { id: '__proto__', type: 'container', position: { x: 0, y: 0 }, data: {} },
      { id: 'constructor', type: 'service', parentNode: '__proto__', extent: 'parent', position: { x: 30, y: 60 }, data: {} },
    ] as FlowNode[]
    const clipboardEdges = [
      { id: 'inside', source: '__proto__', target: 'constructor' },
      { id: 'outside', source: 'constructor', target: 'toString' },
    ] as Edge[]
    const pasted = remapPastedNodes(clipboardNodes, clipboardEdges, 10)
    expect(pasted.nodes.map(node => node.id)).toEqual(['10', '11'])
    expect(pasted.nodes[1].parentNode).toBe('10')
    expect(pasted.edges).toEqual([expect.objectContaining({ id: 'e10-11', source: '10', target: '11' })])
  })

  it('keeps parallel connections distinct and preserves their semantics', () => {
    const clipboardNodes = [
      { id: 'a', type: 'service', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', type: 'database', position: { x: 300, y: 0 }, data: {} },
    ] as FlowNode[]
    const clipboardEdges = [
      { id: 'query', source: 'a', target: 'b', label: 'Query', sourceHandle: 'right', targetHandle: 'left', data: { protocol: 'SQL', commStyle: 'sync' } },
      { id: 'events', source: 'a', target: 'b', label: 'Events', animated: true, data: { protocol: 'event', commStyle: 'async' } },
    ] as Edge[]
    const { edges } = remapPastedNodes(clipboardNodes, clipboardEdges, 10)
    expect(new Set(edges.map(edge => edge.id)).size).toBe(2)
    expect(edges[0]).toMatchObject({ source: '10', target: '11', label: 'Query', sourceHandle: 'right', targetHandle: 'left', data: { protocol: 'SQL', commStyle: 'sync' } })
    expect(edges[1]).toMatchObject({ source: '10', target: '11', label: 'Events', animated: true, data: { protocol: 'event', commStyle: 'async' } })
  })
})

describe('Nesting export/import round-trip', () => {
  it('preserves parentNode, extent, and containerKind through serialize/parse', () => {
    const nodes = [
      {
        id: '1',
        type: 'container',
        position: { x: 0, y: 0 },
        data: { label: 'Prod VPC', containerKind: 'vpc' },
        style: { width: 500, height: 400 },
      },
      {
        id: '2',
        type: 'service',
        parentNode: '1',
        extent: 'parent',
        position: { x: 40, y: 60 },
        data: { label: 'API' },
      },
    ] as FlowNode[]

    const result = parseFlowJson(serializeFlow(nodes, [], 'architecture'))

    expect(result.mode).toBe('architecture')
    const container = result.nodes.find((n) => n.id === '1')!
    const child = result.nodes.find((n) => n.id === '2')!
    expect(container.data.containerKind).toBe('vpc')
    expect(child.parentNode).toBe('1')
    expect(child.extent).toBe('parent')
    expect(child.position).toEqual({ x: 40, y: 60 })
  })
})

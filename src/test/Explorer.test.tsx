import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Explorer from '../components/Explorer'
import type { Edge, Node } from 'reactflow'

const nodes: Node[] = [
  { id: 'gateway', type: 'apiGateway', position: { x: 0, y: 0 }, data: { label: 'Edge gateway', icon: 'icon-api' } },
  { id: 'worker', type: 'service', position: { x: 200, y: 0 }, data: { label: 'Queue worker' } },
  { id: 'db', type: 'database', position: { x: 400, y: 0 }, data: { label: 'Archive database' } },
]
const edges: Edge[] = [
  { id: 'requests', source: 'gateway', target: 'worker', label: 'Job requests', data: { protocol: 'event', commStyle: 'async' }, animated: true },
  { id: 'records', source: 'worker', target: 'db', label: 'Persist records', data: { protocol: 'SQL', commStyle: 'sync' } },
]

function props() {
  return { nodes, edges, onUpdateNodeLabel: vi.fn(), onUpdateEdgeLabel: vi.fn(), onReorderNodes: vi.fn(), onApplyFlow: vi.fn(), onClose: vi.fn() }
}

describe('Diagram Explorer', () => {
  it('searches node labels and connection endpoints without changing the diagram', () => {
    const callbacks = props()
    render(<Explorer {...callbacks} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Archive' } })
    expect(screen.getByRole('textbox', { name: 'Name for node 3' })).toHaveValue('Archive database')
    expect(screen.queryByRole('textbox', { name: 'Name for node 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Connection label from Queue worker to Archive database' })).toHaveValue('Persist records')
    expect(callbacks.onApplyFlow).not.toHaveBeenCalled()
    expect(callbacks.onUpdateNodeLabel).not.toHaveBeenCalled()
  })

  it('reorders with keyboard-friendly controls using original indexes while filtered', () => {
    const callbacks = props()
    render(<Explorer {...callbacks} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'worker' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move node 2 up' }))
    expect(callbacks.onReorderNodes).toHaveBeenCalledWith(1, 0)
  })

  it('keeps label editing focus when the parent updates its nodes or close callback', () => {
    const callbacks = props()
    const view = render(<Explorer {...callbacks} />)
    const label = screen.getByRole('textbox', { name: 'Name for node 2' })
    label.focus()
    fireEvent.change(label, { target: { value: 'Updated worker' } })
    const nextClose = vi.fn()
    view.rerender(<Explorer {...callbacks} nodes={nodes.map((node) => node.id === 'worker' ? { ...node, data: { ...node.data, label: 'Updated worker' } } : node)} onClose={nextClose} />)
    expect(label).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(nextClose).toHaveBeenCalledOnce()
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })

  it('preserves icon and protocol metadata when editing the diagram JSON', () => {
    const callbacks = props()
    render(<Explorer {...callbacks} />)
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    const editor = screen.getByRole('textbox', { name: 'Diagram JSON' })
    const document = JSON.parse((editor as HTMLTextAreaElement).value)
    expect(document.nodes[0].icon).toBe('icon-api')
    expect(document.edges[0]).toMatchObject({ protocol: 'event', commStyle: 'async' })
    document.nodes[1].label = 'Resilient queue worker'
    fireEvent.change(editor, { target: { value: JSON.stringify(document) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    expect(callbacks.onApplyFlow).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'worker', label: 'Resilient queue worker' }), expect.objectContaining({ id: 'gateway', icon: 'icon-api' })]),
      edges: expect.arrayContaining([expect.objectContaining({ id: 'requests', protocol: 'event', commStyle: 'async' })]),
    }))
  })

  it('rejects broken references instead of applying a partially lost diagram', () => {
    const callbacks = props()
    render(<Explorer {...callbacks} />)
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    const editor = screen.getByRole('textbox', { name: 'Diagram JSON' })
    fireEvent.change(editor, { target: { value: JSON.stringify({ nodes: [{ id: 'node', label: 'Missing position' }], edges: [] }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON')
    expect(callbacks.onApplyFlow).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: JSON.stringify({ nodes: [{ id: 'node', type: 'step', label: 'Valid node', position: { x: 0, y: 0 } }], edges: [{ source: 'node', target: 'missing' }] }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    expect(callbacks.onApplyFlow).not.toHaveBeenCalled()
  })

  it('acts as a focus-contained mobile dialog and restores its opener', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<Explorer {...props()} />)
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveAttribute('aria-modal', 'true')
    const controls = panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea')
    controls[controls.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(controls[0]).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(controls[controls.length - 1]).toHaveFocus()
    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  })
})

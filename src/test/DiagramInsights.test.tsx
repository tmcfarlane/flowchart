import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Node, Edge } from 'reactflow'
import DiagramInsights from '../components/DiagramInsights'

const node = (id: string, type = 'step', label = id): Node => ({ id, type, position: { x: 0, y: 0 }, data: { label } })
const draft = [node('start', 'step', 'Start'), node('q', 'decision', 'Ready?'), node('done', 'step', 'Done'), node('alone', 'step', 'A loose idea')]
const arrows: Edge[] = [{ id: 'a', source: 'start', target: 'q' }, { id: 'b', source: 'q', target: 'done' }]

const metric = (name: string) => screen.getByText(name, { selector: 'dt' }).parentElement!.querySelector('dd')!
afterEach(() => vi.unstubAllGlobals())

describe('Diagram insights over the actual canvas document', () => {
  it('reports useful graph checks, focuses their nodes only on request, and leaves the diagram unchanged', () => {
    const onFocusNode = vi.fn()
    const onClose = vi.fn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const before = JSON.stringify({ nodes: draft, edges: arrows })
    render(<DiagramInsights nodes={draft} edges={arrows} onFocusNode={onFocusNode} onClose={onClose} />)
    expect(metric('Nodes')).toHaveTextContent('4')
    expect(metric('Connections')).toHaveTextContent('2')
    expect(metric('Decisions')).toHaveTextContent('1')
    expect(metric('Connected groups')).toHaveTextContent('2')
    expect(screen.getByText('Decision "Ready?" has 1 outgoing branch.')).toBeInTheDocument()
    expect(screen.getByText('A branch from "Ready?" has no label.')).toBeInTheDocument()
    expect(screen.getByText('Node "A loose idea" has no connections.')).toBeInTheDocument()
    expect(onFocusNode).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Find Ready? on canvas' })[0])
    expect(onFocusNode).toHaveBeenCalledOnce()
    expect(onFocusNode).toHaveBeenCalledWith('q')
    expect(onClose).toHaveBeenCalledOnce()
    expect(JSON.stringify({ nodes: draft, edges: arrows })).toBe(before)
    vi.unstubAllGlobals()
  })

  it('updates live after decision branches are completed and accepts deliberate loops and context notes', () => {
    const nodes = [node('start'), node('q', 'decision', 'Ready?'), node('done'), node('tip', 'note', 'A helpful note')]
    const view = render(<DiagramInsights nodes={nodes} edges={arrows} onFocusNode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('A branch from "Ready?" has no label.')).toBeInTheDocument()
    const completed: Edge[] = [{ id: 'a', source: 'start', target: 'q' }, { id: 'yes', source: 'q', target: 'done', label: 'Yes' }, { id: 'no', source: 'q', target: 'start', label: 'No, retry' }]
    view.rerender(<DiagramInsights nodes={nodes} edges={completed} onFocusNode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Your connections look clear.')).toBeInTheDocument()
    expect(screen.getByText('Your diagram has no blocking issues or design warnings. Keep exploring.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Insight filters' })).not.toBeInTheDocument()
    expect(metric('Connected groups')).toHaveTextContent('1')
  })

  it('filters detail findings without fetching or embedding external artwork', () => {
    const photo: Node = { ...node('photo', 'image', 'Outside illustration'), data: { label: 'Outside illustration', imageUrl: 'https://example.com/track.png' } }
    const nodes = [node('q', 'decision', 'Which path?'), photo]
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<DiagramInsights nodes={nodes} edges={[{ id: 'p', source: 'q', target: 'photo' }]} onFocusNode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Viewing this diagram can contact an external image host.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Details 1' }))
    expect(screen.queryByText('Decision "Which path?" has 1 outgoing branch.')).not.toBeInTheDocument()
    expect(screen.getByText('Viewing this diagram can contact an external image host.')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('handles blocking validation errors and an empty canvas with precise repair guidance', () => {
    const onFocusNode = vi.fn()
    const view = render(<DiagramInsights nodes={[node('a', 'step', '<img onerror=alert(1)>')]} edges={[{ id: 'bad', source: 'a', target: 'missing' }]} onFocusNode={onFocusNode} onClose={vi.fn()} />)
    expect(screen.getByText(/no node with id "missing"/)).toBeInTheDocument()
    expect(metric('Connected groups')).toHaveTextContent('—')
    fireEvent.click(screen.getByRole('button', { name: 'Find <img onerror=alert(1)> on canvas' }))
    expect(onFocusNode).toHaveBeenCalledWith('a')
    view.rerender(<DiagramInsights nodes={[]} edges={[]} onFocusNode={onFocusNode} onClose={vi.fn()} />)
    expect(screen.getByText('add at least one node')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Find .* on canvas/ })).not.toBeInTheDocument()
  })

  it('traps keyboard focus, calls the latest close handler, and restores the opener', () => {
    const firstClose = vi.fn(), latestClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const view = render(<DiagramInsights nodes={draft} edges={arrows} onFocusNode={vi.fn()} onClose={firstClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Look at the connections.' })
    const close = within(dialog).getByRole('button', { name: 'Close diagram insights' })
    const last = within(dialog).getByRole('button', { name: 'Back to canvas' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    view.rerender(<DiagramInsights nodes={draft} edges={arrows} onFocusNode={vi.fn()} onClose={latestClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(firstClose).not.toHaveBeenCalled()
    expect(latestClose).toHaveBeenCalledOnce()
    view.unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})

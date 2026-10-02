import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { LOCAL_DRAFT_KEY } from '../hooks/useLocalDraft'

const layout = vi.hoisted(() => ({ arrange: vi.fn() }))
vi.mock('../shared/layout', () => ({ arrangeChart: layout.arrange }))
vi.mock('reactflow', async (importOriginal) => {
  const original = await importOriginal<typeof import('reactflow')>()
  return { ...original, useReactFlow: () => ({ ...original.useReactFlow(), setCenter: () => Promise.resolve(true) }) }
})
const flow = {
  nodes: [
    { id: 'source', type: 'step', label: 'Source step', position: { x: 0, y: 0 } },
    { id: 'sink', type: 'step', label: 'Sink step', position: { x: 300, y: 0 } },
  ],
  edges: [{ id: 'request', source: 'source', target: 'sink', label: 'Send request', protocol: 'HTTPS', commStyle: 'sync', style: 'default' }],
}
beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: 1790917171000, diagramMode: 'flowchart', flow }))
  layout.arrange.mockResolvedValue({ nodes: [
    { id: 'proposal-a', type: 'step', label: 'Proposal first', position: { x: 0, y: 0 } },
    { id: 'proposal-b', type: 'step', label: 'Proposal second', position: { x: 300, y: 0 } },
  ], edges: [] })
})
afterEach(() => { vi.useRealTimers(); layout.arrange.mockReset(); localStorage.clear(); sessionStorage.clear() })

function readGraph() {
  fireEvent.click(screen.getByLabelText('Toggle Explorer'))
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
  return JSON.parse((screen.getByRole('textbox', { name: 'Diagram JSON' }) as HTMLTextAreaElement).value)
}

describe('Presentation keyboard boundary', () => {
  it.each(['canvas', 'proposal'])('keeps editor clipboard/history/commands inactive while presenting %s', async (scope) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore saved draft' }))
    fireEvent.click(screen.getByLabelText('Find nodes and actions'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Find a node or action' }), { target: { value: 'Source step' } })
    fireEvent.click(screen.getByRole('option', { name: /Source step/ }))
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    if (scope === 'canvas') fireEvent.click(screen.getByLabelText('Enter Preview Mode'))
    else {
      fireEvent.click(screen.getByLabelText('Open template gallery'))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use The dream observatory template' })) })
      await act(async () => { await vi.dynamicImportSettled() })
      fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    }
    expect(document.querySelector('.floating-counter')!.textContent?.replace(/\s/g, '')).toBe('1/2')
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(document.querySelector('.floating-counter')!.textContent?.replace(/\s/g, '')).toBe('1/2')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(document.querySelector('.floating-counter')!.textContent?.replace(/\s/g, '')).toBe('2/2')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(document.querySelector('.floating-counter')!.textContent?.replace(/\s/g, '')).toBe('1/2')
    fireEvent.keyDown(window, { key: 'Escape' })
    if (scope === 'canvas') expect(screen.getByLabelText('Enter Preview Mode')).toHaveFocus()
    if (scope === 'proposal') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('combobox', { name: 'Find a node or action' })).not.toBeInTheDocument()
    const actual = readGraph()
    expect(actual.nodes.map((node: { id: string }) => node.id)).toEqual(['source', 'sink'])
    expect(actual.edges).toEqual([expect.objectContaining({ id: 'request', source: 'source', target: 'sink', label: 'Send request', protocol: 'HTTPS', commStyle: 'sync' })])
  })
})

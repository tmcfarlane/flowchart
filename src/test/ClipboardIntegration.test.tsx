import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { LOCAL_DRAFT_KEY } from '../hooks/useLocalDraft'

const selectionFixture = vi.hoisted(() => ({ select: (_ids: string[]) => {} }))
vi.mock('reactflow', async (importOriginal) => {
  const original = await importOriginal<typeof import('reactflow')>()
  return { ...original, useReactFlow: () => {
    const flow = original.useReactFlow()
    const store = original.useStoreApi()
    selectionFixture.select = (ids) => {
      store.setState({ multiSelectionActive: true })
      store.getState().addSelectedNodes(ids)
      store.setState({ multiSelectionActive: false })
    }
    return { ...flow, setCenter: () => Promise.resolve(true) }
  } }
})

const graph = { nodes: [
  { id: 'box', type: 'container', label: 'Copied cluster', position: { x: 80, y: 60 }, width: 650, height: 350, containerKind: 'cluster' },
  { id: 'a', type: 'service', label: 'Request service', parentNode: 'box', position: { x: 40, y: 80 }, icon: 'icon-cloud' },
  { id: 'b', type: 'database', label: 'Persistent archive', parentNode: 'box', position: { x: 380, y: 80 }, icon: 'icon-database' },
  { id: 'outside', type: 'note', label: 'Keep this note', position: { x: 800, y: 80 } },
], edges: [
  { id: 'request', source: 'a', target: 'b', label: 'Store request', sourceHandle: 'right', targetHandle: 'left', protocol: 'SQL', commStyle: 'sync', style: 'default' },
  { id: 'events', source: 'a', target: 'b', label: 'Archive event', sourceHandle: 'bottom', targetHandle: 'bottom', protocol: 'event', commStyle: 'async', style: 'animated' },
] }

function readGraph() {
  fireEvent.click(screen.getByLabelText('Toggle Explorer'))
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
  const value = JSON.parse((screen.getByRole('textbox', { name: 'Diagram JSON' }) as HTMLTextAreaElement).value)
  fireEvent.click(screen.getByRole('button', { name: 'Close explorer' }))
  return value
}

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: 1790917171000, diagramMode: 'architecture', flow: graph }))
})
afterEach(() => { vi.useRealTimers(); localStorage.clear(); sessionStorage.clear() })

describe('Container clipboard connections', () => {
  it.each([false, true])('Cut and Paste retain unselected internal connections when children are explicitly selected: %s', (selectChildren) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview saved draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore saved draft' }))
    const select = (id: string) => fireEvent.keyDown(document.querySelector(`.react-flow-wrapper .react-flow__node[data-id="${id}"]`)!, { key: 'Enter' })
    select('box')
    if (selectChildren) {
      // Seed a multi-selection through React Flow's real store. JSDOM does
      // not initialize pointer dragging; clipboard/keyboard/history stay real.
      act(() => selectionFixture.select(['box', 'a', 'b']))
    }
    expect([...document.querySelectorAll('.react-flow-wrapper .react-flow__node.selected')].map(node => node.getAttribute('data-id')).sort()).toEqual(selectChildren ? ['a', 'b', 'box'] : ['box'])
    expect(document.querySelector('.react-flow-wrapper .react-flow__edge.selected')).toBeNull()
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true })
    expect(readGraph().nodes.map((node: { id: string }) => node.id)).toEqual(['outside'])
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    const pasted = readGraph()
    const parent = pasted.nodes.find((node: { type: string }) => node.type === 'container')
    const a = pasted.nodes.find((node: { label: string }) => node.label === 'Request service')
    const b = pasted.nodes.find((node: { label: string }) => node.label === 'Persistent archive')
    expect(pasted.nodes).toHaveLength(4)
    expect(a).toMatchObject({ parentNode: parent.id, position: { x: 40, y: 80 }, icon: 'icon-cloud' })
    expect(b).toMatchObject({ parentNode: parent.id, position: { x: 380, y: 80 }, icon: 'icon-database' })
    expect(pasted.edges).toHaveLength(2)
    expect(new Set(pasted.edges.map((edge: { id: string }) => edge.id)).size).toBe(2)
    expect(pasted.edges).toEqual([
      expect.objectContaining({ source: a.id, target: b.id, label: 'Store request', sourceHandle: 'right', targetHandle: 'left', protocol: 'SQL', commStyle: 'sync' }),
      expect.objectContaining({ source: a.id, target: b.id, label: 'Archive event', protocol: 'event', commStyle: 'async' }),
    ])
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(readGraph().nodes.map((node: { id: string }) => node.id)).toEqual(['outside'])
    fireEvent.click(screen.getByLabelText('Undo'))
    const restored = readGraph()
    expect(restored.nodes.map((node: { id: string }) => node.id)).toEqual(['box', 'a', 'b', 'outside'])
    expect(restored.edges.map((edge: { id: string }) => edge.id)).toEqual(['request', 'events'])
  })
})

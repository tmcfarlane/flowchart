import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { LOCAL_DRAFT_KEY, parseLocalDraft } from '../hooks/useLocalDraft'
import { parseDiagramJson } from '../utils/importFlow'

vi.mock('reactflow', async (importOriginal) => {
  const original = await importOriginal<typeof import('reactflow')>()
  return { ...original, useReactFlow: () => ({ ...original.useReactFlow(), setCenter: () => Promise.resolve(true) }) }
})

const ID = 'LocalCopy1'
const source = { id: ID, version: 3, title: 'Original shared idea', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', nodes: [
  { id: 'source', type: 'step', label: 'Shared first step', position: { x: 0, y: 0 } },
  { id: 'sink', type: 'step', label: 'Shared second step', position: { x: 240, y: 0 } },
], edges: [{ id: 'request', source: 'source', target: 'sink', label: 'Original connection' }] }
const saved = (label = 'Earlier browser idea') => JSON.stringify({ version: 1, savedAt: 1790900000000, diagramMode: 'flowchart', flow: { nodes: [{ id: 'old', type: 'step', label, position: { x: 0, y: 0 } }], edges: [] } })
let fetchMock: ReturnType<typeof vi.fn>
let chart = source

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', `/f/${ID}`)
  chart = source
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith(`/api/flows/${ID}`) && (!init?.method || init.method === 'GET')) return new Response(JSON.stringify(String(input).includes('?since=') ? { changed: false, version: 3 } : chart), { status: 200, headers: { 'Content-Type': 'application/json' } })
    throw new Error(`Unexpected test request: ${String(input)}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); localStorage.clear() })

async function open(raw?: string) {
  if (raw !== undefined) localStorage.setItem(LOCAL_DRAFT_KEY, raw)
  await act(async () => { render(<App />) })
  expect(screen.getByText(chart.nodes[0].label)).toBeInTheDocument()
  const button = screen.getByRole('button', { name: 'Make editable copy' })
  button.focus()
  return button
}
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')

describe('Shared view to editable local copy', () => {
  it('retains the graph, enables local draft saving and never writes or shares the original automatically', async () => {
    fireEvent.click(await open())
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByLabelText('Shared flowchart status')).not.toBeInTheDocument()
    expect(screen.getByText('Shared first step')).toBeInTheDocument()
    expect(screen.getByText('Shared second step')).toBeInTheDocument()
    expect(screen.getByLabelText('Find nodes and actions')).toHaveFocus()
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    await act(async () => { vi.advanceTimersByTime(801) })
    const draft = parseLocalDraft(localStorage.getItem(LOCAL_DRAFT_KEY)!)!
    expect(draft.flow.nodes.map(node => node.label)).toEqual(['Shared first step', 'Shared second step', 'Step'])
    expect(draft.flow.edges).toEqual([expect.objectContaining({ id: 'request', label: 'Original connection' })])
    expect(writes()).toEqual([])
  })

  it('reviews an older draft and preserves its exact bytes, source route and canvas when cancelled', async () => {
    const raw = saved()
    const button = await open(raw)
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: 'A browser draft is already saved' })
    expect(within(dialog).getByText('Earlier browser idea')).toBeInTheDocument()
    expect(within(dialog).getByRole('region', { name: 'Existing browser draft' })).toHaveTextContent('1 nodes · 0 connections')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(window.location.pathname).toBe(`/f/${ID}`)
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
    expect(button).toHaveFocus()
    expect(screen.getByText('Shared first step')).toBeInTheDocument()
    expect(writes()).toEqual([])
  })

  it('replaces a valid older draft only after explicit confirmation', async () => {
    fireEvent.click(await open(saved()))
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(saved())
    fireEvent.click(screen.getByRole('button', { name: 'Replace saved draft and make copy' }))
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(801) })
    expect(parseLocalDraft(localStorage.getItem(LOCAL_DRAFT_KEY)!)!.flow.nodes.map(node => node.id)).toEqual(['source', 'sink'])
    expect(writes()).toEqual([])
  })

  it('offers an exact raw backup for unreadable stored data and never replaces it on download or cancellation', async () => {
    const raw = '{ this is an unreadable older backup'
    const create = vi.fn((_blob: Blob) => 'blob:local-backup')
    const revoke = vi.fn()
    const OriginalURL = URL
    class DownloadURL extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke }
    vi.stubGlobal('URL', DownloadURL)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(await open(raw))
    expect(screen.getByRole('dialog')).toHaveTextContent('Its contents could not be verified')
    fireEvent.click(screen.getByRole('button', { name: 'Download raw backup' }))
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0]).toMatchObject({ type: 'text/plain', size: raw.length })
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(revoke).toHaveBeenCalledWith('blob:local-backup')
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
    expect(window.location.pathname).toBe(`/f/${ID}`)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
  })

  it('requires renewed review when another draft appears before replacement is confirmed', async () => {
    fireEvent.click(await open(saved()))
    const newer = saved('A newer browser backup')
    localStorage.setItem(LOCAL_DRAFT_KEY, newer)
    fireEvent.click(screen.getByRole('button', { name: 'Replace saved draft and make copy' }))
    expect(window.location.pathname).toBe(`/f/${ID}`)
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(newer)
    expect(screen.getByRole('dialog')).toHaveTextContent('A newer browser backup')
    expect(screen.getByRole('alert')).toHaveTextContent('saved draft changed')
    fireEvent.click(screen.getByRole('button', { name: 'Replace saved draft and make copy' }))
    await act(async () => { vi.advanceTimersByTime(801) })
    expect(window.location.pathname).toBe('/')
    expect(parseLocalDraft(localStorage.getItem(LOCAL_DRAFT_KEY)!)!.flow.nodes[0].label).toBe('Shared first step')
    expect(writes()).toEqual([])
  })

  it('downloads a valid older draft as a portable diagram that preserves containers, icons and edge semantics through import', async () => {
    vi.useRealTimers()
    const previous = { version: 1, savedAt: 1790900000000, diagramMode: 'architecture', flow: { nodes: [
      { id: 'group', type: 'container', label: 'Earlier cloud', position: { x: 0, y: 0 }, width: 420, height: 300, containerKind: 'vpc' },
      { id: 'api', type: 'service', label: 'Earlier API', position: { x: 28, y: 56 }, parentNode: 'group', icon: 'icon-robot' },
      { id: 'db', type: 'database', label: 'Earlier archive', position: { x: 480, y: 50 } },
    ], edges: [{ id: 'save', source: 'api', target: 'db', style: 'default', protocol: 'SQL', commStyle: 'async' }] } }
    const raw = JSON.stringify(previous)
    const create = vi.fn((_blob: Blob) => 'blob:portable-backup')
    const OriginalURL = URL
    class DownloadURL extends OriginalURL { static createObjectURL = create; static revokeObjectURL = vi.fn() }
    vi.stubGlobal('URL', DownloadURL)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(await open(raw))
    fireEvent.click(screen.getByRole('button', { name: 'Download saved diagram' }))
    const blob = create.mock.calls[0][0]
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    expect(JSON.parse(content)).toMatchObject({ version: 2, mode: 'architecture', nodes: previous.flow.nodes, edges: previous.flow.edges })
    expect(parseDiagramJson(content, { requireEdgeIds: true })).toEqual({ mode: 'architecture', flow: previous.flow })
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
    expect(window.location.pathname).toBe(`/f/${ID}`)
    expect(writes()).toEqual([])
  })

  it('retains source artwork and reports honestly when its private URL cannot be saved as a safe browser draft', async () => {
    const imageUrl = 'https://example.com/photo.png?token=private-reader-fixture'
    chart = { ...source, nodes: [{ id: 'art', type: 'image', label: 'Source artwork', position: { x: 0, y: 0 }, imageUrl } as unknown as typeof source.nodes[0]], edges: [] }
    fireEvent.click(await open())
    await act(async () => { vi.advanceTimersByTime(801) })
    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('alert')).toHaveTextContent('private access link')
    expect(document.querySelector('.image-node img')).toHaveAttribute('src', imageUrl)
    expect(localStorage.getItem(LOCAL_DRAFT_KEY)).toBeNull()
    expect(writes()).toEqual([])
  })
})

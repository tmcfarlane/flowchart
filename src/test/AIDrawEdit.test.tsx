import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { createElement } from '../utils/drawScene'
import { serializeFlow } from '../utils/exportUtils'

const DRAFT = 'flowchart-editor-draft-v3'
const shape = createElement('rectangle', { x: 100, y: 100 }, { x: 300, y: 200 }, { id: 'shape', backgroundColor: '#ffffff', customData: { private: 'retained' } })
const other = createElement('rectangle', { x: 500, y: 100 }, { x: 700, y: 200 }, { id: 'other', locked: true })
const original = { version: 1 as const, elements: [shape, other], files: {} }
const edit = { summary: 'Make the selected shape blue.', operations: [{ op: 'update_element', id: 'shape', changes: { backgroundColor: '#dbeafe' } }] }
const response = (proposal: unknown = edit) => ({ ok: true, json: async () => ({ finishReason: 'stop', message: JSON.stringify(proposal) }) })
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear(); window.history.replaceState(null, '', '/')
  localStorage.setItem(DRAFT, serializeFlow([], [], 'draw', original))
  fetcher = vi.fn(async () => response())
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const saved = () => JSON.parse(localStorage.getItem(DRAFT) ?? '{}').architectureScene
async function open() {
  render(<App />)
  const canvas = await screen.findByRole('region', { name: 'Draw canvas' })
  fireEvent.keyDown(canvas, { key: 'a', ctrlKey: true })
  fireEvent.click(screen.getByRole('button', { name: 'Edit selection with AI' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit Draw selection with AI' })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'What should change?' }), { target: { value: 'Make it blue' } })
  return { dialog, canvas }
}
async function preview() {
  const result = await open()
  fireEvent.click(within(result.dialog).getByRole('button', { name: 'Preview changes' }))
  const apply = within(result.dialog).getByRole('button', { name: 'Apply changes' })
  await waitFor(() => expect(apply).toBeEnabled())
  return { ...result, apply }
}

describe('App selected Draw AI', () => {
  it('previews without a write then applies exactly one undoable transaction and preserves other elements', async () => {
    const { dialog, apply, canvas } = await preview()
    expect(saved()).toEqual(original)
    const request = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(request.mode).toBe('draw-edit')
    expect(request.drawContext.targets.map((target: { id: string }) => target.id)).toEqual(['shape'])
    expect(JSON.stringify(request)).not.toMatch(/customData|private|files|dataURL/)
    expect(within(dialog).getByRole('img', { name: 'Before' })).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Proposed' })).toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'Proposed' }).getAttribute('viewBox')).toBe(within(dialog).getByRole('img', { name: 'Before' }).getAttribute('viewBox'))
    fireEvent.click(apply)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(saved().elements[0].backgroundColor).toBe('#dbeafe'))
    expect(saved().elements[1]).toEqual(other)
    expect(saved().elements[0].customData).toEqual(shape.customData)
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(saved()).toEqual(original))
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(saved().elements[0].backgroundColor).toBe('#dbeafe'))
  })
  it('cancels a preview and keeps instruction editing from applying an outdated proposal', async () => {
    const { dialog, apply } = await preview()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Make it red' } })
    expect(apply).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(saved()).toEqual(original)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('discards a response body arriving after Cancel, even if the fetch ignores abort', async () => {
    let complete!: (value: unknown) => void
    fetcher.mockResolvedValueOnce({ ok: true, json: () => new Promise(done => { complete = done }) })
    const { dialog } = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes' }))
    await waitFor(() => expect(complete).toBeDefined())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await act(async () => complete({ finishReason: 'stop', message: JSON.stringify(edit) }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(saved()).toEqual(original)
  })
  it('keeps drawing shortcuts from changing the selection behind the AI dialog', async () => {
    const { dialog, apply, canvas } = await preview()
    fireEvent.keyDown(canvas, { key: 'Escape' })
    expect(saved()).toEqual(original)
    fireEvent.click(apply)
    expect(dialog).not.toBeInTheDocument()
    await waitFor(() => expect(saved().elements[0].backgroundColor).toBe('#dbeafe'))
  })
  it('invalidates requests when leaving Draw mode', async () => {
    let complete!: (value: ReturnType<typeof response>) => void
    fetcher.mockImplementationOnce(() => new Promise(done => { complete = done }))
    const { dialog } = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Architecture Mode', exact: true }))
    await act(async () => complete(response()))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(saved()).toEqual(original)
  })
  it('rejects an old preview after a shared document replacement with reused element IDs', async () => {
    localStorage.clear()
    window.history.replaceState(null, '', '/f/Ab3dE5fG7h#edit=test-edit-token-1234567890')
    const chart = { id: 'Ab3dE5fG7h', version: 1, title: 'Shared drawing', mode: 'draw', architectureScene: original,
      nodes: [], edges: [], createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' }
    let remote = chart
    fetcher.mockImplementation(async (url: string) => url === '/api/chat' ? response() : { ok: true, status: 200, json: async () => remote })
    const { dialog, apply } = await preview()
    remote = { ...chart, version: 2, architectureScene: { ...original, elements: [{ ...shape, strokeColor: '#ff0000' }, other] } }
    fireEvent.focus(window)
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/drawing or selection changed/), { timeout: 4500 })
    expect(apply).toBeDisabled()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('saves one applied Draw transaction through the existing shared chart endpoint', async () => {
    localStorage.clear()
    window.history.replaceState(null, '', '/f/Ab3dE5fG7h#edit=test-edit-token-1234567890')
    const chart = { id: 'Ab3dE5fG7h', version: 3, title: 'Shared drawing', mode: 'draw', architectureScene: original,
      nodes: [], edges: [], createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z' }
    fetcher.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url === '/api/chat') return response()
      if (init.method === 'PUT') return { ok: true, status: 200, json: async () => ({ ...chart, ...JSON.parse(String(init.body)), version: 4 }) }
      return { ok: true, status: 200, json: async () => chart }
    })
    const { apply } = await preview()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
    fireEvent.click(apply)
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true), { timeout: 2500 })
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(writes).toHaveLength(1)
    const body = JSON.parse(writes[0][1].body)
    expect(body).toMatchObject({ baseVersion: 3, mode: 'draw', nodes: [], edges: [] })
    expect(body.architectureScene.elements[0]).toEqual({ ...shape, backgroundColor: '#dbeafe' })
    expect(body.architectureScene.elements[1]).toEqual(other)
  })

  it('revalidates the provider response in the browser', async () => {
    fetcher.mockResolvedValueOnce(response({ summary: 'Outside scope', operations: [{ op: 'update_element', id: 'other', changes: { opacity: 10 } }] }))
    const { dialog } = await open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview changes' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/outside the selection/i)
    expect(within(dialog).getByRole('button', { name: 'Apply changes' })).toBeDisabled()
    expect(saved()).toEqual(original)
  })
})

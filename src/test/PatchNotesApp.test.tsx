import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { PATCH_NOTES } from '../patchNotes'
import { parseFlowJson, serializeFlow } from '../utils/exportUtils'
import { seedReturningVisitor } from './helpers/returningVisitor'

vi.mock('../components/DrawCanvas', async () => import('./mocks/DrawCanvas'))

const key = 'flowchart-patch-notes-seen-revision'
const draftKey = 'flowchart-editor-draft-v3'
const latest = String(PATCH_NOTES[0].revision)
const notes = () => screen.queryByRole('dialog', { name: "What's new" })
const chart = {
  id: 'Ab3dE5fG7h', version: 1, title: 'Saved flowchart', mode: 'flowchart',
  nodes: [{ id: 'a', type: 'step', label: 'Keep this step', position: { x: 0, y: 0 } }], edges: [],
  createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('patch notes in the editor', () => {
  it.each(['Close patch notes', 'Got it', 'Escape', 'backdrop'])('opens before welcome and acknowledges through %s', (method) => {
    const { container, unmount } = render(<App />)
    expect(notes()).toBeInTheDocument()
    expect(screen.queryByText("What's your flow?")).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Open AI Assistant')).not.toBeInTheDocument()
    expect(localStorage.getItem(key)).toBeNull()
    if (method === 'Escape') fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Escape' })
    else if (method === 'backdrop') fireEvent.mouseDown(container.querySelector('.patch-notes-overlay')!)
    else fireEvent.click(screen.getByRole('button', { name: method }))
    expect(notes()).not.toBeInTheDocument()
    expect(localStorage.getItem(key)).toBe(latest)
    expect(screen.getByText("What's your flow?")).toBeInTheDocument()
    unmount()
    render(<App />)
    expect(notes()).not.toBeInTheDocument()
    expect(screen.getByText("What's your flow?")).toBeInTheDocument()
  })

  it('shows an unacknowledged release again after a reload', () => {
    const { unmount } = render(<App />)
    expect(notes()).toBeInTheDocument()
    unmount()
    render(<App />)
    expect(notes()).toBeInTheDocument()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('reopens manually in every editor mode and returns focus to the toolbar', async () => {
    seedReturningVisitor()
    render(<App />)
    fireEvent.click(screen.getByText('No, thank you'))
    for (const mode of ['Flowchart Mode', 'Architecture Mode', 'Draw Mode']) {
      fireEvent.click(screen.getByRole('button', { name: mode, exact: true }))
      const opener = screen.getByRole('button', { name: "What's new" })
      opener.focus()
      fireEvent.click(opener)
      expect(notes()).toBeInTheDocument()
      expect(screen.queryByLabelText('Open AI Assistant')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      expect(notes()).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    }
    await screen.findByLabelText('Draw canvas')
  })

  it('closes the full assistant for a manual opening without clearing its prompt', () => {
    seedReturningVisitor()
    render(<App />)
    fireEvent.click(screen.getByText('No, thank you'))
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my next diagram idea' } })
    fireEvent.click(screen.getByRole('button', { name: "What's new" }))
    expect(notes()).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    fireEvent.click(screen.getByLabelText('Open AI Assistant'))
    expect(screen.getByRole('textbox')).toHaveValue('Keep my next diagram idea')
  })

  it('preserves the saved document, clipboard, selected tool, and undo history under modal keyboard input', async () => {
    const existing = [{ id: 'a', type: 'step', position: { x: 32, y: 48 }, data: { label: 'Keep this step' }, selected: true }]
    const drawing = { version: 1 as const, elements: [{ id: 'frame', type: 'frame', name: 'Keep this frame', x: 0, y: 0, width: 400, height: 250, angle: 0 }], files: {} }
    localStorage.setItem(draftKey, serializeFlow(existing, [], 'flowchart', drawing))
    render(<App />)
    expect(screen.getByText('Keep this step')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'x', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    fireEvent.click(screen.getByLabelText('Add Note'))
    await waitFor(() => expect(parseFlowJson(localStorage.getItem(draftKey)!).nodes).toHaveLength(2))
    const before = localStorage.getItem(draftKey)
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: "What's new" }))
    const target = screen.getByRole('button', { name: 'Got it' })
    for (const key of ['c', 'x', 'v', 'z', 'y']) {
      fireEvent.keyDown(target, { key, ctrlKey: true })
      fireEvent.keyDown(target, { key, metaKey: true })
    }
    for (const key of ['Delete', 'Backspace', 'h', 'a']) fireEvent.keyDown(target, { key })
    expect(localStorage.getItem(draftKey)).toBe(before)
    expect(screen.getByText('Keep this step')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByLabelText('Selection Tool')).toHaveClass('active')
    expect(undo).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    fireEvent.click(target)
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    expect(screen.getAllByText('Keep this step')).toHaveLength(1)
    fireEvent.click(undo)
    expect(screen.queryByText('Note')).not.toBeInTheDocument()
    expect(screen.getByText('Keep this step')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByText('Note')).toBeInTheDocument()
    await waitFor(() => expect(parseFlowJson(localStorage.getItem(draftKey)!).architectureScene).toEqual(drawing))
  })

  it('waits for a shared chart to finish loading and does not write to it', async () => {
    window.history.replaceState(null, '', `/f/${chart.id}`)
    let resolve!: (value: unknown) => void
    const fetcher = vi.fn(() => new Promise(done => { resolve = done }))
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    expect(screen.getByText('Opening shared flowchart…')).toBeInTheDocument()
    expect(notes()).not.toBeInTheDocument()
    await act(async () => resolve({ ok: true, status: 200, json: async () => chart }))
    expect(await screen.findByText('Keep this step')).toBeInTheDocument()
    expect(notes()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(fetcher).toHaveBeenCalledOnce()
    expect(localStorage.getItem(draftKey)).toBeNull()
  })

  it.each([404, 500])('keeps shared-chart recovery ahead of notes for HTTP %s', async (status) => {
    window.history.replaceState(null, '', `/f/${chart.id}`)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, json: async () => ({ error: 'Unavailable' }) })))
    render(<App />)
    await screen.findByRole('alert')
    expect(notes()).not.toBeInTheDocument()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('keeps unread notes deferred through presentation and announces them after exit', async () => {
    window.history.replaceState(null, '', `/f/${chart.id}`)
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    render(<App />)
    fireEvent.click(screen.getByLabelText('Enter Preview Mode'))
    await act(async () => resolve({ ok: true, status: 200, json: async () => chart }))
    expect(notes()).not.toBeInTheDocument()
    expect(localStorage.getItem(key)).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(notes()).toBeInTheDocument()
    expect(screen.getByText('Keep this step')).toBeInTheDocument()
  })
})

import { seedReturningVisitor } from './helpers/returningVisitor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { serializeFlow } from '../utils/exportUtils'

const board = (label: string) => serializeFlow([{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label } }], [], 'flowchart')
let otherTab: BroadcastChannel

beforeEach(() => {
  localStorage.clear()
  seedReturningVisitor()
  localStorage.setItem('flowchart-editor-draft-v3', board('This tab'))
  otherTab = new BroadcastChannel('flowchart-draft')
})
afterEach(() => { otherTab.close(); vi.restoreAllMocks(); delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker })

// Another tab autosaves its board to the shared draft and announces it
async function saveInOtherTab(label: string) {
  localStorage.setItem('flowchart-editor-draft-v3', board(label))
  otherTab.postMessage('saved')
  await act(() => new Promise(resolve => setTimeout(resolve, 50)))
}

describe('Autosave across tabs', () => {
  it('takes the board another tab saved when this tab is focused again', async () => {
    render(<App />)
    expect(screen.getByText('This tab')).toBeInTheDocument()
    await saveInOtherTab('Other tab')

    fireEvent.focus(window)
    expect(await screen.findByText('Other tab')).toBeInTheDocument()
    await act(() => new Promise(resolve => setTimeout(resolve, 200)))
    // An edit here now builds on the other tab's board instead of replacing it
    fireEvent.click(screen.getByLabelText('Add Note'))
    await waitFor(() => expect(localStorage.getItem('flowchart-editor-draft-v3')).toContain('"Note"'), { timeout: 2000 })
    const saved = localStorage.getItem('flowchart-editor-draft-v3')!
    expect(saved).toContain('Other tab')
    expect(saved).not.toContain('This tab')

    // Taking the other board is one undoable step
    fireEvent.click(screen.getByLabelText('Undo'))
    fireEvent.click(screen.getByLabelText('Undo'))
    expect(await screen.findByText('This tab')).toBeInTheDocument()
  })

  it('keeps its board when no other tab has saved', async () => {
    render(<App />)
    localStorage.setItem('flowchart-editor-draft-v3', board('Not announced'))
    fireEvent.focus(window)
    await act(() => new Promise(resolve => setTimeout(resolve, 50)))
    expect(screen.getByText('This tab')).toBeInTheDocument()
  })

  it('takes a save that arrives just after this tab was focused, before any edit here', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<App />)
    fireEvent.focus(window)
    await saveInOtherTab('Saved as you switched')
    expect(await screen.findByText('Saved as you switched')).toBeInTheDocument()
  })

  it('waits for the next focus when this tab was edited since it was focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<App />)
    fireEvent.focus(window)
    fireEvent.click(screen.getByLabelText('Add Note'))
    await saveInOtherTab('Other tab')
    expect(screen.queryByText('Other tab')).not.toBeInTheDocument()
    fireEvent.focus(window)
    expect(await screen.findByText('Other tab')).toBeInTheDocument()
  })

  it('saves a pending edit at once when the tab loses focus', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Note'))
    fireEvent.blur(window)
    await act(() => new Promise(resolve => setTimeout(resolve, 50)))
    expect(localStorage.getItem('flowchart-editor-draft-v3')).toContain('"Note"')
  })

  it('asks where to save after taking another tab\'s board', async () => {
    const picker = vi.fn(async () => ({ name: 'board.json', queryPermission: async () => 'granted' as const, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }))
    Object.assign(window, { showSaveFilePicker: picker })
    render(<App />)
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true })
    await waitFor(() => expect(picker).toHaveBeenCalledTimes(1))
    await saveInOtherTab('Other tab')
    fireEvent.focus(window)
    expect(await screen.findByText('Other tab')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true })
    await waitFor(() => expect(picker).toHaveBeenCalledTimes(2))
  })

  it('takes a board saved during preview once preview ends', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('Enter Preview Mode'))
    await saveInOtherTab('Other tab')
    fireEvent.focus(window)
    await act(() => new Promise(resolve => setTimeout(resolve, 50)))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByText('Other tab')).toBeInTheDocument()
  })

  it('never takes the local draft into a board that became a shared link', async () => {
    render(<App />)
    window.history.replaceState(null, '', '/f/Ab3dE5fG7h')
    try {
      await saveInOtherTab('Other tab')
      fireEvent.focus(window)
      await act(() => new Promise(resolve => setTimeout(resolve, 50)))
      expect(screen.queryByText('Other tab')).not.toBeInTheDocument()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})

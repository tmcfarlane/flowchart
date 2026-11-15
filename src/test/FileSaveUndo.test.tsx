import { seedReturningVisitor } from './helpers/returningVisitor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { parseFlowJson, serializeFlow } from '../utils/exportUtils'

beforeEach(() => {
  seedReturningVisitor()
  localStorage.setItem('flowchart-editor-draft-v3', serializeFlow([{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Keep me' } }], [], 'flowchart'))
})
afterEach(() => { delete (window as { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown }).showSaveFilePicker; delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker; vi.restoreAllMocks() })

function fakeFileSystem() {
  const writes: { file: string; contents: string }[] = []
  const handle = (name: string) => ({
    name,
    queryPermission: async () => 'granted' as const,
    createWritable: async () => { let contents = ''; return { write: async (data: string) => { contents = data }, close: async () => { writes.push({ file: name, contents }) } } },
  })
  const names = ['board.json', 'copy.json']
  const picker = vi.fn(async () => handle(names.shift()!))
  Object.assign(window, { showSaveFilePicker: picker })
  return { picker, writes }
}
const pressSave = (shift = false) => fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true, shiftKey: shift })

describe('Save target and Undo', () => {
  it('does not write the board from before an open into the opened file after Undo', async () => {
    const { picker, writes } = fakeFileSystem()
    const opened = serializeFlow([{ id: 'x', type: 'step', position: { x: 0, y: 0 }, data: { label: 'From disk' } }], [], 'flowchart')
    const handle = {
      name: 'opened.json',
      getFile: async () => new File([opened], 'opened.json', { type: 'application/json' }),
      queryPermission: async () => 'granted' as const,
      createWritable: async () => { let contents = ''; return { write: async (data: string) => { contents = data }, close: async () => { writes.push({ file: 'opened.json', contents }) } } },
    }
    Object.assign(window, { showOpenFilePicker: vi.fn(async () => [handle]) })
    render(<App />)
    fireEvent.click(screen.getByLabelText(/Export/))
    fireEvent.click(screen.getByRole('button', { name: 'Import from JSON' }))
    expect(await screen.findByText('From disk')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Undo'))
    expect(await screen.findByText('Keep me')).toBeInTheDocument()
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(picker).toHaveBeenCalledTimes(1)
    expect(writes[0].file).toBe('board.json')
    expect(parseFlowJson(writes[0].contents).nodes[0].data.label).toBe('Keep me')
  })

  it('keeps saving to the opened file when Undo stays within it', async () => {
    const { picker, writes } = fakeFileSystem()
    const opened = serializeFlow([{ id: 'x', type: 'step', position: { x: 0, y: 0 }, data: { label: 'From disk' } }], [], 'flowchart')
    const handle = {
      name: 'opened.json',
      getFile: async () => new File([opened], 'opened.json', { type: 'application/json' }),
      queryPermission: async () => 'granted' as const,
      createWritable: async () => { let contents = ''; return { write: async (data: string) => { contents = data }, close: async () => { writes.push({ file: 'opened.json', contents }) } } },
    }
    Object.assign(window, { showOpenFilePicker: vi.fn(async () => [handle]) })
    render(<App />)
    fireEvent.click(screen.getByLabelText(/Export/))
    fireEvent.click(screen.getByRole('button', { name: 'Import from JSON' }))
    expect(await screen.findByText('From disk')).toBeInTheDocument()
    await act(() => new Promise(resolve => setTimeout(resolve, 200)))
    fireEvent.click(screen.getByLabelText('Add Note'))
    expect(screen.getByText('Note')).toBeInTheDocument()
    // Edits join the history after a 500 ms pause
    await act(() => new Promise(resolve => setTimeout(resolve, 700)))
    fireEvent.click(screen.getByLabelText('Undo'))
    await waitFor(() => expect(screen.getByText('From disk')).toBeInTheDocument())
    expect(screen.queryByText('Note')).not.toBeInTheDocument()
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].file).toBe('opened.json')
    expect(picker).not.toHaveBeenCalled()
  })

  it('asks where to save after Clear All starts a new board', async () => {
    const { picker, writes } = fakeFileSystem()
    render(<App />)
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].file).toBe('board.json')

    fireEvent.click(screen.getByLabelText('Clear All'))
    fireEvent.click(await screen.findByRole('button', { name: 'Clear board' }))
    await waitFor(() => expect(screen.queryByText('Keep me')).not.toBeInTheDocument())
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(picker).toHaveBeenCalledTimes(2)
    expect(writes[1].file).toBe('copy.json')
  })
})

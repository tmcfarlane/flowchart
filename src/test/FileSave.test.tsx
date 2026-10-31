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

describe('Save to file', () => {
  it('asks for a location once, then Cmd+S writes back to the same file', async () => {
    const { picker, writes } = fakeFileSystem()
    render(<App />)
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].file).toBe('board.json')
    expect(parseFlowJson(writes[0].contents).nodes[0].data.label).toBe('Keep me')
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to board.json')

    pressSave()
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[1].file).toBe('board.json')
    expect(picker).toHaveBeenCalledTimes(1)

    pressSave(true)
    await waitFor(() => expect(writes).toHaveLength(3))
    expect(writes[2].file).toBe('copy.json')
    expect(picker).toHaveBeenCalledTimes(2)
  })

  it('treats a dismissed file picker as a non-event', async () => {
    Object.assign(window, { showSaveFilePicker: vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') }) })
    render(<App />)
    await act(async () => { pressSave() })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('downloads the JSON where the browser cannot write files', async () => {
    const createObjectURL = vi.fn(() => 'blob:board')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<App />)
    pressSave()
    expect(await screen.findByRole('status')).toHaveTextContent('Downloaded flowchart.json')
    expect(click).toHaveBeenCalled()
  })

  it('names the known file in the export menu after the first save', async () => {
    const { writes } = fakeFileSystem()
    render(<App />)
    fireEvent.click(screen.getByLabelText(/Export/))
    expect(screen.getByRole('button', { name: /^Save…/ })).toBeInTheDocument()
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    // The menu is still open and now names the file
    expect(screen.getByRole('button', { name: /Save to board\.json/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save as…/ })).toBeInTheDocument()
  })

  it('opens a file through Import and saves back to it with Cmd+S', async () => {
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
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].file).toBe('opened.json')
    expect(parseFlowJson(writes[0].contents).nodes[0].data.label).toBe('From disk')
    expect(picker).not.toHaveBeenCalled()
  })

  it('forgets the Save target when a document is opened without a file handle', async () => {
    const { writes } = fakeFileSystem()
    const { container } = render(<App />)
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    // No showOpenFilePicker: Import falls back to the plain file input in the menu
    fireEvent.click(screen.getByLabelText(/Export/))
    const input = container.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement
    const other = serializeFlow([{ id: 'y', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Other board' } }], [], 'flowchart')
    fireEvent.change(input, { target: { files: [new File([other], 'other.json', { type: 'application/json' })] } })
    expect(await screen.findByText('Other board')).toBeInTheDocument()
    if (!screen.queryByRole('button', { name: /^Save/ })) fireEvent.click(screen.getByLabelText(/Export/))
    expect(screen.getByRole('button', { name: /^Save…/ })).toBeInTheDocument()
  })
})

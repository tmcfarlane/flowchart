import { seedReturningVisitor } from './helpers/returningVisitor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { parseFlowJson, serializeFlow } from '../utils/exportUtils'

// An in-memory IndexedDB, so file handles and drafts persist across visits
const stores = { drafts: new Map<string, unknown>(), handles: new Map<string, unknown>() }
vi.mock('../utils/browserStore', () => ({
  browserStoreGet: async (store: keyof typeof stores, key: string) => stores[store].get(key),
  browserStorePut: async (store: keyof typeof stores, key: string, value: unknown) => { stores[store].set(key, value); return true },
  browserStoreDelete: async (store: keyof typeof stores, key: string) => stores[store].delete(key),
}))

const board = (label: string) => serializeFlow([{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label } }], [], 'flowchart')
const writes: { file: string; contents: string }[] = []

function fileHandle(name: string, options: { permission?: PermissionState; grant?: PermissionState; contents?: string; failWrite?: string } = {}) {
  return {
    name,
    getFile: async () => new File([options.contents ?? ''], name, { type: 'application/json' }),
    queryPermission: vi.fn(async () => options.permission ?? 'granted'),
    requestPermission: vi.fn(async () => options.grant ?? 'granted'),
    createWritable: async () => {
      if (options.failWrite) throw new Error(options.failWrite)
      let contents = ''
      return { write: async (data: string) => { contents = data }, close: async () => { writes.push({ file: name, contents }) } }
    },
  }
}

const savePicker = vi.fn(async () => fileHandle('picked.json'))
const pressSave = () => fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true })

async function renderApp() {
  vi.resetModules()
  // Mirrors main.tsx, which loads the IndexedDB draft before the first render
  const drafts = await import('../utils/draftStore')
  await drafts.preloadDraft()
  const { default: App } = await import('../App')
  const view = render(<App />)
  await act(async () => {})
  return view
}

beforeEach(() => {
  localStorage.clear()
  stores.drafts.clear()
  stores.handles.clear()
  writes.length = 0
  savePicker.mockClear()
  seedReturningVisitor()
  Object.assign(window, { showSaveFilePicker: savePicker })
})
afterEach(() => {
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker
})

describe('IndexedDB draft', () => {
  it('opens the board autosaved on the last visit', async () => {
    stores.drafts.set('editor', board('From last visit'))
    await renderApp()
    expect(screen.getByText('From last visit')).toBeInTheDocument()
  })

  it('autosaves edits to IndexedDB', async () => {
    stores.drafts.set('editor', board('Original'))
    await renderApp()
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    await waitFor(() => expect(parseFlowJson(stores.drafts.get('editor') as string).nodes).toHaveLength(2), { timeout: 2000 })
  })
})

describe('Remembered save file', () => {
  it('saves back to the file chosen on an earlier visit without a dialog', async () => {
    stores.drafts.set('editor', board('Remembered'))
    const remembered = fileHandle('earlier.json')
    stores.handles.set('current', remembered)
    await renderApp()
    fireEvent.click(screen.getByLabelText(/Export/))
    expect(screen.getByRole('button', { name: /Save to earlier\.json/ })).toBeInTheDocument()
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].file).toBe('earlier.json')
    expect(parseFlowJson(writes[0].contents).nodes[0].data.label).toBe('Remembered')
    expect(savePicker).not.toHaveBeenCalled()
    expect(remembered.requestPermission).not.toHaveBeenCalled()
  })

  it('asks for write access again before writing to a remembered file', async () => {
    const remembered = fileHandle('earlier.json', { permission: 'prompt', grant: 'granted' })
    stores.handles.set('current', remembered)
    await renderApp()
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(remembered.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(writes[0].file).toBe('earlier.json')
    expect(savePicker).not.toHaveBeenCalled()
  })

  it('asks for a new location when write access is refused', async () => {
    stores.handles.set('current', fileHandle('earlier.json', { permission: 'prompt', grant: 'denied' }))
    await renderApp()
    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].file).toBe('picked.json')
    expect(savePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'earlier.json' }))
    await waitFor(() => expect((stores.handles.get('current') as { name: string }).name).toBe('picked.json'))
  })

  it('reports a write that fails', async () => {
    stores.handles.set('current', fileHandle('locked.json', { failWrite: 'The file is locked.' }))
    await renderApp()
    pressSave()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save: The file is locked.")
  })
})

describe('Open file', () => {
  it('forgets the Save target when an Excalidraw drawing opens as a new diagram', async () => {
    stores.drafts.set('editor', board('Earlier board'))
    stores.handles.set('current', fileHandle('earlier.json'))
    const scene = readFileSync(`${process.cwd()}/src/test/fixtures/excalidraw/dark-pastel-contrast.excalidraw`, 'utf8')
    Object.assign(window, { showOpenFilePicker: vi.fn(async () => [fileHandle('sketch.excalidraw', { contents: scene })]) })
    await renderApp()
    fireEvent.click(screen.getByLabelText(/Export/))
    expect(screen.getByRole('button', { name: /Save to earlier\.json/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import from JSON' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open as new diagram/ }))
    await waitFor(() => expect(stores.handles.has('current')).toBe(false))
    expect(screen.queryByText('Earlier board')).not.toBeInTheDocument()

    pressSave()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(savePicker).toHaveBeenCalled()
    expect(writes[0].file).toBe('picked.json')
    expect(parseFlowJson(writes[0].contents).mode).toBe('draw')
  })
})

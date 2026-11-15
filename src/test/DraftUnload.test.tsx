import { seedReturningVisitor } from './helpers/returningVisitor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { parseFlowJson, serializeFlow } from '../utils/exportUtils'

// IndexedDB writes started while the page unloads never commit: model that
// with a store whose writes stay pending forever unless a test lets them commit.
const idb = vi.hoisted(() => ({ commits: false, draft: undefined as string | undefined }))
vi.mock('../utils/browserStore', () => ({
  browserStoreGet: async () => idb.draft,
  browserStorePut: (_store: string, _key: string, value: string) => idb.commits ? (idb.draft = value, Promise.resolve(true)) : new Promise<boolean>(() => {}),
  browserStoreDelete: async () => true,
}))

beforeEach(() => {
  idb.commits = false
  idb.draft = undefined
  localStorage.clear()
  seedReturningVisitor()
  localStorage.setItem('flowchart-editor-draft-v3', serializeFlow([{ id: 'a', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Keep me' } }], [], 'flowchart'))
})

describe('Autosave on unload', () => {
  it('keeps an edit made just before the page closes', async () => {
    const { default: App } = await import('../App')
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    // Closed before the 500 ms autosave timer fires
    window.dispatchEvent(new Event('pagehide'))

    vi.resetModules()
    const drafts = await import('../utils/draftStore')
    await drafts.preloadDraft()
    const reopened = parseFlowJson(drafts.readDraft()!)
    expect(reopened.nodes).toHaveLength(2)
  })

  it('keeps an edit whose autosave was still writing when the page closed', async () => {
    const { default: App } = await import('../App')
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    // The timer's IndexedDB write starts, then the page closes before it commits
    await act(() => new Promise(resolve => setTimeout(resolve, 600)))
    window.dispatchEvent(new Event('pagehide'))

    vi.resetModules()
    const drafts = await import('../utils/draftStore')
    await drafts.preloadDraft()
    expect(parseFlowJson(drafts.readDraft()!).nodes).toHaveLength(2)
  })

  it('does not save over a newer board from another tab when an idle tab closes', async () => {
    idb.commits = true
    const { default: App } = await import('../App')
    render(<App />)
    fireEvent.click(screen.getByLabelText('Add Step Node'))
    await act(() => new Promise(resolve => setTimeout(resolve, 600)))
    // Another tab saves a newer board, then this idle tab closes
    idb.draft = serializeFlow([{ id: 'b', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Other tab' } }], [], 'flowchart')
    window.dispatchEvent(new Event('pagehide'))

    vi.resetModules()
    const drafts = await import('../utils/draftStore')
    await drafts.preloadDraft()
    expect(parseFlowJson(drafts.readDraft()!).nodes[0].data.label).toBe('Other tab')
  })
})

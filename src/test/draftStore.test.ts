import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
const available = { value: true, hang: false }
vi.mock('../utils/browserStore', () => ({
  browserStoreGet: async (_: string, key: string) => available.value ? store.get(key) : undefined,
  browserStorePut: (_: string, key: string, value: unknown) => available.hang ? new Promise<boolean>(() => {}) : (async () => { if (!available.value) return false; store.set(key, value); return true })(),
}))

const load = async () => { vi.resetModules(); return import('../utils/draftStore') }

beforeEach(() => { store.clear(); localStorage.clear(); available.value = true; available.hang = false })

describe('draft store', () => {
  it('migrates a localStorage draft into IndexedDB on the next save', async () => {
    localStorage.setItem('flowchart-editor-draft-v3', 'old board')
    const drafts = await load()
    await drafts.preloadDraft()
    expect(drafts.readDraft()).toBe('old board')
    await drafts.writeDraft('new board')
    expect(store.get('editor')).toBe('new board')
    expect(localStorage.getItem('flowchart-editor-draft-v3')).toBeNull()
    expect(drafts.readDraft()).toBe('new board')
  })

  it('reads the IndexedDB draft preloaded before the first render', async () => {
    store.set('editor', 'saved board')
    const drafts = await load()
    await drafts.preloadDraft()
    expect(drafts.readDraft()).toBe('saved board')
  })

  it('falls back to localStorage where IndexedDB is unavailable', async () => {
    store.set('editor', 'stale')
    const drafts = await load()
    await drafts.preloadDraft()
    available.value = false
    await drafts.writeDraft('fallback board')
    expect(localStorage.getItem('flowchart-editor-draft-v3')).toBe('fallback board')
    expect(drafts.readDraft()).toBe('fallback board')
  })

  it('reads a draft flushed on close before an IndexedDB draft that may be older', async () => {
    store.set('editor', 'older board')
    const drafts = await load()
    await drafts.preloadDraft()
    available.value = false // the unload interrupts the IndexedDB write
    await drafts.flushDraft('latest board').catch(() => {})
    available.value = true
    const reopened = await load()
    await reopened.preloadDraft()
    expect(reopened.readDraft()).toBe('latest board')
  })

  it('drops the flushed copy once an IndexedDB save succeeds', async () => {
    const drafts = await load()
    await drafts.flushDraft('closing board')
    await drafts.writeDraft('next board')
    expect(localStorage.getItem('flowchart-editor-draft-v3')).toBeNull()
    expect(drafts.readDraft()).toBe('next board')
  })

  it('drops the flushed copy when the board is too large for localStorage', async () => {
    localStorage.setItem('flowchart-editor-draft-v3', 'earlier copy')
    const drafts = await load()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    available.value = false
    await drafts.flushDraft('large board').catch(() => {})
    setItem.mockRestore()
    expect(localStorage.getItem('flowchart-editor-draft-v3')).toBeNull()
  })

  it('tells other tabs about a flush before its IndexedDB write settles', async () => {
    const drafts = await load()
    const otherTab = new BroadcastChannel('flowchart-draft')
    const heard = new Promise<unknown>(resolve => { otherTab.onmessage = event => resolve(event.data) })
    available.hang = true // the page unloads before the write resolves
    void drafts.flushDraft('closing board')
    expect(await heard).toBe('saved')
    otherTab.close()
  })
})

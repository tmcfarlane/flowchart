import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
const available = { value: true }
vi.mock('../utils/browserStore', () => ({
  browserStoreGet: async (_: string, key: string) => available.value ? store.get(key) : undefined,
  browserStorePut: async (_: string, key: string, value: unknown) => { if (!available.value) return false; store.set(key, value); return true },
}))

const load = async () => { vi.resetModules(); return import('../utils/draftStore') }

beforeEach(() => { store.clear(); localStorage.clear(); available.value = true })

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
})

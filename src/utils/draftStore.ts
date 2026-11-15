import { browserStoreGet, browserStorePut } from './browserStore'

// The autosaved board lives in IndexedDB, whose quota is a share of the disk
// rather than localStorage's ~5 MB, so boards with pasted images keep saving.
// localStorage remains the fallback where IndexedDB is unavailable, and the
// draft older versions left there is read once and migrated on the next save.
export const LEGACY_DRAFT_KEY = 'flowchart-editor-draft-v3'
const DRAFT_KEY = 'editor'

// IndexedDB is asynchronous but the editor reads its draft while initialising
// state, so main.tsx awaits preloadDraft() before the first render.
let preloaded: string | undefined

export async function preloadDraft(): Promise<void> {
  const saved = await browserStoreGet<string>('drafts', DRAFT_KEY)
  if (typeof saved === 'string') preloaded = saved
}

// A localStorage draft is never older than the IndexedDB one: every IndexedDB
// save removes it, so one that remains was written by a flush or a fallback.
export function readDraft(): string | null {
  return localStorage.getItem(LEGACY_DRAFT_KEY) ?? preloaded ?? null
}

/** Rejects only when neither IndexedDB nor localStorage can hold the draft. */
export async function writeDraft(text: string): Promise<void> {
  if (await browserStorePut('drafts', DRAFT_KEY, text)) {
    preloaded = text
    localStorage.removeItem(LEGACY_DRAFT_KEY)
    return
  }
  localStorage.setItem(LEGACY_DRAFT_KEY, text)
  preloaded = undefined
}

/**
 * Save while the page unloads. An IndexedDB write started then may never
 * commit, so keep a synchronous localStorage copy as well. A board too large
 * for localStorage drops the copy rather than leave an older one in front.
 */
export function flushDraft(text: string): Promise<void> {
  try {
    localStorage.setItem(LEGACY_DRAFT_KEY, text)
  } catch {
    localStorage.removeItem(LEGACY_DRAFT_KEY)
  }
  return writeDraft(text)
}

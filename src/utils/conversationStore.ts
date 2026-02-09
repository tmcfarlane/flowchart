// Temporary conversation thread storage with TTL expiration.
// Uses sessionStorage so threads auto-clear on tab close.
// TTL provides secondary cleanup for long-lived tabs.

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface StoredThread {
  id: string
  messages: ChatMessage[]
  createdAt: number
  lastAccessedAt: number
}

const STORAGE_KEY_PREFIX = 'fc_thread_'
const TTL_MS = 30 * 60 * 1000 // 30 minutes
const MAX_MESSAGES = 20

function threadKey(id: string): string {
  return `${STORAGE_KEY_PREFIX}${id}`
}

function isExpired(thread: StoredThread): boolean {
  return Date.now() - thread.lastAccessedAt > TTL_MS
}

function safeWrite(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value)
    return true
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      purgeExpired()
      try {
        sessionStorage.setItem(key, value)
        return true
      } catch {
        console.warn('sessionStorage quota exceeded even after purge')
        return false
      }
    }
    return false
  }
}

function readThread(id: string): StoredThread | null {
  try {
    const raw = sessionStorage.getItem(threadKey(id))
    if (!raw) return null
    const thread: StoredThread = JSON.parse(raw)
    if (isExpired(thread)) {
      sessionStorage.removeItem(threadKey(id))
      return null
    }
    thread.lastAccessedAt = Date.now()
    safeWrite(threadKey(id), JSON.stringify(thread))
    return thread
  } catch {
    return null
  }
}

function truncateMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages
  return messages.slice(-MAX_MESSAGES)
}

/** Remove all expired threads from sessionStorage. */
export function purgeExpired(): void {
  const keysToRemove: string[] = []
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i)
    if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
      try {
        const raw = sessionStorage.getItem(key)
        if (raw) {
          const thread: StoredThread = JSON.parse(raw)
          if (isExpired(thread)) {
            keysToRemove.push(key)
          }
        }
      } catch {
        keysToRemove.push(key!)
      }
    }
  }
  keysToRemove.forEach((k) => sessionStorage.removeItem(k))
}

/** Create a new conversation thread. Returns the thread ID. */
export function createThread(): string {
  const id = crypto.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2))
  const thread: StoredThread = {
    id,
    messages: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  }
  safeWrite(threadKey(id), JSON.stringify(thread))
  return id
}

/** Get all messages for a thread. Returns empty array if expired or missing. */
export function getMessages(threadId: string): ChatMessage[] {
  const thread = readThread(threadId)
  return thread ? thread.messages : []
}

/** Append a message to a thread, auto-truncating to last 20. */
export function addMessage(threadId: string, message: ChatMessage): void {
  let thread = readThread(threadId)
  if (!thread) {
    thread = {
      id: threadId,
      messages: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    }
  }
  thread.messages.push(message)
  thread.messages = truncateMessages(thread.messages)
  thread.lastAccessedAt = Date.now()
  safeWrite(threadKey(threadId), JSON.stringify(thread))
}

/** Delete a thread explicitly. */
export function deleteThread(threadId: string): void {
  sessionStorage.removeItem(threadKey(threadId))
}

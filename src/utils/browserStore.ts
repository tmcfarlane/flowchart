// Small IndexedDB key-value store for data too large or too rich for
// localStorage: the board draft (with embedded images) and saved-file handles.
// Every call resolves; callers treat `undefined` / `false` as "unavailable".

const DB_NAME = 'flowchart'
export type BrowserStoreName = 'drafts' | 'handles'
const STORES: BrowserStoreName[] = ['drafts', 'handles']

// One shared connection, so readwrite transactions run in the order issued
let connection: Promise<IDBDatabase | null> | undefined

function database(): Promise<IDBDatabase | null> {
  connection ??= new Promise(resolve => {
    try {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => { for (const store of STORES) open.result.createObjectStore(store) }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => resolve(null)
      open.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
  return connection
}

function request<T>(store: BrowserStoreName, mode: IDBTransactionMode, run: (objects: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: boolean; value?: T }> {
  return database().then(db => new Promise(resolve => {
    if (!db) return resolve({ ok: false })
    try {
      const transaction = db.transaction(store, mode)
      const pending = run(transaction.objectStore(store))
      // Resolve on commit, not on the request, so a reported write is durable
      transaction.oncomplete = () => resolve({ ok: true, value: pending.result })
      transaction.onerror = transaction.onabort = () => resolve({ ok: false })
    } catch { resolve({ ok: false }) }
  }))
}

export const browserStoreGet = <T>(store: BrowserStoreName, key: string) =>
  request<T>(store, 'readonly', objects => objects.get(key) as IDBRequest<T>).then(result => result.value)

export const browserStorePut = (store: BrowserStoreName, key: string, value: unknown) =>
  request(store, 'readwrite', objects => objects.put(value, key)).then(result => result.ok)

export const browserStoreDelete = (store: BrowserStoreName, key: string) =>
  request(store, 'readwrite', objects => objects.delete(key)).then(result => result.ok)

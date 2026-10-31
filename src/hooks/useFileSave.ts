import { useCallback, useEffect, useRef, useState } from 'react'

// File System Access API (Chromium). Not in TypeScript's DOM lib yet.
interface WritableFile { write(data: string): Promise<void>; close(): Promise<void> }
interface SaveFileHandle {
  name: string
  createWritable(): Promise<WritableFile>
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
}
type SaveFilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveFileHandle>

const SUGGESTED_NAME = 'flowchart.json'
const DB_NAME = 'flowchart-file-save'
const STORE = 'handles'
const HANDLE_KEY = 'current'

export type FileSaveStatus = { kind: 'saved' | 'downloaded'; name: string } | { kind: 'error'; message: string }

export function fileSaveMessage(status: FileSaveStatus): string {
  if (status.kind === 'error') return `Couldn't save: ${status.message}`
  return status.kind === 'saved' ? `Saved to ${status.name}` : `Downloaded ${status.name}`
}

function picker(): SaveFilePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
}

// File handles are structured-cloneable, so IndexedDB can keep the chosen file
// across visits. Failures only cost the remembered location, never a save.
function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise(resolve => {
    try {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onerror = () => resolve(undefined)
      open.onsuccess = () => {
        try {
          const request = run(open.result.transaction(STORE, mode).objectStore(STORE))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(undefined)
        } catch { resolve(undefined) }
      }
    } catch { resolve(undefined) }
  })
}

function download(contents: string, name: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.download = name
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Save the board to a file the user picks once; later saves write back to the
 * same file without a dialog. Browsers without the File System Access API
 * download the JSON instead.
 */
export function useFileSave(getContents: () => string) {
  const supported = typeof window !== 'undefined' && !!picker()
  const handle = useRef<SaveFileHandle | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<FileSaveStatus | null>(null)

  useEffect(() => {
    if (!supported) return
    void withStore<SaveFileHandle>('readonly', store => store.get(HANDLE_KEY)).then(saved => {
      if (saved && !handle.current) { handle.current = saved; setFileName(saved.name) }
    })
  }, [supported])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(null), 2500)
    return () => window.clearTimeout(timer)
  }, [status])

  const save = useCallback(async (chooseLocation = false) => {
    const contents = getContents()
    const showPicker = picker()
    if (!showPicker) {
      download(contents, SUGGESTED_NAME)
      setStatus({ kind: 'downloaded', name: SUGGESTED_NAME })
      return
    }
    try {
      let target = chooseLocation ? null : handle.current
      // A remembered file needs write access re-granted once per visit; the
      // keyboard shortcut or menu click is the user gesture that allows asking.
      if (target?.queryPermission && await target.queryPermission({ mode: 'readwrite' }) !== 'granted'
        && await target.requestPermission?.({ mode: 'readwrite' }) !== 'granted') target = null
      if (!target) {
        target = await showPicker({ suggestedName: handle.current?.name ?? SUGGESTED_NAME, types: [{ description: 'Flowchart', accept: { 'application/json': ['.json'] } }] })
        handle.current = target
        setFileName(target.name)
        void withStore('readwrite', store => store.put(target, HANDLE_KEY))
      }
      const writable = await target.createWritable()
      await writable.write(contents)
      await writable.close()
      setStatus({ kind: 'saved', name: target.name })
    } catch (error) {
      // Dismissing the file picker is not an error
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'The file could not be saved.' })
    }
  }, [getContents])

  return { supported, fileName, status, save: () => save(false), saveAs: () => save(true) }
}

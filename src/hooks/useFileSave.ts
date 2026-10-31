import { useCallback, useEffect, useRef, useState } from 'react'
import { browserStoreDelete, browserStoreGet, browserStorePut } from '../utils/browserStore'

// File System Access API (Chromium). Not in TypeScript's DOM lib yet.
interface WritableFile { write(data: string): Promise<void>; close(): Promise<void> }
export interface SaveFileHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<WritableFile>
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>
}
type FileTypes = { description: string; accept: Record<string, string[]> }[]
type SaveFilePicker = (options: { suggestedName: string; types: FileTypes }) => Promise<SaveFileHandle>
type OpenFilePicker = (options: { types: FileTypes; multiple: false }) => Promise<SaveFileHandle[]>

const SUGGESTED_NAME = 'flowchart.json'
const HANDLE_KEY = 'current'

export type FileSaveStatus = { kind: 'saved' | 'downloaded'; name: string } | { kind: 'error'; message: string }

export function fileSaveMessage(status: FileSaveStatus): string {
  if (status.kind === 'error') return `Couldn't save: ${status.message}`
  return status.kind === 'saved' ? `Saved to ${status.name}` : `Downloaded ${status.name}`
}

function picker(): SaveFilePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
}

function openPicker(): OpenFilePicker | undefined {
  return (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

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

  // File handles are structured-cloneable, so IndexedDB keeps the chosen file
  // across visits. Failures only cost the remembered location, never a save.
  useEffect(() => {
    if (!supported) return
    void browserStoreGet<SaveFileHandle>('handles', HANDLE_KEY).then(saved => {
      if (saved && !handle.current) { handle.current = saved; setFileName(saved.name) }
    })
  }, [supported])

  /** The file Save writes to; null forgets it so the next Save asks again. */
  const setKnownFile = useCallback((next: SaveFileHandle | null) => {
    handle.current = next
    setFileName(next?.name ?? null)
    void (next ? browserStorePut('handles', HANDLE_KEY, next) : browserStoreDelete('handles', HANDLE_KEY))
  }, [])

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
        setKnownFile(target)
      }
      const writable = await target.createWritable()
      await writable.write(contents)
      await writable.close()
      setStatus({ kind: 'saved', name: target.name })
    } catch (error) {
      // Dismissing the file picker is not an error
      if (isAbort(error)) return
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'The file could not be saved.' })
    }
  }, [getContents, setKnownFile])

  /**
   * Pick a file to open, keeping its handle so a Flowchart file can become the
   * Save target. Undefined where the API is missing or the picker is dismissed.
   */
  const open = useCallback(async (): Promise<{ file: File; handle: SaveFileHandle } | undefined> => {
    const showOpen = openPicker()
    if (!showOpen) return undefined
    try {
      const [picked] = await showOpen({ types: [{ description: 'Flowchart or Excalidraw drawing', accept: { 'application/json': ['.json', '.excalidraw'] } }], multiple: false })
      return { file: await picked.getFile(), handle: picked }
    } catch (error) {
      if (isAbort(error)) return undefined
      throw error
    }
  }, [])

  const saveCurrent = useCallback(() => save(false), [save])
  const saveAs = useCallback(() => save(true), [save])
  return { supported, canOpen: supported && !!openPicker(), fileName, status, save: saveCurrent, saveAs, open, setKnownFile }
}

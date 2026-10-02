import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface Entry<T> { value: T; key: string }
interface History<T> { entries: Entry<T>[]; index: number }
interface Options<T> {
  value: T
  fingerprint: (value: T) => string
  onRestore: (value: T) => void
  maxEntries?: number
  debounceMs?: number
}

/** Content history includes the current edit immediately, even before autosave. */
export function useDiagramHistory<T>({ value, fingerprint, onRestore, maxEntries = 10, debounceMs = 500 }: Options<T>) {
  const key = useMemo(() => fingerprint(value), [value, fingerprint])
  const latest = useRef<Entry<T>>({ value, key })
  latest.current = { value, key }
  const restore = useRef(onRestore)
  restore.current = onRestore
  const [history, setHistory] = useState<History<T>>(() => ({ entries: [{ value, key }], index: 0 }))
  const current = useRef(history)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const cancelPending = useCallback(() => { clearTimeout(timer.current); timer.current = undefined }, [])
  const install = useCallback((next: History<T>) => { current.current = next; setHistory(next) }, [])
  const append = useCallback((previous: History<T>, entry: Entry<T>): History<T> => {
    if (previous.entries[previous.index].key === entry.key) return previous
    const entries = [...previous.entries.slice(0, previous.index + 1), entry].slice(-Math.max(2, maxEntries))
    return { entries, index: entries.length - 1 }
  }, [maxEntries])
  const capture = useCallback(() => {
    cancelPending()
    const next = append(current.current, latest.current)
    if (next !== current.current) install(next)
  }, [append, cancelPending, install])
  const undo = useCallback(() => {
    cancelPending()
    // Save the visible result before stepping back, so Redo is already usable.
    const saved = append(current.current, latest.current)
    if (saved.index === 0) return
    const next = { ...saved, index: saved.index - 1 }
    install(next)
    restore.current(next.entries[next.index].value)
  }, [append, cancelPending, install])
  const redo = useCallback(() => {
    cancelPending()
    const saved = current.current
    if (latest.current.key !== saved.entries[saved.index].key || saved.index === saved.entries.length - 1) return
    const next = { ...saved, index: saved.index + 1 }
    install(next)
    restore.current(next.entries[next.index].value)
  }, [cancelPending, install])
  const reset = useCallback((nextValue: T) => {
    cancelPending()
    install({ entries: [{ value: nextValue, key: fingerprint(nextValue) }], index: 0 })
  }, [cancelPending, fingerprint, install])

  useEffect(() => {
    if (key === history.entries[history.index].key) return
    timer.current = setTimeout(capture, debounceMs)
    return cancelPending
  }, [key, history, capture, debounceMs, cancelPending])

  const hasUnrecordedEdit = key !== history.entries[history.index].key
  return {
    capture, undo, redo, reset,
    canUndo: hasUnrecordedEdit || history.index > 0,
    canRedo: !hasUnrecordedEdit && history.index < history.entries.length - 1,
  }
}

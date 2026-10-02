import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useDiagramHistory } from '../hooks/useDiagramHistory'

const fingerprint = (value: string) => value
function useHarness(maxEntries = 10) {
  const [value, setValue] = useState('initial')
  return { value, setValue, ...useDiagramHistory({ value, fingerprint, onRestore: setValue, maxEntries }) }
}
afterEach(() => vi.useRealTimers())

describe('Diagram content history', () => {
  it('makes an immediate edit undoable and redoable before its debounce expires', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness())
    act(() => result.current.setValue('edited'))
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.undo())
    expect(result.current.value).toBe('initial')
    expect(result.current.canRedo).toBe(true)
    act(() => vi.runAllTimers())
    expect(result.current.value).toBe('initial')
    act(() => result.current.redo())
    expect(result.current.value).toBe('edited')
  })

  it('captures an unsaved pre-command diagram without adding duplicate history', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.setValue('before command'))
    act(() => { result.current.capture(); result.current.capture() })
    act(() => result.current.setValue('command result'))
    act(() => result.current.undo())
    expect(result.current.value).toBe('before command')
    act(() => result.current.undo())
    expect(result.current.value).toBe('initial')
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.redo())
    act(() => result.current.redo())
    expect(result.current.value).toBe('command result')
  })

  it('cuts the old redo branch as soon as a new edit occurs', () => {
    const { result } = renderHook(() => useHarness())
    act(() => result.current.setValue('old branch'))
    act(() => result.current.undo())
    act(() => result.current.setValue('new branch'))
    expect(result.current.canRedo).toBe(false)
    act(() => result.current.redo())
    expect(result.current.value).toBe('new branch')
    act(() => result.current.capture())
    act(() => result.current.undo())
    act(() => result.current.redo())
    expect(result.current.value).toBe('new branch')
  })

  it('keeps only the configured recent states without losing their redo values', () => {
    const { result } = renderHook(() => useHarness(3))
    for (const value of ['one', 'two', 'three', 'four']) {
      act(() => result.current.setValue(value))
      act(() => result.current.capture())
    }
    act(() => result.current.undo())
    expect(result.current.value).toBe('three')
    act(() => result.current.undo())
    expect(result.current.value).toBe('two')
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.redo())
    act(() => result.current.redo())
    expect(result.current.value).toBe('four')
  })

  it('resets a loaded/shared diagram without an undo path to a prior empty canvas', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness())
    act(() => result.current.setValue('pending local edit'))
    act(() => { result.current.reset('loaded chart'); result.current.setValue('loaded chart') })
    act(() => vi.runAllTimers())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    act(() => result.current.setValue('loaded chart edit'))
    act(() => result.current.undo())
    expect(result.current.value).toBe('loaded chart')
  })

  it('ignores presentation-only updates when their content fingerprint is unchanged', () => {
    const byContent = (value: { text: string; selected: boolean }) => value.text
    const { result } = renderHook(() => {
      const [value, setValue] = useState({ text: 'initial', selected: false })
      return { value, setValue, ...useDiagramHistory({ value, fingerprint: byContent, onRestore: setValue }) }
    })
    act(() => result.current.setValue({ text: 'initial', selected: true }))
    expect(result.current.canUndo).toBe(false)
    act(() => result.current.setValue({ text: 'edited', selected: true }))
    act(() => result.current.undo())
    act(() => result.current.setValue({ text: 'initial', selected: true }))
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.value.text).toBe('edited')
  })
})

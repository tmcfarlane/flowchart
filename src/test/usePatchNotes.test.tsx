import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePatchNotes } from '../hooks/usePatchNotes'
import { PATCH_NOTES } from '../patchNotes'

const key = 'flowchart-patch-notes-seen-revision'
const latest = PATCH_NOTES[0].revision

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('patch note acknowledgement', () => {
  it.each([null, '0', '-1', 'broken', '1.5', 'Infinity', '9007199254740992', '1e0', ' 1 '])('opens unseen or malformed revision %s without marking it seen', (saved) => {
    if (saved !== null) localStorage.setItem(key, saved)
    const { result } = renderHook(() => usePatchNotes(true))
    expect(result.current.isOpen).toBe(true)
    expect(localStorage.getItem(key)).toBe(saved)
  })

  it.each([latest, latest + 1, Number.MAX_SAFE_INTEGER])('keeps acknowledged revision %s closed and allows manual reopening', (saved) => {
    localStorage.setItem(key, String(saved))
    const { result } = renderHook(() => usePatchNotes(true))
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    expect(localStorage.getItem(key)).toBe(String(saved))
  })

  it('waits for a ready editor, preserves an unread release when temporarily hidden, and allows a manual override', () => {
    const { result, rerender } = renderHook(({ ready }) => usePatchNotes(ready), { initialProps: { ready: false } })
    expect(result.current.isOpen).toBe(false)
    rerender({ ready: true })
    expect(result.current.isOpen).toBe(true)
    rerender({ ready: false })
    expect(result.current.isOpen).toBe(false)
    expect(localStorage.getItem(key)).toBeNull()
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
  })

  it('acknowledges only on dismissal and stays closed across readiness changes and reload', () => {
    const first = renderHook(({ ready }) => usePatchNotes(ready), { initialProps: { ready: true } })
    expect(localStorage.getItem(key)).toBeNull()
    first.unmount()
    const second = renderHook(({ ready }) => usePatchNotes(ready), { initialProps: { ready: true } })
    expect(second.result.current.isOpen).toBe(true)
    act(() => second.result.current.dismiss())
    expect(localStorage.getItem(key)).toBe(String(latest))
    second.rerender({ ready: false })
    second.rerender({ ready: true })
    expect(second.result.current.isOpen).toBe(false)
    second.unmount()
    expect(renderHook(() => usePatchNotes(true)).result.current.isOpen).toBe(false)
  })

  it('still dismisses and reopens manually when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked') })
    const { result, rerender } = renderHook(({ ready }) => usePatchNotes(ready), { initialProps: { ready: true } })
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.dismiss())
    rerender({ ready: false })
    rerender({ ready: true })
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.dismiss())
    expect(result.current.isOpen).toBe(false)
  })
})

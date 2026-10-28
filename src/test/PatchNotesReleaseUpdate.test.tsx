import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePatchNotes } from '../hooks/usePatchNotes'
import PatchNotesDialog from '../components/PatchNotesDialog'

const catalog = vi.hoisted(() => [
  { revision: 2, publishedOn: '2026-10-29', title: 'A new release', highlights: ['A newly shipped change.'] },
  { revision: 1, publishedOn: '2026-10-28', title: 'An earlier release', highlights: ['An earlier shipped change.'] },
])
vi.mock('../patchNotes', () => ({ PATCH_NOTES: catalog }))
const originalCatalog = [...catalog]

afterEach(() => { cleanup(); localStorage.clear(); catalog.splice(0, catalog.length, ...originalCatalog) })

describe('publishing another release', () => {
  it('announces the higher revision to an existing visitor and acknowledges that revision', () => {
    localStorage.setItem('flowchart-patch-notes-seen-revision', '1')
    const { result } = renderHook(() => usePatchNotes(true))
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.dismiss())
    expect(localStorage.getItem('flowchart-patch-notes-seen-revision')).toBe('2')
    expect(result.current.isOpen).toBe(false)
  })

  it('shows the latest release above preserved history without component changes', () => {
    render(<PatchNotesDialog onDismiss={() => {}} />)
    expect(screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['A new release', 'An earlier release'])
    expect(screen.getAllByText('Latest')).toHaveLength(1)
  })

  it('does not announce an acknowledged release after a rollback, manual dismissal, and restoration', () => {
    localStorage.setItem('flowchart-patch-notes-seen-revision', '2')
    catalog.shift()
    const rollback = renderHook(() => usePatchNotes(true))
    expect(rollback.result.current.isOpen).toBe(false)
    act(() => rollback.result.current.open())
    expect(rollback.result.current.isOpen).toBe(true)
    act(() => rollback.result.current.dismiss())
    expect(localStorage.getItem('flowchart-patch-notes-seen-revision')).toBe('2')
    rollback.unmount()
    catalog.unshift(originalCatalog[0])
    expect(renderHook(() => usePatchNotes(true)).result.current.isOpen).toBe(false)
  })
})

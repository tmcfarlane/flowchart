import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TemplateGallery from '../components/TemplateGallery'
import { DIAGRAM_TEMPLATES } from '../shared/diagramTemplates'
import { parseTemplateFavorites, TEMPLATE_FAVORITES_KEY } from '../utils/templateFavorites'

const dream = 'dream-observatory'
const learning = 'learning-loop'
const cloud = 'azure-serverless'
const title = (id: string) => DIAGRAM_TEMPLATES.find(template => template.id === id)!.title
const raw = (...ids: string[]) => JSON.stringify({ version: 1, ids })
const star = (id: string) => screen.getByRole('button', { name: `Favorite ${title(id)} template` })
const use = (id: string) => screen.getByRole('button', { name: `Use ${title(id)} template` })
const favorites = () => screen.getByRole('button', { name: /^Favorites \(\d+\)$/ })
const cards = () => [...document.querySelectorAll<HTMLElement>('[data-template-id]')].map(card => card.dataset.templateId)
const statusText = () => screen.getAllByRole('status').map(status => status.textContent).join(' ')
function open() {
  const onClose = vi.fn(), onSelect = vi.fn()
  const view = render(<TemplateGallery isOpen onClose={onClose} onSelect={onSelect} />)
  return { view, onClose, onSelect, reopen() {
    view.rerender(<TemplateGallery isOpen={false} onClose={onClose} onSelect={onSelect} />)
    view.rerender(<TemplateGallery isOpen onClose={onClose} onSelect={onSelect} />)
  } }
}
function storageEvent(key: string | null, newValue: string | null, area = localStorage) {
  act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: area })))
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Browser template favorites', () => {
  it('stars a template independently, stores IDs only, and persists across close/reopen before explicit selection', () => {
    const fetchMock = vi.fn(() => { throw new Error('Favorites must stay local') })
    vi.stubGlobal('fetch', fetchMock)
    const controls = open()
    fireEvent.click(star(dream))
    expect(star(dream)).toHaveAttribute('aria-pressed', 'true')
    expect(favorites()).toHaveTextContent('Favorites (1)')
    expect(controls.onSelect).not.toHaveBeenCalled()
    expect(controls.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!)
    expect(Object.keys(stored).sort()).toEqual(['ids', 'version'])
    expect(stored).toEqual({ version: 1, ids: [dream] })
    controls.reopen()
    expect(star(dream)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(use(dream))
    expect(controls.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: dream, nodes: expect.any(Array), edges: expect.any(Array) }))
    expect(controls.onClose).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('combines favorites with the shared multiword search, and recovers from a search with no match', () => {
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream, learning, cloud))
    open()
    fireEvent.click(favorites())
    expect(new Set(cards())).toEqual(new Set([dream, learning, cloud]))
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'recall LEARNING' } })
    expect(cards()).toEqual([learning])
    fireEvent.change(search, { target: { value: 'unknown-zzqqzz' } })
    expect(screen.getByText('No match in this constellation.')).toBeInTheDocument()
    expect(favorites()).toHaveTextContent('(3)')
    fireEvent.click(screen.getByRole('button', { name: 'Show all templates' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(cards()).toHaveLength(DIAGRAM_TEMPLATES.length)
    expect(screen.getByRole('button', { name: 'All ideas' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('returns focus to search when the last favorite disappears and leaves an actionable empty view', () => {
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream))
    const controls = open()
    fireEvent.click(favorites())
    const remove = star(dream)
    remove.focus()
    fireEvent.click(remove)
    expect(screen.getByRole('searchbox')).toHaveFocus()
    expect(cards()).toEqual([])
    expect(screen.getByText('Keep your best starting points close.')).toBeInTheDocument()
    expect(localStorage.getItem(TEMPLATE_FAVORITES_KEY)).toBeNull()
    expect(controls.onSelect).not.toHaveBeenCalled()
    expect(controls.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show all templates' }))
    expect(cards()).toHaveLength(DIAGRAM_TEMPLATES.length)
  })

  it.each([
    ['missing', null],
    ['invalid JSON', '{bad json'],
    ['array envelope', '[]'],
    ['unsupported version', '{"version":2,"ids":["dream-observatory"]}'],
    ['invalid IDs shape', '{"version":1,"ids":"dream-observatory"}'],
    ['oversized payload', JSON.stringify({ version: 1, ids: [dream], ignored: 'x'.repeat(5000) })],
  ])('safely ignores %s saved values', (_description, value) => {
    if (value !== null) localStorage.setItem(TEMPLATE_FAVORITES_KEY, value)
    open()
    expect(favorites()).toHaveTextContent('(0)')
    expect(cards()).toHaveLength(DIAGRAM_TEMPLATES.length)
    expect(parseTemplateFavorites(value)).toEqual([])
  })

  it('filters unknown, duplicate and nonstring IDs, and never carries unrelated metadata into a later write', () => {
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, JSON.stringify({ version: 1, ids: [dream, 'unknown-id', dream, null, 12, { id: cloud }, '__proto__'], editToken: 'untrusted-fixture', nodes: [{ label: 'Untrusted content' }] }))
    open()
    expect(favorites()).toHaveTextContent('(1)')
    expect(star(dream)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(star(cloud))
    const stored = JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!)
    expect(Object.keys(stored).sort()).toEqual(['ids', 'version'])
    expect(stored.version).toBe(1)
    expect(new Set(stored.ids)).toEqual(new Set([dream, cloud]))
  })

  it('keeps all temporary choices after repeated quota failures, then persists them when storage recovers', () => {
    const original = Storage.prototype.setItem
    let blocked = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
      if (this === localStorage && key === TEMPLATE_FAVORITES_KEY && blocked) throw new DOMException('Full', 'QuotaExceededError')
      return original.call(this, key, value)
    })
    const controls = open()
    fireEvent.click(star(dream))
    fireEvent.click(star(cloud))
    expect(favorites()).toHaveTextContent('(2)')
    expect(star(dream)).toHaveAttribute('aria-pressed', 'true')
    expect(star(cloud)).toHaveAttribute('aria-pressed', 'true')
    expect(statusText()).toMatch(/could not.*save|cannot.*save/i)
    expect(localStorage.getItem(TEMPLATE_FAVORITES_KEY)).toBeNull()
    expect(controls.onClose).not.toHaveBeenCalled()
    blocked = false
    fireEvent.click(star(learning))
    expect(new Set(JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!).ids)).toEqual(new Set([dream, cloud, learning]))
    controls.reopen()
    expect(favorites()).toHaveTextContent('(3)')
  })

  it('does not erase unread saved preferences after get failure, while retaining temporary choices and honest feedback', () => {
    const saved = raw(learning)
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, saved)
    const original = Storage.prototype.getItem
    let blocked = true
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(key) {
      if (this === localStorage && key === TEMPLATE_FAVORITES_KEY && blocked) throw new Error('Browser storage unavailable')
      return original.call(this, key)
    })
    const setter = vi.spyOn(Storage.prototype, 'setItem')
    const controls = open()
    expect(cards()).toHaveLength(DIAGRAM_TEMPLATES.length)
    expect(statusText()).toMatch(/could not.*read|cannot.*read|unavailable/i)
    fireEvent.click(star(dream))
    expect(star(dream)).toHaveAttribute('aria-pressed', 'true')
    expect(statusText()).toMatch(/could not.*save|cannot.*save/i)
    expect(setter).not.toHaveBeenCalled()
    blocked = false
    expect(localStorage.getItem(TEMPLATE_FAVORITES_KEY)).toBe(saved)
    fireEvent.click(star(cloud))
    expect(new Set(JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!).ids)).toEqual(new Set([dream, learning, cloud]))
    expect(controls.onSelect).not.toHaveBeenCalled()
    expect(controls.onClose).not.toHaveBeenCalled()
  })

  it('merges the latest unrelated cross-tab choice before adding or removing one favorite', () => {
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream))
    open()
    // Simulate another tab writing before this gallery receives its event.
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream, learning))
    fireEvent.click(star(cloud))
    expect(new Set(JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!).ids)).toEqual(new Set([dream, learning, cloud]))
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream, learning))
    fireEvent.click(star(dream))
    expect(JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!).ids).toEqual([learning])
    expect(favorites()).toHaveTextContent('(1)')
  })

  it('preserves a failed local addition and a later unrelated cross-tab addition together when saving resumes', () => {
    const original = Storage.prototype.setItem
    let blocked = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
      if (this === localStorage && key === TEMPLATE_FAVORITES_KEY && blocked) throw new DOMException('Full', 'QuotaExceededError')
      return original.call(this, key, value)
    })
    open()
    fireEvent.click(star(dream))
    blocked = false
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(learning))
    fireEvent.click(star(cloud))
    expect(new Set(JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!).ids)).toEqual(new Set([dream, learning, cloud]))
  })

  it('keeps a pending local removal when a cross-tab event arrives, then saves it alongside a new favorite', () => {
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream))
    const original = Storage.prototype.removeItem
    let blocked = true
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function(key) {
      if (this === localStorage && key === TEMPLATE_FAVORITES_KEY && blocked) throw new Error('Browser storage blocked')
      return original.call(this, key)
    })
    open()
    fireEvent.click(favorites())
    star(dream).focus()
    fireEvent.click(star(dream))
    expect(screen.getByRole('searchbox')).toHaveFocus()
    expect(favorites()).toHaveTextContent('(0)')
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream, learning))
    storageEvent(TEMPLATE_FAVORITES_KEY, raw(dream, learning))
    expect(cards()).toEqual([learning])
    expect(statusText()).toMatch(/could not.*save/i)
    blocked = false
    fireEvent.click(screen.getByRole('button', { name: 'All ideas' }))
    fireEvent.click(star(cloud))
    expect(new Set(JSON.parse(localStorage.getItem(TEMPLATE_FAVORITES_KEY)!).ids)).toEqual(new Set([learning, cloud]))
    expect(star(dream)).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps unsaved local intent and its warning across a cross-tab clear, then loses only unsaved state on close', () => {
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
      if (this === localStorage && key === TEMPLATE_FAVORITES_KEY) throw new DOMException('Full', 'QuotaExceededError')
      return original.call(this, key, value)
    })
    const controls = open()
    fireEvent.click(star(dream))
    storageEvent(null, null)
    expect(favorites()).toHaveTextContent('(1)')
    expect(star(dream)).toHaveAttribute('aria-pressed', 'true')
    expect(statusText()).toMatch(/could not.*save/i)
    controls.reopen()
    expect(favorites()).toHaveTextContent('(0)')
    expect(star(dream)).toHaveAttribute('aria-pressed', 'false')
    expect(controls.onSelect).not.toHaveBeenCalled()
  })

  it('syncs localStorage removal and clear events, moves focus off removed cards, and ignores unrelated/sessionStorage events', () => {
    localStorage.setItem(TEMPLATE_FAVORITES_KEY, raw(dream, learning))
    open()
    fireEvent.click(favorites())
    star(dream).focus()
    storageEvent(TEMPLATE_FAVORITES_KEY, raw(learning))
    expect(cards()).toEqual([learning])
    expect(screen.getByRole('searchbox')).toHaveFocus()
    storageEvent('unrelated-preference', raw(cloud))
    storageEvent(TEMPLATE_FAVORITES_KEY, raw(cloud), sessionStorage)
    storageEvent(null, null, sessionStorage)
    expect(cards()).toEqual([learning])
    storageEvent(null, null)
    expect(favorites()).toHaveTextContent('(0)')
    expect(cards()).toEqual([])
    expect(screen.getByText('Keep your best starting points close.')).toBeInTheDocument()
  })
})

import { act, renderHook } from '@testing-library/react'
import type { Edge, Node } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_DRAFT_DEBOUNCE_MS, LOCAL_DRAFT_KEY, MAX_DRAFT_EMBEDDED_IMAGE_BYTES, MAX_LOCAL_DRAFT_BYTES,
  parseLocalDraft, useLocalDraft, type LocalDraft,
} from '../hooks/useLocalDraft'

const START = Date.UTC(2026, 9, 1, 10)
const GENERATED_IMAGE = `/api/images/9ec56aa3-6579-4bb0-8d05-2db965f357a3?key=${'k'.repeat(43)}`
const node = (label = 'Collect moonlight'): Node => ({ id: 'moon', type: 'step', position: { x: 40, y: 60 }, data: { label } })
const savedDraft = (): LocalDraft => ({ version: 1, savedAt: START - 60_000, diagramMode: 'flowchart', flow: { nodes: [{ id: 'moon', type: 'step', label: 'Collect moonlight', position: { x: 40, y: 60 } }], edges: [] } })
const options = (nodes: Node[] = []) => ({ nodes, edges: [] as Edge[], diagramMode: 'flowchart' as const, enabled: true })
const advance = (ms = LOCAL_DRAFT_DEBOUNCE_MS) => act(() => { vi.advanceTimersByTime(ms) })
const read = () => parseLocalDraft(window.localStorage.getItem(LOCAL_DRAFT_KEY) ?? '')

beforeEach(() => {
  vi.useFakeTimers({ now: START })
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/') })

describe('Local diagram recovery', () => {
  it('keeps a previous draft reviewable without overwriting it with startup or new canvas work', () => {
    const draft = savedDraft()
    const raw = JSON.stringify(draft)
    window.localStorage.setItem(LOCAL_DRAFT_KEY, raw)
    const hook = renderHook(useLocalDraft, { initialProps: options() })
    expect(hook.result.current.recovery).toEqual(draft)
    advance(10_000)
    hook.rerender(options([node('My new canvas')]))
    advance(10_000)
    expect(window.localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
    expect(hook.result.current.recovery?.flow.nodes[0].label).toBe('Collect moonlight')
  })

  it('returns a draft only on explicit Restore, keeps its good copy, and resumes saving after application', () => {
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(savedDraft()))
    const hook = renderHook(useLocalDraft, { initialProps: options() })
    let recovered: LocalDraft | null = null
    act(() => { recovered = hook.result.current.restoreDraft() })
    expect(recovered).toEqual(savedDraft())
    expect(hook.result.current.recovery).toBeNull()
    advance(10_000)
    expect(read()?.flow.nodes[0].label).toBe('Collect moonlight')
    hook.rerender(options([node()]))
    advance()
    expect(read()?.savedAt).toBe(START - 60_000)
    hook.rerender(options([node('Tune the dream receiver')]))
    advance()
    expect(read()?.flow.nodes[0].label).toBe('Tune the dream receiver')
    expect(hook.result.current.status).toBe('saved')
  })

  it('discards the old recovery copy and saves current work only after a later edit', () => {
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(savedDraft()))
    const hook = renderHook(useLocalDraft, { initialProps: options([node('A different thought')]) })
    act(() => hook.result.current.discardDraft())
    advance(10_000)
    expect(read()).toBeNull()
    hook.rerender(options([node('A different thought, edited')]))
    advance()
    expect(read()?.flow.nodes[0].label).toBe('A different thought, edited')
  })

  it('batches rapid edits and ignores selection and callback changes in the document', () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const hook = renderHook(useLocalDraft, { initialProps: options([node('First thought')]) })
    advance(400)
    hook.rerender(options([node('Second thought')]))
    advance(700)
    expect(writes).not.toHaveBeenCalled()
    advance(100)
    expect(writes).toHaveBeenCalledOnce()
    expect(read()?.flow.nodes[0].label).toBe('Second thought')
    hook.rerender(options([{ ...node('Second thought'), selected: true, data: { label: 'Second thought', onLabelChange: vi.fn() } }]))
    advance(2_000)
    expect(writes).toHaveBeenCalledOnce()
  })

  it('flushes the latest pending diagram on pagehide and cancels the queued duplicate', () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const hook = renderHook(useLocalDraft, { initialProps: options([node('First thought')]) })
    hook.rerender(options([node('Last thought before refresh')]))
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(read()?.flow.nodes[0].label).toBe('Last thought before refresh')
    advance(2_000)
    expect(writes).toHaveBeenCalledOnce()
  })

  it('purges saved and pending writes on Clear All, then saves a fresh diagram', () => {
    const hook = renderHook(useLocalDraft, { initialProps: options([node()]) })
    advance()
    expect(read()).not.toBeNull()
    hook.rerender(options([node('Pending update')]))
    act(() => hook.result.current.clearDraft())
    hook.rerender(options())
    act(() => window.dispatchEvent(new Event('pagehide')))
    advance(2_000)
    expect(read()).toBeNull()
    hook.rerender(options([node('Fresh moonlight')]))
    advance()
    expect(read()?.flow.nodes[0].label).toBe('Fresh moonlight')
  })

  it('refuses shared routes before their chart loads even when a caller incorrectly enables it', () => {
    const raw = JSON.stringify(savedDraft())
    window.localStorage.setItem(LOCAL_DRAFT_KEY, raw)
    window.history.replaceState(null, '', '/f/shared-chart#edit=secret-edit-capability')
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const hook = renderHook(useLocalDraft, { initialProps: options([node('Shared private chart')]) })
    expect(hook.result.current.status).toBe('disabled')
    expect(hook.result.current.recovery).toBeNull()
    act(() => { hook.result.current.flushDraft(); hook.result.current.clearDraft() })
    advance(10_000)
    expect(reads).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
  })

  it('cancels pending work when sharing starts and reviews a saved local copy when re-enabled', () => {
    const hook = renderHook(useLocalDraft, { initialProps: options([node()]) })
    hook.rerender({ ...options([node('A shared chart')]), enabled: false })
    advance(2_000)
    expect(read()).toBeNull()
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(savedDraft()))
    hook.rerender(options([node('Current canvas')]))
    expect(hook.result.current.recovery).toEqual(savedDraft())
    advance(2_000)
    expect(read()?.flow.nodes[0].label).toBe('Collect moonlight')
  })

  it('keeps the last good draft after quota failure and allows an explicit retry', () => {
    const hook = renderHook(useLocalDraft, { initialProps: options([node()]) })
    advance()
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY)
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    hook.rerender(options([node('A newer thought')]))
    advance()
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.error).toMatch(/Export/)
    expect(window.localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
    writes.mockRestore()
    act(() => hook.result.current.flushDraft())
    expect(read()?.flow.nodes[0].label).toBe('A newer thought')
    expect(hook.result.current.status).toBe('saved')
  })

  it('handles blocked browser storage without crashing or applying a draft', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const hook = renderHook(useLocalDraft, { initialProps: options() })
    expect(hook.result.current.recovery).toBeNull()
    expect(hook.result.current.status).toBe('error')
    expect(hook.result.current.error).toMatch(/current diagram is unchanged/)
  })

  it('serializes only diagram fields while preserving icon and connection metadata', () => {
    const nodes: Node[] = [
      { ...node(), type: 'image', data: { label: 'Collect moonlight', icon: 'icon-moon', paymentToken: 'private-payment-token', editToken: 'private-edit-token', onLabelChange: vi.fn() } },
      { id: 'dream', type: 'service', position: { x: 200, y: 60 }, data: { label: 'Dream receiver' } },
    ]
    const edges: Edge[] = [{ id: 'moon-dream', source: 'moon', target: 'dream', data: { protocol: 'gRPC', commStyle: 'async', token: 'private-edge-token' } }]
    const hook = renderHook(useLocalDraft, { initialProps: { ...options(nodes), edges, diagramMode: 'architecture' as const } })
    advance()
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY) ?? ''
    expect(raw).not.toMatch(/private-|onLabelChange|paymentToken|editToken/)
    expect(read()?.flow.nodes[0].icon).toBe('icon-moon')
    expect(read()?.flow.edges[0]).toMatchObject({ protocol: 'gRPC', commStyle: 'async' })
    expect(hook.result.current.savedAt).toBe(START + LOCAL_DRAFT_DEBOUNCE_MS)
  })

  it('preserves a good draft when a large embedded image cannot be saved', () => {
    const hook = renderHook(useLocalDraft, { initialProps: options([node()]) })
    advance()
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY)
    hook.rerender(options([{ id: 'image', type: 'image', position: { x: 0, y: 0 }, data: { label: 'Original art', imageUrl: `data:image/png;base64,${'a'.repeat(MAX_DRAFT_EMBEDDED_IMAGE_BYTES)}` } }]))
    advance()
    expect(hook.result.current.error).toMatch(/embedded image is too large/)
    expect(window.localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(raw)
  })

  it('recovers a generated image by its shareable asset URL after a reload', () => {
    const imageNode: Node = { id: 'art', type: 'image', position: { x: 40, y: 60 }, data: { label: 'Moonlight studio', imageUrl: GENERATED_IMAGE, paymentToken: 'account-secret' } }
    const first = renderHook(useLocalDraft, { initialProps: options([imageNode]) })
    advance()
    expect(first.result.current.status).toBe('saved')
    first.unmount()
    const reloaded = renderHook(useLocalDraft, { initialProps: options() })
    expect(reloaded.result.current.recovery?.flow.nodes[0]).toMatchObject({ id: 'art', imageUrl: GENERATED_IMAGE })
    let restored: LocalDraft | null = null
    act(() => { restored = reloaded.result.current.restoreDraft() })
    expect(restored?.flow.nodes[0].imageUrl).toBe(GENERATED_IMAGE)
    expect(window.localStorage.getItem(LOCAL_DRAFT_KEY)).not.toContain('account-secret')
  })

  it('cancels pending timers on unmount', () => {
    const hook = renderHook(useLocalDraft, { initialProps: options([node()]) })
    hook.unmount()
    advance(2_000)
    expect(read()).toBeNull()
  })
})

describe('Bounded draft decoding', () => {
  it.each([
    ['duplicate nodes', (draft: LocalDraft) => { draft.flow.nodes.push({ ...draft.flow.nodes[0] }) }],
    ['missing endpoint', (draft: LocalDraft) => { draft.flow.edges = [{ id: 'bad', source: 'moon', target: 'missing' }] }],
    ['non-container parent', (draft: LocalDraft) => { draft.flow.nodes.push({ ...draft.flow.nodes[0], id: 'child', parentNode: 'moon' }) }],
    ['cyclic parents', (draft: LocalDraft) => { draft.flow.nodes = [{ id: 'a', type: 'container', label: 'A', position: { x: 0, y: 0 }, parentNode: 'b' }, { id: 'b', type: 'container', label: 'B', position: { x: 0, y: 0 }, parentNode: 'a' }] }],
    ['non-finite position', (draft: LocalDraft) => { draft.flow.nodes[0].position.x = Infinity }],
    ['duplicate edges', (draft: LocalDraft) => { draft.flow.edges = [{ id: 'same', source: 'moon', target: 'moon' }, { id: 'same', source: 'moon', target: 'moon' }] }],
    ['private image link', (draft: LocalDraft) => { draft.flow.nodes[0].type = 'image'; draft.flow.nodes[0].imageUrl = 'https://example.com/image?access_token=secret' }],
    ['unsafe image URL', (draft: LocalDraft) => { draft.flow.nodes[0].type = 'image'; draft.flow.nodes[0].imageUrl = 'javascript:alert(1)' }],
  ])('rejects %s as a whole document', (_name, damage) => {
    const draft = savedDraft()
    damage(draft)
    expect(parseLocalDraft(JSON.stringify(draft))).toBeNull()
  })

  it('rejects malformed, unsupported, and oversized JSON before recovery', () => {
    expect(parseLocalDraft('{')).toBeNull()
    expect(parseLocalDraft(JSON.stringify({ ...savedDraft(), version: 2 }))).toBeNull()
    expect(parseLocalDraft(' '.repeat(MAX_LOCAL_DRAFT_BYTES + 1))).toBeNull()
    expect(parseLocalDraft(JSON.stringify({ ...savedDraft(), padding: '☾'.repeat(400_000) }))).toBeNull()
  })

  it.each([
    `https://other.example${GENERATED_IMAGE}`,
    GENERATED_IMAGE.replace('/api/images/', '/api/billing/'),
    `${GENERATED_IMAGE}&edit=account-secret`,
    GENERATED_IMAGE.slice(0, -1),
    GENERATED_IMAGE.replace('key=k', 'key=%6b'),
  ])('refuses a private or noncanonical asset URL: %s', (url) => {
    const draft = savedDraft()
    draft.flow.nodes[0].type = 'image'
    draft.flow.nodes[0].imageUrl = url
    expect(parseLocalDraft(JSON.stringify(draft))).toBeNull()
  })

  it.each(['step', 'decision', 'note', 'container'] as const)('rejects hidden images on a %s node without overwriting the last good draft', (type) => {
    const hook = renderHook(useLocalDraft, { initialProps: options([node()]) })
    advance()
    const original = window.localStorage.getItem(LOCAL_DRAFT_KEY)
    for (const source of [{ icon: 'icon-moon' }, { imageUrl: GENERATED_IMAGE }]) {
      const bad = savedDraft()
      Object.assign(bad.flow.nodes[0], { type, ...source })
      expect(parseLocalDraft(JSON.stringify(bad))).toBeNull()
      hook.rerender(options([{ ...node(), type, data: { label: 'Hidden illustration', ...source } }]))
      advance()
      expect(hook.result.current.status).toBe('error')
      expect(window.localStorage.getItem(LOCAL_DRAFT_KEY)).toBe(original)
    }
  })

  it.each(['image', 'service', 'database', 'queue', 'cache', 'apiGateway', 'externalActor'] as const)('recovers supported icon and image sources on a %s node', (type) => {
    for (const source of [{ icon: 'icon-moon' }, { imageUrl: GENERATED_IMAGE }]) {
      const draft = savedDraft()
      Object.assign(draft.flow.nodes[0], { type, ...source })
      expect(parseLocalDraft(JSON.stringify(draft))?.flow.nodes[0]).toMatchObject({ type, ...source })
    }
  })

  it.each(['data:image/avif;base64,aGVsbG8=', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E'])('retains an existing supported upload format: %s', (imageUrl) => {
    const draft = savedDraft()
    Object.assign(draft.flow.nodes[0], { type: 'image', imageUrl })
    expect(parseLocalDraft(JSON.stringify(draft))?.flow.nodes[0].imageUrl).toBe(imageUrl)
  })

  it('drops unrecognized capabilities from a decoded document and safely keeps unusual ids', () => {
    const draft = savedDraft()
    draft.flow.nodes[0].id = '__proto__'
    const raw = JSON.stringify({ ...draft, editToken: 'secret', flow: { ...draft.flow, nodes: draft.flow.nodes.map((n) => ({ ...n, paymentToken: 'secret' })) } })
    const parsed = parseLocalDraft(raw)
    expect(parsed?.flow.nodes[0].id).toBe('__proto__')
    expect(JSON.stringify(parsed)).not.toContain('secret')
  })
})

import { act, renderHook } from '@testing-library/react'
import type { Edge, Node } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  POLL_ERROR_MAX_MS,
  POLL_FAST_MS,
  POLL_HOT_MS,
  POLL_IDLE_MS,
  POLL_MAX_MS,
  SAVE_DEBOUNCE_MS,
  useSharedFlow,
} from '../hooks/useSharedFlow'
import type { Chart } from '../shared/flowTypes'

const ID = 'Ab3dE5fG7h'
const START = Date.UTC(2026, 0, 1, 9, 0, 0)
const NO_NODES: Node[] = []
const NO_EDGES: Edge[] = []

function chart(version: number): Chart {
  return {
    id: ID,
    version,
    title: 'Polling',
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedVia: 'mcp',
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

let remote: Chart
let pollOverride: (() => Response) | null
let pollTimes: number[]
let fetchMock: ReturnType<typeof vi.fn>

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const fire = (target: EventTarget, type: string) =>
  act(async () => {
    target.dispatchEvent(new Event(type))
    await vi.advanceTimersByTimeAsync(0)
  })

/** Gaps between consecutive checks, in ms. */
const gaps = () => pollTimes.slice(1).map((t, i) => t - pollTimes[i])

describe('useSharedFlow editable local copies', () => {
  it('stops source polling and rejects a late response after detaching a loaded view', async () => {
    const { hook, applyChart } = await mount()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    fetchMock.mockImplementation(async input => String(input).includes('since=') ? pending : json(chart(1)))
    await advance(POLL_FAST_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { expect(hook.result.current.detachToLocal()).toBe(true) })
    expect(window.location.pathname).toBe('/')
    expect(hook.result.current.state).toMatchObject({ id: null, title: 'Polling (copy)', status: 'idle', version: 0, canEdit: false })
    expect(hook.result.current.viewUrl).toBeUndefined()
    expect(hook.result.current.editUrl).toBeUndefined()
    await act(async () => { release(json({ ...chart(9), changed: true })); await Promise.resolve() })
    await advance(POLL_MAX_MS * 3)
    await fire(window, 'focus')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(applyChart).toHaveBeenCalledTimes(1)
    expect(hook.result.current.state.id).toBeNull()
  })

  it('fences Load latest and creates only a new explicitly shared copy of the current canvas', async () => {
    const { hook, applyChart } = await mount()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    fetchMock.mockImplementation(async (_input, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return json({ id: 'Zy9xW7vU5t', version: 1, editToken: 'new-copy-token', chart: { ...chart(1), id: 'Zy9xW7vU5t', title: body.title, nodes: body.nodes, edges: body.edges } }, 201)
      }
      return pending
    })
    let latest!: Promise<void>
    act(() => { latest = hook.result.current.loadLatest() })
    hook.rerender({ nodes: [{ id: 'new-local', type: 'step', position: { x: 44, y: 88 }, data: { label: 'Current local change' } }] })
    // Detaching must preserve another stored source capability even if this
    // already-open view did not grant it to the hook's current session.
    localStorage.setItem(`flowchart:edit-token:${ID}`, 'source-capability-preserved')
    await act(async () => { expect(hook.result.current.detachToLocal()).toBe(true) })
    expect(localStorage.getItem(`flowchart:edit-token:${ID}`)).toBe('source-capability-preserved')
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST')).toBe(false)
    await act(async () => { release(json(chart(8))); await latest })
    expect(applyChart).toHaveBeenCalledTimes(1)
    await act(async () => { expect(await hook.result.current.createShare()).toBe(true) })
    const creates = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')
    expect(creates).toHaveLength(1)
    const body = JSON.parse(String((creates[0][1] as RequestInit).body))
    expect(body).toMatchObject({ title: 'Polling (copy)', nodes: [{ id: 'new-local', label: 'Current local change', position: { x: 44, y: 88 } }] })
    expect(hook.result.current.state.id).toBe('Zy9xW7vU5t')
    expect(localStorage.getItem(`flowchart:edit-token:${ID}`)).toBe('source-capability-preserved')
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PUT')).toBe(false)
  })

  it('does not detach a loading, missing initial, editable or already local chart', async () => {
    window.history.replaceState(null, '', `/f/${ID}`)
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    fetchMock.mockImplementation(async () => pending)
    const loading = renderHook(() => useSharedFlow({ nodes: NO_NODES, edges: NO_EDGES, applyChart: vi.fn() }))
    act(() => { expect(loading.result.current.detachToLocal()).toBe(false) })
    expect(window.location.pathname).toBe(`/f/${ID}`)
    await act(async () => { release(json({ code: 'not_found' }, 404)); await pending })
    act(() => { expect(loading.result.current.detachToLocal()).toBe(false) })
    loading.unmount()
    fetchMock.mockImplementation(async () => json(chart(1)))
    const { hook } = await mount({ token: true })
    act(() => { expect(hook.result.current.detachToLocal()).toBe(false) })
    expect(hook.result.current.state.canEdit).toBe(true)
    hook.unmount()
    window.history.replaceState(null, '', '/')
    const local = renderHook(() => useSharedFlow({ nodes: NO_NODES, edges: NO_EDGES, applyChart: vi.fn() }))
    act(() => { expect(local.result.current.detachToLocal()).toBe(false) })
  })

  it('can retain the loaded canvas after source deletion and keeps a bounded copy title', async () => {
    remote = { ...chart(1), title: 'A'.repeat(200) }
    const { hook, applyChart } = await mount()
    pollOverride = () => json({ code: 'not_found' }, 404)
    await advance(POLL_FAST_MS)
    expect(hook.result.current.state).toMatchObject({ status: 'not-found', version: 1 })
    await act(async () => { expect(hook.result.current.detachToLocal()).toBe(true) })
    expect(hook.result.current.state.title).toHaveLength(200)
    expect(hook.result.current.state.title.endsWith(' (copy)')).toBe(true)
    expect(hook.result.current.state.error).toBeUndefined()
    expect(applyChart).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/')
  })

  it('does not apply an old poll after the local copy is shared under a new id', async () => {
    const { hook, applyChart } = await mount()
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    const copyId = 'Zy9xW7vU5t'
    fetchMock.mockImplementation(async (input, init: RequestInit = {}) => {
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return json({ id: copyId, version: 1, editToken: 'new-copy-token', chart: { ...chart(1), id: copyId, title: body.title, nodes: body.nodes } }, 201)
      }
      return String(input).includes(ID) ? pending : json({ id: copyId, version: 1, changed: false })
    })
    await advance(POLL_FAST_MS)
    await act(async () => { expect(hook.result.current.detachToLocal()).toBe(true) })
    await act(async () => { expect(await hook.result.current.createShare()).toBe(true) })
    await act(async () => { release(json({ ...chart(10), changed: true })); await Promise.resolve() })
    expect(applyChart).toHaveBeenCalledTimes(1)
    expect(hook.result.current.state).toMatchObject({ id: copyId, version: 1, title: 'Polling (copy)', status: 'synced', canEdit: true })
    expect(window.location.pathname).toBe(`/f/${copyId}`)
  })
})

async function mount(options: { token?: boolean } = {}) {
  window.history.replaceState(null, '', `/f/${ID}${options.token ? '#edit=secret-token' : ''}`)
  const applyChart = vi.fn()
  const hook = renderHook((props: { nodes: Node[] }) => useSharedFlow({ nodes: props.nodes, edges: NO_EDGES, applyChart }), {
    initialProps: { nodes: NO_NODES },
  })
  await advance(0)
  expect(hook.result.current.state.status).toBe('synced')
  return { hook, applyChart }
}

beforeEach(() => {
  vi.useFakeTimers({ now: START })
  window.localStorage.clear()
  remote = chart(1)
  pollOverride = null
  pollTimes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (init.method === 'PUT') {
      remote = { ...chart(remote.version + 1), nodes: JSON.parse(String(init.body)).nodes, updatedVia: 'api' }
      return json(remote)
    }
    if (url.includes('since=')) {
      pollTimes.push(Date.now())
      if (pollOverride) return pollOverride()
      const since = Number(new URL(url, 'http://x').searchParams.get('since'))
      return remote.version > since ? json({ ...remote, changed: true }) : json({ id: ID, version: remote.version, changed: false })
    }
    return json(remote)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('useSharedFlow concurrent share actions', () => {
  it('saves edits made while creation is pending after the link becomes available', async () => {
    window.history.replaceState(null, '', '/')
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    fetchMock.mockImplementation(async (_input, init: RequestInit = {}) => init.method === 'POST' ? pending : json(chart(2)))
    const hook = renderHook((props: { nodes: Node[] }) => useSharedFlow({ nodes: props.nodes, edges: NO_EDGES, applyChart: () => {} }), { initialProps: { nodes: NO_NODES } })
    let creating!: Promise<boolean>
    act(() => { creating = hook.result.current.createShare() })
    hook.rerender({ nodes: [{ id: 'new', type: 'service', position: { x: 0, y: 0 }, data: { label: 'During creation', icon: 'icon-robot' } }] })
    await advance(SAVE_DEBOUNCE_MS + 1)
    await act(async () => { release(json({ id: ID, version: 1, editToken: 'fixture-creation-credential', chart: chart(1) }, 201)); await creating })
    await advance(SAVE_DEBOUNCE_MS + 1)
    const saves = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PUT')
    expect(saves).toHaveLength(1)
    expect(JSON.parse(String((saves[0][1] as RequestInit).body)).nodes[0]).toMatchObject({ id: 'new', type: 'service', label: 'During creation', icon: 'icon-robot' })
  })

  it('coalesces repeated creation requests while the first response is pending', async () => {
    window.history.replaceState(null, '', '/')
    let release!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { release = resolve })
    fetchMock.mockImplementation(async () => pending)
    const hook = renderHook(() => useSharedFlow({ nodes: NO_NODES, edges: NO_EDGES, applyChart: () => {} }))
    let first!: Promise<boolean>, second!: Promise<boolean>
    act(() => { first = hook.result.current.createShare(); second = hook.result.current.createShare() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { release(json({ id: ID, version: 1, editToken: 'fixture-creation-credential', chart: chart(1) }, 201)); await Promise.all([first, second]) })
  })

  it('protects an unsaved title from a remote update while saving is rate limited', async () => {
    const { hook, applyChart } = await mount({ token: true })
    fetchMock.mockImplementation(async (input, init: RequestInit = {}) => init.method === 'PUT' ? json({ error: 'Slow down' }, 429, { 'Retry-After': '60' }) : json({ ...chart(2), title: 'Remote title', changed: true }))
    await act(async () => { hook.result.current.rename('My unsaved title') })
    expect(hook.result.current.state.status).toBe('error')
    await advance(POLL_FAST_MS)
    expect(hook.result.current.state.title).toBe('My unsaved title')
    expect(hook.result.current.state.status).toBe('conflict')
    expect(hook.result.current.state.conflictVersion).toBe(2)
    expect(applyChart).toHaveBeenCalledTimes(1)
  })

  it('ignores an earlier Load latest result after a newer request has been applied', async () => {
    const { hook, applyChart } = await mount()
    const releases: Array<(value: Response) => void> = []
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { releases.push(resolve) }))
    let first!: Promise<void>, second!: Promise<void>
    act(() => { first = hook.result.current.loadLatest(); second = hook.result.current.loadLatest() })
    await act(async () => { releases[1](json(chart(3))); await second })
    await act(async () => { releases[0](json(chart(2))); await first })
    expect(hook.result.current.state.version).toBe(3)
    expect(applyChart).toHaveBeenCalledTimes(2)
  })

  it('does not apply a deferred initial chart after its hook has unmounted', async () => {
    window.history.replaceState(null, '', `/f/${ID}`)
    let release!: (value: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { release = resolve }))
    const applyChart = vi.fn()
    const hook = renderHook(() => useSharedFlow({ nodes: NO_NODES, edges: NO_EDGES, applyChart }))
    hook.unmount()
    await act(async () => { release(json(chart(1))) })
    expect(applyChart).not.toHaveBeenCalled()
  })

  it('keeps a newer polled version when an older Load latest request finishes', async () => {
    const { hook } = await mount()
    let release!: (value: Response) => void
    fetchMock.mockImplementation(input => String(input).includes('since=') ? Promise.resolve(json({ ...chart(3), changed: true })) : new Promise<Response>(resolve => { release = resolve }))
    let loading!: Promise<void>
    act(() => { loading = hook.result.current.loadLatest() })
    await advance(POLL_FAST_MS)
    expect(hook.result.current.state.version).toBe(3)
    await act(async () => { release(json(chart(2))); await loading })
    expect(hook.result.current.state.version).toBe(3)
    expect(hook.result.current.state.status).toBe('synced')
  })

  it('preserves canvas work made after Load latest starts instead of replacing it', async () => {
    const { hook, applyChart } = await mount({ token: true })
    let release!: (value: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { release = resolve }))
    let loading!: Promise<void>
    act(() => { loading = hook.result.current.loadLatest() })
    hook.rerender({ nodes: [{ id: 'local', type: 'service', position: { x: 0, y: 0 }, data: { label: 'Newer local work' } }] })
    await act(async () => { release(json(chart(2))); await loading })
    expect(hook.result.current.state.status).toBe('conflict')
    expect(hook.result.current.state.error).toContain('canvas changed while')
    expect(applyChart).toHaveBeenCalledTimes(1)
  })

  it('saves a deliberate Keep my version with the known conflict revision and current local canvas', async () => {
    const { hook } = await mount({ token: true })
    fetchMock.mockImplementation(async (_input, init: RequestInit = {}) => init.method === 'PUT' ? json({ error: 'Changed', currentVersion: 3 }, 409) : json(chart(3)))
    hook.rerender({ nodes: [{ id: 'local', type: 'service', position: { x: 0, y: 0 }, data: { label: '', icon: 'icon-robot' } }] })
    await advance(SAVE_DEBOUNCE_MS)
    expect(hook.result.current.state.status).toBe('conflict')
    fetchMock.mockImplementation(async (_input, init: RequestInit = {}) => json({ ...chart(4), ...JSON.parse(String(init.body)), version: 4 }))
    await act(async () => { await hook.result.current.keepMine() })
    const lastSave = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PUT').at(-1)!
    expect(JSON.parse(String((lastSave[1] as RequestInit).body))).toMatchObject({ baseVersion: 3, nodes: [{ id: 'local', type: 'service', label: '', icon: 'icon-robot' }] })
    expect(hook.result.current.state.status).toBe('synced')
    expect(hook.result.current.state.version).toBe(4)
  })

  it('never saves or renames a read-only chart even through direct action callbacks', async () => {
    const { hook } = await mount()
    hook.rerender({ nodes: [{ id: 'local', type: 'service', position: { x: 0, y: 0 }, data: { label: 'Local copy' } }] })
    await act(async () => { hook.result.current.rename('Not authorized'); await hook.result.current.keepMine() })
    await advance(SAVE_DEBOUNCE_MS + 1)
    expect(hook.result.current.state.title).toBe('Polling')
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PUT')).toHaveLength(0)
    expect(hook.result.current.editUrl).toBeUndefined()
  })

  it('does not change browser navigation after a pending creation has unmounted', async () => {
    window.history.replaceState(null, '', '/')
    let release!: (value: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { release = resolve }))
    const hook = renderHook(() => useSharedFlow({ nodes: NO_NODES, edges: NO_EDGES, applyChart: () => {} }))
    let creating!: Promise<boolean>
    act(() => { creating = hook.result.current.createShare() })
    hook.unmount()
    window.history.replaceState(null, '', '/mcp')
    await act(async () => { release(json({ id: ID, version: 1, editToken: 'fixture-creation-credential', chart: chart(1) }, 201)); await creating })
    expect(window.location.pathname).toBe('/mcp')
  })

  it('does not revive a remotely deleted chart when an older save response completes', async () => {
    const { hook } = await mount({ token: true })
    let releaseSave!: (value: Response) => void
    fetchMock.mockImplementation((_input, init: RequestInit = {}) => init.method === 'PUT' ? new Promise<Response>(resolve => { releaseSave = resolve }) : Promise.resolve(json({ error: 'Chart not found' }, 404)))
    hook.rerender({ nodes: [{ id: 'local', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Keep this local canvas' } }] })
    await advance(SAVE_DEBOUNCE_MS)
    expect(hook.result.current.state.status).toBe('saving')
    await advance(POLL_FAST_MS)
    expect(hook.result.current.state.status).toBe('not-found')
    await act(async () => { releaseSave(json(chart(2))) })
    expect(hook.result.current.state.status).toBe('not-found')
    expect(hook.result.current.state.version).toBe(1)
    expect(hook.result.current.state.canEdit).toBe(false)
  })

  it('reports a failed Load latest without clearing the conflict or local canvas', async () => {
    const { hook, applyChart } = await mount()
    hook.rerender({ nodes: [{ id: 'local', type: 'step', position: { x: 0, y: 0 }, data: { label: 'Unsaved local work' } }] })
    remote = chart(2)
    await advance(POLL_FAST_MS)
    expect(hook.result.current.state.status).toBe('conflict')
    fetchMock.mockResolvedValue(json({ error: 'Storage busy' }, 503))
    await act(async () => { await hook.result.current.loadLatest() })
    expect(hook.result.current.state.status).toBe('conflict')
    expect(hook.result.current.state.error).toContain("Couldn't load the latest version")
    expect(hook.result.current.state.conflictVersion).toBe(2)
    expect(applyChart).toHaveBeenCalledTimes(1)
  })

  it('stops sharing controls and polling when a loaded chart disappears remotely', async () => {
    const { hook, applyChart } = await mount({ token: true })
    pollOverride = () => json({ error: 'Chart not found' }, 404)
    await advance(POLL_FAST_MS)
    expect(hook.result.current.state.status).toBe('not-found')
    expect(hook.result.current.state.canEdit).toBe(false)
    expect(hook.result.current.editUrl).toBeUndefined()
    expect(hook.result.current.viewUrl).toBeUndefined()
    const checks = pollTimes.length
    await advance(60_000)
    expect(pollTimes).toHaveLength(checks)
    expect(applyChart).toHaveBeenCalledTimes(1)
  })
})

afterEach(() => {
  vi.useRealTimers()
  delete (document as { visibilityState?: string }).visibilityState
  window.history.replaceState(null, '', '/')
})

describe('useSharedFlow adaptive polling', () => {
  it('checks every 3 s for a few minutes after loading, then slows down to every 15 s', async () => {
    await mount()
    expect(pollTimes).toHaveLength(0)
    await advance(POLL_FAST_MS)
    expect(pollTimes).toEqual([START + POLL_FAST_MS])

    await advance(POLL_HOT_MS + 90_000)
    const hot = POLL_HOT_MS / POLL_FAST_MS
    expect(gaps().slice(0, hot - 1).every((gap) => gap === POLL_FAST_MS)).toBe(true)
    expect(gaps().slice(hot - 1, hot + 5)).toEqual([4500, 6750, 10125, POLL_MAX_MS, POLL_MAX_MS, POLL_MAX_MS])
  })

  it('pauses after 30 quiet minutes and checks at once when the user is back', async () => {
    await mount()
    await advance(POLL_IDLE_MS + 60_000)
    const before = pollTimes.length
    await advance(20 * 60_000)
    expect(pollTimes).toHaveLength(before) // paused: no checks at all

    await fire(window, 'pointerdown')
    expect(pollTimes).toHaveLength(before + 1)
    await advance(POLL_FAST_MS)
    expect(pollTimes).toHaveLength(before + 2) // and fast again
  })

  it('stops while the tab is hidden and checks immediately when it is shown or focused', async () => {
    await mount()
    await advance(POLL_FAST_MS)
    setVisibility('hidden')
    const hidden = pollTimes.length
    await advance(10 * 60_000)
    expect(pollTimes).toHaveLength(hidden)

    setVisibility('visible')
    await advance(0)
    expect(pollTimes).toHaveLength(hidden + 1)

    await advance(POLL_HOT_MS + 2 * 60_000) // slowed down by now
    const slow = pollTimes.length
    await fire(window, 'focus')
    expect(pollTimes).toHaveLength(slow + 1)
    expect(gaps().at(-1)).toBeLessThan(POLL_MAX_MS)
  })

  it('checks at once on input after a quiet minute, but not on every keystroke', async () => {
    await mount()
    await advance(5 * 60_000)
    const count = pollTimes.length
    await fire(window, 'keydown')
    expect(pollTimes).toHaveLength(count + 1)
    await advance(2000)
    await fire(window, 'keydown')
    expect(pollTimes).toHaveLength(count + 1)
  })

  it('speeds up when the user switches to another window (for example to ask the agent)', async () => {
    await mount()
    await advance(POLL_HOT_MS + 3 * 60_000)
    expect(gaps().at(-1)).toBe(POLL_MAX_MS)
    await fire(window, 'blur')
    const count = pollTimes.length
    await advance(POLL_FAST_MS)
    expect(pollTimes).toHaveLength(count + 1)
  })

  it('applies a remote change live and polls fast afterwards', async () => {
    const { hook, applyChart } = await mount()
    await advance(POLL_HOT_MS + 3 * 60_000)
    remote = chart(2)
    await advance(POLL_MAX_MS)
    expect(applyChart).toHaveBeenLastCalledWith(expect.objectContaining({ version: 2 }), 'remote')
    expect(hook.result.current.state.lastRemoteUpdate?.version).toBe(2)
    const count = pollTimes.length
    await advance(POLL_FAST_MS)
    expect(pollTimes).toHaveLength(count + 1)
  })

  it('polls fast after a local edit is saved', async () => {
    const { hook } = await mount({ token: true })
    await advance(POLL_HOT_MS + 3 * 60_000)
    hook.rerender({ nodes: [{ id: '1', type: 'step', position: { x: 0, y: 0 }, data: { label: 'New' } }] })
    await advance(1000) // save debounce
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(true)
    const count = pollTimes.length
    await advance(POLL_FAST_MS)
    expect(pollTimes).toHaveLength(count + 1)
  })

  it('backs off on errors and honors Retry-After', async () => {
    await mount()
    pollOverride = () => json({ error: 'boom' }, 500)
    await advance(POLL_FAST_MS + 5 * 60_000)
    expect(gaps().slice(0, 6)).toEqual([6000, 12_000, 24_000, 48_000, POLL_ERROR_MAX_MS, POLL_ERROR_MAX_MS])

    pollOverride = () => json({ error: 'Slow down', code: 'rate_limited' }, 429, { 'Retry-After': '300' })
    await advance(POLL_ERROR_MAX_MS)
    const limitedAt = pollTimes.at(-1)!
    pollOverride = null
    await fire(window, 'focus') // even a focus doesn't check before Retry-After ends
    expect(pollTimes.at(-1)).toBe(limitedAt)
    await advance(300_000)
    expect(pollTimes.find((t) => t > limitedAt)).toBe(limitedAt + 300_000)
  })

  it('stops polling and listening when unmounted', async () => {
    const { hook } = await mount()
    await advance(POLL_FAST_MS)
    hook.unmount()
    const count = pollTimes.length
    await advance(10 * 60_000)
    await fire(window, 'focus')
    await fire(window, 'pointerdown')
    expect(pollTimes).toHaveLength(count)
  })
})

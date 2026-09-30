import { act, renderHook } from '@testing-library/react'
import type { Node } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  POLL_ERROR_MAX_MS,
  POLL_FAST_MS,
  POLL_HOT_MS,
  POLL_IDLE_MS,
  POLL_MAX_MS,
  useSharedFlow,
} from '../hooks/useSharedFlow'
import type { Chart } from '../shared/flowTypes'

const ID = 'Ab3dE5fG7h'
const START = Date.UTC(2026, 0, 1, 9, 0, 0)
const NO_NODES: Node[] = []

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

async function mount(options: { token?: boolean } = {}) {
  window.history.replaceState(null, '', `/f/${ID}${options.token ? '#edit=secret-token' : ''}`)
  const applyChart = vi.fn()
  const hook = renderHook((props: { nodes: Node[] }) => useSharedFlow({ nodes: props.nodes, edges: [], applyChart }), {
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

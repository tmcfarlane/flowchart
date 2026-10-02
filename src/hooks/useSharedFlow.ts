// Keeps the canvas in sync with a shared chart (/f/:id):
// - loads the chart, stores the "#edit=" token per chart and strips it from the URL
// - saves local edits back (debounced) with the edit token and optimistic
//   concurrency, so agents calling get_flowchart see them
// - polls GET /api/flows/:id?since=<version> for changes (agents, other tabs)
//   and applies them live, unless local edits are unsaved (then it asks)
//
// Polling adapts, because every check is a function invocation plus a Redis
// read on the service's free-tier budget:
// - Fast (every 3 s) for a few minutes after the chart loads, after a remote
//   change, after a local edit, and when the user comes back: window focus,
//   tab shown again, or input after a quiet minute (those also check at once).
//   Switching to another window while this one stays visible (often to ask
//   the agent something) keeps it fast too.
// - Otherwise it slows down step by step to one check every 15 s.
// - It stops while the tab is hidden, and after 30 minutes without input or
//   remote changes, until the user returns.
// - Errors back off exponentially (up to a minute) and honor Retry-After.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import type { Chart, UpdateSource } from '../shared/flowTypes'
import { contentFingerprint, flowToChart } from '../utils/sharedFlow'
import {
  createSharedChart,
  fetchSharedChart,
  forgetEditToken,
  parseSharedLocation,
  readEditToken,
  saveSharedChart,
  sharePaths,
  storeEditToken,
} from '../utils/shareApi'

export const POLL_FAST_MS = 3_000
export const POLL_MAX_MS = 15_000
/** Each quiet check after the fast period waits this much longer than the last. */
export const POLL_BACKOFF = 1.5
/** How long polling stays fast after activity. */
export const POLL_HOT_MS = 3 * 60_000
/** Polling pauses after this long without input or remote changes. */
export const POLL_IDLE_MS = 30 * 60_000
export const POLL_ERROR_MAX_MS = 60_000
/** Input after this long without any counts as coming back: check immediately. */
export const POLL_RETURN_MS = 60_000
export const SAVE_DEBOUNCE_MS = 800
export const DEFAULT_SHARED_TITLE = 'Untitled flowchart'

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

export type ShareStatus =
  | 'idle' // not shared
  | 'loading'
  | 'synced'
  | 'saving'
  | 'error' // last save failed; retried on the next change or poll
  | 'conflict' // the chart changed remotely while local edits were unsaved
  | 'not-found'
  | 'load-error'

export type ApplyReason = 'initial' | 'remote'

export interface SharedFlowState {
  /** null while the canvas is not shared. */
  id: string | null
  title: string
  version: number
  canEdit: boolean
  status: ShareStatus
  error?: string
  /** Remote version that is waiting because of unsaved local edits. */
  conflictVersion?: number
  lastRemoteUpdate?: { at: number; version: number; via?: UpdateSource }
  creating: boolean
  createError?: string
}

export interface SharedFlowApi {
  state: SharedFlowState
  viewUrl?: string
  editUrl?: string
  createShare: () => Promise<boolean>
  rename: (title: string) => void
  loadLatest: () => Promise<void>
  keepMine: () => Promise<void>
  retryLoad: () => void
  /** Detach a loaded view into a local canvas; never writes to the source. */
  detachToLocal: () => boolean
}

interface Options {
  nodes: Node[]
  edges: Edge[]
  /** Render a chart on the canvas (App converts it with the editor's styling). */
  applyChart: (chart: Chart, reason: ApplyReason) => void
}

const PAUSED: ShareStatus[] = ['idle', 'loading', 'conflict', 'not-found', 'load-error']

export function useSharedFlow({ nodes, edges, applyChart }: Options): SharedFlowApi {
  const [state, setState] = useState<SharedFlowState>(() => {
    const location = typeof window === 'undefined' ? null : parseSharedLocation(window.location)
    return {
      id: location?.id ?? null,
      title: '',
      version: 0,
      canEdit: location ? !!(location.token || readEditToken(location.id)) : false,
      status: location ? 'loading' : 'idle',
      creating: false,
    }
  })

  const idRef = useRef<string | null>(state.id)
  const tokenRef = useRef<string | null>(null)
  const versionRef = useRef(0)
  const titleRef = useRef('')
  const titleDirtyRef = useRef(false)
  const syncedFingerprintRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const saveAgainRef = useRef(false)
  /** After a 429 or 503 on save, don't retry before this time. */
  const saveNotBeforeRef = useRef(0)
  const loadStartedRef = useRef(false)
  const loadRequestRef = useRef(0)
  const creatingRef = useRef<Promise<boolean> | null>(null)
  const statusRef = useRef<ShareStatus>(state.status)
  const conflictVersionRef = useRef<number | undefined>(undefined)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const applyRef = useRef(applyChart)
  const unmountedRef = useRef(false)
  const pollRef = useRef({
    /** Poll every POLL_FAST_MS until this time. */
    hotUntil: 0,
    /** Current slowed-down interval. */
    interval: POLL_FAST_MS,
    /** Last input, local edit or remote change (for the idle pause). */
    lastActivity: 0,
    /** Consecutive failed checks. */
    errors: 0,
    /** Don't check before this time (Retry-After). */
    notBefore: 0,
    /** Set while polling runs: re-plans the next check after activity. */
    replan: null as null | ((checkNow: boolean) => void),
  })

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])
  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges])
  useEffect(() => {
    applyRef.current = applyChart
  }, [applyChart])
  useEffect(() => {
    statusRef.current = state.status
  }, [state.status])

  /** Activity that makes further changes likely soon: poll fast for a while. */
  const markActive = useCallback((checkNow = false) => {
    const poll = pollRef.current
    const now = Date.now()
    poll.lastActivity = now
    poll.hotUntil = now + POLL_HOT_MS
    poll.interval = POLL_FAST_MS
    poll.replan?.(checkNow)
  }, [])

  const setStatus = useCallback((status: ShareStatus, patch: Partial<SharedFlowState> = {}) => {
    statusRef.current = status
    if ('conflictVersion' in patch) conflictVersionRef.current = patch.conflictVersion
    setState((s) => ({ ...s, status, ...patch }))
  }, [])

  const adopt = useCallback(
    (chart: Chart, reason: ApplyReason) => {
      syncedFingerprintRef.current = contentFingerprint(chart)
      versionRef.current = chart.version
      titleRef.current = chart.title
      titleDirtyRef.current = false
      applyRef.current(chart, reason)
      setStatus('synced', {
        title: chart.title,
        version: chart.version,
        error: undefined,
        conflictVersion: undefined,
        canEdit: !!tokenRef.current,
      })
      if (reason === 'remote') {
        setState((s) => ({ ...s, lastRemoteUpdate: { at: Date.now(), version: chart.version, via: chart.updatedVia } }))
        markActive()
      }
    },
    [setStatus, markActive],
  )

  const markUnavailable = useCallback((id: string) => {
    if (unmountedRef.current || idRef.current !== id) return
    forgetEditToken(id)
    tokenRef.current = null
    loadRequestRef.current += 1
    setStatus('not-found', {
      canEdit: false,
      conflictVersion: undefined,
      error: 'This shared chart was deleted or is no longer available. Your current canvas is still here; export a copy to keep your work.',
    })
  }, [setStatus])

  const load = useCallback(
    async (id: string) => {
      if (unmountedRef.current) return
      const request = ++loadRequestRef.current
      setStatus('loading', { error: undefined })
      const result = await fetchSharedChart(id)
      if (unmountedRef.current || idRef.current !== id || request !== loadRequestRef.current) return
      if (result.status === 'ok') adopt(result.chart, 'initial')
      else if (result.status === 'not_found') markUnavailable(id)
      else if (result.status === 'error') setStatus('load-error', { error: result.message })
    },
    [adopt, markUnavailable, setStatus],
  )

  // Open /f/:id: remember the edit token, hide it from the address bar, load.
  useEffect(() => {
    const id = idRef.current
    if (!id) return
    const location = parseSharedLocation(window.location)
    if (location?.token) {
      storeEditToken(id, location.token)
      window.history.replaceState(window.history.state, '', `/f/${id}${window.location.search}`)
    }
    tokenRef.current = location?.token ?? readEditToken(id) ?? tokenRef.current
    if (!loadStartedRef.current) {
      loadStartedRef.current = true
      void load(id)
    }
  }, [load])

  // Leaving /f/:id with the back button: start fresh from the new URL.
  useEffect(() => {
    const onPopState = () => {
      const location = parseSharedLocation(window.location)
      if ((location?.id ?? null) !== idRef.current) {
        idRef.current = location?.id ?? null
        tokenRef.current = null
        loadRequestRef.current += 1
        window.location.reload()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const flushSave = useCallback(async (): Promise<void> => {
    const id = idRef.current
    const token = tokenRef.current
    if (unmountedRef.current || !id || !token || PAUSED.includes(statusRef.current)) return
    if (savingRef.current) {
      saveAgainRef.current = true
      return
    }
    const currentNodes = nodesRef.current
    if (currentNodes.some((n) => n.dragging)) return // saved when the drag ends

    const content = flowToChart(currentNodes, edgesRef.current)
    const fingerprint = contentFingerprint(content)
    if (fingerprint === syncedFingerprintRef.current && !titleDirtyRef.current) {
      if (statusRef.current === 'error') setStatus('synced', { error: undefined })
      return
    }
    if (Date.now() < saveNotBeforeRef.current) {
      // Rate-limited or storage busy: the poll loop retries while the status is "error".
      if (statusRef.current !== 'error') setStatus('error', { error: 'Saving paused for a moment. Your changes will sync shortly.' })
      return
    }

    savingRef.current = true
    markActive() // someone is editing: an agent may be working alongside
    const sentTitle = titleRef.current
    setStatus('saving')
    const result = await saveSharedChart(id, token, {
      title: sentTitle || undefined,
      nodes: content.nodes,
      edges: content.edges,
      baseVersion: versionRef.current,
    })
    savingRef.current = false
    if (unmountedRef.current || idRef.current !== id || statusRef.current === 'not-found') return

    if (result.ok) {
      versionRef.current = result.chart.version
      syncedFingerprintRef.current = fingerprint
      if (titleRef.current === sentTitle) titleDirtyRef.current = false
      setStatus('synced', { version: result.chart.version, error: undefined })
      if (saveAgainRef.current) {
        saveAgainRef.current = false
        void flushSave()
      }
      return
    }

    saveAgainRef.current = false
    if (result.status === 404) {
      markUnavailable(id)
    } else if (result.status === 409) {
      setStatus('conflict', { conflictVersion: result.currentVersion })
    } else if (result.status === 401 || result.status === 403) {
      forgetEditToken(id)
      tokenRef.current = null
      setStatus('error', {
        canEdit: false,
        error: 'This edit link is no longer valid, so changes made here are not saved.',
      })
    } else {
      if (result.retryAfterSeconds) saveNotBeforeRef.current = Date.now() + result.retryAfterSeconds * 1000
      setStatus('error', {
        error: result.status === 0 ? 'Offline. Changes will sync when the connection is back.' : `Couldn't save: ${result.message}`,
      })
    }
  }, [setStatus, markActive, markUnavailable])

  // Debounced autosave of local edits.
  useEffect(() => {
    if (!idRef.current || !tokenRef.current || PAUSED.includes(statusRef.current)) return
    const timer = window.setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [nodes, edges, flushSave])

  const handleRemote = useCallback(
    (chart: Chart) => {
      if (chart.version <= versionRef.current || savingRef.current) return
      const local = contentFingerprint(flowToChart(nodesRef.current, edgesRef.current))
      const hasUnsavedEdits = local !== syncedFingerprintRef.current || titleDirtyRef.current
      if (!hasUnsavedEdits && statusRef.current !== 'conflict') {
        adopt(chart, 'remote')
      } else {
        // Never clobber unsaved local work: ask instead.
        setStatus('conflict', { conflictVersion: chart.version })
        markActive()
      }
    },
    [adopt, setStatus, markActive],
  )

  // Poll for remote changes (agents, other tabs); see the header for the schedule.
  const loaded = state.id !== null && !['idle', 'loading', 'not-found', 'load-error'].includes(state.status)
  useEffect(() => {
    if (!loaded) return
    const poll = pollRef.current
    let stopped = false
    let inFlight = false
    let timer: number | undefined
    let dueAt = Infinity
    let lastCheck = 0
    let lastInput = Date.now()

    const visible = () => document.visibilityState === 'visible'
    const idle = (now: number) => now - poll.lastActivity >= POLL_IDLE_MS

    /** Delay before the next check, or null to wait for the user (hidden tab, idle). */
    const nextDelay = (now: number): number | null => {
      if (!visible() || idle(now)) return null
      let delay: number
      if (poll.errors > 0) {
        delay = Math.min(POLL_ERROR_MAX_MS, POLL_FAST_MS * 2 ** poll.errors)
      } else if (now < poll.hotUntil) {
        poll.interval = POLL_FAST_MS
        delay = POLL_FAST_MS
      } else {
        poll.interval = Math.min(POLL_MAX_MS, Math.round(poll.interval * POLL_BACKOFF))
        delay = poll.interval
      }
      return Math.max(delay, poll.notBefore - now)
    }

    const schedule = (delay: number | null) => {
      window.clearTimeout(timer)
      timer = undefined
      dueAt = Infinity
      if (stopped || delay === null) return
      dueAt = Date.now() + delay
      timer = window.setTimeout(() => void check(), delay)
    }

    const check = async () => {
      timer = undefined
      dueAt = Infinity
      const id = idRef.current
      if (stopped || !id || inFlight) return
      const startedAt = Date.now()
      if (!visible() || idle(startedAt)) return // resumes when the user comes back
      if (statusRef.current === 'error') void flushSave()
      lastCheck = startedAt
      inFlight = true
      let result: Awaited<ReturnType<typeof fetchSharedChart>>
      try {
        result = await fetchSharedChart(id, versionRef.current)
      } finally {
        inFlight = false
      }
      if (stopped || unmountedRef.current || idRef.current !== id) return
      const now = Date.now()
      if (result.status === 'not_found') {
        markUnavailable(id)
        return
      } else if (result.status === 'ok' || result.status === 'unchanged') {
        poll.errors = 0
        if (result.status === 'ok') handleRemote(result.chart)
      } else {
        poll.errors = Math.min(poll.errors + 1, 10)
        if (result.status === 'error' && result.retryAfterSeconds) poll.notBefore = now + result.retryAfterSeconds * 1000
      }
      schedule(nextDelay(now))
    }

    /** Re-plan after activity; `checkNow` checks at once (unless a check just ran). */
    poll.replan = (checkNow: boolean) => {
      if (stopped || inFlight) return
      const now = Date.now()
      if (checkNow && visible() && now - lastCheck >= 1000 && now >= poll.notBefore) return schedule(0)
      const delay = nextDelay(now)
      if (delay !== null && now + delay < dueAt) schedule(delay)
    }

    const onVisibility = () => {
      if (visible()) markActive(true)
      else schedule(null)
    }
    const onFocus = () => markActive(true)
    // Leaving for another window while this one stays on screen (often to talk
    // to the agent): keep checking quickly.
    const onBlur = () => {
      if (visible()) markActive()
    }
    const onOnline = () => {
      poll.errors = 0
      poll.notBefore = 0
      markActive(true)
    }
    const onInput = () => {
      const now = Date.now()
      if (now - lastInput < 1000) return
      const returning = now - lastInput >= POLL_RETURN_MS || idle(now)
      lastInput = now
      if (returning) {
        markActive(true)
      } else {
        poll.lastActivity = now
      }
    }

    markActive() // starts fast polling (first check in POLL_FAST_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('online', onOnline)
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true, capture: true })
    return () => {
      stopped = true
      poll.replan = null
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('online', onOnline)
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true })
    }
  }, [loaded, handleRemote, flushSave, markActive, markUnavailable])

  const createShare = useCallback((): Promise<boolean> => {
    if (unmountedRef.current) return Promise.resolve(false)
    if (idRef.current) return Promise.resolve(true)
    if (creatingRef.current) return creatingRef.current
    const request = (async () => {
      setState((s) => ({ ...s, creating: true, createError: undefined }))
      const content = flowToChart(nodesRef.current, edgesRef.current)
      const result = await createSharedChart({ title: titleRef.current || DEFAULT_SHARED_TITLE, ...content })
      if (unmountedRef.current || idRef.current) return false
      if (!result.ok) {
        setState((s) => ({ ...s, creating: false, createError: result.message }))
        return false
      }
      storeEditToken(result.id, result.editToken)
      idRef.current = result.id
      tokenRef.current = result.editToken
      versionRef.current = result.version
      titleRef.current = result.chart.title
      syncedFingerprintRef.current = contentFingerprint(content)
      loadStartedRef.current = true
      window.history.pushState(window.history.state, '', `/f/${result.id}`)
      statusRef.current = 'synced'
      setState((s) => ({
        ...s,
        id: result.id,
        title: result.chart.title,
        version: result.version,
        canEdit: true,
        status: 'synced',
        creating: false,
      }))
      // Edits made before creation settled had no shared id, so their debounce
      // could not save. Compare and flush the current canvas now.
      void flushSave()
      return true
    })()
    creatingRef.current = request
    void request.finally(() => { if (creatingRef.current === request) creatingRef.current = null })
    return request
  }, [flushSave])

  const rename = useCallback(
    (title: string) => {
      const next = title.trim()
      if (!next || next === titleRef.current || !tokenRef.current) return
      titleRef.current = next
      titleDirtyRef.current = true
      setState((s) => ({ ...s, title: next }))
      void flushSave()
    },
    [flushSave],
  )

  const loadLatest = useCallback(async () => {
    const id = idRef.current
    if (!id || unmountedRef.current || statusRef.current === 'not-found') return
    const request = ++loadRequestRef.current
    const local = contentFingerprint(flowToChart(nodesRef.current, edgesRef.current))
    const title = titleRef.current
    const result = await fetchSharedChart(id)
    if (unmountedRef.current || idRef.current !== id || request !== loadRequestRef.current) return
    if (result.status === 'ok') {
      if (result.chart.version < versionRef.current) return
      const newestKnown = Math.max(versionRef.current, conflictVersionRef.current ?? 0)
      const changedWhileLoading = local !== contentFingerprint(flowToChart(nodesRef.current, edgesRef.current)) || title !== titleRef.current
      if (result.chart.version < newestKnown || changedWhileLoading) {
        setStatus('conflict', {
          conflictVersion: Math.max(newestKnown, result.chart.version),
          error: changedWhileLoading ? 'Your canvas changed while the latest version was loading. Your work is still here. Choose again when ready.' : 'A newer remote version is available. Load latest again to fetch it.',
        })
        return
      }
      adopt(result.chart, 'remote')
    } else if (result.status === 'not_found') markUnavailable(id)
    else if (result.status === 'error') setStatus(statusRef.current === 'conflict' ? 'conflict' : 'error', { error: `Couldn't load the latest version: ${result.message}` })
  }, [adopt, markUnavailable, setStatus])

  const keepMine = useCallback(async () => {
    if (!idRef.current || !tokenRef.current || unmountedRef.current || statusRef.current === 'not-found') return
    loadRequestRef.current += 1
    // Overwrite the remote change with the local canvas, based on the newest version.
    if (conflictVersionRef.current !== undefined) versionRef.current = conflictVersionRef.current
    syncedFingerprintRef.current = null
    setStatus('synced', { conflictVersion: undefined, error: undefined })
    await flushSave()
  }, [flushSave, setStatus])

  const retryLoad = useCallback(() => {
    if (idRef.current) void load(idRef.current)
  }, [load])

  const detachToLocal = useCallback((): boolean => {
    if (unmountedRef.current || !idRef.current || tokenRef.current || state.canEdit || state.version < 1 ||
        ['loading', 'load-error'].includes(statusRef.current)) return false
    // Clear the identity synchronously before changing the route/state so every
    // in-flight source read, poll and version load fails its existing id fence.
    // Keep the source's stored capability for other tabs and future visits.
    idRef.current = null
    tokenRef.current = null
    loadRequestRef.current += 1
    versionRef.current = 0
    titleRef.current = `${(titleRef.current || DEFAULT_SHARED_TITLE).slice(0, 193)} (copy)`
    titleDirtyRef.current = false
    conflictVersionRef.current = undefined
    syncedFingerprintRef.current = null
    saveAgainRef.current = false
    saveNotBeforeRef.current = 0
    statusRef.current = 'idle'
    window.history.pushState(window.history.state, '', '/')
    setState({ id: null, title: titleRef.current, version: 0, canEdit: false, status: 'idle', creating: false })
    return true
  }, [state.canEdit, state.version])

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const links = state.id && state.status !== 'not-found' ? sharePaths(origin, state.id, state.canEdit ? tokenRef.current : null) : undefined

  return {
    state,
    viewUrl: links?.url,
    editUrl: links?.editUrl,
    createShare,
    rename,
    loadLatest,
    keepMine,
    retryLoad,
    detachToLocal,
  }
}

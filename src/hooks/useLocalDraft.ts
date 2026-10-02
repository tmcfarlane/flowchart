import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import {
  COMM_STYLES, CONTAINER_KINDS, EDGE_PROTOCOLS, EDGE_STYLES, HANDLE_POSITIONS, ICON_NODE_TYPES, LIMITS,
  isNodeType, type ChartEdge, type ChartNode,
} from '../shared/flowTypes'
import { flowToChart } from '../utils/sharedFlow'
import { parseSharedLocation } from '../utils/shareApi'

export const LOCAL_DRAFT_KEY = 'flowchart.local-draft.v1'
export const LOCAL_DRAFT_DEBOUNCE_MS = 800
export const MAX_LOCAL_DRAFT_BYTES = 1_000_000
export const MAX_DRAFT_EMBEDDED_IMAGE_BYTES = 64 * 1024

export type DraftDiagramMode = 'flowchart' | 'architecture'
export type LocalDraftStatus = 'disabled' | 'idle' | 'pending' | 'saved' | 'error'
export interface LocalDraft {
  version: 1
  savedAt: number
  diagramMode: DraftDiagramMode
  flow: { nodes: ChartNode[]; edges: ChartEdge[] }
}
interface Options {
  nodes: Node[]
  edges: Edge[]
  diagramMode: DraftDiagramMode
  /** False for a shared chart, including while its initial request is loading. */
  enabled: boolean
  debounceMs?: number
}
export interface LocalDraftApi {
  recovery: LocalDraft | null
  status: LocalDraftStatus
  savedAt: number | null
  error: string | null
  /** Returns a reviewed draft for App to apply. It never changes the canvas itself. */
  restoreDraft: () => LocalDraft | null
  discardDraft: () => void
  /** Call with Clear All. Pending writes are canceled until the canvas changes again. */
  clearDraft: () => void
  flushDraft: () => void
}

const INVALID_DRAFT = 'A saved draft could not be read. Your current diagram is unchanged.'
const TOO_LARGE = 'This diagram is too large for draft recovery. Export it to keep a copy.'
const STORAGE_ERROR = 'Your browser could not save this draft. Export your diagram to keep a copy.'
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const bytes = (value: string) => new TextEncoder().encode(value).byteLength
const validId = (value: unknown, max: number = LIMITS.maxIdLength): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const enumValue = <T extends string>(value: unknown, choices: readonly T[]): value is T => typeof value === 'string' && (choices as readonly string[]).includes(value)
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const fail = (message = INVALID_DRAFT): never => { throw new Error(message) }

function imageUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) return fail()
  if (/^data:image\//i.test(value)) {
    if (value.length > MAX_DRAFT_EMBEDDED_IMAGE_BYTES || bytes(value) > MAX_DRAFT_EMBEDDED_IMAGE_BYTES) return fail('An embedded image is too large for draft recovery. Export your diagram to keep a copy.')
    if (!/^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value)) return fail()
    return value
  }
  if (value.length > 8_192 || /[\s\\]/.test(value) || !(/^https:\/\//i.test(value) || /^\/(?!\/)/.test(value))) return fail()
  const origin = typeof window === 'undefined' ? 'https://local-draft.invalid' : window.location.origin
  const url = new URL(value, origin)
  if (url.username || url.password || url.hash) return fail()
  // Generated art has a public, chart-shareable read capability. This exact
  // same-origin asset route is safe to recover; it grants no account access.
  const assetPath = value.startsWith('/api/images/') ? value : value.startsWith(`${origin}/api/images/`) ? value.slice(origin.length) : ''
  if (url.origin === origin && /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\?key=[A-Za-z0-9_-]{43}$/.test(assetPath)) return value
  // Diagram fields are allowlisted below; signed/account capabilities also stay
  // out of other image URLs, which can otherwise smuggle credentials into a snapshot.
  for (const key of url.searchParams.keys()) {
    if (/^(?:edit|token|access_token|refresh_token|auth|authorization|session|api_key|key|client_secret|capability|recovery|signature|sig)$/i.test(key)) return fail('An image uses a private access link and cannot be saved in a local draft. Export your diagram to keep a copy.')
  }
  return value
}

/** Validate the entire graph and copy only diagram fields. No server metadata or capabilities survive. */
function graph(raw: unknown): LocalDraft['flow'] {
  if (!object(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || raw.nodes.length > LIMITS.maxNodes || raw.edges.length > LIMITS.maxEdges) return fail()
  const nodes: ChartNode[] = raw.nodes.map((item: unknown) => {
    if (!object(item) || !validId(item.id) || !isNodeType(item.type) || !validText(item.label, LIMITS.maxLabelLength) || !object(item.position) || !number(item.position.x, -LIMITS.maxCoordinate, LIMITS.maxCoordinate) || !number(item.position.y, -LIMITS.maxCoordinate, LIMITS.maxCoordinate)) return fail()
    const node: ChartNode = { id: item.id, type: item.type, label: item.label, position: { x: item.position.x, y: item.position.y } }
    for (const key of ['width', 'height'] as const) {
      if (item[key] !== undefined) { if (!number(item[key], LIMITS.minNodeSize, LIMITS.maxNodeSize)) return fail(); node[key] = item[key] }
    }
    if (item.icon !== undefined) { if (!validId(item.icon, 120)) return fail(); node.icon = item.icon }
    if (item.imageUrl !== undefined && !node.icon) node.imageUrl = imageUrl(item.imageUrl)
    if ((node.icon || node.imageUrl) && !ICON_NODE_TYPES.includes(node.type)) return fail()
    if (item.parentNode !== undefined) { if (!validId(item.parentNode)) return fail(); node.parentNode = item.parentNode }
    if (item.containerKind !== undefined) { if (node.type !== 'container' || !enumValue(item.containerKind, CONTAINER_KINDS)) return fail(); node.containerKind = item.containerKind }
    if (node.type === 'image' && !node.icon && !node.imageUrl) return fail()
    return node
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) return fail()
  for (const node of nodes) {
    let parent = node.parentNode
    const visited = new Set([node.id])
    while (parent) {
      if (visited.has(parent)) return fail()
      visited.add(parent)
      const container = byId.get(parent)
      if (!container || container.type !== 'container') return fail()
      parent = container.parentNode
    }
  }
  const edgeIds = new Set<string>()
  const edges: ChartEdge[] = raw.edges.map((item: unknown) => {
    if (!object(item) || !validId(item.id, LIMITS.maxEdgeIdLength) || edgeIds.has(item.id) || !validId(item.source) || !validId(item.target) || !byId.has(item.source) || !byId.has(item.target)) return fail()
    edgeIds.add(item.id)
    const edge: ChartEdge = { id: item.id, source: item.source, target: item.target }
    if (item.label !== undefined) { if (!validText(item.label, LIMITS.maxEdgeLabelLength)) return fail(); edge.label = item.label }
    if (item.style !== undefined) { if (!enumValue(item.style, EDGE_STYLES)) return fail(); edge.style = item.style }
    for (const key of ['sourceHandle', 'targetHandle'] as const) {
      if (item[key] !== undefined) { if (!enumValue(item[key], HANDLE_POSITIONS)) return fail(); edge[key] = item[key] }
    }
    if (item.protocol !== undefined) { if (!enumValue(item.protocol, EDGE_PROTOCOLS)) return fail(); edge.protocol = item.protocol }
    if (item.commStyle !== undefined) { if (!enumValue(item.commStyle, COMM_STYLES)) return fail(); edge.commStyle = item.commStyle }
    return edge
  })
  return { nodes, edges }
}

function decodeDraft(raw: string): LocalDraft {
  // Check the bound before JSON.parse, including multi-byte labels.
  if (raw.length > MAX_LOCAL_DRAFT_BYTES || bytes(raw) > MAX_LOCAL_DRAFT_BYTES) return fail(TOO_LARGE)
  const parsed: unknown = JSON.parse(raw)
  if (!object(parsed) || parsed.version !== 1 || !Number.isSafeInteger(parsed.savedAt) || !number(parsed.savedAt, 1, 8_640_000_000_000_000) || !enumValue(parsed.diagramMode, ['flowchart', 'architecture'])) return fail()
  const flow = graph(parsed.flow)
  if (!flow.nodes.length) return fail()
  return { version: 1, savedAt: parsed.savedAt, diagramMode: parsed.diagramMode, flow }
}

/** Useful for a recovery review; invalid/oversized documents never partially apply. */
export function parseLocalDraft(raw: string): LocalDraft | null {
  try { return decodeDraft(raw) } catch { return null }
}

interface State { recovery: LocalDraft | null; status: LocalDraftStatus; savedAt: number | null; error: string | null }
function readDraft(enabled: boolean): State {
  const empty: State = { recovery: null, status: enabled ? 'idle' : 'disabled', savedAt: null, error: null }
  if (!enabled) return empty
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY)
    if (!raw) return empty
    const draft = decodeDraft(raw)
    return { recovery: draft, status: 'idle', savedAt: draft.savedAt, error: null }
  } catch { return { ...empty, status: 'error', error: INVALID_DRAFT } }
}
const fingerprintOf = (mode: DraftDiagramMode, flow: LocalDraft['flow']) => JSON.stringify({ diagramMode: mode, flow })

export function useLocalDraft({ nodes, edges, diagramMode, enabled, debounceMs = LOCAL_DRAFT_DEBOUNCE_MS }: Options): LocalDraftApi {
  // Defense in depth: callers must gate sharing before its load completes, and
  // the hook also refuses the shared-link route even if enabled was passed true.
  const active = enabled && typeof window !== 'undefined' && !parseSharedLocation(window.location)
  const [state, setState] = useState<State>(() => readDraft(active))
  const recoveryRef = useRef(state.recovery)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedFingerprint = useRef(state.recovery ? fingerprintOf(state.recovery.diagramMode, state.recovery.flow) : null)
  const suppressedFingerprint = useRef<string | null>(null)
  const candidate = useMemo(() => {
    if (!active) return { flow: null, fingerprint: null, error: null }
    try {
      const flow = graph(flowToChart(nodes, edges))
      const fingerprint = fingerprintOf(diagramMode, flow)
      if (fingerprint.length > MAX_LOCAL_DRAFT_BYTES || bytes(fingerprint) + 100 > MAX_LOCAL_DRAFT_BYTES) return fail(TOO_LARGE)
      return { flow, fingerprint, error: null }
    } catch (error) { return { flow: null, fingerprint: null, error: error instanceof Error ? error.message : INVALID_DRAFT } }
  }, [nodes, edges, diagramMode, active])
  const latest = useRef({ active, candidate, diagramMode })
  latest.current = { active, candidate, diagramMode }

  const cancelPending = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current)
    timerRef.current = undefined
  }, [])

  const clearDraft = useCallback(() => {
    cancelPending()
    if (!latest.current.active) return
    suppressedFingerprint.current = latest.current.candidate.fingerprint
    savedFingerprint.current = null
    recoveryRef.current = null
    try {
      window.localStorage.removeItem(LOCAL_DRAFT_KEY)
      setState({ recovery: null, status: 'idle', savedAt: null, error: null })
    } catch { setState({ recovery: null, status: 'error', savedAt: null, error: STORAGE_ERROR }) }
  }, [cancelPending])

  const flushDraft = useCallback(() => {
    cancelPending()
    const next = latest.current
    if (!next.active || parseSharedLocation(window.location) || recoveryRef.current) return
    if (next.candidate.error || !next.candidate.flow || !next.candidate.fingerprint) {
      setState((previous) => ({ ...previous, status: 'error', error: next.candidate.error ?? INVALID_DRAFT }))
      return
    }
    const fingerprint = next.candidate.fingerprint
    if (fingerprint === suppressedFingerprint.current || fingerprint === savedFingerprint.current) return
    if (!next.candidate.flow.nodes.length) { if (savedFingerprint.current) clearDraft(); return }
    const draft: LocalDraft = { version: 1, savedAt: Date.now(), diagramMode: next.diagramMode, flow: next.candidate.flow }
    try {
      const raw = JSON.stringify(draft)
      if (raw.length > MAX_LOCAL_DRAFT_BYTES || bytes(raw) > MAX_LOCAL_DRAFT_BYTES) return fail(TOO_LARGE)
      window.localStorage.setItem(LOCAL_DRAFT_KEY, raw)
      savedFingerprint.current = fingerprint
      suppressedFingerprint.current = null
      setState({ recovery: null, status: 'saved', savedAt: draft.savedAt, error: null })
    } catch (error) { setState((previous) => ({ ...previous, status: 'error', error: error instanceof Error && error.message === TOO_LARGE ? TOO_LARGE : STORAGE_ERROR })) }
  }, [cancelPending, clearDraft])

  const restoreDraft = useCallback(() => {
    if (!latest.current.active || !recoveryRef.current) return null
    const draft = recoveryRef.current
    recoveryRef.current = null
    // Applying the returned document is the caller's decision. Keep the last
    // good copy until the caller actually changes this render's canvas.
    suppressedFingerprint.current = latest.current.candidate.fingerprint
    savedFingerprint.current = fingerprintOf(draft.diagramMode, draft.flow)
    setState({ recovery: null, status: 'saved', savedAt: draft.savedAt, error: null })
    return draft
  }, [])

  const previouslyActive = useRef(active)
  useEffect(() => {
    const wasActive = previouslyActive.current
    previouslyActive.current = active
    if (!active || wasActive) return
    cancelPending()
    const loaded = readDraft(true)
    recoveryRef.current = loaded.recovery
    savedFingerprint.current = loaded.recovery ? fingerprintOf(loaded.recovery.diagramMode, loaded.recovery.flow) : null
    suppressedFingerprint.current = null
    setState(loaded)
  }, [active, cancelPending])

  useEffect(() => {
    cancelPending()
    if (!active || recoveryRef.current) return
    if (candidate.error) { setState((previous) => ({ ...previous, status: 'error', error: candidate.error })); return }
    if (!candidate.flow || !candidate.fingerprint || candidate.fingerprint === suppressedFingerprint.current) return
    suppressedFingerprint.current = null
    if (!candidate.flow.nodes.length) { if (savedFingerprint.current) clearDraft(); return }
    if (candidate.fingerprint === savedFingerprint.current) return
    setState((previous) => ({ ...previous, status: 'pending', error: null }))
    const delay = Number.isFinite(debounceMs) ? Math.min(5_000, Math.max(50, debounceMs)) : LOCAL_DRAFT_DEBOUNCE_MS
    timerRef.current = setTimeout(flushDraft, delay)
    return cancelPending
  }, [active, candidate, debounceMs, state.recovery, cancelPending, clearDraft, flushDraft])

  useEffect(() => {
    if (!active) return
    const hidden = () => { if (document.visibilityState === 'hidden') flushDraft() }
    window.addEventListener('pagehide', flushDraft)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('pagehide', flushDraft)
      document.removeEventListener('visibilitychange', hidden)
      cancelPending()
    }
  }, [active, flushDraft, cancelPending])

  return { recovery: active ? state.recovery : null, status: active ? state.status : 'disabled', savedAt: active ? state.savedAt : null, error: active ? state.error : null, restoreDraft, discardDraft: clearDraft, clearDraft, flushDraft }
}

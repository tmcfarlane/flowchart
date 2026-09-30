// Browser client for the shared-flowchart REST API (api/flows) plus the
// URL and edit-token helpers behind /f/:id links.

import type { Chart, ChartEdge, ChartNode } from '../shared/flowTypes'

const TOKEN_KEY_PREFIX = 'flowchart:edit-token:'

/** decodeURIComponent that keeps malformed input (e.g. a truncated "%E2%8") instead of throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** "/f/Ab3dE5fG7h" (+ optional "#edit=<token>") -> { id, token }. Malformed ids still count, so the server's 404 shows "not found". */
export function parseSharedLocation(location: Pick<Location, 'pathname' | 'hash'>): { id: string; token?: string } | null {
  const match = location.pathname.match(/^\/f\/([^/]+)\/?$/)
  if (!match) return null
  const token = location.hash.match(/(?:^#|&)edit=([^&]+)/)?.[1]
  return { id: safeDecode(match[1]), token: token ? safeDecode(token) : undefined }
}

export function sharePaths(origin: string, id: string, token?: string | null) {
  const url = `${origin}/f/${id}`
  return { url, editUrl: token ? `${url}#edit=${encodeURIComponent(token)}` : undefined }
}

export function readEditToken(id: string): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY_PREFIX + id)
  } catch {
    return null
  }
}

export function storeEditToken(id: string, token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY_PREFIX + id, token)
  } catch {
    // Private browsing or storage disabled: the token stays usable for this session only.
  }
}

export function forgetEditToken(id: string): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY_PREFIX + id)
  } catch {
    // ignore
  }
}

interface ErrorBody {
  error?: string
  code?: string
  currentVersion?: number
  issues?: Array<{ path: string; message: string }>
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

function describeError(status: number, body: ErrorBody | null): string {
  if (body?.issues?.length) {
    const first = body.issues[0]
    return `${body.error ?? 'Invalid chart'} ${first.path ? `${first.path}: ` : ''}${first.message}`
  }
  if (body?.error) return body.error
  return `Request failed (${status})`
}

export type FetchChartResult =
  | { status: 'ok'; chart: Chart }
  | { status: 'unchanged'; version: number }
  | { status: 'not_found' }
  /** httpStatus is 0 for network errors; retryAfterSeconds comes from a 429/503 Retry-After header. */
  | { status: 'error'; message: string; httpStatus: number; retryAfterSeconds?: number }

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export async function fetchSharedChart(id: string, since?: number): Promise<FetchChartResult> {
  try {
    const query = since !== undefined ? `?since=${since}` : ''
    const response = await fetch(`/api/flows/${encodeURIComponent(id)}${query}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (response.status === 404) return { status: 'not_found' }
    const body = await readJson<Chart & ErrorBody & { changed?: boolean }>(response)
    if (!response.ok || !body) {
      return {
        status: 'error',
        message: describeError(response.status, body),
        httpStatus: response.status,
        retryAfterSeconds: retryAfterSeconds(response),
      }
    }
    if (body.changed === false) return { status: 'unchanged', version: body.version }
    return { status: 'ok', chart: body }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Network error', httpStatus: 0 }
  }
}

export type CreateChartResult =
  | { ok: true; id: string; version: number; url: string; editUrl: string; editToken: string; chart: Chart }
  | { ok: false; message: string }

export async function createSharedChart(content: { title: string; nodes: ChartNode[]; edges: ChartEdge[] }): Promise<CreateChartResult> {
  try {
    const response = await fetch('/api/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(content),
    })
    const body = await readJson<Extract<CreateChartResult, { ok: true }> & ErrorBody>(response)
    if (!response.ok || !body?.id) return { ok: false, message: describeError(response.status, body) }
    return { ...body, ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' }
  }
}

export type SaveChartResult =
  | { ok: true; chart: Chart }
  | { ok: false; status: number; code?: string; message: string; currentVersion?: number; retryAfterSeconds?: number }

export async function saveSharedChart(
  id: string,
  token: string,
  payload: { title?: string; nodes: ChartNode[]; edges: ChartEdge[]; baseVersion: number },
): Promise<SaveChartResult> {
  try {
    const response = await fetch(`/api/flows/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const body = await readJson<Chart & ErrorBody>(response)
    if (response.ok && body) return { ok: true, chart: body }
    return {
      ok: false,
      status: response.status,
      code: body?.code,
      message: describeError(response.status, body),
      currentVersion: body?.currentVersion,
      retryAfterSeconds: retryAfterSeconds(response),
    }
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : 'Network error' }
  }
}

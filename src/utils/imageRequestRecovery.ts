export const IMAGE_REQUEST_RECOVERY_KEY = 'flowchart.image-request.v1'
export const MAX_IMAGE_REQUEST_RECOVERY_BYTES = 12_000
export type ImageStyle = 'surreal' | 'editorial' | 'blueprint' | 'minimal'
export type ImageSize = 'square' | 'landscape' | 'portrait'
export type ImageRecoveryState = 'pending' | 'uncertain' | 'retryable' | 'complete' | 'expired' | 'deleted' | 'missing' | 'failed'
export interface SavedImageRequest {
  version: 1; accountBinding: string; requestId: string
  prompt: string; style: ImageStyle; size: ImageSize
  state: ImageRecoveryState; createdAt: number; updatedAt: number
}
const FIELDS = ['version', 'accountBinding', 'requestId', 'prompt', 'style', 'size', 'state', 'createdAt', 'updatedAt']
const STATES: ImageRecoveryState[] = ['pending', 'uncertain', 'retryable', 'complete', 'expired', 'deleted', 'missing', 'failed']
const STYLES: ImageStyle[] = ['surreal', 'editorial', 'blueprint', 'minimal']
const SIZES: ImageSize[] = ['square', 'landscape', 'portrait']
const storageError = () => new Error('This browser could not save image recovery details. No new image request was sent. Allow local storage and try again.')
export class ImageRecoveryChangedError extends Error {
  constructor() { super('Saved image recovery details changed in another window. Check the saved request before starting another image.') }
}
export function validImageAccountBinding(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) }

function decode(raw: string): SavedImageRequest {
  if (raw.length > MAX_IMAGE_REQUEST_RECOVERY_BYTES || new TextEncoder().encode(raw).byteLength > MAX_IMAGE_REQUEST_RECOVERY_BYTES) throw new Error('Invalid recovery record')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery record')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== FIELDS.length || Object.keys(item).some(key => !FIELDS.includes(key)) || item.version !== 1 || !validImageAccountBinding(item.accountBinding) ||
      typeof item.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(item.requestId) ||
      typeof item.prompt !== 'string' || item.prompt.length < 3 || item.prompt.length > 2000 || item.prompt.trim() !== item.prompt ||
      !STYLES.includes(item.style as ImageStyle) || !SIZES.includes(item.size as ImageSize) || !STATES.includes(item.state as ImageRecoveryState) ||
      typeof item.createdAt !== 'number' || !Number.isSafeInteger(item.createdAt) || item.createdAt <= 0 ||
      typeof item.updatedAt !== 'number' || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < item.createdAt) throw new Error('Invalid recovery record')
  // Explicit copy keeps storage bounded to request data. No tokens, response
  // URLs or pixels belong in this record, including after success.
  return { version: 1, accountBinding: item.accountBinding, requestId: item.requestId, prompt: item.prompt, style: item.style as ImageStyle, size: item.size as ImageSize, state: item.state as ImageRecoveryState, createdAt: item.createdAt, updatedAt: item.updatedAt }
}
export function readImageRequestRecovery(storage: Storage = localStorage): SavedImageRequest | null {
  try { const raw = storage.getItem(IMAGE_REQUEST_RECOVERY_KEY); return raw === null ? null : decode(raw) }
  catch { throw new Error('Saved image recovery details could not be read. Do not start another image if a previous outcome is uncertain. Contact support or allow local storage and refresh.') }
}
export function saveImageRequestRecovery(next: SavedImageRequest, expected: SavedImageRequest | null, storage: Storage = localStorage): SavedImageRequest {
  const value = decode(JSON.stringify(next))
  if (JSON.stringify(readImageRequestRecovery(storage)) !== JSON.stringify(expected)) throw new ImageRecoveryChangedError()
  const serialized = JSON.stringify(value)
  try {
    storage.setItem(IMAGE_REQUEST_RECOVERY_KEY, serialized)
    if (storage.getItem(IMAGE_REQUEST_RECOVERY_KEY) !== serialized) throw storageError()
  } catch { throw storageError() }
  return value
}
export function imageRecoveryState(code: string | undefined): ImageRecoveryState {
  if (['image_quota', 'image_daily_quota', 'image_cooldown', 'image_budget', 'rate_limited', 'premium_required', 'images_unavailable', 'billing_changed'].includes(code ?? '')) return 'retryable'
  if (code === 'image_pending') return 'pending'
  if (code === 'image_result_expired') return 'expired'
  if (code === 'image_deleted') return 'deleted'
  // A missing claim can precede the original request finishing paid-proof
  // preflight. Keep nonspending checks available for that eventual result.
  if (code === 'image_missing') return 'missing'
  if (['image_rejected', 'image_busy', 'invalid_image_request', 'request_reused'].includes(code ?? '')) return 'failed'
  return 'uncertain'
}

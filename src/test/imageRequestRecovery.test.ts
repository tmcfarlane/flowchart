import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_REQUEST_RECOVERY_KEY, ImageRecoveryChangedError, imageRecoveryState, readImageRequestRecovery, saveImageRequestRecovery, type SavedImageRequest } from '../utils/imageRequestRecovery'
const request: SavedImageRequest = { version: 1, accountBinding: 'A'.repeat(43), requestId: '123e4567-e89b-42d3-a456-426614174000', prompt: 'Floating observatory', style: 'surreal', size: 'square', state: 'pending', createdAt: 1790917171000, updatedAt: 1790917171000 }
beforeEach(() => vi.restoreAllMocks())
describe('Bounded local image request recovery', () => {
  it('keeps exact request metadata without tokens, image URLs or pixels, including after success', () => {
    saveImageRequestRecovery(request, null)
    expect(readImageRequestRecovery()).toEqual(request)
    const complete = { ...request, state: 'complete' as const, updatedAt: request.updatedAt + 1000 }
    saveImageRequestRecovery(complete, request)
    expect(readImageRequestRecovery()).toEqual(complete)
    expect(Object.keys(JSON.parse(localStorage.getItem(IMAGE_REQUEST_RECOVERY_KEY)!)).sort()).toEqual(['version', 'accountBinding', 'requestId', 'prompt', 'style', 'size', 'state', 'createdAt', 'updatedAt'].sort())
  })
  it.each([
    { ...request, prompt: 'x'.repeat(2001) }, { ...request, prompt: ' Floating observatory ' },
    { ...request, style: 'unsupported' }, { ...request, accountBinding: 'short' },
    { ...request, requestId: 'not-a-uuid' }, { ...request, updatedAt: request.createdAt - 1 },
    { ...request, imageUrl: 'https://private.example?token=secret' }, { ...request, csrfToken: 'private-token' },
  ])('refuses malformed or extra recovery fields (%j)', raw => {
    localStorage.setItem(IMAGE_REQUEST_RECOVERY_KEY, JSON.stringify(raw))
    expect(() => readImageRequestRecovery()).toThrow('could not be read')
  })
  it('does not let a stale caller replace newer request details or their completion state', () => {
    saveImageRequestRecovery(request, null)
    const complete = { ...request, state: 'complete' as const, updatedAt: request.updatedAt + 1000 }
    saveImageRequestRecovery(complete, request)
    expect(() => saveImageRequestRecovery({ ...request, state: 'uncertain' }, request)).toThrow(ImageRecoveryChangedError)
    expect(() => saveImageRequestRecovery({ ...request, requestId: 'fb6899e4-c083-45f7-97a1-56fa1cfde602' }, null)).toThrow(ImageRecoveryChangedError)
    expect(readImageRequestRecovery()).toEqual(complete)
  })
  it('fails closed if the browser throws or silently fails to persist a request', () => {
    const store = { getItem: vi.fn(() => null), setItem: vi.fn(() => { throw new Error('quota') }) } as unknown as Storage
    expect(() => saveImageRequestRecovery(request, null, store)).toThrow('No new image request was sent')
    store.setItem = vi.fn()
    expect(() => saveImageRequestRecovery(request, null, store)).toThrow('No new image request was sent')
  })
  it('retains long-lived uncertainty and distinguishes safe pre-provider retries from terminal or unknown outcomes', () => {
    saveImageRequestRecovery(request, null)
    vi.spyOn(Date, 'now').mockReturnValue(request.createdAt + 365 * 86400000)
    expect(readImageRequestRecovery()?.requestId).toBe(request.requestId)
    expect(imageRecoveryState('image_cooldown')).toBe('retryable')
    expect(imageRecoveryState('image_timeout')).toBe('uncertain')
    expect(imageRecoveryState(undefined)).toBe('uncertain')
    expect(imageRecoveryState('image_result_expired')).toBe('expired')
    expect(imageRecoveryState('image_deleted')).toBe('deleted')
    expect(imageRecoveryState('image_missing')).toBe('missing')
    expect(imageRecoveryState('image_request_missing')).toBe('uncertain')
  })
})

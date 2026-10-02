import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PremiumStudio from '../components/PremiumStudio'
import { IMAGE_REQUEST_RECOVERY_KEY, readImageRequestRecovery, saveImageRequestRecovery, type SavedImageRequest } from '../utils/imageRequestRecovery'

const session = {
  available: true, premium: false, testMode: true, status: 'free', csrfToken: 'test-csrf',
  hasSubscription: false, canManageBilling: false,
  accountBinding: 'A'.repeat(43),
  images: { available: true, limit: 30, used: 0, remaining: 30, resetAt: 1800000000000 },
  recovery: { browserBound: true, available: true },
  price: { amount: 1200, currency: 'usd', interval: 'month', intervalCount: 1 },
}
const reply = (value: unknown, ok = true) => ({ ok, json: async () => value })
const image = { id: '123e4567-e89b-42d3-a456-426614174000', url: '/api/images/123e4567-e89b-42d3-a456-426614174000?key=' + 'A'.repeat(43), prompt: 'A floating observatory', createdAt: 1790917171000 }
const paid = { ...session, premium: true, status: 'active' }
const uncertain = { code: 'image_uncertain', error: 'The outcome is uncertain. Contact support before creating another request.' }
const saved = (state: SavedImageRequest['state'] = 'pending'): SavedImageRequest => ({ version: 1, accountBinding: session.accountBinding, requestId: 'fb6899e4-c083-45f7-97a1-56fa1cfde602', prompt: image.prompt, style: 'surreal', size: 'square', state, createdAt: 1790917171000, updatedAt: 1790917171000 })
const imageBodies = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([path]) => path === '/api/images').map(([, options]) => JSON.parse(options.body))
const props = { isOpen: true, onClose: vi.fn(), onInsertImage: vi.fn() }
async function begin() {
  fireEvent.change(await screen.findByLabelText('Describe your image'), { target: { value: `  ${image.prompt}  ` } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image · 1 credit' }))
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

describe('Premium image studio', () => {
  it('verifies a Checkout return and keeps generation locked while payment is unverified', async () => {
    window.history.replaceState({}, '', '/?premium=success')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(session)))
    render(<PremiumStudio isOpen onClose={vi.fn()} onInsertImage={vi.fn()} />)
    expect(await screen.findByText('Verifying your payment with Stripe…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Describe your image')).not.toBeInTheDocument()
    expect(screen.queryByText('✦ Premium active')).not.toBeInTheDocument()
  })

  it('does not promise a ready studio when paid access exists but image generation is unavailable', async () => {
    window.history.replaceState({}, '', '/?premium=success')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...session, premium: true, images: { ...session.images, available: false } })))
    render(<PremiumStudio isOpen onClose={vi.fn()} onInsertImage={vi.fn()} />)
    expect(await screen.findByText('Your payment is verified and Premium is active. Image generation is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.queryByText('Premium is active. Your image studio is ready.')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Describe your image')).not.toBeInTheDocument()
  })

  it('takes an unpaid existing subscription to billing and rejects an unexpected redirect host', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({ ...session, status: 'past_due', hasSubscription: true, canManageBilling: true })).mockResolvedValueOnce(reply({ url: 'https://unexpected.example/billing' }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio isOpen onClose={vi.fn()} onInsertImage={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage subscription ↗' }))
    expect(screen.queryByRole('button', { name: 'Upgrade to Premium' })).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe did not return a valid payment link')
    expect(fetch.mock.calls[1][0]).toBe('/api/billing/portal')
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('test-csrf')
  })

  it('allows a fresh upgrade after a subscription ends', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...session, status: 'canceled', hasSubscription: true, canManageBilling: true, checkoutAvailable: true })))
    render(<PremiumStudio isOpen onClose={vi.fn()} onInsertImage={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Upgrade to Premium' })).toBeEnabled()
    expect(screen.queryByText('Your subscription needs attention.')).not.toBeInTheDocument()
  })

  it('reuses an image request id after failure and inserts the persistent asset URL', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ code: 'image_pending', error: 'Generation is still processing. Try again shortly.' }, false)).mockResolvedValueOnce(reply({ image, usage: { ...session.images, used: 1, remaining: 29 } }))
    vi.stubGlobal('fetch', fetch)
    const insert = vi.fn()
    render(<PremiumStudio isOpen onClose={vi.fn()} onInsertImage={insert} />)
    fireEvent.change(await screen.findByLabelText('Describe your image'), { target: { value: image.prompt } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image · 1 credit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('still processing')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover last image' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Recover last image' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add to diagram' }))
    expect(JSON.parse(fetch.mock.calls[1][1].body).requestId).toBe(JSON.parse(fetch.mock.calls[2][1].body).requestId)
    expect(insert).toHaveBeenCalledWith(image.url, image.prompt)
    expect(imageBodies(fetch)[1]).toMatchObject({ recoverOnly: true, accountBinding: session.accountBinding })
    expect(readImageRequestRecovery()?.state).toBe('complete')
  })

  it('persists before POST and recovers the exact request after remount without an automatic retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockImplementationOnce(async () => {
      expect(readImageRequestRecovery()).toMatchObject({ prompt: image.prompt, accountBinding: session.accountBinding, state: 'pending' })
      throw new TypeError('Network disconnected')
    }).mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ image, usage: { ...session.images, used: 1, remaining: 29 } }))
    vi.stubGlobal('fetch', fetch)
    const first = render(<PremiumStudio {...props} />)
    await begin()
    expect(await screen.findByRole('alert')).toHaveTextContent('Network disconnected')
    const original = readImageRequestRecovery()!
    first.unmount()
    render(<PremiumStudio {...props} />)
    await screen.findByRole('button', { name: 'Recover last image' })
    expect(imageBodies(fetch)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Recover last image' }))
    await screen.findByRole('button', { name: 'Add to diagram' })
    expect(imageBodies(fetch)[1]).toMatchObject({ requestId: original.requestId, prompt: original.prompt, style: original.style, size: original.size, recoverOnly: true, accountBinding: original.accountBinding })
    expect(localStorage.getItem(IMAGE_REQUEST_RECOVERY_KEY)).not.toContain(image.url)
    expect(localStorage.getItem(IMAGE_REQUEST_RECOVERY_KEY)).not.toContain('test-csrf')
  })

  it('keeps a not-yet-found request check repeatable and recovers a late result with the same ID', async () => {
    saveImageRequestRecovery(saved(), null)
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid))
      .mockResolvedValueOnce(reply({ code: 'image_request_missing', error: 'The original request may still be verifying payment. Check this same request again.' }, false))
      .mockResolvedValueOnce(reply({ image, usage: { ...paid.images, used: 1, remaining: 29 } }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Recover last image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('may still be verifying payment')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover last image' })).toBeEnabled())
    expect(readImageRequestRecovery()).toMatchObject({ requestId: saved().requestId, state: 'uncertain' })
    fireEvent.click(screen.getByRole('button', { name: 'Recover last image' }))
    await screen.findByRole('button', { name: 'Add to diagram' })
    expect(imageBodies(fetch)).toHaveLength(2)
    expect(imageBodies(fetch).every(body => body.requestId === saved().requestId && body.recoverOnly === true)).toBe(true)
    expect(readImageRequestRecovery()).toMatchObject({ requestId: saved().requestId, state: 'complete' })
  })

  it.each([
    { ...paid, images: { ...paid.images, remaining: 0, used: 30 } },
    { ...session, status: 'canceled' },
    { ...paid, images: { ...paid.images, available: false } },
  ])('recovers with no new spend when new generation is blocked (%j)', async current => {
    saveImageRequestRecovery(saved(), null)
    const fetch = vi.fn().mockResolvedValueOnce(reply(current)).mockResolvedValueOnce(reply({ image, usage: { ...current.images, remaining: 0 } }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    const recover = await screen.findByRole('button', { name: 'Recover last image' })
    expect(recover).toBeEnabled()
    expect(imageBodies(fetch)).toHaveLength(0)
    fireEvent.click(recover)
    expect(await screen.findByRole('button', { name: 'Add to diagram' })).toBeEnabled()
    expect(imageBodies(fetch)).toHaveLength(1)
    expect(imageBodies(fetch)[0]).toMatchObject({ recoverOnly: true, requestId: saved().requestId })
  })

  it('keeps a completed request recoverable across reload and requires deliberate Generate another image to spend again', async () => {
    saveImageRequestRecovery(saved('complete'), null)
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ image, usage: paid.images })).mockResolvedValueOnce(reply({ image, usage: paid.images }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Recover last image' }))
    await screen.findByRole('button', { name: 'Add to diagram' })
    expect(imageBodies(fetch)[0]).toMatchObject({ recoverOnly: true, requestId: saved().requestId })
    expect(readImageRequestRecovery()?.requestId).toBe(saved().requestId)
    fireEvent.click(screen.getByRole('button', { name: 'Generate another image · 1 credit' }))
    await waitFor(() => expect(imageBodies(fetch)).toHaveLength(2))
    expect(imageBodies(fetch)[1].requestId).not.toBe(saved().requestId)
    expect(imageBodies(fetch)[1].recoverOnly).toBe(false)
  })

  it('requires explicit intent to replace an uncertain request and never rotates its ID when opening or preparing new details', async () => {
    saveImageRequestRecovery(saved('uncertain'), null)
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ image, usage: paid.images }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    await screen.findByRole('button', { name: 'Recover last image' })
    expect(screen.queryByLabelText('Describe your image')).toBeNull()
    expect(screen.getByText(/contact support before starting another paid request/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start another paid request…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep saved request' }))
    expect(imageBodies(fetch)).toHaveLength(0)
    expect(readImageRequestRecovery()?.requestId).toBe(saved().requestId)
    fireEvent.click(screen.getByRole('button', { name: 'Start another paid request…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare a new paid request' }))
    fireEvent.change(screen.getByLabelText('Describe your image'), { target: { value: 'A different observatory' } })
    expect(imageBodies(fetch)).toHaveLength(0)
    expect(readImageRequestRecovery()?.requestId).toBe(saved().requestId)
    fireEvent.click(screen.getByRole('button', { name: 'Generate another image · 1 credit' }))
    await waitFor(() => expect(imageBodies(fetch)).toHaveLength(1))
    expect(imageBodies(fetch)[0]).toMatchObject({ prompt: 'A different observatory', recoverOnly: false })
    expect(imageBodies(fetch)[0].requestId).not.toBe(saved().requestId)
  })

  it('blocks old-account recovery and uses a fresh account-bound UUID only after deliberate new-request intent', async () => {
    saveImageRequestRecovery(saved('uncertain'), null)
    const other = { ...paid, accountBinding: 'B'.repeat(43) }
    const fetch = vi.fn().mockResolvedValueOnce(reply(other)).mockResolvedValueOnce(reply({ image, usage: paid.images }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    expect(await screen.findByRole('button', { name: 'Recover last image' })).toBeDisabled()
    expect(screen.getByText(/belong to a different Premium account/)).toBeInTheDocument()
    expect(imageBodies(fetch)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Start another paid request…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare a new paid request' }))
    fireEvent.change(screen.getByLabelText('Describe your image'), { target: { value: image.prompt } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate another image · 1 credit' }))
    await waitFor(() => expect(imageBodies(fetch)).toHaveLength(1))
    expect(imageBodies(fetch)[0].accountBinding).toBe(other.accountBinding)
    expect(imageBodies(fetch)[0].requestId).not.toBe(saved().requestId)
  })

  it('retries a safe pre-provider failure with the exact saved UUID and description', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ code: 'image_cooldown', error: 'Wait a moment.' }, false)).mockResolvedValueOnce(reply({ image, usage: paid.images }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    await begin()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saved request · 1 credit' }))
    await screen.findByRole('button', { name: 'Add to diagram' })
    expect(imageBodies(fetch)[0]).toEqual(imageBodies(fetch)[1])
    expect(readImageRequestRecovery()?.state).toBe('complete')
  })

  it.each([['image_result_expired', 'expired', 'recovery cache has expired'], ['image_deleted', 'deleted', 'image was deleted']] as const)('preserves terminal %s without rotating or suggesting that replay recreates the image', async (code, state, message) => {
    saveImageRequestRecovery(saved('complete'), null)
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ code, error: message }, false))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Recover last image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover last image' })).toBeDisabled())
    expect(readImageRequestRecovery()).toMatchObject({ requestId: saved().requestId, state })
    expect(imageBodies(fetch)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Generate another image · 1 credit' })).toBeNull()
  })

  it('serializes simultaneous Generate activations before the first provider request completes', async () => {
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    fireEvent.change(await screen.findByLabelText('Describe your image'), { target: { value: image.prompt } })
    const generate = screen.getByRole('button', { name: 'Generate image · 1 credit' })
    act(() => { generate.dispatchEvent(new MouseEvent('click', { bubbles: true })); generate.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(imageBodies(fetch)).toHaveLength(1)
    await act(async () => finish(reply({ image, usage: paid.images })))
    expect(readImageRequestRecovery()?.state).toBe('complete')
  })

  it('sends no image POST if saving recovery details fails before generation', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(paid))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    render(<PremiumStudio {...props} />)
    await begin()
    expect(await screen.findByRole('alert')).toHaveTextContent('No new image request was sent')
    expect(imageBodies(fetch)).toHaveLength(0)
  })

  it('keeps the original saved ID and the returned image if the post-success status save fails', async () => {
    const setItem = Storage.prototype.setItem
    let writes = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (key === IMAGE_REQUEST_RECOVERY_KEY && ++writes > 1) throw new Error('Storage full'); return setItem.call(this, key, value) })
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockResolvedValueOnce(reply({ image, usage: paid.images }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    await begin()
    expect(await screen.findByRole('button', { name: 'Add to diagram' })).toBeEnabled()
    expect(await screen.findByRole('alert')).toHaveTextContent('original request ID remains')
    expect(readImageRequestRecovery()).toMatchObject({ state: 'pending', requestId: imageBodies(fetch)[0].requestId })
    expect(imageBodies(fetch)).toHaveLength(1)
  })

  it('fences an old generation result after the active Premium account changes', async () => {
    let finish!: (value: unknown) => void
    const other = { ...paid, accountBinding: 'B'.repeat(43) }
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(reply(other))
    vi.stubGlobal('fetch', fetch)
    const view = render(<PremiumStudio {...props} />)
    await begin()
    view.rerender(<PremiumStudio {...props} isOpen={false} />)
    view.rerender(<PremiumStudio {...props} isOpen />)
    await screen.findByText(/belong to a different Premium account/)
    await act(async () => finish(reply({ image, usage: paid.images })))
    expect(screen.queryByRole('button', { name: 'Add to diagram' })).toBeNull()
    expect(screen.queryByAltText(image.prompt)).toBeNull()
    expect(readImageRequestRecovery()).toMatchObject({ accountBinding: session.accountBinding, state: 'complete' })
  })

  it('ignores an earlier status response after a later account refresh wins', async () => {
    saveImageRequestRecovery(saved(), null)
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(reply({ ...session, accountBinding: 'B'.repeat(43) }))
    vi.stubGlobal('fetch', fetch)
    const view = render(<PremiumStudio {...props} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    view.rerender(<PremiumStudio {...props} isOpen={false} />)
    view.rerender(<PremiumStudio {...props} isOpen />)
    expect(await screen.findByRole('button', { name: 'Recover last image' })).toBeDisabled()
    await act(async () => finish(reply(paid)))
    expect(screen.queryByText('✦ Premium active')).toBeNull()
    expect(screen.getByRole('button', { name: 'Recover last image' })).toBeDisabled()
    expect(imageBodies(fetch)).toHaveLength(0)
  })

  it('clears an access recovery code after restoring a different Premium account', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid))
      .mockResolvedValueOnce(reply({ recoveryCode: 'account-a-private-code' }))
      .mockResolvedValueOnce(reply({ restored: true }))
      .mockResolvedValueOnce(reply({ ...paid, accountBinding: 'B'.repeat(43) }))
    vi.stubGlobal('fetch', fetch)
    render(<PremiumStudio {...props} />)
    await screen.findByText('✦ Premium active')
    fireEvent.click(screen.getByText('Save or restore Premium access'))
    fireEvent.click(screen.getByRole('button', { name: 'Create recovery code' }))
    expect(await screen.findByLabelText('One-time recovery code')).toHaveValue('account-a-private-code')
    fireEvent.change(screen.getByLabelText('Have a saved code?'), { target: { value: 'account-b-private-code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore access' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(screen.queryByLabelText('One-time recovery code')).toBeNull())
    expect(screen.getByLabelText('Have a saved code?')).toHaveValue('')
  })

  it('does not display a delayed access recovery code under a newer account session', async () => {
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockResolvedValueOnce(reply(paid))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce(reply({ ...paid, accountBinding: 'B'.repeat(43) }))
    vi.stubGlobal('fetch', fetch)
    const view = render(<PremiumStudio {...props} />)
    await screen.findByText('✦ Premium active')
    fireEvent.click(screen.getByText('Save or restore Premium access'))
    fireEvent.click(screen.getByRole('button', { name: 'Create recovery code' }))
    view.rerender(<PremiumStudio {...props} isOpen={false} />)
    view.rerender(<PremiumStudio {...props} isOpen />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await act(async () => finish(reply({ recoveryCode: 'account-a-private-code' })))
    expect(screen.queryByLabelText('One-time recovery code')).toBeNull()
    expect(screen.queryByText(/Save this code in a password manager/)).toBeNull()
  })
})

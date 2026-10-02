import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatGPTAccount from '../components/ChatGPTAccount'

const available = { available: true, authenticated: false, planUsageAvailable: false }
const unavailable = { available: false, authenticated: false, planUsageAvailable: false }
const authenticated = { ...available, authenticated: true, user: { name: 'Ada Example', email: 'ada@example.test' }, csrfToken: 'controlled-auth-csrf-fixture' }
const response = (value: unknown, ok = true) => ({ ok, json: async () => value })
const originalWidth = window.innerWidth
const originalHeight = window.innerHeight
const deferred = () => {
  let resolve!: (value: ReturnType<typeof response>) => void
  const promise = new Promise<ReturnType<typeof response>>(done => { resolve = done })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
})

describe('Website ChatGPT identity sign-in', () => {
  it('shows the unavailable default honestly, fetches a fresh session on open, and makes no sign-in request', async () => {
    const fetch = vi.fn().mockResolvedValue(response(unavailable))
    vi.stubGlobal('fetch', fetch)
    render(<ChatGPTAccount />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByText('ChatGPT sign-in is not available on this website yet.')).toBeInTheDocument()
    expect(screen.getByText('Signing in does not enable ChatGPT plan usage.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.every(([url]) => url === '/api/auth/openai/session')).toBe(true)
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) })
  })

  it('offers the real start link only when the website reports sign-in available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(available)))
    render(<ChatGPTAccount />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByRole('link', { name: 'Continue with ChatGPT' })).toHaveAttribute('href', '/api/auth/openai/start')
    expect(screen.getByRole('dialog', { name: 'ChatGPT account' })).toHaveAttribute('aria-describedby')
    expect(screen.getByText('Signing in does not enable ChatGPT plan usage.')).toBeInTheDocument()
  })

  it('gives a retry after network and HTTP failures without suggesting a connected account', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(response({}, false)).mockResolvedValueOnce(response(available))
    vi.stubGlobal('fetch', fetch)
    render(<ChatGPTAccount />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check ChatGPT sign-in. Try again.')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['missing CSRF', { ...authenticated, csrfToken: undefined }],
    ['unsafe CSRF', { ...authenticated, csrfToken: 'bad\r\nheader' }],
    ['missing user', { ...authenticated, user: undefined }],
    ['incomplete user', { ...authenticated, user: { name: 'Ada Example' } }],
    ['unsupported plan claim', { ...authenticated, planUsageAvailable: true }],
    ['unavailable authenticated identity', { ...authenticated, available: false }],
  ])('rejects a malformed session with %s', async (_label, value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(value)))
    render(<ChatGPTAccount />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check ChatGPT sign-in')
    expect(screen.queryByText('Ada Example')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('keeps a verified session usable when optional profile and email claims are absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...authenticated, user: { name: null, email: null } })))
    render(<ChatGPTAccount />)
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT account' }))
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeEnabled()
    expect(screen.getByText('Signed in to this website as')).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('.chatgpt-account-identity')).toHaveTextContent('ChatGPT account')
    expect(screen.queryByText('Ada Example')).not.toBeInTheDocument()
  })

  it('shows only verified identity, signs out with the identity CSRF header, and refreshes the session', async () => {
    const pending = deferred()
    const fetch = vi.fn().mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response(authenticated)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(available))
    vi.stubGlobal('fetch', fetch)
    render(<ChatGPTAccount />)
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT account' }))
    expect(await screen.findByText('Ada Example')).toBeInTheDocument()
    expect(screen.getByText('ada@example.test')).toBeInTheDocument()
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    signOut.focus()
    fireEvent.click(signOut)
    fireEvent.click(signOut)
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close ChatGPT account' })).toHaveFocus()
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[2]).toEqual(['/api/auth/openai/signout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'x-openai-auth-csrf': authenticated.csrfToken } })])
    await act(async () => pending.resolve(response({ signedOut: true })))
    expect(await screen.findByText('Signed out of this website.')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    expect(screen.queryByText('ada@example.test')).not.toBeInTheDocument()
    expect(fetch.mock.calls[3][0]).toBe('/api/auth/openai/session')
  })

  it('keeps verified identity and allows sign-out retry after a failed or malformed response', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response(authenticated)).mockResolvedValueOnce(response({}, false)).mockResolvedValueOnce(response({ signedOut: false }))
    vi.stubGlobal('fetch', fetch)
    render(<ChatGPTAccount />)
    fireEvent.click(await screen.findByRole('button', { name: 'ChatGPT account' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out. Try again.')
    expect(screen.getByText('Ada Example')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent('Could not sign out. Try again.')
    expect(screen.queryByText('Signed out of this website.')).not.toBeInTheDocument()
    expect(fetch.mock.calls.filter(([url]) => url === '/api/auth/openai/signout')).toHaveLength(2)
  })

  it.each([
    ['error', 'ChatGPT sign-in did not finish. You can try again.'],
    ['cancelled', 'ChatGPT sign-in was cancelled. You can try again.'],
  ])('explains a %s callback and removes only its parameter while preserving route, search, hash and history state', async (result, message) => {
    const state = { retained: 'local-route-state' }
    window.history.replaceState(state, '', `/f/LocalFixture?keep=yes&chatgpt_signin=${result}&other=two#retained-fragment`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(available)))
    render(<ChatGPTAccount />)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/f/LocalFixture?keep=yes&other=two#retained-fragment')
    expect(window.history.state).toEqual(state)
    expect(await screen.findByRole('link', { name: 'Continue with ChatGPT' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close ChatGPT account' }))
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toHaveFocus()
  })

  it('does not treat a success callback as proof of authentication', async () => {
    window.history.replaceState({}, '', '/?chatgpt_signin=success')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(available)))
    render(<ChatGPTAccount />)
    expect(await screen.findByText('The website could not verify your sign-in. You can try again.')).toBeInTheDocument()
    expect(screen.queryByText('Signed in to this website.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('traps focus, shields canvas keyboard listeners and restores the opener on Escape', async () => {
    const keyDown = vi.fn(), keyUp = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(available)))
    render(<div className="app dark-mode" onKeyDown={keyDown} onKeyUp={keyUp}><ChatGPTAccount /></div>)
    const trigger = screen.getByRole('button', { name: 'Continue with ChatGPT' })
    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: 'Close ChatGPT account' })
    const link = await screen.findByRole('link', { name: 'Continue with ChatGPT' })
    expect(close).toHaveFocus()
    expect(screen.getByRole('dialog').closest('.app')).toHaveClass('dark-mode')
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(link).toHaveFocus()
    fireEvent.keyDown(link, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: ' ' })
    fireEvent.keyUp(close, { key: ' ' })
    fireEvent.keyDown(close, { key: 'Delete' })
    expect(keyDown).not.toHaveBeenCalled()
    expect(keyUp).not.toHaveBeenCalled()
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('fits a short mobile viewport and keeps Close as its first focus target', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 7, bottom: 51, left: 334, right: 378, width: 44, height: 44, x: 334, y: 7, toJSON() {} })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(unavailable)))
    render(<ChatGPTAccount />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(screen.getByRole('dialog')).toHaveStyle({ top: '61px', left: '12px', maxHeight: '317px' })
    expect(screen.getByRole('button', { name: 'Close ChatGPT account' })).toHaveFocus()
    await screen.findByText('ChatGPT sign-in is not available on this website yet.')
  })

  it('aborts pending requests on unmount and ignores an older session after reopening', async () => {
    const older = deferred(), fresh = deferred()
    const fetch = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('fetch', fetch)
    const view = render(<ChatGPTAccount />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => fresh.resolve(response(unavailable)))
    await act(async () => older.resolve(response(authenticated)))
    expect(screen.getByText('ChatGPT sign-in is not available on this website yet.')).toBeInTheDocument()
    expect(screen.queryByText('Ada Example')).not.toBeInTheDocument()
    view.unmount()
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true)
  })
})

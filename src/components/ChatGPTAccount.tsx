import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './ChatGPTAccount.css'

type AccountSession =
  | { status: 'loading' | 'error' | 'unavailable' | 'signed-out' }
  | { status: 'signed-in'; user: { name: string | null; email: string | null }; csrfToken: string }
type CallbackResult = 'success' | 'error' | 'cancelled'

function accountSession(value: unknown): AccountSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (typeof result.available !== 'boolean' || typeof result.authenticated !== 'boolean' || result.planUsageAvailable !== false) return null
  if (!result.available) return result.authenticated ? null : { status: 'unavailable' }
  if (!result.authenticated) return { status: 'signed-out' }
  if (!result.user || typeof result.user !== 'object' || Array.isArray(result.user)) return null
  const user = result.user as Record<string, unknown>
  const text = (field: unknown): field is string | null => field === null || (typeof field === 'string' && field.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(field))
  if (!text(user.name) || !text(user.email)) return null
  if (typeof result.csrfToken !== 'string' || !result.csrfToken.length || result.csrfToken.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(result.csrfToken)) return null
  return { status: 'signed-in', user: { name: user.name?.trim() || null, email: user.email?.trim() || null }, csrfToken: result.csrfToken }
}

function readCallback(): CallbackResult | null {
  const url = new URL(window.location.href)
  const result = url.searchParams.get('chatgpt_signin')
  if (!url.searchParams.has('chatgpt_signin')) return null
  url.searchParams.delete('chatgpt_signin')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  return result === 'success' || result === 'error' || result === 'cancelled' ? result : null
}

function ChatGPTAccount() {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<AccountSession>({ status: 'loading' })
  const [callback, setCallback] = useState<CallbackResult | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const mountedRef = useRef(false)
  const sessionRequestRef = useRef<AbortController | null>(null)
  const actionRequestRef = useRef<AbortController | null>(null)
  const requestVersionRef = useRef(0)
  const signingOutRef = useRef(false)
  const panelId = useId()
  const helpId = useId()
  const [position, setPosition] = useState({ top: 12, left: 12, maxHeight: 'calc(100dvh - 24px)' })

  const refreshSession = useCallback(async () => {
    sessionRequestRef.current?.abort()
    const controller = new AbortController()
    sessionRequestRef.current = controller
    const version = ++requestVersionRef.current
    setSession({ status: 'loading' })
    try {
      const response = await fetch('/api/auth/openai/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('Session unavailable')
      const next = accountSession(await response.json())
      if (!next) throw new Error('Invalid session')
      if (mountedRef.current && !controller.signal.aborted && version === requestVersionRef.current) setSession(next)
    } catch {
      if (mountedRef.current && !controller.signal.aborted && version === requestVersionRef.current) setSession({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const returned = readCallback()
    if (returned) { setCallback(returned); setOpen(true) }
    void refreshSession()
    return () => {
      mountedRef.current = false
      ++requestVersionRef.current
      sessionRequestRef.current?.abort()
      actionRequestRef.current?.abort()
    }
  }, [refreshSession])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      if (!trigger) return
      const width = Math.min(390, Math.max(0, window.innerWidth - 24))
      const below = trigger.bottom + 10
      const top = window.innerHeight - below - 12 < 260 ? 12 : Math.max(12, below)
      setPosition({ top, left: Math.max(12, Math.min(trigger.right - width, window.innerWidth - width - 12)), maxHeight: `${Math.max(0, window.innerHeight - top - 12)}px` })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false) }
      if (event.key !== 'Tab') return
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])
      const first = controls[0], last = controls[controls.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true })
    }
  }, [open])

  const toggleOpen = () => {
    if (!open && !signingOutRef.current) { setActionError(''); void refreshSession() }
    setOpen(value => !value)
  }

  const signOut = async () => {
    if (session.status !== 'signed-in' || signingOutRef.current) return
    signingOutRef.current = true
    if (panelRef.current?.contains(document.activeElement)) closeRef.current?.focus({ preventScroll: true })
    setSigningOut(true)
    setActionError('')
    setNotice('')
    setCallback(null)
    sessionRequestRef.current?.abort()
    ++requestVersionRef.current
    const controller = new AbortController()
    actionRequestRef.current = controller
    try {
      const response = await fetch('/api/auth/openai/signout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'x-openai-auth-csrf': session.csrfToken }, signal: controller.signal })
      if (!response.ok) throw new Error('Sign-out failed')
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || (result as Record<string, unknown>).signedOut !== true) throw new Error('Sign-out failed')
      if (!mountedRef.current || controller.signal.aborted) return
      setNotice('Signed out of this website.')
      await refreshSession()
    } catch {
      if (mountedRef.current && !controller.signal.aborted) setActionError('Could not sign out. Try again.')
    } finally {
      signingOutRef.current = false
      if (mountedRef.current) setSigningOut(false)
    }
  }

  const callbackNotice = callback === 'error' ? 'ChatGPT sign-in did not finish. You can try again.'
    : callback === 'cancelled' ? 'ChatGPT sign-in was cancelled. You can try again.'
    : callback === 'success' && session.status === 'signed-in' ? 'Signed in to this website.'
    : callback === 'success' && session.status === 'signed-out' ? 'The website could not verify your sign-in. You can try again.' : ''
  const authenticated = session.status === 'signed-in'

  return (
    <div className="chatgpt-account">
      <button ref={triggerRef} type="button" className={`chatgpt-account-trigger ${authenticated ? 'is-authenticated' : ''}`} aria-label={authenticated ? 'ChatGPT account' : 'Continue with ChatGPT'} title={authenticated ? 'ChatGPT account' : 'Continue with ChatGPT'} aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId} onClick={toggleOpen}>
        <svg className="chatgpt-account-symbol" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="6" r="3" /><path d="M4 17v-2a6 6 0 0 1 12 0v2" /></svg>
        <span>{authenticated ? 'ChatGPT account' : 'Continue with ChatGPT'}</span>
      </button>
      {open && createPortal(
        <div className="chatgpt-account-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
          <div ref={panelRef} id={panelId} className="chatgpt-account-panel" style={position} role="dialog" aria-modal="true" aria-label="ChatGPT account" aria-describedby={helpId} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
            <div className="chatgpt-account-heading"><h2>ChatGPT account</h2><button ref={closeRef} type="button" className="chatgpt-account-close" aria-label="Close ChatGPT account" onClick={() => setOpen(false)}>×</button></div>
            <div className="chatgpt-account-content" aria-busy={signingOut || session.status === 'loading'}>
              {callbackNotice && <p className={callback === 'error' || (callback === 'success' && session.status === 'signed-out') ? 'chatgpt-account-error' : 'chatgpt-account-notice'} role={callback === 'error' || (callback === 'success' && session.status === 'signed-out') ? 'alert' : 'status'}>{callbackNotice}</p>}
              {notice && <p className="chatgpt-account-notice" role="status">{notice}</p>}
              {session.status === 'loading' && <p role="status">Checking website sign-in…</p>}
              {session.status === 'unavailable' && <><p className="chatgpt-account-message">ChatGPT sign-in is not available on this website yet.</p><p>This website needs an approved sign-in connection before you can use it.</p></>}
              {session.status === 'error' && <><p role="alert">Could not check ChatGPT sign-in. Try again.</p><button type="button" className="chatgpt-account-action" disabled={signingOut} onClick={() => void refreshSession()}>Try again</button></>}
              {session.status === 'signed-out' && <><p>Sign in to identify yourself on this website.</p><a className="chatgpt-account-action chatgpt-account-primary" href="/api/auth/openai/start">Continue with ChatGPT</a></>}
              {session.status === 'signed-in' && <><p className="chatgpt-account-caption">Signed in to this website as</p><div className="chatgpt-account-identity">{session.user.name && <strong>{session.user.name}</strong>}{session.user.email && <span>{session.user.email}</span>}{!session.user.name && !session.user.email && <strong>ChatGPT account</strong>}</div><button type="button" className="chatgpt-account-action" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button></>}
              {actionError && <p className="chatgpt-account-error" role="alert">{actionError}</p>}
              <p id={helpId} className="chatgpt-account-help">Signing in does not enable ChatGPT plan usage.</p>
            </div>
          </div>
        </div>, triggerRef.current?.closest('.app') ?? document.body,
      )}
    </div>
  )
}

export default ChatGPTAccount

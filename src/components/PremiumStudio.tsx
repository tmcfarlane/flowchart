import { useEffect, useRef, useState } from 'react'
import { IMAGE_REQUEST_RECOVERY_KEY, ImageRecoveryChangedError, imageRecoveryState, readImageRequestRecovery, saveImageRequestRecovery, validImageAccountBinding, type SavedImageRequest, type ImageStyle, type ImageSize } from '../utils/imageRequestRecovery'
import './PremiumStudio.css'

interface Usage { limit: number; used: number; remaining: number; resetAt: number }
interface PremiumSession {
  available: boolean; premium: boolean; testMode?: boolean; status: string; csrfToken?: string
  cancelAtPeriodEnd?: boolean; currentPeriodEnd?: number
  hasSubscription?: boolean; canManageBilling?: boolean
  checkoutAvailable?: boolean
  accountBinding?: string
  images: Partial<Usage> & { available: boolean }
  recovery: { browserBound: boolean; available: boolean; saved?: boolean }
  price?: { amount: number; currency: string; interval: string; intervalCount: number }
}
interface GeneratedImage { id: string; url: string; prompt: string; createdAt: number }
interface Props { isOpen: boolean; onClose: () => void; onInsertImage: (imageUrl: string, label: string) => void }
const STYLES: Array<{ id: ImageStyle; title: string; hint: string }> = [
  { id: 'surreal', title: 'Dreamscape', hint: 'Unexpected worlds, soft light' },
  { id: 'editorial', title: 'Editorial', hint: 'Expressive visual storytelling' },
  { id: 'blueprint', title: 'Blueprint', hint: 'Precise, technical, luminous' },
  { id: 'minimal', title: 'Minimal', hint: 'A quiet, focused composition' },
]
class StudioError extends Error { constructor(message: string, readonly code?: string) { super(message) } }
function savedRequestNotice(request: SavedImageRequest) {
  if (request.state === 'complete') return 'Your last image was created. Recover it within 24 hours, or save it in your diagram or download it. Generating another image is a new paid request.'
  if (request.state === 'expired') return 'The last request’s 24-hour recovery cache has expired. It will never generate again. Use an image link or diagram you saved earlier; starting another request is a new paid operation.'
  if (request.state === 'deleted') return 'The last image was deleted. This saved request cannot recreate it. Starting another request is a new paid operation.'
  if (request.state === 'missing') return 'The saved result could not be found. Recovery did not start generation. Contact support if the previous outcome is uncertain before starting another paid request.'
  if (request.state === 'retryable') return 'Generation stopped before the provider request. You can retry this exact saved description when your allowance and the studio are available.'
  if (request.state === 'failed') return 'The last request did not produce an available image and will not be sent again. Starting another request is a new paid operation.'
  return 'The last request’s outcome may be uncertain. Checking it does not start generation or use another credit. Its allowance may remain reserved; contact support before starting another paid request.'
}
function priceLabel(session: PremiumSession | null) {
  if (!session?.price) return ''
  const { amount, currency, interval, intervalCount } = session.price
  const zeroDecimal = ['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'].includes(currency)
  const formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / (zeroDecimal ? 1 : 100))
  return `${formatted} / ${intervalCount > 1 ? `${intervalCount} ${interval}s` : interval}`
}

export default function PremiumStudio({ isOpen, onClose, onInsertImage }: Props) {
  const [session, setSession] = useState<PremiumSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'image' | 'recovery' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<ImageStyle>('surreal')
  const [size, setSize] = useState<ImageSize>('square')
  const [image, setImage] = useState<GeneratedImage | null>(null)
  const [label, setLabel] = useState('')
  const [recovery, setRecovery] = useState<string | null>(null)
  const [restore, setRestore] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [initialRecovery] = useState(() => { try { return { request: readImageRequestRecovery(), error: null } } catch (error) { return { request: null, error: error instanceof Error ? error.message : 'Image recovery details could not be read.' } } })
  const [savedRequest, setSavedRequest] = useState<SavedImageRequest | null>(initialRecovery.request)
  const [storageIssue, setStorageIssue] = useState<string | null>(initialRecovery.error)
  const [newRequestMode, setNewRequestMode] = useState(false)
  const [confirmNewRequest, setConfirmNewRequest] = useState(false)
  const requestRef = useRef(initialRecovery.request)
  const imageLock = useRef(false)
  const sessionRef = useRef<PremiumSession | null>(null)
  const refreshVersion = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnStatus = new URLSearchParams(window.location.search).get('premium')

  const remember = (request: SavedImageRequest | null) => { requestRef.current = request; setSavedRequest(request) }
  const syncSavedRequest = () => {
    try { const request = readImageRequestRecovery(); remember(request); setStorageIssue(null); return request }
    catch (error) { const message = error instanceof Error ? error.message : 'Image recovery details could not be read.'; setStorageIssue(message); throw error }
  }
  const refresh = async () => {
    const version = ++refreshVersion.current
    const response = await fetch('/api/billing/session', { credentials: 'same-origin', cache: 'no-store' })
    const value = await response.json().catch(() => ({}))
    if (version !== refreshVersion.current) return null
    if (!response.ok) throw new Error(value.error || 'Premium status could not be checked. Try refreshing it.')
    const changed = value.accountBinding !== sessionRef.current?.accountBinding
    sessionRef.current = value
    setSession(value)
    if (changed) {
      setImage(null); setLabel(''); setRecovery(null); setRestore(''); setNotice(null); setError(null); setNewRequestMode(false); setConfirmNewRequest(false)
      let stored = requestRef.current
      try { stored = syncSavedRequest() } catch { /* The displayed storage error blocks new spend. */ }
      if (stored && stored.accountBinding === value.accountBinding) { setPrompt(stored.prompt); setStyle(stored.style); setSize(stored.size) }
      else { setPrompt(''); setStyle('surreal'); setSize('square') }
    }
    return value as PremiumSession
  }
  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    let stopped = false
    let poll: number | undefined
    const start = Date.now()
    setLoading(true)
    setError(null)
    if (returnStatus === 'cancelled') setNotice('Checkout was cancelled. Your diagrams are still here.')
    const check = async () => {
      try {
        const current = await refresh()
        if (stopped || !current) return
        if (returnStatus === 'success' && !current.premium && current.available && Date.now() - start < 120000) {
          setNotice('Verifying your payment with Stripe…')
          poll = window.setTimeout(() => void check(), 3000)
        } else if (current.premium && returnStatus === 'success') setNotice(current.images.available ? 'Premium is active. Your image studio is ready.' : 'Your payment is verified and Premium is active. Image generation is temporarily unavailable.')
        else if (returnStatus === 'success' && current.available) setNotice('Payment is still being verified. Refresh your status in a moment.')
      } catch (err) { if (!stopped) setError(err instanceof Error ? err.message : 'Premium status could not be checked.') }
      finally { if (!stopped) setLoading(false) }
    }
    void check()
    const focus = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus(), 60)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary') ?? []).filter((element) => !element.closest('details:not([open])') || element.tagName === 'SUMMARY')
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => { stopped = true; ++refreshVersion.current; window.clearTimeout(poll); window.clearTimeout(focus); window.removeEventListener('keydown', keydown); previous?.focus() }
  }, [isOpen])
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key && event.key !== IMAGE_REQUEST_RECOVERY_KEY) return; try { syncSavedRequest(); setNewRequestMode(false); setConfirmNewRequest(false) } catch { /* Shown in the studio. */ } }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  const post = async (path: string, body: unknown = {}) => {
    if (!sessionRef.current?.csrfToken) throw new Error('Refresh Premium status to start a secure session.')
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionRef.current.csrfToken }, body: JSON.stringify(body) })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) throw new StudioError(value.error || 'This action could not be completed. Please try again.', typeof value.code === 'string' ? value.code : undefined)
    return value
  }
  const paymentAction = async (action: 'checkout' | 'portal') => {
    setBusy(action); setError(null)
    try {
      const result = await post(`/api/billing/${action}`)
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || url.hostname !== (action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com') || url.username || url.password) throw new Error('Stripe did not return a valid payment link.')
      window.location.assign(url.href)
    } catch (err) { setError(err instanceof Error ? err.message : 'Stripe could not be opened.') }
    finally { setBusy(null) }
  }
  const runImageRequest = async (request: SavedImageRequest, observed: SavedImageRequest | null, recoverOnly: boolean) => {
    if (imageLock.current || busy || request.accountBinding !== sessionRef.current?.accountBinding) return
    imageLock.current = true
    setBusy('image'); setError(null); setNotice(null)
    const working = { ...request, state: recoverOnly ? request.state : 'pending' as const, updatedAt: Math.max(Date.now(), request.createdAt) }
    let saved = observed
    try {
      try { saved = saveImageRequestRecovery(working, observed); remember(saved); setStorageIssue(null) }
      catch (error) {
        if (error instanceof ImageRecoveryChangedError || !recoverOnly) throw error
        setStorageIssue('The browser could not update recovery details. This check uses the saved request ID and does not start generation.')
      }
      setNewRequestMode(false); setConfirmNewRequest(false)
      const result = await post('/api/images', { prompt: request.prompt, style: request.style, size: request.size, requestId: request.requestId, accountBinding: request.accountBinding, recoverOnly })
      if (!result.image || typeof result.image.id !== 'string' || typeof result.image.url !== 'string' || typeof result.image.prompt !== 'string') throw new StudioError('The saved image response could not be read. Check this same request again; do not start another if its outcome is uncertain.', 'image_response')
      const complete: SavedImageRequest = { ...working, state: 'complete', updatedAt: Math.max(Date.now(), working.updatedAt) }
      try { remember(saveImageRequestRecovery(complete, saved)); setStorageIssue(null) }
      catch (error) {
        if (error instanceof ImageRecoveryChangedError) { syncSavedRequest(); throw error }
        remember(complete); setStorageIssue('Your image is ready, but the browser could not update recovery details. Save it in your diagram or download it. The original request ID remains in its earlier saved record.')
      }
      if (sessionRef.current?.accountBinding !== request.accountBinding || requestRef.current?.requestId !== request.requestId) return
      setImage(result.image); setLabel(request.prompt.slice(0, 100))
      const updated = { ...sessionRef.current, images: { ...sessionRef.current.images, ...result.usage } }
      sessionRef.current = updated
      setSession(updated)
    } catch (err) {
      if (err instanceof ImageRecoveryChangedError) { try { syncSavedRequest() } catch { /* Preserve its storage error. */ } }
      else if (saved && saved.requestId === request.requestId) {
        const next: SavedImageRequest = { ...working, state: imageRecoveryState(err instanceof StudioError ? err.code : undefined), updatedAt: Math.max(Date.now(), working.updatedAt) }
        try { remember(saveImageRequestRecovery(next, saved)) } catch { /* Keep the original persisted ID on any storage failure. */ }
      }
      if (sessionRef.current?.accountBinding === request.accountBinding) setError(err instanceof Error ? err.message : 'Image generation could not finish. Check the saved request before starting another.')
    } finally { imageLock.current = false; setBusy(null) }
  }
  const generate = async () => {
    const text = prompt.trim()
    const current = sessionRef.current
    if (imageLock.current || busy || text.length < 3 || !current?.premium || !current.images.available || (current.images.remaining ?? 0) < 1 || !validImageAccountBinding(current.accountBinding)) return
    try {
      const observed = readImageRequestRecovery()
      if (JSON.stringify(observed) !== JSON.stringify(requestRef.current)) throw new ImageRecoveryChangedError()
      if (observed && !newRequestMode && (observed.accountBinding !== current.accountBinding || observed.state !== 'complete')) throw new Error('Check the saved request or explicitly choose a new paid request before generating another image.')
      const now = Date.now()
      const request: SavedImageRequest = { version: 1, accountBinding: current.accountBinding, requestId: crypto.randomUUID(), prompt: text, style, size, state: 'pending', createdAt: now, updatedAt: now }
      await runImageRequest(request, observed, false)
    } catch (error) { if (error instanceof ImageRecoveryChangedError) { try { syncSavedRequest() } catch {} }; setError(error instanceof Error ? error.message : 'Image recovery details could not be saved.') }
  }
  const recoverImage = async (retry = false) => {
    const stored = requestRef.current
    if (!stored || stored.accountBinding !== sessionRef.current?.accountBinding) return
    if (retry && (!sessionRef.current?.premium || !sessionRef.current.images.available || (sessionRef.current.images.remaining ?? 0) < 1 || stored.state !== 'retryable')) return
    await runImageRequest(stored, stored, !retry)
  }
  const recoveryAction = async (action: 'recovery' | 'restore') => {
    const accountBinding = sessionRef.current?.accountBinding
    setBusy(action); setError(null)
    try {
      const result = await post(`/api/billing/${action}`, action === 'restore' ? { recoveryCode: restore.trim() } : {})
      if (action === 'recovery') {
        if (sessionRef.current?.accountBinding !== accountBinding) return
        setRecovery(result.recoveryCode); setNotice('Save this code in a password manager. It can restore access once; generating another replaces it.')
      }
      else { setRestore(''); setNotice('Premium access restored to this browser. Save a new recovery code.'); await refresh() }
    } catch (err) { if (sessionRef.current?.accountBinding === accountBinding) setError(err instanceof Error ? err.message : 'Premium access could not be recovered.') }
    finally { setBusy(null) }
  }
  if (!isOpen) return null
  const paid = session?.premium
  const sameAccount = !!savedRequest && savedRequest.accountBinding === session?.accountBinding
  const showGenerator = paid && session.images.available && (!savedRequest || newRequestMode || (sameAccount && savedRequest.state === 'complete'))
  const existingSubscription = session?.hasSubscription && !['canceled', 'incomplete_expired'].includes(session.status)
  return <div className="premium-overlay" onClick={onClose}><div ref={dialogRef} className="premium-dialog" role="dialog" aria-modal="true" aria-labelledby="premium-title" onClick={(event) => event.stopPropagation()}>
    <header className="premium-header"><div><span className="premium-eyebrow">Flowchart Premium {session?.testMode ? '· Stripe test mode' : ''}</span><h2 id="premium-title">The image studio</h2><p>Give your diagram a window into another world.</p></div><button className="premium-close" aria-label="Close image studio" onClick={onClose}>×</button></header>
    <div className="premium-body">
      {loading && <p role="status" className="premium-notice">Checking your Premium access…</p>}
      {notice && <p role="status" className="premium-notice">{notice}</p>}
      {error && <p role="alert" className="premium-error">{error}</p>}
      {storageIssue && <p role="alert" className="premium-error">{storageIssue}</p>}
      {!loading && session && !session.available && <div className="premium-plan"><span aria-hidden="true">✧</span><h3>Premium is on its way</h3><p>Payments are not configured on this server yet. Templates, the icon library, and canvas editing are available now.</p></div>}
      {session?.available && !paid && existingSubscription && <div className="premium-plan"><div><h3>Your subscription needs attention.</h3><p>{session.status === 'payment_review' ? 'Premium access is on hold while your payment is reviewed.' : 'Premium is waiting for a verified payment. Review your subscription and payment method in Stripe.'}</p></div>{session.canManageBilling && <button className="premium-primary" onClick={() => void paymentAction('portal')} disabled={!!busy}>{busy === 'portal' ? 'Opening Stripe…' : 'Manage subscription ↗'}</button>}</div>}
      {session?.available && !paid && !existingSubscription && <div className="premium-plan"><span className="premium-plan-glyph" aria-hidden="true">✧</span><div><h3>Turn a description into an original image.</h3><p>Premium includes {session.images.limit ?? 30} AI images per calendar month. Add them to your diagrams or download them for later.</p><strong>{priceLabel(session)}</strong><small>Recurring subscription. Manage or cancel through Stripe.</small></div><button className="premium-primary" onClick={() => void paymentAction('checkout')} disabled={!!busy || !session.images.available || session.checkoutAvailable === false}>{busy === 'checkout' ? 'Opening Stripe…' : 'Upgrade to Premium'}</button>{(!session.images.available || session.checkoutAvailable === false) && <p className="premium-availability">New subscriptions are temporarily unavailable. Please check back when the studio is ready.</p>}</div>}
      {paid && <div className="premium-access"><span className="premium-active">✦ Premium active</span><span>{session.images.remaining ?? 0} / {session.images.limit ?? 0} images left this month</span><button onClick={() => void paymentAction('portal')} disabled={!!busy}>Manage subscription ↗</button>{session.cancelAtPeriodEnd && session.currentPeriodEnd && <small>Your subscription ends {new Date(session.currentPeriodEnd).toLocaleDateString()}.</small>}</div>}
      {paid && !session.images.available && <p className="premium-notice">Your subscription is active. Image generation is temporarily unavailable on this server.</p>}
      {session?.available && <p className="premium-local-details">This browser saves your last image request’s description, style and size for recovery after a reload. Opening the studio never starts generation. Save finished images in your diagram or download them; result recovery lasts 24 hours.</p>}
      {session?.available && savedRequest && <section className="premium-request-recovery" aria-label="Saved image request">
        <h3>Your last image request</h3><p className="premium-saved-prompt">{savedRequest.prompt}</p>
        <p>{sameAccount ? savedRequestNotice(savedRequest) : 'These saved details belong to a different Premium account. Restore that account to recover its image. This request will not be sent using your current account.'}</p>
        <div className="premium-request-actions"><button onClick={() => void recoverImage()} disabled={!!busy || !sameAccount || ['expired', 'deleted', 'missing', 'failed'].includes(savedRequest.state)}>{busy === 'image' ? 'Checking your request…' : 'Recover last image'}</button>
          {sameAccount && savedRequest.state === 'retryable' && <button onClick={() => void recoverImage(true)} disabled={!!busy || !paid || !session.images.available || (session.images.remaining ?? 0) < 1}>Retry saved request · 1 credit</button>}
          {(!sameAccount || savedRequest.state !== 'complete') && <button onClick={() => setConfirmNewRequest(true)} disabled={!!busy || !paid || !session.images.available || (session.images.remaining ?? 0) < 1}>Start another paid request…</button>}
        </div>
        {confirmNewRequest && <div className="premium-new-request-confirm" role="group" aria-label="Confirm another paid image request"><p>{sameAccount ? 'Another request may use another credit. If the previous outcome is uncertain, contact support first. Starting it replaces the recovery details saved in this browser.' : 'A new request uses your current account’s allowance and replaces the locally saved details for the other account. Restore the original account first if you need its image.'}</p><button onClick={() => { setNewRequestMode(true); setConfirmNewRequest(false) }} disabled={!!busy}>Prepare a new paid request</button><button onClick={() => setConfirmNewRequest(false)}>Keep saved request</button></div>}
        {newRequestMode && <p>A new paid request is selected. Your previous recovery details stay saved until you press Generate.</p>}
      </section>}
      {showGenerator && <div className="premium-generator">
        <label htmlFor="premium-prompt">Describe your image</label><textarea id="premium-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={3} placeholder="A tiny observatory floating above a sea of clouds, with a glowing constellation shaped like a workflow…" disabled={busy === 'image'} />
        <div className="premium-styles" aria-label="Image style">{STYLES.map((choice) => <button key={choice.id} onClick={() => setStyle(choice.id)} className={style === choice.id ? 'active' : ''} aria-pressed={style === choice.id} disabled={busy === 'image'}><strong>{choice.title}</strong><small>{choice.hint}</small></button>)}</div>
        <div className="premium-generate-row"><label htmlFor="premium-size">Canvas<select id="premium-size" value={size} onChange={(event) => setSize(event.target.value as ImageSize)} disabled={busy === 'image'}><option value="square">Square</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label><button className="premium-primary" onClick={() => void generate()} disabled={!!busy || !!storageIssue || !validImageAccountBinding(session.accountBinding) || prompt.trim().length < 3 || (session.images.remaining ?? 0) < 1}>{busy === 'image' ? 'Creating your image…' : savedRequest ? 'Generate another image · 1 credit' : 'Generate image · 1 credit'}</button></div>
      </div>}
      {busy === 'image' && <p className="premium-image-working" role="status">✦ Checking or creating your image. This may take a minute.</p>}
      {image && sameAccount && <div className="premium-result"><img src={image.url} alt={image.prompt} /><div><label htmlFor="premium-caption">Diagram caption</label><input id="premium-caption" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={200} /><button className="premium-primary" onClick={() => { onInsertImage(image.url, label.trim() || 'Generated image'); onClose() }}>Add to diagram</button><a href={image.url} download={`flowchart-${image.id}.webp`}>Download image ↗</a></div></div>}
      {session?.available && <details className="premium-recovery"><summary>Save or restore Premium access</summary><p>Premium access is stored securely in this browser. Save a recovery code before clearing cookies or switching devices.</p><button onClick={() => void recoveryAction('recovery')} disabled={!!busy}>{session.recovery.saved ? 'Create a new recovery code' : 'Create recovery code'}</button>{recovery && <div className="premium-recovery-code"><input aria-label="One-time recovery code" type="password" value={recovery} readOnly autoComplete="off" /><button onClick={() => { void navigator.clipboard.writeText(recovery).then(() => setNotice('Recovery code copied. Save it somewhere private.')).catch(() => setError('Clipboard is unavailable. Select and save your recovery code.')) }}>Copy code</button></div>}<div className="premium-restore"><label htmlFor="premium-restore">Have a saved code?</label><input id="premium-restore" type="password" value={restore} onChange={(event) => setRestore(event.target.value)} placeholder="Paste recovery code" autoComplete="off" /><button onClick={() => void recoveryAction('restore')} disabled={!!busy || !restore.trim()}>Restore access</button></div></details>}
      <button className="premium-refresh" onClick={() => { setLoading(true); void refresh().catch((err) => setError(err.message)).finally(() => setLoading(false)) }} disabled={loading || !!busy}>Refresh Premium status</button>
    </div>
  </div></div>
}

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { billingUpdate, type BillingStore } from './billingStore.js'
import { PremiumError, type BillingConfig, type BillingEvent, type BillingProvider, type SubscriptionSnapshot } from './billingProvider.js'
import { hashToken, verifyToken } from './tokens.js'

export interface ImageUsage { limit: number; used: number; remaining: number; resetAt: number }
export interface PremiumAccount {
  id: string; sessionHash: string; sessionExpiresAt?: number; recoveryHash?: string; createdAt: number
  customerId?: string; checkoutId?: string; checkoutNonce?: string; checkoutCreatedAt?: number
  subscriptionId?: string; status: string; paidUntil: number; cancelAtPeriodEnd: boolean
  lastBillingEvent: number; lastBillingCheck: number; billingRevision?: number
  riskBlocked?: string
  imageMonth?: string; imageUsed?: number; imageDay?: string; imageDayUsed?: number; lastImageAt?: number
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const CAPABILITY = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/
export const BILLING_COOKIE = '__Host-flowchart-premium'
export const LOCAL_BILLING_COOKIE = 'flowchart-premium-local'
const YEAR = 365 * 86400
class BillingProofChanged extends PremiumError {
  constructor() { super(409, 'billing_changed', 'Your billing status changed while this request was processing. Please retry shortly.') }
}
function accountKey(id: string) { return `account:${id}` }
function objectId(value: unknown): string {
  return typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String(value.id) : ''
}

export class BillingService {
  constructor(readonly store: BillingStore, readonly provider: BillingProvider, readonly config: BillingConfig, readonly now: () => number = Date.now) {}
  get secureCookies() { return new URL(this.config.origin).protocol === 'https:' }
  get cookieName() { return this.secureCookies ? BILLING_COOKIE : LOCAL_BILLING_COOKIE }
  cookie(capability: string): string {
    return `${this.cookieName}=${capability}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${YEAR}${this.secureCookies ? '; Secure' : ''}`
  }
  csrf(capability: string) { return createHmac('sha256', this.config.sessionSecret).update(`csrf:${capability}`).digest('base64url') }
  // Stable UI request ownership marker, independent of rotating authentication
  // capabilities. It grants no access and never exposes the account/cookie ID.
  accountBinding(account: Pick<PremiumAccount, 'id'>) { return createHmac('sha256', this.config.sessionSecret).update(`image-recovery-account:${account.id}`).digest('base64url') }
  checkCsrf(capability: string, submitted: unknown): boolean {
    if (typeof submitted !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(submitted)) return false
    return timingSafeEqual(Buffer.from(this.csrf(capability)), Buffer.from(submitted))
  }
  capabilityFromCookies(header: string | undefined): string | null {
    const values = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${this.cookieName}=`))
    if (values.length !== 1) return null
    const value = values[0].slice(this.cookieName.length + 1)
    return CAPABILITY.test(value) ? value : null
  }
  async authenticate(capability: string | null): Promise<PremiumAccount | null> {
    const match = capability?.match(CAPABILITY)
    if (!match || !UUID.test(match[1])) return null
    const account = await this.store.read<PremiumAccount>(accountKey(match[1]))
    const expiresAt = account?.sessionExpiresAt ?? (account?.createdAt ?? 0) + YEAR * 1000
    return account && expiresAt > this.now() && verifyToken(match[2], account.sessionHash) ? account : null
  }
  async createAccount(): Promise<{ account: PremiumAccount; capability: string }> {
    const token = randomBytes(32).toString('base64url')
    const account: PremiumAccount = { id: randomUUID(), sessionHash: hashToken(token), sessionExpiresAt: this.now() + YEAR * 1000, createdAt: this.now(), status: 'free', paidUntil: 0, cancelAtPeriodEnd: false, lastBillingEvent: 0, lastBillingCheck: 0 }
    if (!await this.store.compareAndSet(accountKey(account.id), null, account)) throw new PremiumError(503, 'billing_storage', 'Premium access could not be created. Please try again.')
    return { account, capability: `${account.id}.${token}` }
  }
  isPremium(account: PremiumAccount) { return !account.riskBlocked && account.status === 'active' && account.paidUntil > this.now() }
  imageUsage(account: PremiumAccount): ImageUsage {
    const now = new Date(this.now())
    const month = now.toISOString().slice(0, 7)
    const used = account.imageMonth === month ? account.imageUsed ?? 0 : 0
    const resetAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    return { limit: this.config.imageLimit, used, remaining: Math.max(0, this.config.imageLimit - used), resetAt }
  }
  async updateAccount(id: string, change: (account: PremiumAccount) => PremiumAccount): Promise<PremiumAccount> {
    return billingUpdate<PremiumAccount, PremiumAccount>(this.store, accountKey(id), previous => {
      if (!previous) throw new PremiumError(401, 'session_expired', 'Your Premium session has expired. Restore it with your recovery code.')
      const next = change(previous)
      return { next, result: next }
    })
  }
  private requireSameCheckout(current: PremiumAccount, observed: PremiumAccount) {
    if (current.customerId !== observed.customerId || current.checkoutId !== observed.checkoutId || current.checkoutNonce !== observed.checkoutNonce) throw new BillingProofChanged()
  }
  private async retireCheckout(account: PremiumAccount) {
    if (!account.checkoutId) return
    const owner = { accountId: account.id, customerId: account.customerId }
    await billingUpdate<typeof owner, boolean>(this.store, `retired-checkout:${account.checkoutId}`, previous => {
      if (previous && (previous.accountId !== owner.accountId || previous.customerId !== owner.customerId)) throw new PremiumError(409, 'billing_owner', 'The previous Checkout owner could not be verified.')
      return { next: owner, result: true }
    })
  }
  async getSession(account: PremiumAccount) {
    if (account.subscriptionId && this.now() - account.lastBillingCheck > 60000) return this.reconcile(account)
    // A Checkout redirect is only a hint to poll a stored Checkout ID. Neither
    // the URL nor the browser claims payment success or supplies object IDs.
    if (!account.subscriptionId && account.checkoutId && this.now() - account.lastBillingCheck > 10000) {
      const session = await this.provider.getCheckout(account.checkoutId)
      if (session.customerId !== account.customerId) throw new PremiumError(502, 'billing_owner', 'The payment account could not be verified.')
      if (session.status === 'complete' && session.paymentStatus === 'paid' && session.subscriptionId) {
        account = await this.updateAccount(account.id, current => {
          this.requireSameCheckout(current, account)
          return { ...current, subscriptionId: session.subscriptionId ?? undefined, billingRevision: (current.billingRevision ?? 0) + 1 }
        })
        return this.reconcile(account)
      }
      return this.updateAccount(account.id, current => { this.requireSameCheckout(current, account); return { ...current, lastBillingCheck: this.now() } })
    }
    return account
  }
  async checkout(account: PremiumAccount): Promise<string> {
    account = await this.getSession(account)
    if (this.isPremium(account)) throw new PremiumError(409, 'already_premium', 'Premium is already active. Open Manage subscription to change your plan.')
    if (account.subscriptionId && !['canceled', 'incomplete_expired'].includes(account.status)) throw new PremiumError(409, 'subscription_exists', 'A subscription already exists. Open Manage subscription to update payment or cancel it.')
    await this.provider.getPrice()
    if (account.subscriptionId) {
      // Terminal subscriptions cannot be revived. Retire their ownership
      // before starting a fresh Checkout so delayed old events cannot adopt
      // the canceled subscription while the replacement payment is pending.
      const retiredId = account.subscriptionId
      const owner = { accountId: account.id, customerId: account.customerId }
      for (const key of [`retired-subscription:${retiredId}`, ...(account.checkoutId ? [`retired-checkout:${account.checkoutId}`] : [])]) {
        await billingUpdate<typeof owner, boolean>(this.store, key, previous => {
          if (previous && (previous.accountId !== owner.accountId || previous.customerId !== owner.customerId)) throw new PremiumError(409, 'billing_owner', 'The previous subscription owner could not be verified.')
          return { next: owner, result: true }
        })
      }
      account = await this.updateAccount(account.id, current => {
        if (!current.subscriptionId) return current // Another request already retired it; retain its new Checkout nonce.
        if (current.subscriptionId !== retiredId || !['canceled', 'incomplete_expired'].includes(current.status)) throw new PremiumError(409, 'subscription_exists', 'Your subscription changed. Refresh Premium status before upgrading.')
        return { ...current, subscriptionId: undefined, checkoutId: undefined, checkoutNonce: undefined, checkoutCreatedAt: undefined, status: 'free', paidUntil: 0, cancelAtPeriodEnd: false, billingRevision: (current.billingRevision ?? 0) + 1 }
      })
    }
    if (!account.customerId) {
      const customerId = await this.provider.createCustomer(account.id)
      account = await this.updateAccount(account.id, current => {
        if (current.customerId && current.customerId !== customerId) throw new PremiumError(409, 'billing_owner', 'The payment account changed. Please refresh.')
        return { ...current, customerId }
      })
    }
    await billingUpdate<{ accountId: string }, boolean>(this.store, `customer:${account.customerId}`, previous => {
      if (previous && previous.accountId !== account.id) throw new PremiumError(409, 'billing_owner', 'The payment account could not be linked.')
      return { next: { accountId: account.id }, result: true }
    })
    // A completed asynchronous payment can remain pending beyond Checkout's
    // one-day creation window. Inspect its actual lifecycle before replacing
    // the known session; elapsed time alone cannot authorize a second plan.
    if (account.checkoutId) {
      const existing = await this.provider.getCheckout(account.checkoutId)
      if (existing.customerId !== account.customerId) throw new PremiumError(502, 'billing_owner', 'The Checkout owner could not be verified.')
      if (existing.status === 'open' && existing.url) return existing.url
      if (existing.status === 'complete') throw new PremiumError(409, 'payment_pending', 'Payment is still being verified. Please refresh Premium status shortly.')
      await this.retireCheckout(account)
      account = await this.updateAccount(account.id, current => {
        this.requireSameCheckout(current, account)
        return { ...current, checkoutId: undefined, checkoutNonce: undefined, checkoutCreatedAt: undefined }
      })
    }
    // A persisted nonce gives Stripe the same idempotency key if the network
    // fails after it creates the session but before our response arrives.
    account = await this.updateAccount(account.id, current => {
      if (this.isPremium(current)) throw new PremiumError(409, 'already_premium', 'Premium is already active. Open Manage subscription to change your plan.')
      if (current.subscriptionId) throw new PremiumError(409, 'subscription_exists', 'Your subscription changed. Refresh Premium status before upgrading.')
      const fresh = current.checkoutNonce && this.now() - (current.checkoutCreatedAt ?? 0) < 24 * 3600000
      return fresh ? current : { ...current, checkoutId: undefined, checkoutNonce: randomUUID(), checkoutCreatedAt: this.now() }
    })
    const checkout = await this.provider.createCheckout(account.customerId!, account.id, account.checkoutNonce!)
    if (checkout.customerId !== account.customerId) throw new PremiumError(502, 'billing_owner', 'Checkout did not belong to your payment account.')
    await this.updateAccount(account.id, current => {
      this.requireSameCheckout(current, account)
      return { ...current, checkoutId: checkout.id, lastBillingCheck: this.now() }
    })
    return checkout.url
  }
  async portal(account: PremiumAccount): Promise<string> {
    if (!account.customerId) throw new PremiumError(409, 'no_subscription', 'Create a Premium subscription before opening billing management.')
    return this.provider.createPortal(account.customerId)
  }
  async reconcile(account: PremiumAccount, eventCreated?: number): Promise<PremiumAccount> {
    if (!account.subscriptionId) return account
    if (eventCreated !== undefined) {
      const snapshot = await this.provider.getSubscription(account.subscriptionId)
      return this.applySnapshot(account.id, snapshot, eventCreated, account.billingRevision ?? 0)
    }
    // Foreground spend authorization is fresh proof, not a replayed event.
    // An intervening billing commit invalidates the lookup; retry against the
    // new revision instead of replacing negative proof with cached paid state.
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.store.read<PremiumAccount>(accountKey(account.id))
      if (!latest || latest.customerId !== account.customerId) throw new PremiumError(409, 'billing_owner', 'The payment account changed. Refresh Premium status.')
      if (!latest.subscriptionId) return latest
      const snapshot = await this.provider.getSubscription(latest.subscriptionId)
      try { return await this.applySnapshot(latest.id, snapshot, undefined, latest.billingRevision ?? 0) }
      catch (error) { if (!(error instanceof BillingProofChanged)) throw error }
    }
    throw new PremiumError(503, 'billing_changed', 'Your billing status is changing. Refresh Premium status before trying again.')
  }
  private async applySnapshot(accountId: string, snapshot: SubscriptionSnapshot, eventCreated?: number, expectedRevision?: number) {
    if (snapshot.livemode === this.config.testMode) throw new PremiumError(400, 'wrong_environment', 'The payment environment does not match this website.')
    const risks = await Promise.all([
      this.store.read<{ type: string; customerId: string }>(`risk:${snapshot.id}`),
      this.store.read<{ type: string; customerId: string }>(`risk-customer:${snapshot.customerId}`),
    ])
    const risk = risks.find(candidate => candidate?.customerId === snapshot.customerId)
    return this.updateAccount(accountId, current => {
      if (snapshot.customerId !== current.customerId || (current.subscriptionId && snapshot.id !== current.subscriptionId)) throw new PremiumError(409, 'billing_owner', 'The subscription owner could not be verified.')
      if (expectedRevision !== undefined && (current.billingRevision ?? 0) !== expectedRevision) throw new BillingProofChanged()
      if (eventCreated !== undefined && eventCreated < current.lastBillingEvent) return current
      const paid = snapshot.status === 'active' && snapshot.priceId === this.config.priceId && snapshot.paid
      return { ...current, subscriptionId: snapshot.id, status: snapshot.status,
        riskBlocked: risk?.customerId === snapshot.customerId ? risk.type : current.riskBlocked,
        paidUntil: paid ? snapshot.paidUntil : 0, cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        lastBillingCheck: this.now(), lastBillingEvent: eventCreated === undefined ? current.lastBillingEvent : Math.max(eventCreated, current.lastBillingEvent), billingRevision: (current.billingRevision ?? 0) + 1 }
    })
  }
  async requirePremium(account: PremiumAccount): Promise<PremiumAccount> {
    // Fresh server-to-Stripe proof before each image spend closes missed webhook
    // and stale cancellation windows. A provider outage fails closed.
    account = await this.reconcile(account)
    if (account.riskBlocked) throw new PremiumError(402, 'payment_review', 'Premium image generation is paused while a refund or payment risk is reviewed. You can manage your subscription in billing.')
    if (!this.isPremium(account)) throw new PremiumError(402, 'premium_required', 'A paid Premium subscription is required to generate images.')
    return account
  }
  async recoveryCode(account: PremiumAccount): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await this.updateAccount(account.id, current => ({ ...current, recoveryHash: hashToken(token) }))
    return `${account.id}.${token}`
  }
  async restore(code: unknown): Promise<{ account: PremiumAccount; capability: string }> {
    const match = typeof code === 'string' ? code.trim().match(CAPABILITY) : null
    if (!match || !UUID.test(match[1])) throw new PremiumError(401, 'invalid_recovery', 'The recovery code is invalid.')
    const token = randomBytes(32).toString('base64url')
    const account = await this.updateAccount(match[1], current => {
      if (!verifyToken(match[2], current.recoveryHash)) throw new PremiumError(401, 'invalid_recovery', 'The recovery code is invalid or has already been used.')
      return { ...current, sessionHash: hashToken(token), sessionExpiresAt: this.now() + YEAR * 1000, recoveryHash: undefined }
    })
    return { account, capability: `${account.id}.${token}` }
  }
  async webhook(event: BillingEvent): Promise<void> {
    if (event.livemode === this.config.testMode) throw new PremiumError(400, 'wrong_environment', 'The payment environment does not match this website.')
    const risks = ['charge.refunded', 'charge.dispute.created', 'radar.early_fraud_warning.created']
    const relevant = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required', ...risks]
    if (!relevant.includes(event.type)) return
    const claim = await billingUpdate<{ state: string; at: number }, boolean>(this.store, `event:${event.id}`, previous => {
      if (previous?.state === 'complete') return { next: previous, result: false }
      if (previous?.state === 'processing' && this.now() - previous.at < 30000) throw new PremiumError(409, 'event_processing', 'This payment event is already processing. Retry shortly.')
      return { next: { state: 'processing', at: this.now() }, result: true }
    }, 90 * 86400)
    if (!claim) return
    try {
      if (risks.includes(event.type)) {
        const owners = await this.provider.resolveRisk(event)
        for (const owner of owners) {
          // A known account's revocation and image allowance reservation must
          // serialize on the same CAS record. Publish its durable risk boundary
          // only after the account hold commits, avoiding a visible hold whose
          // still-paid account could authorize a concurrent request.
          const linked = await this.store.read<{ accountId: string }>(`customer:${owner.customerId}`)
          if (linked) await this.updateAccount(linked.accountId, current => current.customerId === owner.customerId && (!owner.subscriptionId || !current.subscriptionId || current.subscriptionId === owner.subscriptionId) ? { ...current, riskBlocked: event.type, paidUntil: 0, billingRevision: (current.billingRevision ?? 0) + 1 } : current)
          // Risk events can arrive before invoice.paid/subscription.created.
          // Persist the Stripe ownership boundary independently of our account
          // fulfillment order so subsequent reconciliation cannot lose it.
          const riskKey = owner.subscriptionId ? `risk:${owner.subscriptionId}` : `risk-customer:${owner.customerId}`
          await billingUpdate<{ type: string; customerId: string }, boolean>(this.store, riskKey, () => ({ next: { type: event.type, customerId: owner.customerId }, result: true }))
        }
        await billingUpdate<{ state: string; at: number }, boolean>(this.store, `event:${event.id}`, () => ({ next: { state: 'complete', at: this.now() }, result: true }), 90 * 86400)
        return
      }
      const customerId = objectId(event.object.customer)
      const link = await this.store.read<{ accountId: string }>(`customer:${customerId}`)
      if (link) {
        let account = await this.store.read<PremiumAccount>(accountKey(link.accountId))
        if (account && account.customerId === customerId) {
          if (event.type.startsWith('checkout.session.')) {
            // Resolve the known session from Stripe, never trust client metadata.
            const retired = event.object.id !== account.checkoutId ? await this.store.read<{ accountId: string; customerId: string }>(`retired-checkout:${objectId(event.object)}`) : null
            if (!retired || retired.accountId !== account.id || retired.customerId !== customerId) {
              if (event.object.id !== account.checkoutId) throw new PremiumError(409, 'unknown_checkout', 'The Checkout Session is not linked to this account.')
              const session = await this.provider.getCheckout(account.checkoutId!)
              if (session.customerId !== customerId) throw new PremiumError(409, 'billing_owner', 'The Checkout owner did not match.')
              if (session.paymentStatus === 'paid' && session.status === 'complete' && session.subscriptionId) {
                account = await this.updateAccount(account.id, current => {
                  this.requireSameCheckout(current, account!)
                  return { ...current, subscriptionId: session.subscriptionId ?? undefined, billingRevision: (current.billingRevision ?? 0) + 1 }
                })
                await this.reconcile(account, event.created)
              } else if (event.type.endsWith('.expired') || event.type.endsWith('.async_payment_failed')) {
                await this.retireCheckout(account)
                await this.updateAccount(account.id, current => {
                  this.requireSameCheckout(current, account!)
                  return { ...current, checkoutId: undefined, checkoutNonce: undefined, checkoutCreatedAt: undefined, lastBillingCheck: this.now() }
                })
              }
            }
          } else {
            let subscriptionId = event.type.startsWith('customer.subscription.') ? objectId(event.object) : ''
            if (!subscriptionId) {
              const parent = event.object.parent as { subscription_details?: { subscription?: unknown } } | undefined
              subscriptionId = objectId(parent?.subscription_details?.subscription) || objectId(event.object.subscription)
            }
            const retired = subscriptionId ? await this.store.read<{ accountId: string; customerId: string }>(`retired-subscription:${subscriptionId}`) : null
            if (subscriptionId && !retired && (!account.subscriptionId || account.subscriptionId === subscriptionId)) {
              const snapshot = await this.provider.getSubscription(subscriptionId)
              // Retirement/cancellation or another proof may have committed
              // while this immutable provider lookup was in flight. Stripe
              // retries a rejected event with a fresh account/object lookup.
              await this.applySnapshot(account.id, snapshot, event.created, account.billingRevision ?? 0)
            }
          }
        }
      }
      await billingUpdate<{ state: string; at: number }, boolean>(this.store, `event:${event.id}`, () => ({ next: { state: 'complete', at: this.now() }, result: true }), 90 * 86400)
    } catch (error) {
      await billingUpdate<{ state: string; at: number }, boolean>(this.store, `event:${event.id}`, () => ({ next: { state: 'retry', at: this.now() }, result: true }), 90 * 86400)
      throw error
    }
  }
}

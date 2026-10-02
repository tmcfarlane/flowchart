import Stripe from 'stripe'
import { createHash } from 'node:crypto'

export const STRIPE_API_VERSION = '2026-09-30.endive' as const
export interface PremiumPrice { amount: number; currency: string; interval: string; intervalCount: number }
export interface CheckoutResult { id: string; url: string; status: string; paymentStatus: string; customerId: string; subscriptionId: string | null }
export interface SubscriptionSnapshot {
  id: string; customerId: string; status: string; priceId: string; paid: boolean
  paidUntil: number; cancelAtPeriodEnd: boolean; livemode: boolean
}
export interface BillingEvent { id: string; type: string; created: number; livemode: boolean; object: Record<string, unknown> }
export interface BillingProvider {
  getPrice(): Promise<PremiumPrice>
  createCustomer(accountId: string): Promise<string>
  createCheckout(customerId: string, accountId: string, nonce: string): Promise<CheckoutResult>
  getCheckout(id: string): Promise<CheckoutResult>
  getSubscription(id: string): Promise<SubscriptionSnapshot>
  createPortal(customerId: string): Promise<string>
  resolveRisk(event: BillingEvent): Promise<Array<{ customerId: string; subscriptionId: string }>>
  verifyEvent(raw: Buffer, signature: string): BillingEvent
}

export interface BillingConfig {
  key: string; webhookSecret: string; priceId: string; origin: string; sessionSecret: string; testMode: boolean
  imageLimit: number; imageDailyLimit: number; imageGlobalDailyLimit: number; imageCooldownSeconds: number
}
export class PremiumError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
function positive(env: Record<string, string | undefined>, name: string, fallback: number, maximum: number) {
  const raw = Number(env[name] ?? fallback)
  return Number.isInteger(raw) && raw > 0 && raw <= maximum ? raw : fallback
}
export function billingConfigFromEnv(env: Record<string, string | undefined>): BillingConfig | null {
  const key = env.STRIPE_RESTRICTED_KEY?.trim() || env.STRIPE_SECRET_KEY?.trim()
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim()
  const priceId = env.STRIPE_PREMIUM_PRICE_ID?.trim()
  const sessionSecret = env.BILLING_SESSION_SECRET?.trim()
  const base = env.PUBLIC_BASE_URL?.trim()
  if (!key || !webhookSecret || !priceId || !sessionSecret || !base) return null
  // Current Stripe CLI temporary sandboxes issue rkcs_test_ restricted keys.
  if (!/^(?:(?:rk|sk)_(?:test|live)_|rkcs_test_)/.test(key) || !webhookSecret.startsWith('whsec_') || !/^price_[A-Za-z0-9]+$/.test(priceId) || sessionSecret.length < 32) return null
  let origin: string
  try {
    const url = new URL(base)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return null
    origin = url.origin
  } catch { return null }
  const testMode = key.includes('_test_')
  if (!testMode && env.BILLING_MODE !== 'live') return null
  return {
    key, webhookSecret, priceId, origin, sessionSecret, testMode,
    imageLimit: positive(env, 'PREMIUM_IMAGE_MONTHLY_LIMIT', 30, 500),
    imageDailyLimit: positive(env, 'PREMIUM_IMAGE_DAILY_LIMIT', 5, 100),
    imageGlobalDailyLimit: positive(env, 'IMAGE_GLOBAL_DAILY_LIMIT', 100, 10000),
    imageCooldownSeconds: positive(env, 'IMAGE_COOLDOWN_SECONDS', 20, 3600),
  }
}

function id(value: unknown): string {
  return typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String(value.id) : ''
}
function hostedUrl(value: string | null | undefined, host: string): string {
  if (!value) throw new PremiumError(502, 'billing_provider', 'The payment provider did not return a checkout link.')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) throw new PremiumError(502, 'billing_provider', 'The payment provider returned an invalid link.')
  return value
}

export class StripeBillingProvider implements BillingProvider {
  readonly stripe: Stripe
  constructor(readonly config: BillingConfig) {
    // The installed current SDK determines its API version. Pin that version in
    // STRIPE_API_VERSION so webhook fixtures and production stay compatible.
    this.stripe = new Stripe(config.key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 15000 })
  }
  async getPrice(): Promise<PremiumPrice> {
    const price = await this.stripe.prices.retrieve(this.config.priceId)
    if (!price.active || price.type !== 'recurring' || !price.recurring || !price.unit_amount || price.unit_amount <= 0 || price.livemode === this.config.testMode) {
      throw new PremiumError(503, 'billing_unavailable', 'A paid recurring Premium price has not been configured.')
    }
    return { amount: price.unit_amount, currency: price.currency, interval: price.recurring.interval, intervalCount: price.recurring.interval_count }
  }
  async createCustomer(accountId: string) {
    const customer = await this.stripe.customers.create({}, { idempotencyKey: `flowchart-customer-${accountId}` })
    return customer.id
  }
  async createCheckout(customerId: string, accountId: string, nonce: string): Promise<CheckoutResult> {
    // Stable for retries with the same Stripe idempotency key.
    const label = Array.from(createHash('sha256').update(nonce).digest().subarray(0, 8), byte => String.fromCharCode(97 + byte % 26)).join('')
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId,
      line_items: [{ price: this.config.priceId, quantity: 1 }],
      success_url: `${this.config.origin}/?premium=success`, cancel_url: `${this.config.origin}/?premium=cancelled`,
      client_reference_id: accountId, integration_identifier: `flowchart-premium-${label}`,
      subscription_data: {},
      // No trials, discounts, or payment_method_types: entitlement needs a real
      // paid invoice, while Checkout dynamically selects payment methods.
    }, { idempotencyKey: `flowchart-checkout-${accountId}-${nonce}` })
    return this.checkout(session)
  }
  async getCheckout(checkoutId: string) { return this.checkout(await this.stripe.checkout.sessions.retrieve(checkoutId)) }
  private checkout(session: Stripe.Checkout.Session): CheckoutResult {
    if (session.livemode === this.config.testMode) throw new PremiumError(502, 'billing_provider', 'The payment environment does not match this website.')
    return { id: session.id, url: session.url ? hostedUrl(session.url, 'checkout.stripe.com') : '', status: session.status ?? 'unknown', paymentStatus: session.payment_status, customerId: id(session.customer), subscriptionId: id(session.subscription) || null }
  }
  async getSubscription(subscriptionId: string): Promise<SubscriptionSnapshot> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice', 'items.data.price'] })
    const item = subscription.items.data.find(candidate => candidate.price.id === this.config.priceId)
    const invoice = subscription.latest_invoice && typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null
    let paid = invoice?.status === 'paid' && (invoice.amount_paid ?? 0) > 0
    // A paid invoice alone remains "paid" after a refund/dispute. Follow the
    // current API's InvoicePayment graph to the actual successful money flow.
    if (paid && invoice) {
      let accepted = 0
      let startingAfter: string | undefined
      do {
        const payments = await this.stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 100, starting_after: startingAfter, expand: ['data.payment.payment_intent.latest_charge', 'data.payment.charge'] })
        for (const payment of payments.data) {
          let charge: Stripe.Charge | null = null
          if (payment.payment.type === 'payment_intent') {
            const value = payment.payment.payment_intent
            const intent = typeof value === 'string' ? await this.stripe.paymentIntents.retrieve(value, { expand: ['latest_charge'] }) : value
            if (intent?.status === 'succeeded' && intent.amount_received > 0) {
              const latest = intent.latest_charge
              charge = typeof latest === 'string' ? await this.stripe.charges.retrieve(latest) : latest
            }
          } else if (payment.payment.type === 'charge') {
            const value = payment.payment.charge
            charge = typeof value === 'string' ? await this.stripe.charges.retrieve(value) : value ?? null
          }
          if (charge?.paid && charge.status === 'succeeded' && !charge.disputed && !charge.refunded && charge.amount_refunded === 0) accepted += payment.amount_paid ?? 0
        }
        startingAfter = payments.has_more ? payments.data.at(-1)?.id : undefined
      } while (startingAfter)
      paid = accepted >= invoice.amount_paid
    }
    // Flexible billing/Portal can schedule cancel_at while leaving
    // cancel_at_period_end false. Both represent a scheduled service ending.
    const cancellation = subscription.cancel_at ? subscription.cancel_at * 1000 : Infinity
    const paidUntil = paid && item ? Math.min(item.current_period_end * 1000, cancellation) : 0
    return { id: subscription.id, customerId: id(subscription.customer), status: subscription.status, priceId: item?.price.id ?? '', paid, paidUntil, cancelAtPeriodEnd: subscription.cancel_at_period_end || !!subscription.cancel_at, livemode: subscription.livemode }
  }
  async createPortal(customerId: string) {
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: this.config.origin })
    return hostedUrl(session.url, 'billing.stripe.com')
  }
  async resolveRisk(event: BillingEvent) {
    let intentId = id(event.object.payment_intent)
    if (!intentId) {
      const chargeId = event.type === 'charge.refunded' ? id(event.object) : id(event.object.charge)
      if (chargeId) intentId = id((await this.stripe.charges.retrieve(chargeId)).payment_intent)
    }
    if (!intentId) return []
    const result: Array<{ customerId: string; subscriptionId: string }> = []
    let startingAfter: string | undefined
    do {
      const payments = await this.stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: intentId }, status: 'paid', limit: 100, starting_after: startingAfter })
      for (const payment of payments.data) {
        const invoiceId = id(payment.invoice)
        if (!invoiceId) continue
        const invoice = await this.stripe.invoices.retrieve(invoiceId)
        if (invoice.parent?.type !== 'subscription_details') continue
        const subscriptionId = id(invoice.parent.subscription_details?.subscription)
        if (subscriptionId) result.push({ customerId: id(invoice.customer), subscriptionId })
      }
      startingAfter = payments.has_more ? payments.data.at(-1)?.id : undefined
    } while (startingAfter)
    if (result.length === 0) {
      // Some risk notifications precede the InvoicePayment link becoming
      // visible. Retain the first-class Customer boundary for review rather
      // than silently dropping an early warning. No metadata is consulted.
      const intent = await this.stripe.paymentIntents.retrieve(intentId)
      const customerId = id(intent.customer)
      if (customerId) result.push({ customerId, subscriptionId: '' })
    }
    return result
  }
  verifyEvent(raw: Buffer, signature: string): BillingEvent {
    const event = this.stripe.webhooks.constructEvent(raw, signature, this.config.webhookSecret, 300)
    return { id: event.id, type: event.type, created: event.created, livemode: event.livemode, object: event.data.object as unknown as Record<string, unknown> }
  }
}

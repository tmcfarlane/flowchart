// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Stripe from 'stripe'
import { BillingService, type PremiumAccount } from '../../shared/server/billingService.js'
import { FileBillingStore, MemoryBillingStore, billingStoreFromEnv, billingUpdate, RedisBillingStore } from '../../shared/server/billingStore.js'
import { PremiumError, StripeBillingProvider, billingConfigFromEnv, type BillingProvider, type BillingEvent, type CheckoutResult, type SubscriptionSnapshot } from '../../shared/server/billingProvider.js'
import { createBillingContext, handleBillingSession, handleBillingCheckout, handleBillingPortal, handleBillingWebhook, handleBillingRecovery, handleBillingRestore, handleImages, handleImageAsset, type BillingContext } from '../../shared/server/billingHttp.js'
import { prepareVercelStyleRequest } from '../../shared/server/nodeAdapter.js'
import { ImageService, OpenAIImageProvider, type ImageRequest } from '../../shared/server/imageService.js'
import { isAllowedImageUrl } from '../../shared/flowSchema.js'

const NOW = Date.UTC(2026, 9, 1)
const env = {
  STRIPE_RESTRICTED_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_PREMIUM_PRICE_ID: 'price_premium',
  BILLING_SESSION_SECRET: 'unit-test-session-secret-at-least-32-characters', PUBLIC_BASE_URL: 'http://localhost:3194',
  IMAGE_COOLDOWN_SECONDS: '1', PREMIUM_IMAGE_MONTHLY_LIMIT: '3', PREMIUM_IMAGE_DAILY_LIMIT: '2', IMAGE_GLOBAL_DAILY_LIMIT: '10',
}
const sdk = new Stripe(env.STRIPE_RESTRICTED_KEY)
class Provider implements BillingProvider {
  checkout: CheckoutResult = { id: 'cs_test_checkout', url: 'https://checkout.stripe.com/c/test', status: 'open', paymentStatus: 'unpaid', customerId: 'cus_member', subscriptionId: null }
  subscription: SubscriptionSnapshot = { id: 'sub_member', customerId: 'cus_member', status: 'active', priceId: 'price_premium', paid: true, paidUntil: NOW + 30 * 86400000, cancelAtPeriodEnd: false, livemode: false }
  getPrice = vi.fn(async () => ({ amount: 1200, currency: 'usd', interval: 'month', intervalCount: 1 }))
  createCustomer = vi.fn(async () => 'cus_member')
  createCheckout = vi.fn(async () => ({ ...this.checkout }))
  getCheckout = vi.fn(async () => ({ ...this.checkout }))
  getSubscription = vi.fn(async () => ({ ...this.subscription }))
  createPortal = vi.fn(async () => 'https://billing.stripe.com/p/test')
  resolveRisk = vi.fn(async () => [{ customerId: 'cus_member', subscriptionId: 'sub_member' }])
  verifyEvent(raw: Buffer, signature: string): BillingEvent {
    const event = sdk.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET)
    return { id: event.id, type: event.type, created: event.created, livemode: event.livemode, object: event.data.object as unknown as Record<string, unknown> }
  }
}
function event(type: string, id = `evt_${type}`, created = NOW / 1000): BillingEvent {
  return { id, type, created, livemode: false, object: { id: type.startsWith('checkout.') ? 'cs_test_checkout' : type.startsWith('invoice.') ? 'in_paid' : 'sub_member', customer: 'cus_member', parent: { subscription_details: { subscription: 'sub_member' } } } }
}
function fixture() {
  let clock = NOW
  const store = new MemoryBillingStore(() => clock)
  const provider = new Provider()
  const billing = new BillingService(store, provider, billingConfigFromEnv(env)!, () => clock)
  return { store, provider, billing, advance: (ms: number) => { clock += ms } }
}
async function paid(billing: BillingService, provider: Provider) {
  const created = await billing.createAccount()
  await billing.checkout(created.account)
  provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
  await billing.webhook(event('checkout.session.completed'))
  return { account: (await billing.authenticate(created.capability))!, capability: created.capability }
}
const request: ImageRequest = { requestId: 'fead4488-5c2f-4cc7-9759-55ee844f1d7b', prompt: 'A luminous doorway in an impossible garden', style: 'surreal', size: 'square' }
// A real 2×2 WebP fixture, not just its RIFF/WEBP magic bytes.
const imageBase64 = 'UklGRjoAAABXRUJQVlA4IC4AAADwAQCdASoCAAIAAUAmJaACdLoB+AAEgwAA/u5eP/6En4JPwSfun//ILlhdcRgA'
const image = `data:image/webp;base64,${imageBase64}`

describe('Premium billing ownership and fulfillment', () => {
  it('accepts only complete paid checkout and an active paid configured-price subscription', async () => {
    const { billing, provider } = fixture()
    const { account, capability } = await billing.createAccount()
    await billing.checkout(account)
    provider.checkout.status = 'complete'; provider.checkout.subscriptionId = 'sub_member'
    await billing.webhook(event('checkout.session.completed', 'evt_unpaid'))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(false)
    provider.checkout.paymentStatus = 'paid'
    provider.subscription.paid = false
    await billing.webhook(event('checkout.session.async_payment_succeeded', 'evt_no_invoice'))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(false)
    provider.subscription.paid = true
    await billing.webhook(event('checkout.session.async_payment_succeeded', 'evt_paid'))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(true)
  })
  it.each(['trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'paused'])('does not grant images for %s subscription status', async status => {
    const { billing, provider } = fixture()
    const { account } = await paid(billing, provider)
    provider.subscription.status = status
    await expect(billing.requirePremium(account)).rejects.toMatchObject({ status: 402 })
  })
  it('checks paid price, environment, expiry and customer before granting spend', async () => {
    const { billing, provider } = fixture()
    const { account } = await paid(billing, provider)
    provider.subscription.priceId = 'price_unrelated'
    await expect(billing.requirePremium(account)).rejects.toMatchObject({ status: 402 })
    provider.subscription.priceId = 'price_premium'; provider.subscription.paidUntil = NOW - 1
    await expect(billing.requirePremium(account)).rejects.toMatchObject({ status: 402 })
    provider.subscription.paidUntil = NOW + 1000; provider.subscription.customerId = 'cus_other'
    await expect(billing.requirePremium(account)).rejects.toMatchObject({ code: 'billing_owner' })
    provider.subscription.customerId = 'cus_member'; provider.subscription.livemode = true
    await expect(billing.requirePremium(account)).rejects.toMatchObject({ code: 'wrong_environment' })
  })
  it('processes webhook replay once and prevents an older lifecycle event overriding a newer one', async () => {
    const { billing, provider } = fixture()
    const { capability } = await paid(billing, provider)
    const calls = provider.getSubscription.mock.calls.length
    await billing.webhook(event('checkout.session.completed'))
    expect(provider.getSubscription).toHaveBeenCalledTimes(calls)
    provider.subscription.status = 'canceled'
    await billing.webhook(event('customer.subscription.deleted', 'evt_cancel', NOW / 1000 + 200))
    provider.subscription.status = 'active'
    await billing.webhook(event('customer.subscription.updated', 'evt_stale', NOW / 1000 + 100))
    expect((await billing.authenticate(capability))?.status).toBe('canceled')
  })
  it('retains paid access during cancel-at-period-end and revokes on deletion or failed renewal', async () => {
    const { billing, provider } = fixture()
    const { capability } = await paid(billing, provider)
    provider.subscription.cancelAtPeriodEnd = true
    await billing.webhook(event('customer.subscription.updated', 'evt_scheduled', NOW / 1000 + 1))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(true)
    provider.subscription.paid = false; provider.subscription.status = 'past_due'
    await billing.webhook(event('invoice.payment_failed', 'evt_failed', NOW / 1000 + 2))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(false)
    provider.subscription.paid = true; provider.subscription.status = 'active'
    await billing.webhook(event('invoice.paid', 'evt_renewed', NOW / 1000 + 3))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(true)
    provider.subscription.status = 'canceled'
    await billing.webhook(event('customer.subscription.deleted', 'evt_deleted', NOW / 1000 + 4))
    expect(billing.isPremium((await billing.authenticate(capability))!)).toBe(false)
  })
  it('never spends when a newer webhook commits paid state before fresh foreground cancellation proof returns', async () => {
    const { billing, provider } = fixture()
    const member = await paid(billing, provider)
    const activeSnapshot = { ...provider.subscription }
    const canceledSnapshot = { ...provider.subscription, status: 'canceled' }
    let releaseWebhook!: (snapshot: SubscriptionSnapshot) => void
    let releaseForeground!: (snapshot: SubscriptionSnapshot) => void
    const beforeCalls = provider.getSubscription.mock.calls.length
    provider.getSubscription
      .mockImplementationOnce(() => new Promise(resolve => { releaseWebhook = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseForeground = resolve }))
      .mockImplementation(async () => ({ ...canceledSnapshot }))
    const webhook = billing.webhook(event('customer.subscription.updated', 'evt_held_positive', NOW / 1000 + 1))
    await vi.waitFor(() => expect(provider.getSubscription).toHaveBeenCalledTimes(beforeCalls + 1))
    const generation = vi.fn(async () => image)
    const outcome = new ImageService(billing, { generate: generation }).generate(member.account, request).then(result => ({ result }), error => ({ error }))
    await vi.waitFor(() => expect(provider.getSubscription).toHaveBeenCalledTimes(beforeCalls + 2))
    releaseWebhook(activeSnapshot)
    await webhook
    releaseForeground(canceledSnapshot)
    const result = await outcome
    expect(result).toMatchObject({ error: { status: 402, code: 'premium_required' } })
    expect(generation).not.toHaveBeenCalled()
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(0)
  })
  it('fails closed after bounded fresh-proof retries when billing changes during every lookup', async () => {
    const { billing, provider } = fixture()
    const member = await paid(billing, provider)
    const releases: Array<(snapshot: SubscriptionSnapshot) => void> = []
    provider.getSubscription.mockImplementation(() => new Promise(resolve => { releases.push(resolve) }))
    const generation = vi.fn(async () => image)
    const outcome = new ImageService(billing, { generate: generation }).generate(member.account, request).then(result => ({ result }), error => ({ error }))
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.waitFor(() => expect(releases).toHaveLength(attempt * 2 + 1))
      const webhook = billing.webhook(event('customer.subscription.updated', `evt_collision_${attempt}`, NOW / 1000 + attempt + 1))
      await vi.waitFor(() => expect(releases).toHaveLength(attempt * 2 + 2))
      releases[attempt * 2 + 1]({ ...provider.subscription })
      await webhook
      releases[attempt * 2]({ ...provider.subscription })
    }
    expect(await outcome).toMatchObject({ error: { status: 503, code: 'billing_changed' } })
    expect(generation).not.toHaveBeenCalled()
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(0)
  })
  it('reuses open checkout and never opens a second subscription for an active member', async () => {
    const { billing, provider } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    const current = (await billing.authenticate(created.capability))!
    await billing.checkout(current)
    expect(provider.createCheckout).toHaveBeenCalledTimes(1)
    provider.checkout.status = 'complete'; provider.checkout.paymentStatus = 'paid'; provider.checkout.subscriptionId = 'sub_member'
    await billing.webhook(event('checkout.session.completed'))
    await expect(billing.checkout((await billing.authenticate(created.capability))!)).rejects.toMatchObject({ code: 'already_premium' })
  })
  it('creates a fresh nonce when a checkout expires', async () => {
    const { billing, provider } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    const first = (await billing.authenticate(created.capability))!.checkoutNonce
    provider.checkout.status = 'expired'
    await billing.checkout((await billing.authenticate(created.capability))!)
    expect((await billing.authenticate(created.capability))!.checkoutNonce).not.toBe(first)
  })
  it('does not create a second subscription while an asynchronous Checkout payment is pending beyond one day', async () => {
    const { billing, provider, advance } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'unpaid', subscriptionId: 'sub_async_pending' }
    advance(25 * 3600000)
    await expect(billing.checkout((await billing.authenticate(created.capability))!)).rejects.toMatchObject({ code: 'payment_pending' })
    expect(provider.createCheckout).toHaveBeenCalledTimes(1)
  })
  it('cannot clear a replacement Checkout after a concurrent request finishes checking the expired predecessor', async () => {
    const { billing, provider } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    const original = (await billing.authenticate(created.capability))!
    provider.checkout.status = 'expired'
    let release!: (result: CheckoutResult) => void
    provider.getCheckout.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = billing.checkout(original).then(url => ({ url }), error => ({ error }))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    provider.createCheckout.mockImplementation(async () => ({ ...provider.checkout, id: 'cs_test_new', url: 'https://checkout.stripe.com/c/new', status: 'open' }))
    await billing.checkout(original)
    const replacement = (await billing.authenticate(created.capability))!
    const creates = provider.createCheckout.mock.calls.length
    release({ ...provider.checkout })
    await first
    expect(provider.createCheckout).toHaveBeenCalledTimes(creates)
    expect((await billing.authenticate(created.capability))!.checkoutNonce).toBe(replacement.checkoutNonce)
    expect((await billing.authenticate(created.capability))!.checkoutId).toBe(replacement.checkoutId)
  })
  it('restarts Checkout immediately after terminal cancellation and ignores delayed events from the retired subscription', async () => {
    const { billing, provider } = fixture()
    const member = await paid(billing, provider)
    const previousNonce = member.account.checkoutNonce
    provider.subscription.status = 'canceled'
    await billing.webhook(event('customer.subscription.deleted', 'evt_terminal', NOW / 1000 + 1))
    provider.createCheckout.mockImplementation(async () => ({ ...provider.checkout, id: 'cs_test_replacement', status: 'open', paymentStatus: 'unpaid', subscriptionId: null }))
    await billing.checkout((await billing.authenticate(member.capability))!)
    const pending = (await billing.authenticate(member.capability))!
    expect(pending).toMatchObject({ status: 'free', checkoutId: 'cs_test_replacement', paidUntil: 0 })
    expect(pending.subscriptionId).toBeUndefined()
    expect(pending.checkoutNonce).not.toBe(previousNonce)
    expect(provider.createCheckout).toHaveBeenCalledTimes(2)
    const calls = provider.getSubscription.mock.calls.length
    await billing.webhook(event('customer.subscription.deleted', 'evt_delayed_terminal', NOW / 1000 + 2))
    await billing.webhook(event('checkout.session.async_payment_succeeded', 'evt_delayed_old_checkout', NOW / 1000 + 2))
    expect(provider.getSubscription).toHaveBeenCalledTimes(calls)
    expect((await billing.authenticate(member.capability))!.subscriptionId).toBeUndefined()
    provider.checkout = { ...provider.checkout, id: 'cs_test_replacement', status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_replacement' }
    provider.subscription = { ...provider.subscription, id: 'sub_replacement', status: 'active' }
    const completion = event('checkout.session.completed', 'evt_replacement_paid', NOW / 1000 + 3)
    completion.object.id = 'cs_test_replacement'
    await billing.webhook(completion)
    const renewed = (await billing.authenticate(member.capability))!
    expect(renewed.subscriptionId).toBe('sub_replacement')
    expect(billing.isPremium(renewed)).toBe(true)
  })
  it('cannot restore a retired subscription from a webhook lookup held before cancellation and replacement Checkout', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const active = { ...provider.subscription }
    let release!: (snapshot: SubscriptionSnapshot) => void
    const calls = provider.getSubscription.mock.calls.length
    provider.getSubscription.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const held = billing.webhook(event('customer.subscription.updated', 'evt_retired_held_snapshot', NOW / 1000 + 1)).then(() => ({}), error => ({ error }))
    await vi.waitFor(() => expect(provider.getSubscription).toHaveBeenCalledTimes(calls + 1))
    provider.subscription.status = 'canceled'
    advance(61000)
    const canceled = await billing.getSession((await billing.authenticate(member.capability))!)
    expect(canceled.status).toBe('canceled')
    provider.createCheckout.mockImplementation(async () => ({ ...provider.checkout, id: 'cs_test_replacement', status: 'open', paymentStatus: 'unpaid', subscriptionId: null }))
    await billing.checkout(canceled)
    release(active)
    await held
    const latest = (await billing.authenticate(member.capability))!
    expect(latest).toMatchObject({ status: 'free', checkoutId: 'cs_test_replacement', paidUntil: 0 })
    expect(latest.subscriptionId).toBeUndefined()
    expect(billing.isPremium(latest)).toBe(false)
    // A genuine delivery retry then observes the persisted retirement and
    // completes without querying or adopting the old subscription.
    const beforeRetry = provider.getSubscription.mock.calls.length
    await billing.webhook(event('customer.subscription.updated', 'evt_retired_held_snapshot', NOW / 1000 + 1))
    expect(provider.getSubscription).toHaveBeenCalledTimes(beforeRetry)
  })
  it('rotates a one-time recovery capability and invalidates the previous browser session', async () => {
    const { billing } = fixture()
    const { account, capability } = await billing.createAccount()
    const code = await billing.recoveryCode(account)
    expect(JSON.stringify(await billing.store.read(`account:${account.id}`))).not.toContain(code.split('.')[1])
    const restored = await billing.restore(code)
    expect(await billing.authenticate(capability)).toBeNull()
    expect(await billing.authenticate(restored.capability)).toMatchObject({ id: account.id })
    await expect(billing.restore(code)).rejects.toMatchObject({ code: 'invalid_recovery' })
  })
  it('enforces session expiry on the server and permits deliberate recovery afterward', async () => {
    const { billing, advance } = fixture()
    const created = await billing.createAccount()
    const recovery = await billing.recoveryCode(created.account)
    advance(366 * 86400000)
    expect(await billing.authenticate(created.capability)).toBeNull()
    const restored = await billing.restore(recovery)
    expect(await billing.authenticate(restored.capability)).toMatchObject({ id: created.account.id })
  })
  it('ignores unknown customers and rejects a forged checkout belonging to another account', async () => {
    const { billing, provider } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    const wrong = event('checkout.session.completed', 'evt_other')
    wrong.object.id = 'cs_test_other'
    await expect(billing.webhook(wrong)).rejects.toMatchObject({ code: 'unknown_checkout' })
    const unknown = event('invoice.paid', 'evt_unknown')
    unknown.object.customer = 'cus_unknown'
    await billing.webhook(unknown)
    expect(provider.getSubscription).not.toHaveBeenCalled()
  })
  it.each(['charge.refunded', 'charge.dispute.created', 'radar.early_fraud_warning.created'])('suspends spending for %s through verified Stripe object ownership', async type => {
    const { billing, provider } = fixture()
    const member = await paid(billing, provider)
    const risk = event(type, `evt_risk_${type}`)
    risk.object = { id: 'ch_refunded', payment_intent: 'pi_paid' }
    await billing.webhook(risk)
    expect(provider.resolveRisk).toHaveBeenCalledWith(risk)
    await expect(billing.requirePremium(member.account)).rejects.toMatchObject({ code: 'payment_review' })
    expect(billing.isPremium((await billing.authenticate(member.capability))!)).toBe(false)
  })
  it('commits known-account risk revocation before publishing its boundary and serializes concurrent allowance reservations', async () => {
    const { billing, provider, store } = fixture()
    const member = await paid(billing, provider)
    const read = store.read.bind(store)
    const compare = store.compareAndSet.bind(store)
    const releaseProofReads: Array<() => void> = []
    let heldRiskCommit = false
    let releaseRiskCommit!: () => void
    vi.spyOn(store, 'read').mockImplementation(async <T>(key: string): Promise<T | null> => {
      const snapshot = await read<T>(key)
      if (['risk:sub_member', 'risk-customer:cus_member'].includes(key) && releaseProofReads.length < 2) {
        return new Promise<T | null>(resolve => { releaseProofReads.push(() => resolve(snapshot)) })
      }
      return snapshot
    })
    vi.spyOn(store, 'compareAndSet').mockImplementation(async <T>(key: string, previous: T | null, next: T, ttl?: number): Promise<boolean> => {
      if (key === `account:${member.account.id}` && (next as PremiumAccount).riskBlocked && !heldRiskCommit) {
        heldRiskCommit = true
        await new Promise<void>(resolve => { releaseRiskCommit = resolve })
      }
      return compare(key, previous, next, ttl)
    })
    const generation = vi.fn(async () => image)
    const images = new ImageService(billing, { generate: generation })
    const early = images.generate(member.account, request).then(result => ({ result }), error => ({ error }))
    await vi.waitFor(() => expect(releaseProofReads).toHaveLength(2))
    const warning = billing.webhook(event('radar.early_fraud_warning.created', 'evt_interleaved_risk'))
    await vi.waitFor(() => expect(heldRiskCommit).toBe(true))
    const publishedBeforeRevocation = !!await read('risk:sub_member')
    for (const release of releaseProofReads) release()
    await early
    const callsBeforeRevocation = generation.mock.calls.length
    releaseRiskCommit()
    await warning
    expect({ publishedBeforeRevocation, providerCallsWithPublishedUncommittedRisk: publishedBeforeRevocation ? callsBeforeRevocation : 0 }).toEqual({ publishedBeforeRevocation: false, providerCallsWithPublishedUncommittedRisk: 0 })
    // A reservation made before revocation can finish. Once the authoritative
    // account hold commits, every subsequent spend fails closed.
    expect(callsBeforeRevocation).toBe(1)
    await expect(images.generate(member.account, { ...request, requestId: 'ac25b496-42dd-4f59-b8c7-0a9b1555ac78' })).rejects.toMatchObject({ status: 402, code: 'payment_review' })
    expect(generation).toHaveBeenCalledTimes(1)
  })
  it('rejects an allowance CAS that was prepared before a concurrent risk revocation committed', async () => {
    const { billing, provider, store } = fixture()
    const member = await paid(billing, provider)
    const compare = store.compareAndSet.bind(store)
    let heldReservation = false
    let releaseReservation!: () => void
    vi.spyOn(store, 'compareAndSet').mockImplementation(async <T>(key: string, previous: T | null, next: T, ttl?: number): Promise<boolean> => {
      if (key === `account:${member.account.id}` && (next as PremiumAccount).imageUsed === 1 && !heldReservation) {
        heldReservation = true
        await new Promise<void>(resolve => { releaseReservation = resolve })
      }
      return compare(key, previous, next, ttl)
    })
    const generation = vi.fn(async () => image)
    const outcome = new ImageService(billing, { generate: generation }).generate(member.account, request).then(result => ({ result }), error => ({ error }))
    await vi.waitFor(() => expect(heldReservation).toBe(true))
    await billing.webhook(event('radar.early_fraud_warning.created', 'evt_risk_wins_reservation'))
    releaseReservation()
    expect(await outcome).toMatchObject({ error: { status: 402, code: 'premium_required' } })
    expect(generation).not.toHaveBeenCalled()
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(0)
  })
  it('preserves early fraud warnings that arrive before subscription fulfillment', async () => {
    const { billing, provider } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    const warning = event('radar.early_fraud_warning.created', 'evt_early')
    warning.object = { id: 'issfr_early', payment_intent: 'pi_paid' }
    await billing.webhook(warning)
    expect(await billing.store.read('risk:sub_member')).toEqual({ type: warning.type, customerId: 'cus_member' })
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    await billing.webhook(event('checkout.session.completed', 'evt_later_checkout'))
    const current = (await billing.authenticate(created.capability))!
    expect(current.status).toBe('active')
    expect(billing.isPremium(current)).toBe(false)
    await expect(billing.requirePremium(current)).rejects.toMatchObject({ code: 'payment_review' })
  })
  it('preserves a Customer risk hold while invoice linkage is not yet visible', async () => {
    const { billing, provider } = fixture()
    const created = await billing.createAccount()
    await billing.checkout(created.account)
    provider.resolveRisk.mockResolvedValueOnce([{ customerId: 'cus_member', subscriptionId: '' }])
    await billing.webhook(event('radar.early_fraud_warning.created', 'evt_customer_warning'))
    expect(await billing.store.read('risk-customer:cus_member')).toMatchObject({ type: 'radar.early_fraud_warning.created' })
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    await billing.webhook(event('checkout.session.completed', 'evt_customer_later'))
    expect(billing.isPremium((await billing.authenticate(created.capability))!)).toBe(false)
  })
})

describe('Premium persistence and spend controls', () => {
  it('serializes concurrent reservations with compare-and-set', async () => {
    const store = new MemoryBillingStore()
    await Promise.all(Array.from({ length: 10 }, () => billingUpdate<{ count: number }, void>(store, 'counter', previous => ({ next: { count: (previous?.count ?? 0) + 1 }, result: undefined }))))
    expect(await store.read('counter')).toEqual({ count: 10 })
  })
  it('persists hashed sessions, entitlement and recovery across process restart, fails closed on malformed data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'premium-store-'))
    try {
      const path = join(dir, 'billing.json')
      const provider = new Provider()
      const first = new BillingService(new FileBillingStore(path), provider, billingConfigFromEnv(env)!, () => NOW)
      const member = await paid(first, provider)
      const recovery = await first.recoveryCode(member.account)
      const text = readFileSync(path, 'utf8')
      expect(text).not.toContain(member.capability.split('.')[1])
      expect(text).not.toContain(recovery.split('.')[1])
      const second = new BillingService(new FileBillingStore(path), provider, billingConfigFromEnv(env)!, () => NOW)
      expect(second.isPremium((await second.authenticate(member.capability))!)).toBe(true)
      expect(await second.restore(recovery)).toMatchObject({ account: { id: member.account.id } })
      writeFileSync(path, 'broken')
      expect(() => new FileBillingStore(path)).toThrow('Premium storage is unavailable')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('never uses local memory for production payments and fails closed when Redis fails', async () => {
    expect(() => billingStoreFromEnv({ NODE_ENV: 'production', FLOW_STORE: 'memory' })).toThrow()
    const store = new RedisBillingStore({ get: async () => { throw new Error('sensitive detail') }, eval: async () => { throw new Error('secret') } })
    await expect(store.read('a')).rejects.toThrow('Premium storage is unavailable')
    await expect(store.compareAndSet('a', null, {})).rejects.toThrow('Premium storage is unavailable')
  })
  it('denies unpaid requests before calling the image provider and detects missed cancellation webhooks', async () => {
    const { billing, provider } = fixture()
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    const created = await billing.createAccount()
    await expect(images.generate(created.account, request)).rejects.toMatchObject({ status: 402 })
    expect(generator.generate).not.toHaveBeenCalled()
    const member = await paid(billing, provider)
    provider.subscription.status = 'canceled'
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ status: 402 })
    expect(generator.generate).not.toHaveBeenCalled()
  })
  it('deduplicates completed and simultaneous image requests and rejects changed prompt with the same ID', async () => {
    const { billing, provider } = fixture()
    const member = await paid(billing, provider)
    let finish!: (value: string) => void
    const generator = { generate: vi.fn(() => new Promise<string>(resolve => { finish = resolve })) }
    const images = new ImageService(billing, generator)
    const first = images.generate(member.account, request)
    await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledTimes(1))
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_pending' })
    finish(image)
    const result = await first
    expect(await images.generate(member.account, request)).toEqual(result)
    expect(generator.generate).toHaveBeenCalledTimes(1)
    await expect(images.generate(member.account, { ...request, prompt: 'Changed subject' })).rejects.toMatchObject({ code: 'request_reused' })
  })
  it('keeps a stalled provider claim and its reservation after a day, reporting uncertainty instead of spending twice', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    let finish!: (value: string) => void
    const generator = { generate: vi.fn(async () => image).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve })) }
    const images = new ImageService(billing, generator)
    const first = images.generate(member.account, request)
    await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledTimes(1))
    advance(120001)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_uncertain' })
    advance(86400000)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_uncertain' })
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(1)
    // A late result can complete the same durable claim; a polling retry never
    // assumes that the original provider work was canceled or refunded.
    finish(image)
    const completed = await first
    expect((await images.generate(member.account, request)).image).toEqual(completed.image)
  })
  it('never resends a timed-out provider request after its old one-day cache window', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => { throw new PremiumError(504, 'image_timeout', 'Timed out') }) }
    const images = new ImageService(billing, generator)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_timeout' })
    advance(86400001)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_timeout' })
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(1)
  })
  it('expires only completed result data, preserving a compact claim and image ownership without another spend', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    const completed = await images.generate(member.account, request)
    const claim = await billing.store.read<Record<string, unknown>>(`image-claim:${member.account.id}:${request.requestId}`)
    expect(claim).toMatchObject({ state: 'complete', assetId: completed.image.id })
    expect(JSON.stringify(claim)).not.toContain(request.prompt)
    expect(JSON.stringify(claim)).not.toContain(completed.image.url)
    expect(JSON.stringify(claim)).not.toContain('data:image')
    advance(86400001)
    expect(await billing.store.read(`image:${member.account.id}:${request.requestId}`)).toBeNull()
    expect(await billing.store.read(`image-claim:${member.account.id}:${request.requestId}`)).toEqual(claim)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_result_expired' })
    await expect(images.generate(member.account, { ...request, prompt: 'Changed subject' })).rejects.toMatchObject({ code: 'request_reused' })
    expect(generator.generate).toHaveBeenCalledTimes(1)
    const asset = await billing.store.read<Record<string, unknown>>(`image-asset:${completed.image.id}`)
    expect(asset).toMatchObject({ accountId: member.account.id, dataUrl: image })
  })
  it('CAS-claims a safe pre-spend retry after a day so concurrent retries reserve and call the provider only once', async () => {
    const { billing, provider, advance, store } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    await images.generate(member.account, request)
    const retry = { ...request, requestId: 'da9a40a4-972f-46b8-a675-914ebd58f319' }
    await expect(images.generate(member.account, retry)).rejects.toMatchObject({ code: 'image_cooldown' })
    advance(86400001)
    const compare = store.compareAndSet.bind(store)
    let prepared = false, releaseClaim!: () => void, finish!: (value: string) => void
    vi.spyOn(store, 'compareAndSet').mockImplementation(async <T>(key: string, previous: T | null, next: T, ttl?: number): Promise<boolean> => {
      if (key === `image-claim:${member.account.id}:${retry.requestId}` && (next as { state: string }).state === 'pending' && !prepared) {
        prepared = true
        await new Promise<void>(resolve => { releaseClaim = resolve })
      }
      return compare(key, previous, next, ttl)
    })
    generator.generate.mockImplementation(() => new Promise<string>(resolve => { finish = resolve }))
    const older = images.generate(member.account, retry).then(result => ({ result }), error => ({ error }))
    await vi.waitFor(() => expect(prepared).toBe(true))
    const winner = images.generate(member.account, retry)
    await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledTimes(2))
    releaseClaim()
    expect(await older).toMatchObject({ error: { code: 'image_pending' } })
    finish(image)
    const result = await winner
    expect((await images.generate(member.account, retry)).image).toEqual(result.image)
    expect(result.usage.used).toBe(2)
    expect(generator.generate).toHaveBeenCalledTimes(2)
    const day = new Date(billing.now()).toISOString().slice(0, 10)
    expect(await store.read(`image-budget:${day}`)).toEqual({ used: 1 })
  })
  it('promotes known legacy pending jobs to durable claims before their former TTL can expire', async () => {
    const { billing, provider, advance, store } = fixture()
    const member = await paid(billing, provider)
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(JSON.stringify({ prompt: request.prompt, style: request.style, size: request.size })).digest('hex')
    const legacyKey = `image:${member.account.id}:${request.requestId}`
    await store.compareAndSet(legacyKey, null, { hash, state: 'pending', createdAt: billing.now() }, 86400)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_pending' })
    advance(86400001)
    expect(await store.read(legacyKey)).toBeNull()
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_uncertain' })
    expect(generator.generate).not.toHaveBeenCalled()
  })
  it('preserves permanent claims across a development file-store reload while the result cache expires', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'image-claim-'))
    let now = NOW
    try {
      const path = join(directory, 'billing.json'), provider = new Provider()
      const billing = new BillingService(new FileBillingStore(path, () => now), provider, billingConfigFromEnv(env)!, () => now)
      const member = await paid(billing, provider)
      const generator = { generate: vi.fn(async () => image) }
      await new ImageService(billing, generator).generate(member.account, request)
      now += 86400001
      const restored = new BillingService(new FileBillingStore(path, () => now), provider, billing.config, () => now)
      await expect(new ImageService(restored, generator).generate((await restored.authenticate(member.capability))!, request)).rejects.toMatchObject({ code: 'image_result_expired' })
      expect(generator.generate).toHaveBeenCalledTimes(1)
      expect(restored.imageUsage((await restored.authenticate(member.capability))!).used).toBe(1)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('recovers a completed image after cancellation or provider removal without new paid proof or spend', async () => {
    const { billing, provider } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    const result = await images.generate(member.account, request)
    provider.subscription.status = 'canceled'
    await billing.webhook(event('customer.subscription.deleted', 'evt_recovery_cancel'))
    provider.getSubscription.mockRejectedValue(new Error('Provider is offline'))
    const calls = provider.getSubscription.mock.calls.length
    expect(await images.generate((await billing.authenticate(member.capability))!, request)).toEqual(result)
    expect(await new ImageService(billing, null).generate((await billing.authenticate(member.capability))!, request)).toEqual(result)
    expect(provider.getSubscription).toHaveBeenCalledTimes(calls)
    expect(generator.generate).toHaveBeenCalledTimes(1)
  })
  it('keeps recovery-only absence nonspending while original paid proof is pending, then recovers its late result', async () => {
    const { billing, provider, store } = fixture()
    const member = await paid(billing, provider)
    let releaseProof!: (snapshot: SubscriptionSnapshot) => void
    provider.getSubscription.mockImplementationOnce(() => new Promise(resolve => { releaseProof = resolve }))
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    const original = images.generate(member.account, request)
    await vi.waitFor(() => expect(releaseProof).toBeTypeOf('function'))
    await expect(images.generate(member.account, { ...request, recoverOnly: true })).rejects.toMatchObject({ code: 'image_request_missing' })
    expect(await store.read(`image-claim:${member.account.id}:${request.requestId}`)).toBeNull()
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(0)
    expect(generator.generate).not.toHaveBeenCalled()
    releaseProof({ ...provider.subscription })
    const completed = await original
    const proofs = provider.getSubscription.mock.calls.length
    expect((await images.generate(member.account, { ...request, recoverOnly: true })).image).toEqual(completed.image)
    expect(provider.getSubscription).toHaveBeenCalledTimes(proofs)
    expect(generator.generate).toHaveBeenCalledTimes(1)
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(1)
  })
  it('reports current allowance on replay instead of the count saved before subsequent image requests', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    const first = await images.generate(member.account, request)
    advance(2000)
    await images.generate(member.account, { ...request, requestId: 'bcf94b82-4c59-4a43-86b9-9409c435c393' })
    const replay = await images.generate((await billing.authenticate(member.capability))!, request)
    expect(replay.image).toEqual(first.image)
    expect(replay.usage).toMatchObject({ used: 2, remaining: 1 })
    expect(generator.generate).toHaveBeenCalledTimes(2)
  })
  it('does not report success or spend again when a completed job has lost its stored asset', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    const result = await images.generate(member.account, request)
    const key = `image-asset:${result.image.id}`
    const asset = await billing.store.read(key)
    await billing.store.compareAndSet(key, asset, asset, 1)
    advance(2000)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ status: 410, code: 'image_missing' })
    expect(generator.generate).toHaveBeenCalledTimes(1)
  })
  it('allows an explicit retry of the same pre-spend request after cooldown clears without duplicate provider calls', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    await images.generate(member.account, request)
    const retry = { ...request, requestId: 'bcf94b82-4c59-4a43-86b9-9409c435c393' }
    await expect(images.generate(member.account, retry)).rejects.toMatchObject({ code: 'image_cooldown' })
    expect(generator.generate).toHaveBeenCalledTimes(1)
    advance(2000)
    const result = await images.generate(member.account, retry)
    expect(await images.generate(member.account, retry)).toEqual(result)
    expect(generator.generate).toHaveBeenCalledTimes(2)
    expect(result.usage).toMatchObject({ used: 2 })
  })
  it('returns the current quota when a slower image finishes after a second reservation', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    let finish!: (value: string) => void
    const generator = { generate: vi.fn(async () => image).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve })) }
    const images = new ImageService(billing, generator)
    const slow = images.generate(member.account, request)
    await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledTimes(1))
    advance(2000)
    await images.generate(member.account, { ...request, requestId: 'bcf94b82-4c59-4a43-86b9-9409c435c393' })
    finish(image)
    expect((await slow).usage).toMatchObject({ used: 2, remaining: 1 })
  })
  it('creates portable absolute HTTPS image URLs for deployment and chart persistence', async () => {
    const original = fixture()
    const billing = new BillingService(original.store, original.provider, { ...original.billing.config, origin: 'https://flowchart.example' }, original.billing.now)
    const member = await paid(billing, original.provider)
    const result = await new ImageService(billing, { generate: async () => image }).generate(member.account, request)
    expect(result.image.url).toMatch(/^https:\/\/flowchart\.example\/api\/images\//)
    expect(isAllowedImageUrl(result.image.url)).toBe(true)
  })
  it('enforces daily and monthly quotas, cooldown, calendar reset and shared global capacity', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => image) }
    const images = new ImageService(billing, generator)
    await images.generate(member.account, request)
    await expect(images.generate(member.account, { ...request, requestId: 'ea5707cc-ac92-4e9e-9d3e-e7968c35a62c' })).rejects.toMatchObject({ code: 'image_cooldown' })
    advance(2000)
    await images.generate(member.account, { ...request, requestId: '70120b1e-a4f9-4688-8cf2-037bf28c8f98' })
    advance(2000)
    await expect(images.generate(member.account, { ...request, requestId: '9b4c427f-960f-407e-87de-30f7e9e8d58b' })).rejects.toMatchObject({ code: 'image_daily_quota' })
    advance(86400000)
    await images.generate(member.account, { ...request, requestId: '8440e9ac-34f3-4067-98a6-2c66f59171c6' })
    advance(2000)
    await expect(images.generate(member.account, { ...request, requestId: 'f6e1780c-b67d-4731-b61c-93f94010a029' })).rejects.toMatchObject({ code: 'image_quota' })
    const current = (await billing.authenticate(member.capability))!
    expect(billing.imageUsage(current)).toMatchObject({ used: 3, remaining: 0, resetAt: Date.UTC(2026, 10, 1) })
    advance(31 * 86400000); provider.subscription.paidUntil = NOW + 90 * 86400000
    expect(billing.imageUsage(current).used).toBe(0)
    const day = new Date(billing.now()).toISOString().slice(0, 10)
    await billing.store.compareAndSet(`image-budget:${day}`, null, { used: 10 })
    await expect(images.generate(member.account, { ...request, requestId: '89553039-7d08-4e4c-b592-c86c29bde0d5' })).rejects.toMatchObject({ code: 'image_budget' })
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(0)
  })
  it('refunds definite provider failure but prevents automatic replay, retains uncertain timeout reservation', async () => {
    const { billing, provider, advance } = fixture()
    const member = await paid(billing, provider)
    const generator = { generate: vi.fn(async () => { throw new PremiumError(503, 'image_busy', 'Busy') }) }
    const images = new ImageService(billing, generator)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_busy' })
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(0)
    await expect(images.generate(member.account, request)).rejects.toMatchObject({ code: 'image_busy' })
    expect(generator.generate).toHaveBeenCalledTimes(1)
    advance(2000)
    generator.generate.mockImplementation(async () => { throw new PremiumError(504, 'image_timeout', 'Timed out') })
    await expect(images.generate(member.account, { ...request, requestId: '89553039-7d08-4e4c-b592-c86c29bde0d5' })).rejects.toMatchObject({ code: 'image_timeout' })
    expect(billing.imageUsage((await billing.authenticate(member.capability))!).used).toBe(1)
  })
})

describe('Stripe and OpenAI adapter contracts', () => {
  it('uses hosted Checkout with configured recurring price, dynamic payment methods, stable retry metadata and safe URLs', async () => {
    const provider = new StripeBillingProvider(billingConfigFromEnv(env)!)
    const create = vi.spyOn(provider.stripe.checkout.sessions, 'create').mockResolvedValue({ id: 'cs_test_a', url: 'https://checkout.stripe.com/c/a', status: 'open', payment_status: 'unpaid', customer: 'cus_member', subscription: null, livemode: false } as Stripe.Checkout.Session)
    await provider.createCheckout('cus_member', 'member', 'same-nonce')
    await provider.createCheckout('cus_member', 'member', 'same-nonce')
    const [parameters, options] = create.mock.calls[0]
    expect(parameters).toMatchObject({ mode: 'subscription', customer: 'cus_member', line_items: [{ price: 'price_premium', quantity: 1 }], success_url: 'http://localhost:3194/?premium=success' })
    expect(parameters).not.toHaveProperty('payment_method_types')
    expect(parameters).not.toHaveProperty('allow_promotion_codes')
    expect(options).toMatchObject({ idempotencyKey: 'flowchart-checkout-member-same-nonce' })
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0])
    create.mockResolvedValue({ id: 'cs_test_a', url: 'https://evil.example/phish', livemode: false } as Stripe.Checkout.Session)
    await expect(provider.createCheckout('cus_member', 'member', 'other')).rejects.toMatchObject({ code: 'billing_provider' })
  })
  it('uses positive paid invoices and the matching subscription item period with the current Stripe API', async () => {
    const provider = new StripeBillingProvider(billingConfigFromEnv(env)!)
    vi.spyOn(provider.stripe.subscriptions, 'retrieve').mockResolvedValue({ id: 'sub_member', customer: 'cus_member', status: 'active', livemode: false, cancel_at_period_end: true, items: { data: [{ price: { id: 'price_premium' }, current_period_end: NOW / 1000 + 1000 }] }, latest_invoice: { id: 'in_paid', status: 'paid', amount_paid: 1200 } } as unknown as Stripe.Subscription)
    const payments = vi.spyOn(provider.stripe.invoicePayments, 'list').mockResolvedValue({ data: [{ amount_paid: 1200, payment: { type: 'payment_intent', payment_intent: { status: 'succeeded', amount_received: 1200, latest_charge: { paid: true, status: 'succeeded', disputed: false, refunded: false, amount_refunded: 0 } } } }], has_more: false } as unknown as Stripe.ApiList<Stripe.InvoicePayment>)
    expect(await provider.getSubscription('sub_member')).toMatchObject({ paid: true, paidUntil: NOW + 1000000, cancelAtPeriodEnd: true })
    payments.mockResolvedValue({ data: [{ amount_paid: 1200, payment: { type: 'charge', charge: { paid: true, status: 'succeeded', disputed: false, refunded: true, amount_refunded: 1200 } } }], has_more: false } as unknown as Stripe.ApiList<Stripe.InvoicePayment>)
    expect(await provider.getSubscription('sub_member')).toMatchObject({ paid: false, paidUntil: 0 })
  })
  it('recognizes flexible Portal cancel_at scheduling and limits access to the earlier cancellation date', async () => {
    const provider = new StripeBillingProvider(billingConfigFromEnv(env)!)
    const subscription = { id: 'sub_member', customer: 'cus_member', status: 'active', livemode: false, cancel_at_period_end: false, cancel_at: NOW / 1000 + 500, items: { data: [{ price: { id: 'price_premium' }, current_period_end: NOW / 1000 + 1000 }] }, latest_invoice: { id: 'in_paid', status: 'paid', amount_paid: 1200 } }
    vi.spyOn(provider.stripe.subscriptions, 'retrieve').mockResolvedValue(subscription as unknown as Stripe.Subscription)
    vi.spyOn(provider.stripe.invoicePayments, 'list').mockResolvedValue({ data: [{ amount_paid: 1200, payment: { type: 'charge', charge: { paid: true, status: 'succeeded', disputed: false, refunded: false, amount_refunded: 0 } } }], has_more: false } as unknown as Stripe.ApiList<Stripe.InvoicePayment>)
    expect(await provider.getSubscription('sub_member')).toMatchObject({ paid: true, paidUntil: NOW + 500000, cancelAtPeriodEnd: true })
    subscription.cancel_at = NOW / 1000 + 2000
    expect(await provider.getSubscription('sub_member')).toMatchObject({ paid: true, paidUntil: NOW + 1000000, cancelAtPeriodEnd: true })
  })
  it('keeps OpenAI credentials server-side and validates generated image data without reflecting upstream secrets', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), { status: 200 }))
    const provider = new OpenAIImageProvider('private-provider-key', 'gpt-image-2.5-flare', fetcher)
    expect(await provider.generate(request)).toBe(image)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
    const options = fetcher.mock.calls[0][1] as RequestInit
    expect(options.headers).toMatchObject({ Authorization: 'Bearer private-provider-key' })
    expect(JSON.parse(String(options.body))).toMatchObject({ n: 1, model: 'gpt-image-2.5-flare', moderation: 'auto', size: '1024x1024', quality: 'medium' })
    fetcher.mockImplementation(async () => new Response('private-provider-key account diagnostics', { status: 500 }))
    await expect(provider.generate(request)).rejects.toThrow('The image provider is unavailable')
  })
  it('marks a real provider deadline uncertain and directs support before another request without automatic retries', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
      const provider = new OpenAIImageProvider('private', undefined, fetcher)
      const outcome = provider.generate(request).then(() => null, error => error)
      await vi.advanceTimersByTimeAsync(110000)
      expect(await outcome).toMatchObject({ code: 'image_timeout', status: 504, message: expect.stringContaining('Contact support before creating another request') })
      expect((await outcome).message).toContain('allowance remains reserved')
      expect((await outcome).message).not.toContain('new request later')
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
  it('resolves refund ownership through paginated invoice payments and invoice parents, without metadata', async () => {
    const provider = new StripeBillingProvider(billingConfigFromEnv(env)!)
    const payments = vi.spyOn(provider.stripe.invoicePayments, 'list')
      .mockResolvedValueOnce({ data: [{ id: 'ip_one', invoice: 'in_one' }], has_more: true } as Stripe.ApiList<Stripe.InvoicePayment>)
      .mockResolvedValueOnce({ data: [{ id: 'ip_two', invoice: 'in_two' }], has_more: false } as Stripe.ApiList<Stripe.InvoicePayment>)
    vi.spyOn(provider.stripe.invoices, 'retrieve')
      .mockResolvedValueOnce({ id: 'in_one', customer: 'cus_one', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_one' } } } as Stripe.Invoice)
      .mockResolvedValueOnce({ id: 'in_two', customer: 'cus_two', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_two' } } } as Stripe.Invoice)
    const risk = event('charge.refunded')
    risk.object = { id: 'ch_one', payment_intent: 'pi_one', metadata: { accountId: 'forged-owner' } }
    expect(await provider.resolveRisk(risk)).toEqual([{ customerId: 'cus_one', subscriptionId: 'sub_one' }, { customerId: 'cus_two', subscriptionId: 'sub_two' }])
    expect(payments.mock.calls[1][0]).toMatchObject({ starting_after: 'ip_one', payment: { type: 'payment_intent', payment_intent: 'pi_one' } })
  })
  it('resolves early risk to the PaymentIntent Customer before the invoice link is available', async () => {
    const provider = new StripeBillingProvider(billingConfigFromEnv(env)!)
    vi.spyOn(provider.stripe.invoicePayments, 'list').mockResolvedValue({ data: [], has_more: false } as Stripe.ApiList<Stripe.InvoicePayment>)
    vi.spyOn(provider.stripe.paymentIntents, 'retrieve').mockResolvedValue({ id: 'pi_one', customer: 'cus_one' } as Stripe.PaymentIntent)
    const risk = event('radar.early_fraud_warning.created')
    risk.object = { id: 'issfr_one', payment_intent: 'pi_one' }
    expect(await provider.resolveRisk(risk)).toEqual([{ customerId: 'cus_one', subscriptionId: '' }])
  })
  it('rejects malformed or non-image provider output', async () => {
    const provider = new OpenAIImageProvider('key', undefined, async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('<svg onload=alert(1)>').toString('base64') }] })))
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'image_response' })
  })
  it('rejects truncated WebP containers that contain only valid format magic or claim missing image bytes', async () => {
    const cases = [Buffer.from('RIFF0000WEBPimage'), Buffer.from(imageBase64, 'base64').subarray(0, 24)]
    for (const bytes of cases) {
      const provider = new OpenAIImageProvider('private', undefined, async () => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] })))
      await expect(provider.generate(request)).rejects.toMatchObject({ code: 'image_response' })
    }
  })
  it('accepts an actual lossless WebP image as well as the lossy fixture', async () => {
    const lossless = 'UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQ1Mr1v/+BiOh/AAA='
    const provider = new OpenAIImageProvider('private', undefined, async () => new Response(JSON.stringify({ data: [{ b64_json: lossless }] })))
    expect(await provider.generate(request)).toBe(`data:image/webp;base64,${lossless}`)
  })
  it('bounds streamed image responses without Content-Length and stops reading on overflow', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2_000_000)); controller.enqueue(new Uint8Array(2_000_000)) },
      cancel,
    })
    const provider = new OpenAIImageProvider('key', undefined, async () => new Response(stream))
    await expect(provider.generate(request)).rejects.toMatchObject({ status: 502, code: 'image_response' })
    expect(cancel).toHaveBeenCalledTimes(1)
    const invalid = new OpenAIImageProvider('key', undefined, async () => new Response('{provider secret diagnostics'))
    await expect(invalid.generate(request)).rejects.toMatchObject({ status: 502, code: 'image_response', message: expect.not.stringContaining('secret') })
  })
  it('requires explicit live-mode configuration and a fixed secure origin', () => {
    expect(billingConfigFromEnv({ ...env, STRIPE_RESTRICTED_KEY: 'rk_live_fixture' })).toBeNull()
    expect(billingConfigFromEnv({ ...env, PUBLIC_BASE_URL: 'http://example.com' })).toBeNull()
    expect(billingConfigFromEnv({ ...env, BILLING_SESSION_SECRET: 'short' })).toBeNull()
    expect(billingConfigFromEnv({ ...env, PUBLIC_BASE_URL: 'https://flowchart.example', STRIPE_RESTRICTED_KEY: 'rk_live_fixture', BILLING_MODE: 'live' })?.testMode).toBe(false)
    expect(billingConfigFromEnv({ ...env, STRIPE_RESTRICTED_KEY: 'rkcs_test_fixture' })?.testMode).toBe(true)
  })
})

describe('Premium HTTP path and raw Stripe signature verification', () => {
  let server: Server
  let base: string
  let ctx: BillingContext
  let provider: Provider
  let generation: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    provider = new Provider()
    generation = vi.fn(async () => image)
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const assetId = url.pathname.match(/^\/api\/images\/([^/]+)$/)?.[1]
      const routes: Record<string, typeof handleBillingSession> = {
        '/api/billing/session': handleBillingSession, '/api/billing/checkout': handleBillingCheckout,
        '/api/billing/portal': handleBillingPortal, '/api/billing/webhook': handleBillingWebhook,
        '/api/billing/recovery': handleBillingRecovery, '/api/billing/restore': handleBillingRestore, '/api/images': handleImages,
      }
      // Webhook exercises Vercel's unparsed stream path, with exact raw bytes.
      if (url.pathname !== '/api/billing/webhook') await prepareVercelStyleRequest(req, assetId ? { id: assetId } : {})
      await (assetId ? handleImageAsset : routes[url.pathname])(req, res, ctx)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    ctx = createBillingContext({ ...env, PUBLIC_BASE_URL: base }, { store: new MemoryBillingStore(() => NOW), provider, imageProvider: { generate: generation }, now: () => NOW })
  })
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })
  async function session() {
    const response = await fetch(`${base}/api/billing/session`)
    return { response, cookie: response.headers.get('set-cookie')!.split(';')[0], data: await response.json() as { csrfToken: string; premium: boolean; accountBinding: string } }
  }
  async function post(path: string, cookie: string, csrf: string, payload: unknown = {}, extra: Record<string, string> = {}) {
    if (path === '/api/images' && payload && typeof payload === 'object' && !('accountBinding' in payload)) {
      const account = await ctx.billing?.authenticate(cookie.split('=')[1])
      if (account) payload = { ...payload, accountBinding: ctx.billing!.accountBinding(account) }
    }
    return fetch(`${base}${path}`, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(payload) })
  }
  it('exposes honest unavailability without issuing a fake Premium capability', async () => {
    ctx = createBillingContext({})
    const response = await fetch(`${base}/api/billing/session`)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toMatchObject({ available: false, premium: false, images: { available: false } })
  })
  it('allows local test browsers while keeping the production account-creation cap strict and existing sessions usable', async () => {
    for (let i = 0; i < 100; i++) expect((await fetch(`${base}/api/billing/session`)).status).toBe(200)
    expect((await fetch(`${base}/api/billing/session`)).status).toBe(429)
    ctx = createBillingContext({ ...env, PUBLIC_BASE_URL: base, NODE_ENV: 'production' }, { store: new MemoryBillingStore(() => NOW), provider, imageProvider: { generate: generation }, now: () => NOW })
    const member = await session()
    for (let i = 1; i < 10; i++) expect((await fetch(`${base}/api/billing/session`)).status).toBe(200)
    expect((await fetch(`${base}/api/billing/session`)).status).toBe(429)
    expect((await fetch(`${base}/api/billing/session`, { headers: { Cookie: member.cookie } })).status).toBe(200)
  })
  it('runs session → hosted checkout → signed paid webhook → entitled images → portal and cancellation', async () => {
    const member = await session()
    expect(member.response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax')
    expect(member.response.headers.get('cache-control')).toContain('no-store')
    const before = await post('/api/images', member.cookie, member.data.csrfToken, request)
    expect(before.status).toBe(402)
    expect(generation).not.toHaveBeenCalled()
    const checkout = await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    expect(await checkout.json()).toEqual({ url: provider.checkout.url })
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    const paidEvent = event('checkout.session.completed', 'evt_http_paid')
    const raw = JSON.stringify({ id: paidEvent.id, object: 'event', type: paidEvent.type, created: paidEvent.created, livemode: false, data: { object: paidEvent.object } }, null, 2)
    const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: env.STRIPE_WEBHOOK_SECRET })
    const webhook = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' }, body: raw })
    expect(webhook.status).toBe(200)
    const refreshed = await fetch(`${base}/api/billing/session`, { headers: { Cookie: member.cookie } })
    expect(await refreshed.json()).toMatchObject({ premium: true, hasSubscription: true, canManageBilling: true, price: { amount: 1200 }, images: { remaining: 3 } })
    const generated = await post('/api/images', member.cookie, member.data.csrfToken, request)
    expect(generated.status).toBe(200)
    const generatedResult = await generated.json() as { image: { id: string; url: string } }
    expect(generatedResult).toMatchObject({ image: { url: expect.stringMatching(/^\/api\/images\//) }, usage: { used: 1, remaining: 2 } })
    expect(isAllowedImageUrl(generatedResult.image.url)).toBe(true)
    expect(generatedResult.image.url.length).toBeLessThan(300)
    const asset = await fetch(new URL(generatedResult.image.url, base))
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toBe('image/webp')
    expect(asset.headers.get('access-control-allow-origin')).toBe('*')
    expect(Buffer.from(await asset.arrayBuffer())).toEqual(Buffer.from(imageBase64, 'base64'))
    expect((await fetch(`${base}/api/images/${generatedResult.image.id}?key=wrong`)).status).toBe(404)
    expect(generation).toHaveBeenCalledTimes(1)
    expect(await (await post('/api/billing/portal', member.cookie, member.data.csrfToken)).json()).toEqual({ url: 'https://billing.stripe.com/p/test' })
    provider.subscription.status = 'canceled'
    const denied = await post('/api/images', member.cookie, member.data.csrfToken, { ...request, requestId: 'fb6899e4-c083-45f7-97a1-56fa1cfde602' })
    expect(denied.status).toBe(402)
    expect(generation).toHaveBeenCalledTimes(1)
  })
  it('rejects tampered, stale and unsigned webhook bodies before fulfillment', async () => {
    const member = await session()
    await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    const raw = JSON.stringify({ id: 'evt_tampered', type: 'checkout.session.completed', created: NOW / 1000, livemode: false, data: { object: { id: 'cs_test_checkout', customer: 'cus_member' } } })
    const valid = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: env.STRIPE_WEBHOOK_SECRET })
    for (const [signature, value] of [[valid, `${raw} `], ['t=1,v1=bad', raw], ['', raw]]) {
      const response = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'stripe-signature': signature, 'Content-Type': 'application/json' }, body: value })
      expect(response.status).toBe(400)
    }
    expect(provider.getSubscription).not.toHaveBeenCalled()
  })
  it('persists an authorized image when the browser disconnects and recovers it without sending the provider request twice', async () => {
    const member = await session()
    await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    await ctx.billing!.webhook(event('checkout.session.completed', 'evt_disconnect_paid'))
    let finish!: (value: string) => void
    generation.mockImplementation(() => new Promise<string>(resolve => { finish = resolve }))
    const controller = new AbortController()
    const disconnected = fetch(`${base}/api/images`, { method: 'POST', signal: controller.signal, headers: { Origin: base, Cookie: member.cookie, 'X-CSRF-Token': member.data.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, accountBinding: member.data.accountBinding }) }).catch(error => error)
    await vi.waitFor(() => expect(generation).toHaveBeenCalledTimes(1))
    controller.abort()
    expect(await disconnected).toMatchObject({ name: 'AbortError' })
    finish(image)
    const accountId = member.cookie.split('=')[1].split('.')[0]
    await vi.waitFor(async () => expect(await ctx.billing!.store.read(`image:${accountId}:${request.requestId}`)).toMatchObject({ state: 'complete' }))
    const recovered = await post('/api/images', member.cookie, member.data.csrfToken, request)
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toMatchObject({ image: { id: expect.any(String) }, usage: { used: 1 } })
    expect(generation).toHaveBeenCalledTimes(1)
  })
  it('rejects forged cookies, cross-origin requests, missing CSRF and client Premium flags', async () => {
    const member = await session()
    expect((await post('/api/billing/checkout', member.cookie, '')).status).toBe(403)
    expect((await post('/api/billing/checkout', member.cookie, member.data.csrfToken, {}, { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await post('/api/billing/checkout', member.cookie.replace(/.$/, 'a'), member.data.csrfToken)).status).toBe(401)
    const fakePremium = await post('/api/images', member.cookie, member.data.csrfToken, { ...request, premium: true })
    expect(fakePremium.status).toBe(400)
    expect(generation).not.toHaveBeenCalled()
  })
  it('creates and consumes recovery codes through authenticated same-origin HTTP actions', async () => {
    const member = await session()
    const code = await (await post('/api/billing/recovery', member.cookie, member.data.csrfToken)).json() as { recoveryCode: string }
    const restored = await post('/api/billing/restore', member.cookie, member.data.csrfToken, code)
    expect(restored.status).toBe(200)
    expect(restored.headers.get('set-cookie')).not.toContain(member.cookie)
    expect((await post('/api/billing/checkout', member.cookie, member.data.csrfToken)).status).toBe(401)
  })
  it('keeps a non-auth account binding across recovery rotation and rejects an old account image request before spend', async () => {
    const original = await session()
    expect(original.data.accountBinding).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(original.data.accountBinding).not.toContain(original.cookie.split('=')[1].split('.')[0])
    expect(await ctx.billing!.authenticate(`${original.cookie.split('=')[1].split('.')[0]}.${original.data.accountBinding}`)).toBeNull()
    const code = await (await post('/api/billing/recovery', original.cookie, original.data.csrfToken)).json()
    const restored = await post('/api/billing/restore', original.cookie, original.data.csrfToken, code)
    const rotatedCookie = restored.headers.get('set-cookie')!.split(';')[0]
    const current = await (await fetch(`${base}/api/billing/session`, { headers: { Cookie: rotatedCookie } })).json()
    expect(current.accountBinding).toBe(original.data.accountBinding)
    expect(current.csrfToken).not.toBe(original.data.csrfToken)
    const other = await session()
    expect(other.data.accountBinding).not.toBe(original.data.accountBinding)
    const crossed = await post('/api/images', other.cookie, other.data.csrfToken, { ...request, accountBinding: original.data.accountBinding })
    expect(crossed.status).toBe(409)
    expect(await crossed.json()).toMatchObject({ code: 'image_account_changed' })
    expect(generation).not.toHaveBeenCalled()
    expect(await ctx.billing!.store.read(`image-claim:${other.cookie.split('=')[1].split('.')[0]}:${request.requestId}`)).toBeNull()
    const missingBinding = await post('/api/images', other.cookie, other.data.csrfToken, { ...request, accountBinding: undefined })
    expect(missingBinding.status).toBe(409)
  })
  it('checks a saved request without spending when it never reached the server, then recovers a real saved result with no quota/provider/subscription gate', async () => {
    const member = await session()
    const absent = await post('/api/images', member.cookie, member.data.csrfToken, { ...request, recoverOnly: true })
    expect(absent.status).toBe(404)
    expect(await absent.json()).toMatchObject({ code: 'image_request_missing' })
    const accountId = member.cookie.split('=')[1].split('.')[0]
    expect(await ctx.billing!.store.read(`image-claim:${accountId}:${request.requestId}`)).toBeNull()
    expect(generation).not.toHaveBeenCalled()
    await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    await ctx.billing!.webhook(event('checkout.session.completed', 'evt_saved_recovery_paid'))
    const image = await (await post('/api/images', member.cookie, member.data.csrfToken, request)).json()
    await ctx.billing!.updateAccount(accountId, account => ({ ...account, status: 'canceled', paidUntil: 0, imageMonth: '2026-10', imageUsed: 3 }))
    ctx.images = new ImageService(ctx.billing!, null)
    const recovered = await post('/api/images', member.cookie, member.data.csrfToken, { ...request, recoverOnly: true })
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toMatchObject({ image: image.image, usage: { remaining: 0 } })
    expect(generation).toHaveBeenCalledTimes(1)
  })
  it('exposes billing management for an unpaid subscription without granting Premium', async () => {
    const member = await session()
    expect(await (await fetch(`${base}/api/billing/session`, { headers: { Cookie: member.cookie } })).json()).toMatchObject({ premium: false, hasSubscription: false, canManageBilling: false })
    await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    provider.subscription.status = 'incomplete'; provider.subscription.paid = false
    await ctx.billing!.webhook(event('customer.subscription.created', 'evt_http_incomplete'))
    const current = await (await fetch(`${base}/api/billing/session`, { headers: { Cookie: member.cookie } })).json()
    expect(current).toMatchObject({ premium: false, status: 'incomplete', hasSubscription: true, canManageBilling: true })
  })
  it('does not sell live Premium when the image provider is missing, while permitting sandbox payment validation', async () => {
    ctx = createBillingContext({ ...env, PUBLIC_BASE_URL: base, STRIPE_RESTRICTED_KEY: 'rk_live_fixture', BILLING_MODE: 'live' }, { store: new MemoryBillingStore(), provider, imageProvider: null })
    const member = await session()
    const response = await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'images_unavailable' })
    expect(provider.createCheckout).not.toHaveBeenCalled()
  })
  it('preserves paid access and billing management when the configured Price is retired', async () => {
    const member = await session()
    await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    await ctx.billing!.webhook(event('checkout.session.completed', 'evt_retired_price_paid'))
    provider.getPrice.mockRejectedValue(new PremiumError(503, 'billing_unavailable', 'Price is inactive'))
    const current = await fetch(`${base}/api/billing/session`, { headers: { Cookie: member.cookie } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ premium: true, canManageBilling: true, checkoutAvailable: false })
    expect((await post('/api/billing/portal', member.cookie, member.data.csrfToken)).status).toBe(200)
  })
  it('persists small shareable image URLs, keeps secrets out of chart-sized results, and owner deletion cannot resurrect them', async () => {
    const member = await session()
    await post('/api/billing/checkout', member.cookie, member.data.csrfToken)
    provider.checkout = { ...provider.checkout, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_member' }
    await ctx.billing!.webhook(event('checkout.session.completed', 'evt_asset_paid'))
    const generated = await (await post('/api/images', member.cookie, member.data.csrfToken, request)).json() as { image: { id: string; url: string } }
    expect(JSON.stringify(generated)).not.toContain('data:image')
    const stored = await ctx.billing!.store.read<Record<string, unknown>>(`image-asset:${generated.image.id}`)
    expect(stored).toMatchObject({ dataUrl: image })
    const assetUrl = new URL(generated.image.url, base)
    expect(JSON.stringify(stored)).not.toContain(assetUrl.searchParams.get('key'))
    const checked = await fetch(assetUrl, { method: 'HEAD', cache: 'no-store', credentials: 'omit' })
    expect(checked.status).toBe(200)
    expect(checked.headers.get('content-type')).toBe('image/webp')
    expect(checked.headers.get('cache-control')).toBe('private, no-store')
    expect(Number(checked.headers.get('content-length'))).toBe(Buffer.from(imageBase64, 'base64').byteLength)
    expect((await checked.arrayBuffer()).byteLength).toBe(0)
    const unauth = await fetch(assetUrl, { method: 'DELETE', headers: { Origin: base } })
    expect(unauth.status).toBe(401)
    const outsider = await session()
    const forbidden = await fetch(assetUrl, { method: 'DELETE', headers: { Origin: base, Cookie: outsider.cookie, 'X-CSRF-Token': outsider.data.csrfToken } })
    expect(forbidden.status).toBe(403)
    expect((await fetch(assetUrl)).status).toBe(200)
    const deleted = await fetch(assetUrl, { method: 'DELETE', headers: { Origin: base, Cookie: member.cookie, 'X-CSRF-Token': member.data.csrfToken } })
    expect(deleted.status).toBe(200)
    expect((await fetch(assetUrl)).status).toBe(404)
    const deletedCheck = await fetch(assetUrl, { method: 'HEAD', cache: 'no-store', credentials: 'omit' })
    expect(deletedCheck.status).toBe(404)
    expect(deletedCheck.headers.get('cache-control')).toContain('no-store')
    expect((await deletedCheck.arrayBuffer()).byteLength).toBe(0)
    const replay = await post('/api/images', member.cookie, member.data.csrfToken, request)
    expect(replay.status).toBe(410)
    expect(await replay.json()).toMatchObject({ code: 'image_deleted' })
    expect(generation).toHaveBeenCalledTimes(1)
    expect((await fetch(assetUrl)).status).toBe(404)
  })
})

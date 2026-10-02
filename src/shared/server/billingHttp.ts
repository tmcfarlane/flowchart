import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { BillingService, type PremiumAccount } from './billingService.js'
import { billingConfigFromEnv, PremiumError, StripeBillingProvider, type BillingConfig, type BillingProvider } from './billingProvider.js'
import { billingStoreFromEnv, billingUpdate, type BillingStore } from './billingStore.js'
import { ImageRequestSchema, ImageService, imageProviderFromEnv, type ImageProvider, type ImageAsset } from './imageService.js'
import { BODY_TOO_LARGE_FLAG, clientIp } from './http.js'
import { verifyToken } from './tokens.js'
import { isProductionEnv } from './store.js'

type Env = Record<string, string | undefined>
export interface BillingRequest extends IncomingMessage { body?: unknown; rawBody?: Buffer; query?: Record<string, string | string[] | undefined> }
export interface BillingContext { env: Env; config: BillingConfig | null; billing: BillingService | null; images: ImageService | null }
export function createBillingContext(env: Env = process.env, overrides: { store?: BillingStore; provider?: BillingProvider; imageProvider?: ImageProvider | null; now?: () => number } = {}): BillingContext {
  const config = billingConfigFromEnv(env)
  if (!config) return { env, config: null, billing: null, images: null }
  const billing = new BillingService(overrides.store ?? billingStoreFromEnv(env), overrides.provider ?? new StripeBillingProvider(config), config, overrides.now)
  return { env, config, billing, images: new ImageService(billing, overrides.imageProvider === undefined ? imageProviderFromEnv(env) : overrides.imageProvider) }
}
let defaultContext: BillingContext | undefined
function context() { return (defaultContext ??= createBillingContext(process.env)) }
function json(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Vary', 'Origin, Cookie')
  res.end(JSON.stringify(data))
}
function fail(res: ServerResponse, error: unknown) {
  if (error instanceof PremiumError) return json(res, error.status, { error: error.message, code: error.code })
  // Provider exceptions and environment values are deliberately never logged or
  // reflected. The request can include secrets in a recovery code or cookie.
  return json(res, 503, { error: 'Premium services are unavailable. Please try again later.', code: 'premium_unavailable' })
}
function sameOrigin(req: BillingRequest, ctx: BillingContext, mutation: boolean) {
  const origin = req.headers.origin
  if (Array.isArray(origin) || (origin && origin !== ctx.config?.origin)) throw new PremiumError(403, 'origin_rejected', 'Open Premium from this website to continue.')
  const site = req.headers['sec-fetch-site']
  if (site && !['same-origin', 'none'].includes(String(site))) throw new PremiumError(403, 'origin_rejected', 'Open Premium from this website to continue.')
  if (mutation && origin !== ctx.config?.origin) throw new PremiumError(403, 'origin_rejected', 'This request must come from the Flowchart website.')
}
function body(req: BillingRequest): Record<string, unknown> {
  if ((req as unknown as Record<string, unknown>)[BODY_TOO_LARGE_FLAG]) throw new PremiumError(413, 'body_too_large', 'The request is too large.')
  let value: unknown
  try { value = req.body } catch { throw new PremiumError(400, 'invalid_json', 'The request must contain valid JSON.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PremiumError(400, 'invalid_json', 'The request must contain a JSON object.')
  if (Buffer.byteLength(JSON.stringify(value)) > 8192) throw new PremiumError(413, 'body_too_large', 'The request is too large.')
  return value as Record<string, unknown>
}
async function rateLimit(req: BillingRequest, ctx: BillingContext, bucket: string, limit: number, seconds: number) {
  if (!ctx.billing) return
  const window = Math.floor(ctx.billing.now() / (seconds * 1000))
  const ip = createHash('sha256').update(clientIp(req, ctx.env)).digest('hex').slice(0, 24)
  await billingUpdate<{ count: number }, boolean>(ctx.billing.store, `http:${bucket}:${ip}:${window}`, previous => {
    if ((previous?.count ?? 0) >= limit) throw new PremiumError(429, 'rate_limited', 'Too many Premium requests. Please try again shortly.')
    return { next: { count: (previous?.count ?? 0) + 1 }, result: true }
  }, seconds * 2)
}
async function member(req: BillingRequest, ctx: BillingContext): Promise<PremiumAccount> {
  if (!ctx.billing) throw new PremiumError(503, 'billing_unavailable', 'Premium billing is not configured on this website yet.')
  const capability = ctx.billing.capabilityFromCookies(req.headers.cookie)
  const account = await ctx.billing.authenticate(capability)
  if (!account || !capability) throw new PremiumError(401, 'session_required', 'Refresh Premium status to start a secure session, or restore your recovery code.')
  if (!ctx.billing.checkCsrf(capability, req.headers['x-csrf-token'])) throw new PremiumError(403, 'csrf_rejected', 'Your secure session changed. Refresh Premium status and try again.')
  return account
}

export async function handleBillingSession(req: BillingRequest, res: ServerResponse, supplied?: BillingContext) {
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Method not allowed' }) }
    const ctx = supplied ?? context()
    if (!ctx.billing || !ctx.config) return json(res, 200, { available: false, premium: false, status: 'unavailable', images: { available: false }, recovery: { browserBound: true, available: false } })
    sameOrigin(req, ctx, false)
    await rateLimit(req, ctx, 'session', 120, 60)
    let capability = ctx.billing.capabilityFromCookies(req.headers.cookie)
    let account = await ctx.billing.authenticate(capability)
    if (!account || !capability) {
      await rateLimit(req, ctx, 'new-account', isProductionEnv(ctx.env) ? 10 : 100, 3600)
      const created = await ctx.billing.createAccount()
      account = created.account; capability = created.capability
      res.setHeader('Set-Cookie', ctx.billing.cookie(capability))
    }
    account = await ctx.billing.getSession(account)
    let price
    try { price = await ctx.billing.provider.getPrice() } catch { /* Retired/unavailable prices must not lock existing users out of billing management. */ }
    return json(res, 200, {
      available: true, testMode: ctx.config.testMode, premium: ctx.billing.isPremium(account), status: account.riskBlocked ? 'payment_review' : account.status,
      hasSubscription: !!account.subscriptionId, canManageBilling: !!account.customerId,
      checkoutAvailable: !!price && (ctx.config.testMode || !!ctx.images?.provider),
      billingNotice: price ? undefined : 'New upgrades are temporarily unavailable. Existing subscriptions can still be managed through Stripe.',
      cancelAtPeriodEnd: account.cancelAtPeriodEnd, currentPeriodEnd: account.paidUntil || null,
      images: { available: !!ctx.images?.provider, ...ctx.billing.imageUsage(account) },
      recovery: { browserBound: true, available: true, saved: !!account.recoveryHash },
      accountBinding: ctx.billing.accountBinding(account),
      price, csrfToken: ctx.billing.csrf(capability),
    })
  } catch (error) { fail(res, error) }
}

type Action = 'checkout' | 'portal' | 'images' | 'recovery' | 'restore'
async function mutation(action: Action, req: BillingRequest, res: ServerResponse, supplied?: BillingContext) {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed' }) }
    const ctx = supplied ?? context()
    if (!ctx.billing || !ctx.config) throw new PremiumError(503, 'billing_unavailable', 'Premium billing is not configured on this website yet.')
    sameOrigin(req, ctx, true)
    const payload = body(req)
    const account = await member(req, ctx)
    await rateLimit(req, ctx, action, action === 'restore' ? 10 : 30, 3600)
    if (action === 'checkout') {
      if (!ctx.config.testMode && !ctx.images?.provider) throw new PremiumError(503, 'images_unavailable', 'Premium image generation is not available yet, so upgrades are temporarily disabled.')
      return json(res, 200, { url: await ctx.billing.checkout(account) })
    }
    if (action === 'portal') return json(res, 200, { url: await ctx.billing.portal(account) })
    if (action === 'recovery') return json(res, 200, { recoveryCode: await ctx.billing.recoveryCode(account), oneTime: true })
    if (action === 'restore') {
      if (typeof payload.recoveryCode !== 'string' || payload.recoveryCode.length > 100) throw new PremiumError(400, 'invalid_recovery', 'Enter your saved recovery code.')
      const restored = await ctx.billing.restore(payload.recoveryCode)
      res.setHeader('Set-Cookie', ctx.billing.cookie(restored.capability))
      return json(res, 200, { restored: true, csrfToken: ctx.billing.csrf(restored.capability) })
    }
    const parsed = ImageRequestSchema.safeParse(payload)
    if (!parsed.success) throw new PremiumError(400, 'invalid_image_request', 'Provide a description (3–2000 characters), supported style and size, and a new request ID.')
    if (parsed.data.accountBinding !== ctx.billing.accountBinding(account)) throw new PremiumError(409, 'image_account_changed', 'This image request belongs to a different Premium account. Restore the original account to recover it, or deliberately start a new request for this account.')
    if (!ctx.images) throw new PremiumError(503, 'images_unavailable', 'Image generation is not configured on this website yet.')
    return json(res, 200, await ctx.images.generate(account, parsed.data))
  } catch (error) { fail(res, error) }
}
export function handleBillingCheckout(req: BillingRequest, res: ServerResponse, ctx?: BillingContext) { return mutation('checkout', req, res, ctx) }
export function handleBillingPortal(req: BillingRequest, res: ServerResponse, ctx?: BillingContext) { return mutation('portal', req, res, ctx) }
export function handleBillingRecovery(req: BillingRequest, res: ServerResponse, ctx?: BillingContext) { return mutation('recovery', req, res, ctx) }
export function handleBillingRestore(req: BillingRequest, res: ServerResponse, ctx?: BillingContext) { return mutation('restore', req, res, ctx) }
export function handleImages(req: BillingRequest, res: ServerResponse, ctx?: BillingContext) { return mutation('images', req, res, ctx) }

export async function handleImageAsset(req: BillingRequest, res: ServerResponse, supplied?: BillingContext) {
  try {
    if (!['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(req.method ?? '')) { res.setHeader('Allow', 'GET, HEAD, DELETE, OPTIONS'); return json(res, 405, { error: 'Method not allowed' }) }
    // The asset URL is a read capability, so cross-origin read/export is allowed.
    // DELETE has cookie + CSRF + same-origin checks and no cross-origin grant.
    if (req.method !== 'DELETE') {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
    const ctx = supplied ?? context()
    if (!ctx.billing) throw new PremiumError(503, 'images_unavailable', 'Image storage is unavailable.')
    const assetId = req.query?.id
    if (typeof assetId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(assetId)) throw new PremiumError(404, 'image_not_found', 'Image not found.')
    const asset = await ctx.billing.store.read<ImageAsset>(`image-asset:${assetId}`)
    if (!asset || asset.deleted) throw new PremiumError(404, 'image_not_found', 'Image not found.')
    if (req.method === 'DELETE') {
      sameOrigin(req, ctx, true)
      const account = await member(req, ctx)
      if (asset.accountId !== account.id) throw new PremiumError(403, 'image_owner', 'Only the image’s owner can delete it.')
      // Tombstone instead of deleting a key: CAS prevents a simultaneous reader
      // or retry from accidentally recreating the image after deletion.
      const removed = { ...asset, deleted: true, dataUrl: '', tokenHash: '' }
      if (!await ctx.billing.store.compareAndSet(`image-asset:${assetId}`, asset, removed)) throw new PremiumError(409, 'image_changed', 'The image changed. Refresh and try again.')
      return json(res, 200, { deleted: true })
    }
    const key = req.query?.key
    if (typeof key !== 'string' || !verifyToken(key, asset.tokenHash)) throw new PremiumError(404, 'image_not_found', 'Image not found.')
    const encoded = asset.dataUrl.match(/^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/)?.[1]
    if (!encoded) throw new PremiumError(503, 'image_storage', 'The stored image is unavailable.')
    const buffer = Buffer.from(encoded, 'base64')
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Content-Length', buffer.byteLength)
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Disposition', `inline; filename="flowchart-${assetId}.webp"`)
    return res.end(req.method === 'HEAD' ? undefined : buffer)
  } catch (error) { fail(res, error) }
}

export async function handleBillingWebhook(req: BillingRequest, res: ServerResponse, supplied?: BillingContext) {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed' }) }
    const ctx = supplied ?? context()
    if (!ctx.billing) throw new PremiumError(503, 'billing_unavailable', 'Premium billing is unavailable.')
    const signature = req.headers['stripe-signature']
    if (typeof signature !== 'string' || signature.length > 4096) throw new PremiumError(400, 'invalid_signature', 'Invalid webhook signature.')
    if ((req as unknown as Record<string, unknown>)[BODY_TOO_LARGE_FLAG]) throw new PremiumError(413, 'body_too_large', 'Webhook is too large.')
    // Vercel bodyParser is disabled; the Vite adapter may supply the exact bytes.
    // Parsed JSON is never reserialized for signature verification.
    let raw = req.rawBody
    if (!raw) {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        length += buffer.length
        if (length > 512000) throw new PremiumError(413, 'body_too_large', 'Webhook is too large.')
        chunks.push(buffer)
      }
      raw = Buffer.concat(chunks)
    }
    if (raw.length > 512000) throw new PremiumError(413, 'body_too_large', 'Webhook is too large.')
    let event
    try { event = ctx.billing.provider.verifyEvent(raw, signature) } catch { throw new PremiumError(400, 'invalid_signature', 'Invalid webhook signature.') }
    await ctx.billing.webhook(event)
    return json(res, 200, { received: true })
  } catch (error) { fail(res, error) }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { billingUpdate } from './billingStore.js'
import { BillingService, type ImageUsage, type PremiumAccount } from './billingService.js'
import { PremiumError } from './billingProvider.js'
import { hashToken } from './tokens.js'

export const ImageRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  style: z.enum(['surreal', 'editorial', 'blueprint', 'minimal']).default('surreal'),
  size: z.enum(['square', 'landscape', 'portrait']).default('square'),
  requestId: z.string().uuid(),
  accountBinding: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  recoverOnly: z.boolean().optional(),
}).strict()
export type ImageRequest = z.infer<typeof ImageRequestSchema>
export interface GeneratedImage { id: string; url: string; prompt: string; createdAt: number }
export interface ImageResult { image: GeneratedImage; usage: ImageUsage }
export interface ImageAsset { accountId: string; tokenHash: string; dataUrl: string; createdAt: number; deleted?: boolean }
interface ImageJob {
  hash: string; state: 'pending' | 'complete' | 'failed'; createdAt: number
  result?: ImageResult; code?: string; message?: string; status?: number; retryable?: boolean
}
// The account and request UUID are in this record's key. Keep only identity,
// outcome and an asset reference permanently; result/capability data expires.
interface ImageClaim extends Omit<ImageJob, 'result'> { assetId?: string }
const IMAGE_PENDING_HORIZON_MS = 120000
const IMAGE_RESULT_TTL_SECONDS = 86400
export interface ImageProvider { generate(request: ImageRequest): Promise<string> }
const STYLE: Record<ImageRequest['style'], string> = {
  surreal: 'Dreamlike surrealism, luminous materials and impossible spaces; refined and legible as an illustration inside a diagram.',
  editorial: 'Sophisticated editorial illustration, expressive forms, beautiful restrained color and clean composition.',
  blueprint: 'Detailed futuristic blueprint illustration, midnight blue, luminous cyan linework, crisp technical geometry.',
  minimal: 'Minimal dimensional illustration, restrained palette, generous negative space, one clear focal point.',
}
const SIZE: Record<ImageRequest['size'], string> = { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' }
/** Structural validation of a still WebP container, not a bitstream decoder.
 * https://developers.google.com/speed/webp/docs/riff_container */
function isStillWebP(bytes: Buffer): boolean {
  if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return false
  let imageFound = false
  let canvas: [number, number] | undefined
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return false
    const kind = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + length
    if (end + length % 2 > bytes.length || (length % 2 && bytes[end] !== 0)) return false
    let dimensions: [number, number] | undefined
    if (kind === 'VP8X') {
      if (offset !== 12 || length !== 10 || bytes[start] & 2) return false // Generated images are still images.
      canvas = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1]
    } else if (kind === 'VP8 ') {
      if (imageFound || length <= 10 || bytes[start] & 1 || bytes.toString('hex', start + 3, start + 6) !== '9d012a') return false
      dimensions = [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff]
    } else if (kind === 'VP8L') {
      if (imageFound || length <= 5 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0) return false
      const header = bytes.readUInt32LE(start + 1)
      dimensions = [(header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1]
    } else if (kind === 'ANIM' || kind === 'ANMF') return false
    if (dimensions) {
      if (dimensions.some(value => value < 1 || value > 4096) || (canvas && dimensions.some((value, index) => value !== canvas![index]))) return false
      imageFound = true
    }
    offset = end + length % 2
  }
  return imageFound
}
async function imageResponse(response: Response): Promise<{ data?: Array<{ b64_json?: unknown }> }> {
  const tooLarge = () => new PremiumError(502, 'image_response', 'The generated image was too large. Try a simpler description.')
  const limit = 3_500_000
  if (Number(response.headers.get('content-length') ?? 0) > limit) throw tooLarge()
  const reader = response.body?.getReader()
  if (!reader) throw new PremiumError(502, 'image_response', 'The image provider returned an empty image response.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > limit) { await reader.cancel(); throw tooLarge() }
    chunks.push(next.value)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response')
    return value as { data?: Array<{ b64_json?: unknown }> }
  } catch { throw new PremiumError(502, 'image_response', 'The image provider returned an unreadable image response.') }
}
export class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly key: string, readonly model: string = 'gpt-image-2.5-flare', private readonly fetcher: typeof fetch = fetch) {}
  async generate(request: ImageRequest): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 110000)
    try {
      const response = await this.fetcher('https://api.openai.com/v1/images/generations', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: `${STYLE[request.style]}\n\nUser description: ${request.prompt}\nAvoid captions or labels unless explicitly requested.`, n: 1, size: SIZE[request.size], quality: 'medium', output_format: 'webp', output_compression: 80, moderation: 'auto' }),
      })
      if (!response.ok) {
        // Never echo upstream error messages: they may contain keys, request
        // internals or sensitive provider diagnostics.
        if (response.status === 400) throw new PremiumError(422, 'image_rejected', 'The image provider could not use that description. Try a different prompt.')
        if (response.status === 429) throw new PremiumError(503, 'image_busy', 'The image provider is busy. Please try again later.')
        throw new PremiumError(503, 'image_provider', 'The image provider is unavailable. Please try again later.')
      }
      const data = await imageResponse(response)
      if (!Array.isArray(data.data) || data.data.length !== 1) throw new PremiumError(502, 'image_response', 'The image provider returned an invalid image response.')
      const base64 = data.data?.[0]?.b64_json
      if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 3_000_000) throw new PremiumError(502, 'image_response', 'The image provider returned an invalid image.')
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.toString('base64') !== base64 || !isStillWebP(bytes)) throw new PremiumError(502, 'image_response', 'The image provider returned an invalid image format.')
      return `data:image/webp;base64,${base64}`
    } catch (error) {
      if (error instanceof PremiumError) throw error
      if (controller.signal.aborted) throw new PremiumError(504, 'image_timeout', 'Image generation timed out and its outcome is uncertain. Its allowance remains reserved and this request will not be sent again. Contact support before creating another request.')
      throw new PremiumError(503, 'image_provider', 'The image provider is unavailable. Please try again later.')
    } finally { clearTimeout(timeout); controller.abort() }
  }
}

export function imageProviderFromEnv(env: Record<string, string | undefined>): ImageProvider | null {
  const key = env.OPENAI_IMAGE_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()
  if (!key) return null
  const model = env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2.5-flare'
  if (!/^gpt-image-[A-Za-z0-9.-]+$/.test(model)) return null
  return new OpenAIImageProvider(key, model)
}

export class ImageService {
  constructor(readonly billing: BillingService, readonly provider: ImageProvider | null) {}
  private jobKey(account: PremiumAccount, requestId: string) { return `image:${account.id}:${requestId}` }
  private claimKey(account: PremiumAccount, requestId: string) { return `image-claim:${account.id}:${requestId}` }
  private async readClaim(account: PremiumAccount, requestId: string): Promise<ImageClaim | null> {
    const key = this.claimKey(account, requestId)
    const current = await this.billing.store.read<ImageClaim>(key)
    if (current) return current
    // Promote still-cached jobs from the former 24h-only format before a
    // retry can authorize more spend. Already-expired history is unrecoverable.
    const legacy = await this.billing.store.read<ImageJob>(this.jobKey(account, requestId))
    if (!legacy) return null
    const { result, ...metadata } = legacy
    const migrated: ImageClaim = { ...metadata, ...(result ? { assetId: result.image.id } : {}) }
    if (await this.billing.store.compareAndSet(key, null, migrated)) return migrated
    const claimed = await this.billing.store.read<ImageClaim>(key)
    if (!claimed) throw new PremiumError(503, 'image_storage', 'The image request could not be verified. Please try again later.')
    return claimed
  }
  async generate(account: PremiumAccount, request: ImageRequest): Promise<ImageResult> {
    const key = this.claimKey(account, request.requestId)
    const hash = createHash('sha256').update(JSON.stringify({ prompt: request.prompt, style: request.style, size: request.size })).digest('hex')
    const job = await this.readClaim(account, request.requestId)
    if (request.recoverOnly) {
      if (!job) throw new PremiumError(404, 'image_request_missing', 'No saved image request was found yet. The original request may still be verifying payment. You can check this same request again without starting generation or using another credit. Contact support before starting another request if the outcome is uncertain.')
      return this.replay(account, request.requestId, job, hash)
    }
    // An authenticated owner can recover an already-paid result even after
    // cancellation or provider downtime. Only a new spend needs fresh proof.
    if (job && (job.hash !== hash || job.state !== 'failed' || !job.retryable)) return this.replay(account, request.requestId, job, hash)
    if (!this.provider) throw new PremiumError(503, 'images_unavailable', 'Image generation is not configured on this website yet.')
    account = await this.billing.requirePremium(account)
    const pending: ImageClaim = { hash, state: 'pending', createdAt: this.billing.now() }
    if (!await this.billing.store.compareAndSet(key, job, pending)) {
      const existing = await this.billing.store.read<ImageClaim>(key)
      if (existing) return this.replay(account, request.requestId, existing, hash)
      throw new PremiumError(503, 'image_storage', 'The image request could not be saved. Please try again later.')
    }
    let reserved = false
    try {
      account = await this.reserve(account)
      reserved = true
      const dataUrl = await this.provider.generate(request)
      const assetId = randomUUID()
      const capability = randomBytes(32).toString('base64url')
      const createdAt = this.billing.now()
      // Chart JSON stores this small read-only URL rather than megabytes of
      // base64. Asset access intentionally follows chart link-sharing semantics.
      const asset: ImageAsset = { accountId: account.id, tokenHash: hashToken(capability), dataUrl, createdAt }
      if (!await this.billing.store.compareAndSet(`image-asset:${assetId}`, null, asset)) throw new PremiumError(503, 'image_storage', 'The image was generated but could not be saved. Please contact support before sending another request.')
      // Local development uses a same-origin path, accepted by the chart URL
      // validator. HTTPS deployments use an absolute URL for portable exports.
      const assetOrigin = this.billing.config.origin.startsWith('https:') ? this.billing.config.origin : ''
      const result: ImageResult = { image: { id: assetId, url: `${assetOrigin}/api/images/${assetId}?key=${capability}`, prompt: request.prompt, createdAt }, usage: await this.currentUsage(account) }
      await billingUpdate<ImageJob, boolean>(this.billing.store, this.jobKey(account, request.requestId), previous => {
        if (previous && previous.hash !== hash) throw new PremiumError(503, 'image_storage', 'The image result could not be verified. Please contact support before sending another request.')
        return { next: { ...pending, state: 'complete', result }, result: true }
      }, IMAGE_RESULT_TTL_SECONDS)
      if (!await this.billing.store.compareAndSet(key, pending, { ...pending, state: 'complete', assetId })) throw new PremiumError(503, 'image_storage', 'The image was generated but could not be saved. Please contact support before sending another request.')
      return result
    } catch (error) {
      const failure = error instanceof PremiumError ? error : new PremiumError(503, 'image_storage', 'Image generation could not finish. Please try again later.')
      // A provider timeout or a result-storage failure has an uncertain spend;
      // retain that reservation. Definite rejected/failed responses refund the
      // member quota. Global attempts remain counted to bound provider cost.
      if (reserved && ['image_rejected', 'image_busy'].includes(failure.code)) await this.refund(account)
      // Explicit retries may re-run preflight after quota/cooldown/capacity
      // clears. The failed -> pending CAS still grants only one worker. Never
      // re-send a request that reached the provider or had uncertain storage.
      const retryable = !reserved && ['image_quota', 'image_daily_quota', 'image_cooldown', 'image_budget'].includes(failure.code)
      await this.billing.store.compareAndSet(key, pending, { ...pending, state: 'failed', code: failure.code, message: failure.message, status: failure.status, retryable })
      throw failure
    }
  }
  private async replay(account: PremiumAccount, requestId: string, job: ImageClaim, hash: string): Promise<ImageResult> {
    if (job.hash !== hash) throw new PremiumError(409, 'request_reused', 'Use a new request ID when changing the image description.')
    if (job.state === 'complete' && job.assetId) {
      const asset = await this.billing.store.read<ImageAsset>(`image-asset:${job.assetId}`)
      if (asset?.deleted) throw new PremiumError(410, 'image_deleted', 'This image was deleted. Use a new request ID if you want to create another image.')
      if (!asset || asset.accountId !== account.id) throw new PremiumError(410, 'image_missing', 'This saved image is no longer available. Use a new request ID if you want to create another image.')
      const cached = await this.billing.store.read<ImageJob>(this.jobKey(account, requestId))
      if (!cached?.result || cached.hash !== hash || cached.result.image.id !== job.assetId) throw new PremiumError(410, 'image_result_expired', 'This request’s recovery cache has expired. Use the image link you saved earlier. This request will not generate another image.')
      return { image: cached.result.image, usage: await this.currentUsage(account) }
    }
    if (job.state === 'failed') throw new PremiumError(job.status ?? 503, job.code ?? 'image_failed', job.message ?? 'That image request failed. Send a new request to try again.')
    if (this.billing.now() - job.createdAt >= IMAGE_PENDING_HORIZON_MS) throw new PremiumError(504, 'image_uncertain', 'The outcome of this image request is uncertain. Its allowance remains reserved and it will not be sent again. Contact support before creating another request.')
    throw new PremiumError(409, 'image_pending', 'This image request is already running. Please wait before trying again.')
  }
  private async currentUsage(account: PremiumAccount): Promise<ImageUsage> {
    const current = await this.billing.store.read<PremiumAccount>(`account:${account.id}`)
    if (!current) throw new PremiumError(401, 'session_expired', 'Your Premium session has expired. Restore it with your recovery code.')
    return this.billing.imageUsage(current)
  }
  private async reserve(account: PremiumAccount): Promise<PremiumAccount> {
    const now = this.billing.now()
    const month = new Date(now).toISOString().slice(0, 7)
    const day = new Date(now).toISOString().slice(0, 10)
    account = await this.billing.updateAccount(account.id, current => {
      if (!this.billing.isPremium(current)) throw new PremiumError(402, 'premium_required', 'Your paid Premium period has ended.')
      const used = current.imageMonth === month ? current.imageUsed ?? 0 : 0
      const daily = current.imageDay === day ? current.imageDayUsed ?? 0 : 0
      if (used >= this.billing.config.imageLimit) throw new PremiumError(429, 'image_quota', 'You have used this month’s image allowance. Your allowance resets at the start of next month (UTC).')
      if (daily >= this.billing.config.imageDailyLimit) throw new PremiumError(429, 'image_daily_quota', 'You have used today’s image allowance. Try again tomorrow (UTC).')
      if (current.lastImageAt && now - current.lastImageAt < this.billing.config.imageCooldownSeconds * 1000) throw new PremiumError(429, 'image_cooldown', 'Please wait a moment before generating another image.')
      return { ...current, imageMonth: month, imageUsed: used + 1, imageDay: day, imageDayUsed: daily + 1, lastImageAt: now }
    })
    try {
      await billingUpdate<{ used: number }, boolean>(this.billing.store, `image-budget:${day}`, previous => {
        if ((previous?.used ?? 0) >= this.billing.config.imageGlobalDailyLimit) throw new PremiumError(503, 'image_budget', 'Today’s image generation capacity has been reached. Try again tomorrow.')
        return { next: { used: (previous?.used ?? 0) + 1 }, result: true }
      }, 2 * 86400)
    } catch (error) { await this.refund(account); throw error }
    return account
  }
  private async refund(account: PremiumAccount) {
    await this.billing.updateAccount(account.id, current => ({ ...current,
      imageUsed: current.imageMonth === account.imageMonth ? Math.max(0, (current.imageUsed ?? 0) - 1) : current.imageUsed,
      imageDayUsed: current.imageDay === account.imageDay ? Math.max(0, (current.imageDayUsed ?? 0) - 1) : current.imageDayUsed,
    }))
  }
}

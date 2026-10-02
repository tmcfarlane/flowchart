import { MAX_DRAFT_EMBEDDED_IMAGE_BYTES } from '../hooks/useLocalDraft'
import { LIMITS } from '../shared/flowTypes'

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
export const IMAGE_UPLOAD_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml'

const mimeByExtension: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
}
const supportedMimes = new Set(Object.values(mimeByExtension))
const abortError = () => new DOMException('Image upload cancelled.', 'AbortError')
const readError = () => new Error('This file could not be read. Choose it again or try another image.')

export interface UploadedImage {
  imageUrl: string
  label: string
  notice?: string
}

function readImage(file: Blob, mime: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const reader = new FileReader()
    let settled = false
    const finish = (error?: Error, result?: string) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      reader.onload = reader.onerror = reader.onabort = null
      if (error) reject(error)
      else resolve(result!)
    }
    const cancel = () => {
      // Settle before abort, since some readers dispatch abort synchronously.
      finish(abortError())
      if (reader.readyState === FileReader.LOADING) reader.abort()
    }
    signal.addEventListener('abort', cancel, { once: true })
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith(`data:${mime};base64,`)) finish(readError())
      else finish(undefined, reader.result)
    }
    reader.onerror = () => finish(readError())
    reader.onabort = () => finish(abortError())
    try { reader.readAsDataURL(file) } catch { finish(readError()) }
  })
}

function decodeImage(imageUrl: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return }
    const image = new Image()
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', cancel)
      image.onload = image.onerror = null
      if (error) reject(error)
      else resolve()
    }
    const cancel = () => { finish(abortError()); image.src = '' }
    signal.addEventListener('abort', cancel, { once: true })
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) finish()
      else finish(new Error('This image could not be displayed. Try another image or export it again.'))
    }
    image.onerror = () => finish(new Error('This image could not be displayed. Try another image or export it again.'))
    image.src = imageUrl
  })
}

/** Decode for validity, while preserving original bytes, SVG vectors and animation. */
export async function prepareImageUpload(file: File, signal: AbortSignal): Promise<UploadedImage> {
  if (signal.aborted) throw abortError()
  if (!file.size) throw new Error('This file is empty. Choose another image.')
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error('Choose an image smaller than 5 MB.')
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  const declaredMime = file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type.toLowerCase()
  const extensionMime = mimeByExtension[extension]
  const mime = declaredMime || extensionMime
  if (!mime || !supportedMimes.has(mime) || (extension && !extensionMime)) {
    throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF, or SVG image.')
  }
  if (extensionMime && extensionMime !== mime) throw new Error('The image type does not match its filename. Choose another image.')
  const imageUrl = await readImage(file.slice(0, file.size, mime), mime, signal)
  await decodeImage(imageUrl, signal)
  if (signal.aborted) throw abortError()
  const label = file.name.replace(/\.[^/.]+$/, '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, LIMITS.maxLabelLength) || 'Uploaded image'
  const notice = imageUrl.length > LIMITS.maxImageUrlLength
    ? 'This image is too large for sharing and automatic draft recovery. Export JSON to keep a copy, or choose a smaller image to share.'
    : imageUrl.length > MAX_DRAFT_EMBEDDED_IMAGE_BYTES
      ? 'This image is too large for automatic draft recovery. Export JSON to keep a copy.'
      : undefined
  return { imageUrl, label, notice }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_IMAGE_UPLOAD_BYTES, prepareImageUpload } from '../utils/imageUpload'

class Reader {
  static LOADING = 1
  static instances: Reader[] = []
  readyState = 1
  result: string | ArrayBuffer | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  file?: Blob
  abort = vi.fn(() => { this.readyState = 2; this.onabort?.() })
  constructor() { Reader.instances.push(this) }
  readAsDataURL(file: Blob) { this.file = file }
  succeed(url: string) { this.result = url; this.readyState = 2; this.onload?.() }
}
class DecodedImage {
  static instances: DecodedImage[] = []
  src = ''
  naturalWidth = 120
  naturalHeight = 100
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { DecodedImage.instances.push(this) }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => { Reader.instances = []; DecodedImage.instances = []; vi.stubGlobal('FileReader', Reader); vi.stubGlobal('Image', DecodedImage) })
afterEach(() => vi.unstubAllGlobals())

describe('Image upload preparation', () => {
  it.each([
    ['unsupported extension', new File(['x'], 'document.txt', { type: 'text/plain' }), /PNG, JPEG/],
    ['unsupported MIME', new File(['x'], 'photo.png', { type: 'text/plain' }), /PNG, JPEG/],
    ['mismatched type', new File(['x'], 'photo.gif', { type: 'image/png' }), /does not match/],
    ['empty image', new File([], 'empty.png', { type: 'image/png' }), /empty/],
    ['oversized image', new File([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1)], 'large.png', { type: 'image/png' }), /5 MB/],
  ])('rejects %s before allocating a reader', async (_kind, file, error) => {
    await expect(prepareImageUpload(file, new AbortController().signal)).rejects.toThrow(error)
    expect(Reader.instances).toHaveLength(0)
  })

  it.each([['drawing.svg', 'image/svg+xml'], ['photo.avif', 'image/avif'], ['animation.gif', 'image/gif']])('preserves original data for %s after decoding', async (name, mime) => {
    const url = `data:${mime};base64,PHN2Zy8+`
    const pending = prepareImageUpload(new File(['original bytes'], name, { type: mime }), new AbortController().signal)
    expect(Reader.instances[0].file?.type).toBe(mime)
    Reader.instances[0].succeed(url)
    await tick()
    expect(DecodedImage.instances[0].src).toBe(url)
    DecodedImage.instances[0].onload?.()
    await expect(pending).resolves.toEqual({ imageUrl: url, label: name.replace(/\.[^.]+$/, ''), notice: undefined })
  })

  it('infers a supported MIME for a file with no declared type', async () => {
    const pending = prepareImageUpload(new File(['svg bytes'], 'drawing.SVG'), new AbortController().signal)
    expect(Reader.instances[0].file?.type).toBe('image/svg+xml')
    Reader.instances[0].succeed('data:image/svg+xml;base64,PHN2Zy8+')
    await tick()
    DecodedImage.instances[0].onload?.()
    await expect(pending).resolves.toMatchObject({ label: 'drawing' })
  })

  it('reports a read error without decoding or returning a null URL', async () => {
    const pending = prepareImageUpload(new File(['x'], 'photo.png', { type: 'image/png' }), new AbortController().signal)
    Reader.instances[0].onerror?.()
    await expect(pending).rejects.toThrow('could not be read')
    expect(DecodedImage.instances).toHaveLength(0)
  })

  it('rejects a non-string read result instead of casting it into an image URL', async () => {
    const pending = prepareImageUpload(new File(['x'], 'photo.png', { type: 'image/png' }), new AbortController().signal)
    Reader.instances[0].result = new ArrayBuffer(4)
    Reader.instances[0].onload?.()
    await expect(pending).rejects.toThrow('could not be read')
    expect(DecodedImage.instances).toHaveLength(0)
  })

  it('reports an image decode error before allowing an invalid image', async () => {
    const pending = prepareImageUpload(new File(['corrupt'], 'photo.png', { type: 'image/png' }), new AbortController().signal)
    Reader.instances[0].succeed('data:image/png;base64,Y29ycnVwdA==')
    await tick()
    DecodedImage.instances[0].onerror?.()
    await expect(pending).rejects.toThrow('could not be displayed')
  })

  it('aborts an in-flight reader and ignores its late completion', async () => {
    const controller = new AbortController()
    const pending = prepareImageUpload(new File(['x'], 'photo.png', { type: 'image/png' }), controller.signal)
    controller.abort()
    expect(Reader.instances[0].abort).toHaveBeenCalledOnce()
    Reader.instances[0].succeed('data:image/png;base64,eA==')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(DecodedImage.instances).toHaveLength(0)
  })

  it('cancels decoding when the selection is abandoned', async () => {
    const controller = new AbortController()
    const pending = prepareImageUpload(new File(['x'], 'photo.png', { type: 'image/png' }), controller.signal)
    Reader.instances[0].succeed('data:image/png;base64,eA==')
    await tick()
    const image = DecodedImage.instances[0]
    controller.abort()
    expect(image.src).toBe('')
    image.onload?.()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([[51_000, /too large for automatic draft recovery/], [80_000, /too large for sharing and automatic draft recovery/]])('keeps ordinary uploads usable with an honest portability notice (%i bytes)', async (size, notice) => {
    const url = `data:image/png;base64,${'AAAA'.repeat(Math.ceil(size / 3))}`
    const pending = prepareImageUpload(new File([new Uint8Array(size)], 'photo.png', { type: 'image/png' }), new AbortController().signal)
    Reader.instances[0].succeed(url)
    await tick()
    DecodedImage.instances[0].onload?.()
    await expect(pending).resolves.toEqual({ imageUrl: url, label: 'photo', notice: expect.stringMatching(notice) })
  })
})

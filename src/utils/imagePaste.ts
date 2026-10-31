import { MAX_AI_IMAGE_DATA_URL_BYTES } from '../shared/aiImage'

// Largest side and JPEG quality, tried in order until the image fits the byte budget.
const ENCODINGS: [number, number][] = [[1024, 0.85], [1024, 0.7], [768, 0.7], [512, 0.65], [384, 0.6]]
const PASSTHROUGH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export function getClipboardImage(clipboardData: DataTransfer): File | null {
  return Array.from(clipboardData.files).find(file => file.type.startsWith('image/')) ?? null
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the pasted image.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Encode an image as a data URL no longer than maxBytes. With keepOriginal, a
 * small enough raster file is kept as-is (preserving transparency); otherwise it
 * is downscaled and re-encoded as JPEG.
 */
export async function imageFileToDataUrl(file: File, { maxBytes = MAX_AI_IMAGE_DATA_URL_BYTES, keepOriginal = false } = {}): Promise<string> {
  if (keepOriginal && PASSTHROUGH_TYPES.includes(file.type) && file.size * 1.4 < maxBytes) {
    const original = await readAsDataUrl(file)
    if (original.length <= maxBytes) return original
  }
  const bitmap = await createImageBitmap(file)
  try {
    for (const [maxSide, quality] of ENCODINGS) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      // JPEG has no alpha channel; paint white so transparent screenshots stay readable
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= maxBytes) return dataUrl
    }
  } finally {
    bitmap.close()
  }
  throw new Error('This image is too detailed to paste. Try cropping it.')
}

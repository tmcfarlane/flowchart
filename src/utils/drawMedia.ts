import type { DrawElement, Point } from './drawScene'
import { getElementCenter, rotatePoint } from './drawScene'

export interface ImageCrop { x: number; y: number; width: number; height: number; naturalWidth: number; naturalHeight: number }

export function validImageCrop(value: unknown): value is ImageCrop {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const crop = value as Record<string, unknown>
  const fields = ['x', 'y', 'width', 'height', 'naturalWidth', 'naturalHeight'] as const
  if (!fields.every(field => typeof crop[field] === 'number' && Number.isFinite(crop[field]))) return false
  const x = Number(crop.x), y = Number(crop.y), width = Number(crop.width), height = Number(crop.height)
  const naturalWidth = Number(crop.naturalWidth), naturalHeight = Number(crop.naturalHeight)
  return x >= 0 && y >= 0 && width > 0 && height > 0 && naturalWidth > 0 && naturalHeight > 0 && x + width <= naturalWidth + 0.0001 && y + height <= naturalHeight + 0.0001
}

export function cropImageElement(element: DrawElement, current: ImageCrop, next: ImageCrop): DrawElement {
  if (!validImageCrop(current) || !validImageCrop(next) || current.naturalWidth !== next.naturalWidth || current.naturalHeight !== next.naturalHeight) throw new Error('Crop must stay inside the image and have positive dimensions.')
  const scaleX = element.width / current.width, scaleY = element.height / current.height
  const width = next.width * scaleX, height = next.height * scaleY
  const flipX = Array.isArray(element.scale) && element.scale[0] === -1
  const flipY = Array.isArray(element.scale) && element.scale[1] === -1
  const offsetX = (flipX ? current.x + current.width - next.x - next.width : next.x - current.x) * scaleX
  const offsetY = (flipY ? current.y + current.height - next.y - next.height : next.y - current.y) * scaleY
  const center = getElementCenter(element)
  const shift: Point = rotatePoint({ x: offsetX + (width - element.width) / 2, y: offsetY + (height - element.height) / 2 }, { x: 0, y: 0 }, element.angle)
  return { ...element, x: center.x + shift.x - width / 2, y: center.y + shift.y - height / 2, width, height, crop: next }
}

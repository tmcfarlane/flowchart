import { describe, expect, it } from 'vitest'
import { imageDataUrlSize } from '../utils/imageDimensions'

const dataUrl = (type: string, bytes: number[]) => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`
const u16be = (n: number) => [n >> 8, n & 255]
const u32be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const u24le = (n: number) => [n & 255, (n >> 8) & 255, n >> 16]
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0))

describe('imageDataUrlSize', () => {
  it('reads PNG, JPEG, GIF and extended WebP headers', () => {
    expect(imageDataUrlSize(dataUrl('png', [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, ...ascii('IHDR'), ...u32be(640), ...u32be(480)]))).toEqual({ width: 640, height: 480 })
    // SOI, an APP0 segment to skip, then a baseline frame header
    expect(imageDataUrlSize(dataUrl('jpeg', [0xff, 0xd8, 0xff, 0xe0, ...u16be(4), 0, 0, 0xff, 0xc0, ...u16be(17), 8, ...u16be(300), ...u16be(1200), 3]))).toEqual({ width: 1200, height: 300 })
    expect(imageDataUrlSize(dataUrl('gif', [...ascii('GIF89a'), 20, 0, 10, 0]))).toEqual({ width: 20, height: 10 })
    expect(imageDataUrlSize(dataUrl('webp', [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(1023), ...u24le(767)]))).toEqual({ width: 1024, height: 768 })
  })

  it('returns null for SVG, remote URLs and corrupt data', () => {
    expect(imageDataUrlSize('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull()
    expect(imageDataUrlSize('https://example.com/a.png')).toBeNull()
    expect(imageDataUrlSize('data:image/png;base64,!!!!')).toBeNull()
  })
})

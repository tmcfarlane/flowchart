import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { V3_SCREENSHOTS } from '../releaseScreenshots'

describe('v3 release screenshots', () => {
  it('publishes ten unique PNGs with complete descriptions and their actual dimensions', () => {
    expect(V3_SCREENSHOTS).toHaveLength(10)
    const sources = V3_SCREENSHOTS.map(image => image.src)
    expect(new Set(sources).size).toBe(sources.length)
    const assets = readdirSync('public/releases/v3.0.0')
      .filter(filename => filename.endsWith('.png'))
      .map(filename => `/releases/v3.0.0/${filename}`)
    expect(assets.sort()).toEqual([...sources].sort())
    for (const image of V3_SCREENSHOTS) {
      expect(image.src).toMatch(/^\/releases\/v3\.0\.0\/[a-z0-9-]+\.png$/)
      expect(image.alt.trim()).not.toBe('')
      expect(image.caption.trim()).not.toBe('')
      expect(Number.isSafeInteger(image.width) && image.width > 0).toBe(true)
      expect(Number.isSafeInteger(image.height) && image.height > 0).toBe(true)
      const png = readFileSync(`public${image.src}`)
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(png.readUInt32BE(8)).toBe(13)
      expect(png.toString('ascii', 12, 16)).toBe('IHDR')
      expect(png.readUInt32BE(16)).toBe(image.width)
      expect(png.readUInt32BE(20)).toBe(image.height)
    }
  })

  it.each([
    ['README.md', 'public'],
    ['docs/releases/v3.0.0.md', 'https://raw.githubusercontent.com/tmcfarlane/flowchart/v3.0.0/public'],
  ])('references exactly the gallery assets with publication-safe paths in %s', (filename, prefix) => {
    const markdown = readFileSync(filename, 'utf8')
    const references = markdown.match(/[^\s("'<>]*releases\/v3\.0\.0\/[^\s)"'<>]+\.png/g) ?? []
    expect([...new Set(references)].sort()).toEqual(V3_SCREENSHOTS.map(image => `${prefix}${image.src}`).sort())
  })
})

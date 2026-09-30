// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CHART_ID_LENGTH,
  extractChartId,
  extractEditToken,
  generateChartId,
  generateEditToken,
  hashToken,
  isValidChartId,
  verifyToken,
} from '../../shared/server/tokens'

describe('chart ids', () => {
  it('are 10 url-safe characters and unique', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generateChartId()))
    expect(ids.size).toBe(2000)
    for (const id of ids) {
      expect(id).toHaveLength(CHART_ID_LENGTH)
      expect(id).toMatch(/^[0-9A-Za-z]+$/)
      expect(isValidChartId(id)).toBe(true)
    }
  })

  it('rejects malformed ids', () => {
    for (const bad of ['', 'short', 'toolongtoolong', 'abc-def_gh', '../../etc', 42, null]) {
      expect(isValidChartId(bad)).toBe(false)
    }
  })

  it('are extracted from chart URLs', () => {
    expect(extractChartId('Ab3dE5fG7h')).toBe('Ab3dE5fG7h')
    expect(extractChartId('https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h')).toBe('Ab3dE5fG7h')
    expect(extractChartId('https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h#edit=xyz')).toBe('Ab3dE5fG7h')
    expect(extractChartId('/api/flows/Ab3dE5fG7h?since=2')).toBe('Ab3dE5fG7h')
  })
})

describe('edit tokens', () => {
  it('are 256-bit base64url strings', () => {
    const token = generateEditToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateEditToken()).not.toBe(token)
  })

  it('are stored as SHA-256 hashes', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('verify only the matching token', () => {
    const token = generateEditToken()
    const stored = hashToken(token)
    expect(verifyToken(token, stored)).toBe(true)
    expect(verifyToken(token + 'x', stored)).toBe(false)
    expect(verifyToken(generateEditToken(), stored)).toBe(false)
    expect(verifyToken('', stored)).toBe(false)
    expect(verifyToken(undefined, stored)).toBe(false)
    expect(verifyToken(123, stored)).toBe(false)
    expect(verifyToken('x'.repeat(1000), stored)).toBe(false)
    expect(verifyToken(token, 'not-a-hash')).toBe(false)
    expect(verifyToken(token, null)).toBe(false)
  })

  it('are extracted from edit links', () => {
    expect(extractEditToken('https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h#edit=tok_123-x')).toBe('tok_123-x')
    expect(extractEditToken('#edit=abc')).toBe('abc')
    expect(extractEditToken('  plain-token ')).toBe('plain-token')
    // A truncated %-escape must not throw (it used to surface as an internal error).
    expect(extractEditToken('https://x/f/Ab3dE5fG7h#edit=%E0%A4%A')).toBe('%E0%A4%A')
  })
})

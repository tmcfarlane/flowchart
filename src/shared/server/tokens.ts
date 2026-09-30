// Chart ids and edit tokens. Only a SHA-256 hash of each edit token is stored;
// verification hashes the presented token and compares in constant time.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const CHART_ID_LENGTH = 10
const CHART_ID_PATTERN = /^[0-9A-Za-z]{10}$/

/** 10 characters from a 62-letter alphabet (~59 bits), without modulo bias. */
export function generateChartId(length = CHART_ID_LENGTH): string {
  let out = ''
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue // 248 = 62 * 4; skipping keeps every letter equally likely
      out += ID_ALPHABET[byte % 62]
      if (out.length === length) break
    }
  }
  return out
}

export function isValidChartId(id: unknown): id is string {
  return typeof id === 'string' && CHART_ID_PATTERN.test(id)
}

/** 256 random bits, base64url (43 characters). */
export function generateEditToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time check of a presented token against the stored SHA-256 hash. */
export function verifyToken(token: unknown, storedHash: string | undefined | null): boolean {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) return false
  if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false
  const presented = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

/**
 * Accept what agents and users actually paste: a bare token, an edit URL
 * ("https://host/f/<id>#edit=<token>"), or "#edit=<token>".
 */
export function extractEditToken(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/[#&?]edit=([^&#\s]+)/)
  if (!match) return trimmed
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1] // malformed %-escapes: compare as written (it won't match a real token)
  }
}

/** Accept a bare id or any chart URL ("https://host/f/<id>", "/api/flows/<id>"). */
export function extractChartId(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/\/(?:f|api\/flows)\/([0-9A-Za-z]{10})(?:[/?#]|$)/)
  return match ? match[1] : trimmed
}

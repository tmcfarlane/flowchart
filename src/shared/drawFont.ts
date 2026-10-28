import { DRAW_FONT_GLYPHS, DRAW_FONT_METRICS } from './drawFontMetrics.js'

export const DRAW_FONT_MARKER = 'noto-sans-v1'
export const DRAW_FONT_FAMILY = 'Flowchart Diagram Sans'
export const DRAW_LINE_HEIGHT = 1.5
export const DRAW_FONT_BASELINE = 1.08
export const DRAW_FONT_INSET = 2

export function isGeneratedDrawFont(customData: unknown): boolean {
  return !!customData && typeof customData === 'object' && !Array.isArray(customData)
    && (customData as Record<string, unknown>).flowchartFont === DRAW_FONT_MARKER
}

export function measureDrawText(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const widths = lines.map(line => {
    let advance = 0, left = 0, right = 0
    for (const character of line.normalize('NFC')) {
      const codepoint = character.codePointAt(0)!
      const glyph = DRAW_FONT_GLYPHS[codepoint]
      const metrics = character === '\t' ? [2080, 0, 2080] : glyph ?? (/\p{Cf}/u.test(character) ? [0, 0, 0] : [2000, 0, 2000])
      left = Math.min(left, advance + metrics[1])
      right = Math.max(right, advance + metrics[2])
      advance += metrics[0]
    }
    return (Math.max(advance, right) - left) * fontSize / DRAW_FONT_METRICS.unitsPerEm + 2 * DRAW_FONT_INSET
  })
  return { width: Math.max(2 * DRAW_FONT_INSET, ...widths), height: lines.length * fontSize * DRAW_LINE_HEIGHT + 2 * DRAW_FONT_INSET }
}

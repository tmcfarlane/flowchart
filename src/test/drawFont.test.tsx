import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DrawSceneSvg from '../components/DrawSceneSvg'
import { DRAW_FONT_BASELINE, DRAW_FONT_FAMILY, DRAW_FONT_INSET, DRAW_FONT_MARKER, DRAW_LINE_HEIGHT, drawTextAnchorOffset, isGeneratedDrawFont, measureDrawText } from '../shared/drawFont'
import { DRAW_FONT_METRICS } from '../shared/drawFontMetrics'
import { drawingFontFamily, drawingTextSize } from '../utils/drawText'

const customData = { flowchartFont: DRAW_FONT_MARKER }

describe('canonical generated Draw font', () => {
  it('uses the checked-in font advances and exact source bytes', () => {
    const bytes = readFileSync(resolve(process.cwd(), 'assets/fonts/noto-sans/NotoSans-Regular.ttf'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(DRAW_FONT_METRICS.sourceSha256)
    expect(measureDrawText('WWW', 18).width).toBeCloseTo(3 * 930 / 1000 * 18 + 2 * DRAW_FONT_INSET)
    expect(measureDrawText('WWW', 18).width).toBeGreaterThan(measureDrawText('iii', 18).width * 2)
    expect(measureDrawText('e\u0301', 18)).toEqual(measureDrawText('é', 18))
  })

  it('reserves a conservative fallback width and contains the covered vertical font range', () => {
    expect(measureDrawText('😀', 12).width).toBe(24 + 2 * DRAW_FONT_INSET)
    expect(measureDrawText('配送先', 12).width).toBe(72 + 2 * DRAW_FONT_INSET)
    expect(measureDrawText('A\nǗj', 12).height).toBe(2 * 12 * DRAW_LINE_HEIGHT + 2 * DRAW_FONT_INSET)
    expect(DRAW_FONT_BASELINE * 12 - DRAW_FONT_METRICS.ascent / DRAW_FONT_METRICS.unitsPerEm * 12).toBeGreaterThan(0)
    expect(DRAW_FONT_BASELINE * 12 + DRAW_FONT_METRICS.descent / DRAW_FONT_METRICS.unitsPerEm * 12).toBeLessThan(12 * DRAW_LINE_HEIGHT)
  })

  it('uses canonical metrics only on marked sans text, including later native edits', () => {
    expect(isGeneratedDrawFont(customData)).toBe(true)
    expect(isGeneratedDrawFont({ flowchartFont: 'some-other-font' })).toBe(false)
    expect(drawingTextSize('WWW\nǗj', { fontSize: 18, fontFamily: 2, customData })).toEqual(measureDrawText('WWW\nǗj', 18))
    expect(drawingFontFamily(2, customData)).toContain(DRAW_FONT_FAMILY)
    expect(drawingFontFamily(1, customData)).toContain('Segoe Print')
    expect(drawingFontFamily(2)).toContain('Inter')
  })

  it('accounts for negative glyph bearings in each SVG alignment', () => {
    expect(drawTextAnchorOffset('jjj', 48, 'left')).toBeCloseTo(55 / 1000 * 48)
    expect(drawTextAnchorOffset('jjj', 48, 'center')).toBeCloseTo(55 / 1000 * 48 / 2)
    expect(drawTextAnchorOffset('jjj', 48, 'right')).toBe(0)
    const view = render(<svg><DrawSceneSvg elements={[{ id: 'overhang', type: 'text', x: 0, y: 0, angle: 0, ...measureDrawText('jjj', 48), text: 'jjj', fontSize: 48, fontFamily: 2, autoResize: true, customData }]} files={{}} /></svg>)
    expect(Number(view.container.querySelector('tspan')?.getAttribute('x'))).toBeCloseTo(DRAW_FONT_INSET + 55 / 1000 * 48)
  })

  it('embeds the font and fixes generated text baseline, inset and line spacing in SVG', () => {
    const text = 'Ǘj\nWide WWW'
    const size = measureDrawText(text, 12)
    const view = render(<svg><DrawSceneSvg elements={[{ id: 'generated', type: 'text', x: 0, y: 0, angle: 0, ...size, text, fontSize: 12, fontFamily: 2, lineHeight: DRAW_LINE_HEIGHT, autoResize: true, customData }]} files={{}} /></svg>)
    const graphic = view.container.querySelector('[data-draw-generated-font="true"]')!
    expect(view.container.querySelector('style')?.textContent).toContain('data:font/woff;base64,')
    expect(graphic.getAttribute('font-family')).toContain(DRAW_FONT_FAMILY)
    expect(Number(graphic.getAttribute('x'))).toBe(DRAW_FONT_INSET)
    expect(Number(graphic.getAttribute('y'))).toBeCloseTo(DRAW_FONT_INSET + DRAW_FONT_BASELINE * 12)
    expect(graphic.querySelectorAll('tspan')).toHaveLength(2)
    expect(graphic.querySelectorAll('tspan')[1].getAttribute('dy')).toBe(String(DRAW_LINE_HEIGHT * 12))
    expect((graphic as SVGElement).style.fontKerning).toBe('none')
  })

  it('leaves the font and baseline of unmarked imported text unchanged', () => {
    const view = render(<svg><DrawSceneSvg elements={[{ id: 'imported', type: 'text', x: 0, y: 0, width: 100, height: 30, angle: 0, text: 'Existing', fontSize: 20, fontFamily: 2 }]} files={{}} /></svg>)
    const graphic = view.container.querySelector('[data-element-id="imported"] text')!
    expect(view.container.querySelector('style')).toBeNull()
    expect(graphic.getAttribute('font-family')).toContain('Inter')
    expect(Number(graphic.getAttribute('y'))).toBe(20 * 0.84)
  })
})

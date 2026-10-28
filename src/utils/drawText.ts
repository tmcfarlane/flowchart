import type { DrawElement } from './drawScene'

/** Use the same local font fallback while displaying and editing drawing text. */
export function drawingFontFamily(value: unknown): string {
  if (value === 1 || value === 5 || value === 'handwritten') return '"Segoe Print", "Comic Sans MS", cursive'
  if (value === 3 || value === 8 || value === 'monospace') return 'ui-monospace, "SFMono-Regular", Consolas, monospace'
  if (value === 'serif') return 'Georgia, "Times New Roman", serif'
  return 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
}

let textMeasureContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined
function measureContext() {
  if (textMeasureContext !== undefined) return textMeasureContext
  if (typeof OffscreenCanvas !== 'undefined') textMeasureContext = new OffscreenCanvas(1, 1).getContext('2d')
  else if (typeof document !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined') textMeasureContext = document.createElement('canvas').getContext('2d')
  else textMeasureContext = null
  return textMeasureContext
}

export function drawingTextSize(text: string, element: Partial<Pick<DrawElement, 'fontSize' | 'fontFamily' | 'lineHeight'>>): { width: number; height: number } {
  const fontSize = element.fontSize ?? 20, lines = text.split('\n')
  const lineHeight = Math.max(1.3, typeof element.lineHeight === 'number' ? element.lineHeight : 1.3)
  const context = measureContext()
  if (context) context.font = `${fontSize}px ${drawingFontFamily(element.fontFamily)}`
  const widths = lines.map(line => {
    const measured = context?.measureText(line)
    return Math.max(line.length * fontSize * 0.61, measured?.width ?? 0, measured ? measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight : 0)
  })
  return { width: Math.max(24, ...widths), height: lines.length * fontSize * lineHeight }
}

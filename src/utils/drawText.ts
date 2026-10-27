/** Use the same local font fallback while displaying and editing drawing text. */
export function drawingFontFamily(value: unknown): string {
  if (value === 1 || value === 5 || value === 'handwritten') return '"Segoe Print", "Comic Sans MS", cursive'
  if (value === 3 || value === 8 || value === 'monospace') return 'ui-monospace, "SFMono-Regular", Consolas, monospace'
  if (value === 'serif') return 'Georgia, "Times New Roman", serif'
  return 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
}

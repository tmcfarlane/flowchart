interface Point { x: number; y: number }
interface Box extends Point { width: number; height: number }
export function crossesBox(a: Point, b: Point, box: Box): boolean {
  let low = 0, high = 1
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, box.x + 0.001, box.x + box.width - 0.001],
    [a.y, b.y - a.y, box.y + 0.001, box.y + box.height - 0.001],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false
    } else {
      const first = (min - origin) / delta, last = (max - origin) / delta
      low = Math.max(low, Math.min(first, last))
      high = Math.min(high, Math.max(first, last))
      if (low > high) return false
    }
  }
  return true
}

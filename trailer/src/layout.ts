// Layout constants shared by scenes that hand off to each other (caret -> logo pen).

export const LOGO_VIEWBOX = { w: 441, h: 446 }
/** First point of the gear outline in the logo's viewBox (the path starts at "M200.333 1.53333"). */
export const LOGO_PEN_START = { x: 200.333, y: 1.53333 }
/** The gear is drawn one tooth "behind" and winds into its exact brand orientation. */
export const GEAR_TURN = -45

export function logoDrawBox(portrait: boolean) {
  const size = portrait ? 330 : 290
  const cx = portrait ? 540 : 960
  const cy = portrait ? 820 : 500
  const h = (size * LOGO_VIEWBOX.h) / LOGO_VIEWBOX.w
  return { size, x: cx - size / 2, y: cy - h / 2, h, cx, cy }
}

/** Where the pen starts drawing, in frame pixels (includes the initial gear turn). */
export function penStart(portrait: boolean) {
  const b = logoDrawBox(portrait)
  const a = (GEAR_TURN * Math.PI) / 180
  const vx = LOGO_PEN_START.x - LOGO_VIEWBOX.w / 2
  const vy = LOGO_PEN_START.y - LOGO_VIEWBOX.h / 2
  const rx = vx * Math.cos(a) - vy * Math.sin(a) + LOGO_VIEWBOX.w / 2
  const ry = vx * Math.sin(a) + vy * Math.cos(a) + LOGO_VIEWBOX.h / 2
  return { x: b.x + (rx / LOGO_VIEWBOX.w) * b.size, y: b.y + (ry / LOGO_VIEWBOX.h) * b.h }
}

export function hookType(portrait: boolean) {
  return portrait ? { size: 68, y: 900 } : { size: 80, y: 540 }
}

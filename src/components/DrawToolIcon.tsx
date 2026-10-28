import type { ReactNode } from 'react'

/** Small first-party tool glyphs that stay legible without emoji fonts. */
export default function DrawToolIcon({ tool }: { tool: string }) {
  const paths: Record<string, ReactNode> = {
    selection: <path d="m5 3 14 10-7 1-3 7-4-18Z" />,
    lasso: <path d="M8 18c-4-1-6-4-5-8S9 4 14 4s8 3 7 7-6 7-11 7c-4 0-5-4-2-5s5 2 3 5l-3 4" />,
    hand: <><path d="M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v8c0 4-2 6-6 6h-2c-3 0-5-2-6-4l-3-5a2 2 0 0 1 3-2l2 2Z" /><path d="M12 11v3m4-3v3" /></>,
    rectangle: <rect x="4" y="5" width="16" height="14" rx="2" />,
    diamond: <path d="m12 3 9 9-9 9-9-9 9-9Z" />,
    ellipse: <ellipse cx="12" cy="12" rx="9" ry="7" />,
    arrow: <><path d="M4 19 20 5M11 5h9v9" /></>,
    line: <path d="M4 20 20 4" />,
    freedraw: <path d="M3 15c3-11 6-11 5 0-1 8 3-14 6-9 2 3-2 11 1 11 2 0 3-5 6-5" />,
    text: <><path d="M4 6V4h16v2M12 4v16M8 20h8" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="2" /><path d="m4 18 5-5 4 4 4-6 4 7" /></>,
    eraser: <><path d="m4 13 9-10 8 8-10 10H8l-4-4v-4Zm5-6 8 8M11 21h10" /></>,
    frame: <><path d="M7 3v18M17 3v18M3 7h18M3 17h18" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3" /></>,
  }
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[tool] ?? paths.selection}</svg>
}

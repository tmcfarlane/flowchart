import { Easing } from 'remotion'

// Every value below is copied from the app's CSS (src/index.css, src/App.css,
// src/components/*.css, src/components/nodes/NodeStyles.css), dark mode.
export const C = {
  bg: '#0f1211', // body.dark-mode, .react-flow-dark
  surface: '#1a1d1c', // minimap / inputs
  panel: 'rgba(24, 27, 26, 0.98)', // .share-panel
  toolbar: 'rgba(30, 33, 32, 0.95)', // .floating-toolbar
  text: '#e7eceb',
  textMuted: 'rgba(231, 236, 235, 0.62)',
  textDim: 'rgba(231, 236, 235, 0.45)',
  mint: '#78fcd6', // primary accent
  mintBright: '#00ffb6', // hover / live accent
  mintGradient: 'linear-gradient(135deg, #78fcd6 0%, #00ffb6 100%)',
  mintTextGradient: 'linear-gradient(to right, #78fcd6, #00ffb6)',
  mintBorder: 'rgba(120, 252, 214, 0.2)',
  mintBorderSoft: 'rgba(120, 252, 214, 0.12)',
  mintFill: 'rgba(120, 252, 214, 0.12)',
  green: '#10b981', // light-mode accent
  decision: '#ffa94d',
  note: '#ffd43b',
  stepBg: 'linear-gradient(135deg, #1a2f23 0%, #0f1211 100%)',
  decisionBg: 'linear-gradient(135deg, #2a1f0a 0%, #0f1211 100%)',
  noteBg: 'linear-gradient(135deg, #2a2510 0%, #0f1211 100%)',
  gridDot: 'rgba(231, 236, 235, 0.18)', // <Background variant=Dots gap=18 size=1>
  hairline: 'rgba(255, 255, 255, 0.08)',
} as const

export const FONT = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
}

// Motion tokens: calm expo-out for entrances, quick ease-in for exits.
export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  standard: Easing.bezier(0.4, 0, 0.2, 1),
  // The app's own modal entrance: cubic-bezier(0.34, 1.56, 0.64, 1)
  app: Easing.bezier(0.34, 1.56, 0.64, 1),
}

export const SPRING = {
  node: { damping: 15, stiffness: 150, mass: 0.9 },
  ui: { damping: 22, stiffness: 180, mass: 1 },
  soft: { damping: 26, stiffness: 90, mass: 1 },
  camera: { damping: 30, stiffness: 60, mass: 1.2 },
}

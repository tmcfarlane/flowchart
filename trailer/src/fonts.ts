import { loadFont } from '@remotion/fonts'
import { staticFile } from 'remotion'

// Inter (variable, full glyph set incl. → and …) and JetBrains Mono (no ligatures),
// both SIL Open Font License. Copied into public/fonts by scripts/sync-assets.mjs.
let loaded = false

export function loadTrailerFonts() {
  if (loaded) return
  loaded = true
  void loadFont({ family: 'Inter', url: staticFile('fonts/InterVariable.woff2'), weight: '100 900', format: 'woff2' })
  for (const [file, weight] of [
    ['JetBrainsMonoNL-Regular.woff2', '400'],
    ['JetBrainsMonoNL-Medium.woff2', '500'],
    ['JetBrainsMonoNL-SemiBold.woff2', '600'],
    ['JetBrainsMonoNL-Bold.woff2', '700'],
  ] as const) {
    void loadFont({ family: 'JetBrains Mono', url: staticFile(`fonts/${file}`), weight, format: 'woff2' })
  }
}

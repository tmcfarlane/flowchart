#!/usr/bin/env node
// Copies the app's real brand assets into trailer/public so Remotion can serve them.
// The repo root stays the single source of truth: logos from public/logo, Azure icons
// from assets/icons (via the app's generated icon index), fonts from node_modules.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TRAILER = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(TRAILER, '..')
const PUBLIC = join(TRAILER, 'public')

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

// Logos (unchanged files from the app)
for (const name of ['logo_color.svg', 'logo_dark_pointer.svg']) {
  copy(join(REPO, 'public', 'logo', name), join(PUBLIC, 'brand', name))
}

// Azure icons, named by the same ids the app and the MCP server use
const index = JSON.parse(readFileSync(join(REPO, 'src', 'shared', 'generated', 'azure-icon-index.json'), 'utf8'))
let copied = 0
for (const icon of index.icons) {
  const source = join(REPO, icon.path)
  if (!existsSync(source)) continue
  copy(source, join(PUBLIC, 'icons', `${icon.id}.svg`))
  copied++
}
writeFileSync(
  join(PUBLIC, 'icons', 'index.json'),
  JSON.stringify(index.icons.map(({ id, name, category }) => ({ id, name, category }))),
)

// Fonts (SIL Open Font License): Inter for UI and type, JetBrains Mono for code
const fonts = [
  [join(TRAILER, 'node_modules', 'inter-ui', 'variable', 'InterVariable.woff2'), 'InterVariable.woff2'],
  [join(TRAILER, 'node_modules', 'inter-ui', 'LICENSE.txt'), 'Inter-LICENSE.txt'],
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map((w) => [
    join(TRAILER, 'node_modules', 'jetbrains-mono', 'fonts', 'webfonts', `JetBrainsMonoNL-${w}.woff2`),
    `JetBrainsMonoNL-${w}.woff2`,
  ]),
  [join(TRAILER, 'node_modules', 'jetbrains-mono', 'LICENSE'), 'JetBrainsMono-LICENSE.txt'],
]
for (const [from, name] of fonts) copy(from, join(PUBLIC, 'fonts', name))

console.log(`[assets] logos: 2, azure icons: ${copied}, fonts: ${fonts.length}`)

// Default renders use the approved master; never silently replace it with music only.
if (!existsSync(join(PUBLIC, 'audio', 'trailer-narrated.m4a'))) {
  throw new Error('The approved public/audio/trailer-narrated.m4a master is missing. Restore it from Git before rendering.')
}

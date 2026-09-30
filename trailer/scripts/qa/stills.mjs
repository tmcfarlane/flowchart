#!/usr/bin/env node
// Renders review stills from one bundle: node scripts/qa/stills.mjs <Composition> <frame,frame,...> [outDir]
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [id = 'Trailer', framesArg = '0', outArg] = process.argv.slice(2)
const outDir = outArg ?? join(ROOT, 'out', 'frames', id)
mkdirSync(outDir, { recursive: true })

const serveUrl = await bundle({ entryPoint: join(ROOT, 'src', 'index.ts'), publicDir: join(ROOT, 'public') })
const composition = await selectComposition({ serveUrl, id })
const frames = framesArg.split(',').map(Number)
for (const frame of frames) {
  const output = join(outDir, `${id}-${String(frame).padStart(4, '0')}.png`)
  await renderStill({ serveUrl, composition, frame, output, imageFormat: 'png', overwrite: true })
  console.log(output)
}

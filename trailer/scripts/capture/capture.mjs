#!/usr/bin/env node
// Captures the real Flowchart AI app for the trailer.
//
//   1. Talks to the app's MCP server (create_flowchart / get_flowchart / update_flowchart)
//      exactly like an agent would, and saves the tool results and the server's layout.
//   2. Opens the returned edit link in headless Chromium (high DPI), presenting the local
//      dev server as https://flowchart.zeroclickdev.ai so every link in the UI is the
//      production URL. No traffic reaches the real site. The page (and the saved tool
//      results) see the chart id CHART_ID (default hDZT5de3oe) instead of the local one.
//   3. Records the live agent update and presentation mode frame by frame in virtual time,
//      and takes stills of the share panel, export menu, icon picker and light/dark modes.
//
// Requires the dev server: `npm run dev` in the repo root (port 3004).
// Usage: node scripts/capture/capture.mjs [landscape|portrait|layouts]...

import { chromium } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VirtualTime, netTrackerInitScript } from './virtual-time.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATA = join(ROOT, 'src', 'data')
const PUBLIC_CAPTURES = join(ROOT, 'public', 'captures')
const TMP = join(ROOT, '.capture-tmp')

const LOCAL = (process.env.APP_URL ?? 'http://localhost:3004').replace(/\/$/, '')
const HOST = 'flowchart.zeroclickdev.ai'
const PROD = `https://${HOST}`
const FPS = 60
// The chart id the trailer shows. The local server issues a random id; the browser and the
// saved tool results see this one instead (same length, so response sizes are unchanged).
const SHOWN_ID = process.env.CHART_ID ?? 'hDZT5de3oe'
if (!/^[A-Za-z0-9]{10}$/.test(SHOWN_ID)) throw new Error('CHART_ID must be 10 letters or digits')

const FORMATS = {
  landscape: { viewport: { width: 1600, height: 1000 }, dpr: 2, direction: 'LR' },
  // Tall, but wide enough for the real toolbar (~1090 CSS px) to fit without the mobile layout.
  portrait: { viewport: { width: 1120, height: 1904 }, dpr: 2, direction: 'TB' },
}

const demo = JSON.parse(readFileSync(join(DATA, 'demo-chart.json'), 'utf8'))
const generate = JSON.parse(readFileSync(join(DATA, 'generate-chart.json'), 'utf8'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...args) => console.log('[capture]', ...args)

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------
async function connectMcp() {
  const client = new Client({ name: 'trailer-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${LOCAL}/api/mcp`), {
      requestInit: { headers: { 'X-Forwarded-Host': HOST, 'X-Forwarded-Proto': 'https' } },
    }),
  )
  return client
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
  if (result.isError) throw new Error(`${name} failed:\n${text}`)
  return { text, data: result.structuredContent }
}

/**
 * The agent's edit inserts a step (demo.insertStep) between two connected nodes. The server
 * lays out the finished chart first; the chart the agent creates uses those positions minus
 * the new step, so the step lands in a clean slot and nothing else moves when it arrives.
 */
async function plannedCharts(client, direction) {
  const { node: step, after, before } = demo.insertStep
  const split = demo.edges.find((e) => e.source === after && e.target === before)
  if (!split) throw new Error(`demo-chart.json has no edge ${after} -> ${before}`)
  const finishedEdges = [
    ...demo.edges.filter((e) => e !== split),
    { ...split, target: step.id },
    { source: step.id, target: before },
  ]
  const scratch = await callTool(client, 'create_flowchart', {
    title: demo.title,
    nodes: [...demo.nodes, step],
    edges: finishedEdges,
    direction,
  })
  const finished = await layoutOf(client, scratch.data.id)
  const pos = Object.fromEntries(finished.nodes.map((n) => [n.id, n.position]))
  const handles = (source, target) => {
    const e = finished.edges.find((x) => x.source === source && x.target === target)
    return { sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }
  }
  const createArgs = {
    title: demo.title,
    nodes: demo.nodes.map((n) => ({ ...n, position: pos[n.id] })),
    edges: demo.edges.map((e) =>
      e === split
        ? { ...e, sourceHandle: handles(after, step.id).sourceHandle, targetHandle: handles(step.id, before).targetHandle }
        : { ...e, ...handles(e.source, e.target) },
    ),
    direction,
  }
  const operations = (splitEdgeId) => [
    { op: 'add_node', node: { ...step, position: pos[step.id] } },
    { op: 'update_edge', id: splitEdgeId, changes: { target: step.id, targetHandle: handles(after, step.id).targetHandle } },
    { op: 'add_edge', edge: { source: step.id, target: before, ...handles(step.id, before) } },
  ]
  return { createArgs, operations, split }
}

/** The server's stored chart: node positions and sizes, edge handles. */
async function layoutOf(client, id) {
  const { data } = await callTool(client, 'get_flowchart', { id })
  return {
    id: data.id,
    version: data.version,
    title: data.title,
    nodes: data.nodes,
    edges: data.edges,
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
async function newContext(browser, format, hooks = {}) {
  const { viewport, dpr } = FORMATS[format]
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const alias = hooks.alias // { real, shown }: chart id the server knows -> id the page sees
  const swap = (text, from, to) => (alias ? text.split(from).join(to) : text)
  await context.route(`${PROD}/**`, async (route) => {
    const request = route.request()
    const url = swap(request.url().replace(PROD, LOCAL), alias?.shown, alias?.real)
    if (hooks.beforeFetch) await hooks.beforeFetch(request)
    const postData = request.postData()
    const response = await route.fetch({
      url,
      headers: { ...request.headers(), 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https' },
      ...(alias && postData ? { postData: swap(postData, alias.shown, alias.real) } : {}),
    })
    if (alias && new URL(url).pathname.startsWith('/api/')) {
      const headers = { ...response.headers() }
      delete headers['content-length']
      delete headers['content-encoding']
      const body = swap(await response.text(), alias.real, alias.shown)
      await route.fulfill({ status: response.status(), headers, body })
      return
    }
    await route.fulfill({ response })
  })
  // Vite's HMR socket would point at the production host; the app does not need it.
  await context.routeWebSocket(/.*/, (ws) => ws.close())
  await context.addInitScript(netTrackerInitScript)
  return context
}

async function box(page, selector) {
  const b = await page.locator(selector).first().boundingBox()
  return b ? { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) } : null
}

const round = (n) => Math.round(n * 10) / 10

async function nodeBoxes(page) {
  return page.evaluate(() => {
    const out = {}
    for (const el of document.querySelectorAll('.react-flow__node')) {
      const r = el.getBoundingClientRect()
      out[el.getAttribute('data-id')] = {
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
      }
    }
    return out
  })
}

async function viewportTransform(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.react-flow__viewport')
    const m = el && getComputedStyle(el).transform
    if (!m || m === 'none') return null
    const v = m.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number)
    return { zoom: v[0], x: v[4], y: v[5] }
  })
}

async function shot(page, file) {
  mkdirSync(dirname(file), { recursive: true })
  await page.screenshot({ path: file, type: file.endsWith('.png') ? 'png' : 'jpeg', ...(file.endsWith('.png') ? {} : { quality: 95 }) })
}

/** Moves the pointer somewhere harmless so no hover state leaks into a capture. */
async function parkMouse(page, format) {
  const { viewport } = FORMATS[format]
  await page.mouse.move(viewport.width - 6, Math.round(viewport.height * 0.55))
}

function encodeSequence(dir, outFile) {
  mkdirSync(dirname(outFile), { recursive: true })
  execFileSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-framerate', String(FPS),
      '-i', join(dir, '%04d.jpg'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '12',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile,
    ],
    { stdio: 'inherit' },
  )
}

// ---------------------------------------------------------------------------
// Captures per format
// ---------------------------------------------------------------------------
async function captureFormat(browser, client, format) {
  const { direction } = FORMATS[format]
  const outDir = join(PUBLIC_CAPTURES, format)
  const tmpDir = join(TMP, format)
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })

  // 1. The agent creates the chart. (The trailer shows the first six characters of the edit
  // token; a token that starts with "_" or "-" reads like a typo on screen, so draw again.)
  const plan = await plannedCharts(client, direction)
  let created = await callTool(client, 'create_flowchart', plan.createArgs)
  for (let i = 0; i < 8 && /[-_]/.test(created.data.editToken.slice(0, 6)); i++) {
    created = await callTool(client, 'create_flowchart', plan.createArgs)
  }
  const { id, editToken, editUrl, url } = created.data
  const alias = { real: id, shown: SHOWN_ID }
  const shownEditUrl = editUrl.replace(`/f/${id}`, `/f/${SHOWN_ID}`)
  log(format, 'created', id, `(shown as ${SHOWN_ID})`, editUrl)
  const layoutV1 = await layoutOf(client, id)
  const splitEdge = layoutV1.edges.find((e) => e.source === plan.split.source && e.target === plan.split.target)

  // 2. Open the edit link. Hold the first chart request so the loading state can be captured.
  // (Holding it also sidesteps an app race: when the chart arrives within a few ms of the
  // page booting, the shared-chart auto-fit is skipped and the chart opens unfitted.)
  let hold = null
  const holdNextRead = () => {
    let release
    const gate = new Promise((resolve) => (release = resolve))
    hold = { gate }
    return release
  }
  const beforeFetch = async (request) => {
    if (hold && request.method() === 'GET' && request.url().includes(`/api/flows/${SHOWN_ID}`)) {
      const { gate } = hold
      hold = null
      await gate
    }
  }
  const context = await newContext(browser, format, { alias, beforeFetch })
  const releaseHold = holdNextRead()
  const page = await context.newPage()
  page.on('pageerror', (err) => log('pageerror', err.message))
  await page.clock.install()
  await page.goto(shownEditUrl)
  await page.locator('.share-overlay-card').waitFor({ timeout: 20000 })
  await parkMouse(page, format)
  await sleep(400)
  await shot(page, join(outDir, 'open-loading.png'))
  releaseHold()
  await page.locator('.react-flow__node').first().waitFor({ timeout: 20000 })
  await sleep(1800)
  await parkMouse(page, format)
  await sleep(300)
  await shot(page, join(outDir, 'open-loaded.png'))
  const openState = {
    url: page.url(),
    nodes: await nodeBoxes(page),
    transform: await viewportTransform(page),
    badge: await box(page, '.share-badge'),
    badgeStatus: await box(page, '.share-badge-status'),
    toolbar: await box(page, '.floating-toolbar'),
    shareButton: await box(page, '[aria-label="Share"]'),
  }

  // 3. The agent updates the chart while the tab is open; record it frame by frame.
  const vt = new VirtualTime(page, FPS)
  await vt.start()
  const reads = () => page.evaluate(() => window.__net.flowReads)
  const before = await reads()
  for (let i = 0; i < 40 && (await reads()) === before; i++) await vt.advance(100)
  if ((await reads()) === before) throw new Error('The app never polled for changes')
  const current = await callTool(client, 'get_flowchart', { id })
  const updated = await callTool(client, 'update_flowchart', {
    id,
    editToken,
    expectedVersion: current.data.version,
    operations: plan.operations(splitEdge.id),
  })
  log(format, 'updated to version', updated.data.version, updated.data.changes)
  await vt.advance(3000 - 100 - 650)

  const seqDir = join(tmpDir, 'update')
  mkdirSync(seqDir, { recursive: true })
  const totalFrames = Math.round(5.6 * FPS)
  let changeFrame = -1
  let flashFrame = -1
  let flashEndFrame = -1
  const duringFlash = {}
  for (let f = 0; f < totalFrames; f++) {
    await shot(page, join(seqDir, `${String(f).padStart(4, '0')}.jpg`))
    const state = await page.evaluate((stepId) => ({
      changed: !!document.querySelector(`.react-flow__node[data-id="${stepId}"]`),
      flash: !!document.querySelector('.share-badge-status.flash'),
    }), demo.insertStep.node.id)
    if (state.changed && changeFrame < 0) changeFrame = f
    if (state.flash && flashFrame < 0) flashFrame = f
    if (!state.flash && flashFrame >= 0 && flashEndFrame < 0) flashEndFrame = f
    if (changeFrame >= 0 && f === changeFrame + 1) {
      duringFlash.atChange = { nodes: await nodeBoxes(page), transform: await viewportTransform(page) }
    }
    if (changeFrame >= 0 && f === changeFrame + 60) {
      duringFlash.badge = await box(page, '.share-badge')
      duringFlash.status = await box(page, '.share-badge-status')
    }
    await vt.nextFrame()
  }
  encodeSequence(seqDir, join(outDir, 'update.mp4'))
  // A still of the update landing (new step glowing, "Updated by AI agent") for the poster.
  if (changeFrame >= 0) {
    const still = join(seqDir, `${String(Math.min(totalFrames - 1, changeFrame + 40)).padStart(4, '0')}.jpg`)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', still, join(outDir, 'agent-update.png')], { stdio: 'inherit' })
  }
  const updateState = {
    frames: totalFrames,
    changeFrame,
    flashFrame,
    flashEndFrame,
    ...duringFlash,
    nodes: await nodeBoxes(page),
    transform: await viewportTransform(page),
    badge: await box(page, '.share-badge'),
  }
  log(format, 'update sequence', { changeFrame, flashFrame, flashEndFrame })
  await page.clock.resume()
  await page.close()

  const layoutV2 = await layoutOf(client, id)

  // 4. Stills in real time on a fresh tab (the edit token is remembered by the app).
  // Playwright's clock is context-wide and the recording above left it paused, so the
  // stills and the presentation get their own contexts. Opening the edit link again
  // stores the token, so the Share panel shows the edit link like it does for the owner.
  await context.close()
  const stillsContext = await newContext(browser, format, { alias, beforeFetch })
  const stills = await stillsContext.newPage()
  stills.on('pageerror', (err) => log('pageerror', err.message))
  const releaseStills = holdNextRead()
  await stills.goto(shownEditUrl)
  await stills.locator('.share-overlay-card').waitFor({ timeout: 20000 })
  await sleep(400)
  releaseStills()
  await stills.locator('.react-flow__node').first().waitFor({ timeout: 20000 })
  await sleep(1800)
  await parkMouse(stills, format)
  await sleep(300)
  await shot(stills, join(outDir, 'mode-dark.png'))
  const stillsState = { nodes: await nodeBoxes(stills), transform: await viewportTransform(stills) }

  // Share panel
  const shareButton = stills.locator('[aria-label="Share"]')
  stillsState.shareButton = await box(stills, '[aria-label="Share"]')
  await shareButton.click()
  const panel = stills.getByRole('dialog', { name: 'Share flowchart' })
  await panel.waitFor()
  await sleep(450)
  await parkMouse(stills, format)
  await sleep(250)
  await shot(stills, join(outDir, 'share-open.png'))
  stillsState.sharePanel = await box(stills, '.share-panel')
  stillsState.copyEdit = await box(stills, '[aria-label="Copy edit link"]')
  stillsState.copyMcp = await box(stills, '[aria-label="Copy mcp server"]')
  await stills.locator('[aria-label="Copy mcp server"]').click()
  await sleep(250)
  await parkMouse(stills, format)
  await sleep(150)
  await shot(stills, join(outDir, 'share-copied.png'))
  await stills.keyboard.press('Escape')
  await stills.evaluate(() => document.activeElement?.blur())
  await sleep(1900)

  // Export menu, with each option hovered in turn
  stillsState.exportButton = await box(stills, '[aria-label="Export"]')
  await stills.locator('[aria-label="Export"]').click()
  await stills.locator('.export-dropdown').waitFor()
  await sleep(350)
  await parkMouse(stills, format)
  await sleep(200)
  await shot(stills, join(outDir, 'export-open.png'))
  stillsState.exportDropdown = await box(stills, '.export-dropdown')
  for (const [label, name] of [
    ['Export as PNG', 'png'],
    ['Export as SVG', 'svg'],
    ['Record GIF', 'gif'],
  ]) {
    const option = stills.locator('.export-option', { hasText: label })
    stillsState[`export_${name}`] = await option.boundingBox()
    await option.hover()
    await sleep(250)
    await shot(stills, join(outDir, `export-hover-${name}.png`))
  }
  await stills.keyboard.press('Escape')
  await parkMouse(stills, format)
  await sleep(500)

  // Light mode (same framing), then back to dark
  stillsState.darkToggle = await box(stills, '[aria-label="Toggle Dark Mode"]')
  await stills.locator('[aria-label="Toggle Dark Mode"]').click()
  await parkMouse(stills, format)
  await sleep(700)
  await shot(stills, join(outDir, 'mode-light.png'))
  await stills.locator('[aria-label="Toggle Dark Mode"]').click()
  await parkMouse(stills, format)
  await sleep(700)

  // Azure icon picker
  stillsState.addImage = await box(stills, '[aria-label="Add Image"]')
  await stills.locator('[aria-label="Add Image"]').click()
  await sleep(700)
  await parkMouse(stills, format)
  await sleep(300)
  await shot(stills, join(outDir, 'picker.png'))
  await stills.keyboard.press('Escape')
  await sleep(300)
  await stills.close()
  await stillsContext.close()

  // 5. Presentation mode, recorded in virtual time.
  const presentContext = await newContext(browser, format, { alias })
  const present = await presentContext.newPage()
  present.on('pageerror', (err) => log('pageerror', err.message))
  await present.clock.install()
  await present.goto(shownEditUrl)
  await present.locator('.react-flow__node').first().waitFor({ timeout: 20000 })
  await sleep(1800)
  await present.locator('[aria-label="Enter Preview Mode"]').click()
  await present.locator('.preview-mode').waitFor()
  await sleep(900)
  const pvt = new VirtualTime(present, FPS)
  await pvt.start()
  // Hovering the presentation shows its floating controls.
  await present.mouse.move(12, 12)
  const startIndex = 5 // "Choose a plan" (step 6 of the chart)
  for (let i = 0; i < startIndex; i++) {
    await present.keyboard.press('ArrowRight')
    await pvt.advance(700)
  }
  await pvt.advance(600)
  const presDir = join(tmpDir, 'present')
  mkdirSync(presDir, { recursive: true })
  const presFrames = Math.round(2.6 * FPS)
  const pressAt = [Math.round(0.2 * FPS), Math.round(1.25 * FPS)]
  for (let f = 0; f < presFrames; f++) {
    if (pressAt.includes(f)) await present.keyboard.press('ArrowRight')
    await shot(present, join(presDir, `${String(f).padStart(4, '0')}.jpg`))
    await pvt.nextFrame()
  }
  encodeSequence(presDir, join(outDir, 'present.mp4'))
  await presentContext.close()

  const result = {
    viewport: FORMATS[format].viewport,
    dpr: FORMATS[format].dpr,
    direction,
    id,
    url,
    editUrl,
    editTokenPreview: `${editToken.slice(0, 6)}…`,
    tool: {
      createArgs: plan.createArgs,
      createText: created.text,
      getText: current.text.split('\n').slice(0, 2).join('\n'),
      getVersion: current.data.version,
      updateOperations: plan.operations(splitEdge.id),
      updateText: updated.text,
      updateVersion: updated.data.version,
      changes: updated.data.changes,
    },
    open: openState,
    update: { ...updateState, file: `captures/${format}/update.mp4`, fps: FPS },
    present: { file: `captures/${format}/present.mp4`, fps: FPS, frames: presFrames, pressAt, startIndex },
    stills: stillsState,
    layoutV1,
    layoutV2,
  }
  // Everything saved (tool results, links, layouts) shows the id the page showed.
  return JSON.parse(JSON.stringify(result).split(id).join(SHOWN_ID))
}

// ---------------------------------------------------------------------------
async function main() {
  const wanted = process.argv.slice(2)
  const targets = wanted.length ? wanted : ['layouts', 'landscape', 'portrait']
  const manifestPath = join(DATA, 'captures.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}

  const ping = await fetch(`${LOCAL}/`).catch(() => null)
  if (!ping?.ok) throw new Error(`The app is not running at ${LOCAL}. Start it with \`npm run dev\` in the repo root.`)

  const client = await connectMcp()
  try {
    if (targets.includes('layouts')) {
      // Layouts for the recreated generation scene come from the same server layout engine.
      const { title, nodes, edges } = generate
      for (const direction of ['LR', 'TB']) {
        const res = await callTool(client, 'create_flowchart', { title, nodes, edges, direction })
        writeFileSync(join(DATA, `generate-${direction.toLowerCase()}.json`), JSON.stringify(await layoutOf(client, res.data.id), null, 2))
        log('layout', direction, res.data.id)
      }
    }
    const browser = await chromium.launch()
    try {
      for (const format of ['landscape', 'portrait']) {
        if (!targets.includes(format)) continue
        manifest[format] = await captureFormat(browser, client, format)
        manifest.capturedAt = new Date().toISOString()
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
      }
    } finally {
      await browser.close()
    }
  } finally {
    await client.close()
  }
  if (existsSync(TMP) && !process.env.KEEP_FRAMES) rmSync(TMP, { recursive: true, force: true })
  log('done', existsSync(PUBLIC_CAPTURES) ? readdirSync(PUBLIC_CAPTURES) : [])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

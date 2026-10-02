import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const authRoot = '/api/auth/openai/'
const authorizeEndpoint = 'https://auth.openai.com/api/accounts/authorize'
const sourcePaths = ['src/App.tsx', 'src/components/ChatGPTAccount.tsx', 'src/components/ChatGPTAccount.css',
  'src/shared/server/openaiAuthConfig.ts', 'src/shared/server/openaiAuthHttp.ts', 'src/shared/server/openaiAuthService.ts',
  'src/shared/server/openaiAuthStore.ts', 'src/shared/server/nodeAdapter.ts',
  'api/auth/openai/start.ts', 'api/auth/openai/callback.ts', 'api/auth/openai/session.ts', 'api/auth/openai/signout.ts',
  'tests/browser/openai-auth-server.ts', 'tests/browser/openai-sign-in.spec.ts', 'scripts/serve-auth-browser-fixture.mjs',
  'playwright.auth.config.ts', 'package.json', 'package-lock.json', 'tsconfig.browser-tests.json']

async function sourceReceipt(page: Page, info: TestInfo, details: Record<string, unknown>) {
  const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(resolve(path)))])))
  const bundleUrl = await page.evaluate(() => [...document.scripts].map(script => script.src).find(src => src.includes('/assets/main-')))
  expect(bundleUrl).toBeTruthy()
  const bundle = new URL(bundleUrl!).pathname
  const served = await page.request.get(bundleUrl!, { maxRedirects: 0 })
  expect(served.status()).toBe(200)
  const bytes = await served.body()
  const local = await readFile(resolve('.browser-auth-test-dist', bundle.slice(1)))
  expect(hash(bytes)).toBe(hash(local))
  const receipt = { result: 'PASS', checkedAt: new Date().toISOString(), test: info.title,
    evidenceScope: 'Compiled local UI and real server handlers with a signed mock OIDC transport. Live OpenAI client authorization was not attempted or verified. No plan usage or paid fallback.',
    git: { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() },
    runtime: { node: process.version, browser: page.context().browser()?.version() },
    sources, bundle: { path: bundle, bytes: bytes.length, sha256: hash(bytes), compiledBytesMatch: true }, details }
  const path = info.outputPath('receipt.json')
  await writeFile(path, JSON.stringify(receipt, null, 2) + '\n')
  await info.attach('Identity authentication evidence', { path, contentType: 'application/json' })
}

async function guard(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  expect(new URL(origin).hostname).toBe('127.0.0.1')
  const calls: Array<{ method: string; path: string }> = []
  const rejected: Array<{ method: string; path: string }> = []
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && !url.pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method())) return route.continue()
    if (url.origin === origin && url.pathname.startsWith(authRoot)) {
      calls.push({ method: request.method(), path: url.pathname })
      return route.continue()
    }
    // Authorization is handled separately by the mock provider below. All
    // other external and unrelated API traffic is rejected, never forwarded.
    rejected.push({ method: request.method(), path: url.pathname })
    return route.abort('blockedbyclient')
  })
  return { origin, calls, rejected }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

test('unconfigured website reports unavailable without starting OAuth', async ({ page, baseURL }, info) => {
  const observed = await guard(page, baseURL!)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'ChatGPT account' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('ChatGPT sign-in is not available on this website yet.', { exact: true })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Continue with ChatGPT' })).toHaveCount(0)
  await screenshot(page, info, 'unavailable-desktop')
  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  const account = page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })
  await expect(account).toBeVisible()
  const bounds = await account.boundingBox()
  expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390).toBeTruthy()
  await account.click()
  await expect(panel).toBeVisible()
  await screenshot(page, info, 'unavailable-mobile')
  const start = await page.request.get(observed.origin + authRoot + 'start', { maxRedirects: 0 })
  expect(start.status()).toBe(503)
  const stats = await (await page.request.get(observed.origin + '/__test/status')).json()
  expect(stats.tokenExchanges).toBe(0)
  expect(stats.discovery).toBe(0)
  expect(stats.unexpectedUpstream).toBe(0)
  expect(observed.rejected).toEqual([])
  await sourceReceipt(page, info, { ...observed, fixtureProvider: stats, unavailableStartStatus: start.status(),
    availability: 'Real default-unconfigured handler; no provider discovery, authorization or token call' })
})

async function mockAuthorization(page: Page, observed: Awaited<ReturnType<typeof guard>>, tamperState = false) {
  const { origin } = observed
  const observations: Array<{ scope: string | null; challengeMethod: string | null; browserProvider: string; originalRedirectStatus: number }> = []
  // Playwright interception may skip redirected requests. Fetch the real
  // local start response with redirects disabled, assert its redirect, then
  // display the explicitly labeled fixture instead of following Location.
  await page.context().route(origin + authRoot + 'start', async route => {
    observed.calls.push({ method: route.request().method(), path: authRoot + 'start' })
    const start = await route.fetch({ maxRedirects: 0 })
    expect(start.status()).toBe(302)
    const url = new URL(start.headers().location)
    expect(url.origin + url.pathname).toBe(authorizeEndpoint)
    observations.push({ scope: url.searchParams.get('scope'), challengeMethod: url.searchParams.get('code_challenge_method'), browserProvider: 'Local start redirect checked but never followed; signed fixture page substituted', originalRedirectStatus: start.status() })
    const grant = await page.request.post(origin + '/__test/issue-code', { data: { authorizationUrl: url.href } })
    expect(grant.status()).toBe(200)
    const target = new URL((await grant.json()).callbackUrl)
    expect(target.origin).toBe(origin)
    if (tamperState) target.searchParams.set('state', 'deliberately-mismatched-fixture-state')
    const href = target.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const headers: Record<string, string> = { ...start.headers(), 'content-type': 'text/html' }
    delete headers.location
    delete headers['content-length']
    return route.fulfill({ response: start, status: 200, headers, body: `<!doctype html><html><head><title>Test identity provider</title></head><body><h1>Test identity provider</h1><p>This is a signed local mock. OpenAI is not contacted.</p><a href="${href}">Continue as Test Diagrammer</a></body></html>` })
  })
  return observations
}

test('signed mock identity creates a server session and sign-out revokes it', async ({ page, baseURL }, info) => {
  await page.context().setExtraHTTPHeaders({ 'x-flowchart-auth-fixture': 'configured' })
  const observed = await guard(page, baseURL!)
  const authorization = await mockAuthorization(page, observed)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click()
  await page.getByRole('dialog', { name: 'ChatGPT account' }).getByRole('link', { name: 'Continue with ChatGPT', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Test identity provider' })).toBeVisible()
  await page.getByRole('link', { name: 'Continue as Test Diagrammer' }).click()
  await page.waitForURL(observed.origin + '/**')
  const account = page.getByRole('button', { name: 'ChatGPT account', exact: true })
  await expect(account).toBeVisible()
  const panel = page.getByRole('dialog', { name: 'ChatGPT account' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Test Diagrammer', { exact: true })).toBeVisible()
  await expect(panel.getByText('diagrammer@example.test', { exact: true })).toBeVisible()
  await screenshot(page, info, 'signed-mock-account')
  // Chromium accepts Secure cookies on trustworthy loopback HTTP. Inspect
  // native cookie metadata without an HTTP URL filter that omits Secure ones.
  const before = (await page.context().cookies()).filter(cookie => cookie.domain === '127.0.0.1')
  const session = before.find(cookie => cookie.name === '__Host-flowchart_openai_session')
  expect(session).toBeTruthy()
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
  expect(before.find(cookie => cookie.name === '__Host-flowchart_openai_tx')).toBeUndefined()
  expect(await page.evaluate(() => document.cookie.includes('flowchart_openai_session'))).toBe(false)
  // Use the native browser transport: APIRequestContext's HTTP cookie filtering
  // does not apply Chromium's trustworthy-loopback Secure-cookie exception.
  const status = await page.evaluate(async () => (await fetch('/api/auth/openai/session', { credentials: 'same-origin', cache: 'no-store' })).json())
  expect(status).toMatchObject({ available: true, authenticated: true, planUsageAvailable: false, user: { name: 'Test Diagrammer', email: 'diagrammer@example.test' } })
  expect(status.id_token).toBeUndefined()
  expect(status.access_token).toBeUndefined()
  await panel.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Continue with ChatGPT', exact: true })).toBeVisible()
  await screenshot(page, info, 'signed-out-account')
  expect((await page.context().cookies()).find(cookie => cookie.name === '__Host-flowchart_openai_session')).toBeUndefined()
  const replay = await page.request.get(observed.origin + authRoot + 'session', { headers: {
    'x-flowchart-auth-fixture': 'configured', cookie: `${session!.name}=${session!.value}`,
  } })
  expect((await replay.json()).authenticated).toBe(false)
  const stats = await (await page.request.get(observed.origin + '/__test/status')).json()
  expect(stats.tokenExchanges).toBe(1)
  expect(stats.rejectedExchanges).toBe(0)
  expect(stats.unexpectedUpstream).toBe(0)
  expect(authorization).toHaveLength(1)
  expect(authorization[0]).toMatchObject({ scope: 'openid profile email', challengeMethod: 'S256' })
  expect(observed.rejected).toEqual([])
  await sourceReceipt(page, info, { ...observed, authorization, fixtureProvider: stats,
    sessionCookie: { httpOnly: true, secure: true, sameSite: 'Lax', temporaryCookieCleared: true, revokedCookieCannotAuthenticate: true },
    providerCompletion: 'Signed mock only; no issued OpenAI client configured or real authorization attempted' })
})

test('mismatched browser callback fails before token exchange', async ({ page, baseURL }, info) => {
  await page.context().setExtraHTTPHeaders({ 'x-flowchart-auth-fixture': 'configured' })
  const observed = await guard(page, baseURL!)
  const authorization = await mockAuthorization(page, observed, true)
  const before = await (await page.request.get(observed.origin + '/__test/status')).json()
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click()
  await page.getByRole('dialog', { name: 'ChatGPT account' }).getByRole('link', { name: 'Continue with ChatGPT', exact: true }).click()
  await page.getByRole('link', { name: 'Continue as Test Diagrammer' }).click()
  await page.waitForURL(observed.origin + '/**')
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible()
  const panel = page.getByRole('dialog', { name: 'ChatGPT account' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('alert')).toBeVisible()
  await screenshot(page, info, 'rejected-callback')
  const cookies = await page.context().cookies()
  expect(cookies.find(cookie => cookie.name === '__Host-flowchart_openai_session')).toBeUndefined()
  expect(cookies.find(cookie => cookie.name === '__Host-flowchart_openai_tx')).toBeUndefined()
  const after = await (await page.request.get(observed.origin + '/__test/status')).json()
  expect(after.tokenExchanges).toBe(before.tokenExchanges)
  expect(after.unexpectedUpstream).toBe(0)
  expect(observed.rejected).toEqual([])
  await sourceReceipt(page, info, { ...observed, authorization, tokenExchangesDuringFailure: 0,
    temporaryCookieCleared: true, authenticatedSessionIssued: false, actionableErrorVisible: true })
})

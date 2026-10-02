import { defineConfig } from '@playwright/test'

const port = Number(process.env.FLOWCHART_AUTH_BROWSER_PORT ?? 4187)
if (!Number.isInteger(port) || port < 1024 || port > 65534) {
  throw new Error('FLOWCHART_AUTH_BROWSER_PORT must be an integer from 1024 to 65534 with the next port also free.')
}

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/openai-sign-in.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: './test-results/auth',
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    // Defense beyond interception: the owned loopback proxy refuses all
    // non-loopback browser traffic, including un-intercepted redirect hops.
    launchOptions: { proxy: { server: `http://127.0.0.1:${port + 1}`, bypass: '127.0.0.1,localhost' } },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build -- --outDir .browser-auth-test-dist && node scripts/serve-auth-browser-fixture.mjs',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 3_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})

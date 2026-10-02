import { defineConfig } from '@playwright/test'

const port = Number(process.env.FLOWCHART_BROWSER_PORT ?? 4186)
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('FLOWCHART_BROWSER_PORT must be an integer from 1024 to 65535.')
}
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/local-copy-reload.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: './test-results/local-copy',
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    baseURL,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Build separately so an existing preview of dist/ remains intact.
    command: `npm run build -- --outDir .browser-test-dist && npm run preview -- --host 127.0.0.1 --port ${port} --strictPort --outDir .browser-test-dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 3_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})

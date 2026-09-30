// Diagnostic: does a shared chart open fitted? Prints the React Flow viewport transform
// for a few ways of opening the same chart. Not used by the trailer build.
import { chromium } from 'playwright'

const LOCAL = 'http://localhost:3004'
const res = await fetch(`${LOCAL}/api/flows`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    title: 'fit check',
    direction: 'LR',
    nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, type: 'step', label: `Step ${i + 1}` })),
    edges: Array.from({ length: 7 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })),
  }),
})
const { id, editToken } = await res.json()
const browser = await chromium.launch()
const transform = (page) =>
  page.evaluate(() => getComputedStyle(document.querySelector('.react-flow__viewport')).transform)
const open = async (context, url, label) => {
  const page = await context.newPage()
  await page.goto(url)
  await page.locator('.react-flow__node').first().waitFor()
  await page.waitForTimeout(1500)
  console.log(label.padEnd(44), await transform(page))
  return page
}
const a = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await open(a, `${LOCAL}/f/${id}#edit=${editToken}`, 'fresh context, edit link')
await open(a, `${LOCAL}/f/${id}`, 'same context, view link (token stored)')
await open(a, `${LOCAL}/f/${id}#edit=${editToken}`, 'same context, edit link again')
const b = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await open(b, `${LOCAL}/f/${id}`, 'fresh context, view link (no token)')
await browser.close()

// Deterministic frame capture for a live web app.
//
// Playwright's fake clock drives JS time (timers, rAF, Date, performance.now),
// and every CSS animation/transition is paused and stepped through the Web
// Animations API, so each captured frame is exactly 1/fps apart in app time.
// Network requests still run in real time; each step waits for them to settle.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Init script: counts in-flight fetches so steps can wait for the network. */
export function netTrackerInitScript() {
  const original = window.fetch.bind(window)
  window.__net = { inflight: 0, count: 0, flowReads: 0 }
  window.fetch = (...args) => {
    const target = args[0]
    const url = String(target && typeof target === 'object' && 'url' in target ? target.url : target)
    window.__net.inflight++
    window.__net.count++
    if (url.includes('/api/flows/')) window.__net.flowReads++
    return original(...args).finally(() => {
      window.__net.inflight--
    })
  }
}

/** Waits until fetches finish, React flushes (MessageChannel tasks) and Chrome renders a frame. */
export async function settle(page, { realMs = 24 } = {}) {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 200; i++) {
      const inflight = await page.evaluate(() => window.__net?.inflight ?? 0)
      if (inflight === 0) break
      await sleep(10)
    }
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0
          const channel = new MessageChannel()
          channel.port1.onmessage = () => {
            if (++n >= 6) resolve()
            else channel.port2.postMessage(0)
          }
          channel.port2.postMessage(0)
        }),
    )
    await sleep(realMs)
  }
}

export class VirtualTime {
  constructor(page, fps = 60) {
    this.page = page
    this.fps = fps
    this.frame = 0
    this.elapsed = 0 // integer ms of app time since start()
  }

  /** Pauses app time. Call once the page has loaded. */
  async start() {
    const page = this.page
    await page.clock.pauseAt(Date.now() + 250)
    await page.evaluate(() => {
      const times = new Map()
      window.__anim = {
        step(dt) {
          for (const a of document.getAnimations()) {
            let t = times.get(a)
            if (t === undefined) {
              t = 0
              a.pause()
            } else {
              t += dt
            }
            times.set(a, t)
            try {
              a.currentTime = t
            } catch {
              // cancelled animations throw; they are gone next frame
            }
          }
        },
      }
      window.__anim.step(0)
    })
    await settle(page)
  }

  /** Advances app time by `ms` (split into frame-sized steps so rAF and animations stay smooth). */
  async advance(ms) {
    const frameMs = 1000 / this.fps
    let remaining = ms
    while (remaining > 0.5) {
      const step = Math.min(remaining, frameMs)
      await this.#step(step)
      remaining -= step
    }
  }

  /** Advances exactly one frame. */
  async nextFrame() {
    this.frame++
    await this.#step(1000 / this.fps)
  }

  async #step(ms) {
    const target = Math.round(this.elapsed + ms)
    const delta = target - Math.round(this.elapsed)
    this.elapsed += ms
    if (delta > 0) await this.page.clock.runFor(delta)
    await settle(this.page)
    await this.page.evaluate((dt) => window.__anim.step(dt), delta)
    await settle(this.page, { realMs: 8 })
  }
}

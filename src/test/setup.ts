/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

// Node 25 exposes a native storage placeholder. Browser tests must use the
// actual JSDOM storage, including clear(), rather than inheriting that object.
const browserWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window
if (browserWindow) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browserWindow.localStorage })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: browserWindow.sessionStorage })
}

// Each browser test starts with an independent editor session. Individual
// recovery tests populate storage after this hook when they need a saved draft.
beforeEach(() => {
  if (browserWindow) {
    browserWindow.localStorage.clear()
    browserWindow.sessionStorage.clear()
  }
})

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

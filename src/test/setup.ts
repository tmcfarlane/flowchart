import '@testing-library/jest-dom'

// Mock ResizeObserver for testing
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}


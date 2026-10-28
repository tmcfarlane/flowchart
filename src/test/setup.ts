/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom'

HTMLDialogElement.prototype.showModal = function () { this.open = true }
HTMLDialogElement.prototype.close = function () { this.open = false }

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}


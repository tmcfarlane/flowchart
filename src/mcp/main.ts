// Entry for the /mcp launch page (mcp.html). Deliberately tiny and framework-free: copy
// buttons, accessible tabs for the client setup, and analytics. The page is complete without it.
import { inject } from '@vercel/analytics'

inject()

const status = document.getElementById('copy-status')

function announce(message: string) {
  if (!status) return
  // Clear first so repeating the same message is announced again.
  status.textContent = ''
  window.setTimeout(() => {
    status.textContent = message
  }, 50)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.fontSize = '16px'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

function selectContents(element: Element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function setUpCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-copy], [data-copy-target]').forEach((button) => {
    const idleLabel = button.textContent ?? 'Copy'
    let timer: number | undefined
    button.addEventListener('click', async () => {
      const target = button.dataset.copyTarget ? document.getElementById(button.dataset.copyTarget) : null
      const text = (button.dataset.copy ?? target?.textContent ?? '').trim()
      if (!text) return
      const ok = await copyText(text)
      window.clearTimeout(timer)
      const touch = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches
      const shortcut = /Mac/.test(navigator.userAgent) ? '⌘C' : 'Ctrl+C'
      button.textContent = ok ? 'Copied' : touch ? 'Touch & hold' : `Press ${shortcut}`
      button.classList.toggle('is-copied', ok)
      if (ok) {
        announce('Copied to clipboard.')
      } else {
        const selectable = target ?? document.getElementById('endpoint-url')
        if (selectable) selectContents(selectable)
        announce(touch
          ? 'Copying is blocked here. Touch and hold the selected text, then choose Copy.'
          : `Copying is blocked here. The text is selected: press ${shortcut} to copy it.`)
      }
      timer = window.setTimeout(() => {
        button.textContent = idleLabel
        button.classList.remove('is-copied')
      }, 2000)
    })
  })
}

// WAI-ARIA tabs with automatic activation. Without JavaScript every panel stays visible,
// each under its own heading.
function setUpTabs(root: HTMLElement) {
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-tab]'))
  if (panels.length === 0) return

  const tablist = document.createElement('div')
  tablist.className = 'tablist'
  tablist.setAttribute('role', 'tablist')
  tablist.setAttribute('aria-label', root.dataset.tabsLabel ?? 'Tabs')

  const tabs = panels.map((panel) => {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'tab'
    tab.id = `tab-${panel.id}`
    tab.textContent = panel.dataset.tab ?? panel.id
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', panel.id)
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', tab.id)
    panel.tabIndex = 0
    tablist.append(tab)
    return tab
  })

  root.prepend(tablist)
  root.classList.add('is-enhanced')

  const select = (index: number, options: { focus?: boolean; remember?: boolean } = {}) => {
    tabs.forEach((tab, i) => {
      const selected = i === index
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      panels[i].hidden = !selected
    })
    if (options.focus) tabs[index].focus()
    // Keep the choice in the URL (without scrolling) so a reload or a shared link opens the same client.
    if (options.remember) history.replaceState(null, '', `#${panels[index].id}`)
  }

  tablist.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>('[role="tab"]')
    if (tab) select(tabs.indexOf(tab), { remember: true })
  })

  tablist.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length
        break
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = tabs.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    select(next, { focus: true, remember: true })
  })

  const indexFromHash = () => panels.findIndex((panel) => `#${panel.id}` === decodeURIComponent(window.location.hash))

  const initial = indexFromHash()
  select(initial >= 0 ? initial : 0)
  if (initial >= 0) root.scrollIntoView({ block: 'start' })

  window.addEventListener('hashchange', () => {
    const index = indexFromHash()
    if (index < 0) return
    select(index)
    root.scrollIntoView({ block: 'start' })
  })
}

setUpCopyButtons()
document.querySelectorAll<HTMLElement>('[data-tabs]').forEach(setUpTabs)

// Vercel Web Analytics reports location.href, and the first page view can fire
// before useSharedFlow moves an "#edit=<token>" out of the address bar. Edit
// tokens are secrets, so every event URL loses its fragment and any "edit"
// query parameter before it is sent.

import type { BeforeSendEvent } from '@vercel/analytics'

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.searchParams.has('edit')) parsed.searchParams.delete('edit')
    return parsed.toString()
  } catch {
    return url.split('#')[0]
  }
}

export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: redactUrl(event.url) }
}

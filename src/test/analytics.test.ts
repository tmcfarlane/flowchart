import { describe, expect, it } from 'vitest'
import { redactAnalyticsEvent, redactUrl } from '../utils/analytics'
import { parseSharedLocation } from '../utils/shareApi'

describe('analytics redaction', () => {
  it('never sends an edit token to Vercel Web Analytics', () => {
    const url = 'https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h#edit=SECRET_token-123'
    expect(redactUrl(url)).toBe('https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h')
    expect(redactUrl('https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h?edit=SECRET&ref=x')).toBe(
      'https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h?ref=x',
    )
    expect(redactUrl('https://flowchart.zeroclickdev.ai/?utm_source=x')).toBe('https://flowchart.zeroclickdev.ai/?utm_source=x')
    expect(redactUrl('not a url#edit=SECRET')).toBe('not a url')
    expect(redactAnalyticsEvent({ type: 'pageview', url })).toEqual({
      type: 'pageview',
      url: 'https://flowchart.zeroclickdev.ai/f/Ab3dE5fG7h',
    })
  })
})

describe('shared link parsing', () => {
  it('survives malformed escapes in the id or token instead of crashing the app', () => {
    expect(parseSharedLocation({ pathname: '/f/Ab3dE5fG7h', hash: '#edit=%E0%A4%A' })).toEqual({
      id: 'Ab3dE5fG7h',
      token: '%E0%A4%A',
    })
    expect(parseSharedLocation({ pathname: '/f/%E0%A4%A', hash: '' })).toEqual({ id: '%E0%A4%A', token: undefined })
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { providerEndpoint, readAiConfig } from '../../shared/server/aiConfig'

const env = { AI_ROUTING_MODE: 'direct', AZURE_RESOURCE_NAME: 'operator-resource', AZURE_DEPLOYMENT_NAME: 'model-6.1', AZURE_API_KEY: 'test-key', AI_INPUT_PRICE_PER_MILLION: '0.25', AI_OUTPUT_PRICE_PER_MILLION: '1', NODE_ENV: 'test' }

describe('Azure deployment-name compatibility', () => {
  it.each(['direct', 'gateway'])('accepts dotted deployment names for %s without changing authentication or routing', mode => {
    const config = readAiConfig({ ...env, AI_ROUTING_MODE: mode, CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_AI_GATEWAY_ID: 'gateway', CLOUDFLARE_AI_GATEWAY_TOKEN: 'gateway-key' })
    expect(config.route.kind).toBe(mode)
    if (config.route.kind === 'disabled') throw new Error('Expected configured route')
    expect(providerEndpoint(config.route)).toContain(mode === 'direct' ? '/deployments/model-6.1/chat/completions' : '/operator-resource/model-6.1/chat/completions')
    expect(config.route.azure.apiKey).toBe('test-key')
    if (config.route.kind === 'gateway') expect(config.route.token).toBe('gateway-key')
  })
  it.each(['../model', '.', '..', '%2e%2e', 'model/other', 'model?api-key=bad', 'model%2Fother'])('rejects path/query injection %s', deployment => {
    expect(() => readAiConfig({ ...env, AZURE_DEPLOYMENT_NAME: deployment })).toThrow('Azure configuration is incomplete')
  })
  it('keeps the Azure resource restricted to a single resource-host segment', () => {
    expect(() => readAiConfig({ ...env, AZURE_RESOURCE_NAME: 'operator-resource.evil.example' })).toThrow('Azure configuration is incomplete')
  })
})

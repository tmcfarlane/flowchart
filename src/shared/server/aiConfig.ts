import { z } from 'zod'

export type AiEnv = Record<string, string | undefined>

const segment = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/)
const deploymentName = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/)
const secret = z.string().trim().min(1)
const azureSchema = z.object({
  resource: segment,
  deployment: deploymentName,
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:-preview)?$/),
  apiKey: secret,
})

export type AzureDeployment = z.infer<typeof azureSchema>
export type AiRoute =
  | { kind: 'disabled' }
  | { kind: 'direct'; azure: AzureDeployment }
  | { kind: 'gateway'; azure: AzureDeployment; accountId: string; gatewayId: string; token: string }

export interface AiConfig {
  route: AiRoute
  environment: string
  maxBodyBytes: number
  maxInputBytes: number
  maxOutputTokens: number
  maxResponseBytes: number
  timeoutMs: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  inputPricePerMillion: number
  outputPricePerMillion: number
  admissionCostMultiplier: number
  clientPerMinute: number
  globalPerMinute: number
  dailyBudgetMicros: number
  concurrency: number
  admissionStore: 'redis' | 'memory'
}

export class AiConfigurationError extends Error {}

function numberSetting(env: AiEnv, name: string, fallback: number, min: number, max: number): number {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name])
  if (!Number.isFinite(value) || value < min || value > max) throw new AiConfigurationError(`Invalid ${name}`)
  return value
}

function integerSetting(env: AiEnv, name: string, fallback: number, min: number, max: number): number {
  const value = numberSetting(env, name, fallback, min, max)
  if (!Number.isSafeInteger(value)) throw new AiConfigurationError(`Invalid ${name}`)
  return value
}

export function aiEnabled(env: AiEnv): boolean {
  return env.AI_ENABLED !== 'false' && env.AI_ENABLED !== '0'
}

export function readAiConfig(env: AiEnv): AiConfig {
  const mode = env.AI_ROUTING_MODE?.trim() || 'disabled'
  if (!['disabled', 'direct', 'gateway'].includes(mode)) throw new AiConfigurationError('Invalid AI_ROUTING_MODE')
  const requiredGateway = env.AI_REQUIRE_GATEWAY === 'true' || env.AI_REQUIRE_GATEWAY === '1'
  if (requiredGateway && mode !== 'gateway' && mode !== 'disabled') {
    throw new AiConfigurationError('Gateway routing is required')
  }
  let route: AiRoute = { kind: 'disabled' }
  if (mode !== 'disabled') {
    const parsed = azureSchema.safeParse({
      resource: env.AZURE_RESOURCE_NAME,
      deployment: env.AZURE_DEPLOYMENT_NAME,
      apiVersion: env.AZURE_API_VERSION || '2024-10-21',
      apiKey: env.AZURE_API_KEY,
    })
    if (!parsed.success) throw new AiConfigurationError('Azure configuration is incomplete')
    if (mode === 'direct') route = { kind: 'direct', azure: parsed.data }
    else {
      const gateway = z.object({ accountId: segment, gatewayId: segment, token: secret }).safeParse({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID,
        token: env.CLOUDFLARE_AI_GATEWAY_TOKEN,
      })
      if (!gateway.success) throw new AiConfigurationError('Gateway configuration is incomplete')
      route = { kind: 'gateway', azure: parsed.data, ...gateway.data }
    }
  }
  const environment = env.AI_ENVIRONMENT || env.VERCEL_ENV || env.NODE_ENV || 'development'
  if (!/^[\w-]{1,64}$/.test(environment)) throw new AiConfigurationError('Invalid AI_ENVIRONMENT')
  const store = env.AI_ADMISSION_STORE || (env.NODE_ENV === 'production' || env.VERCEL ? 'redis' : 'memory')
  if (store !== 'redis' && store !== 'memory') throw new AiConfigurationError('Invalid AI_ADMISSION_STORE')
  if (env.VERCEL && store === 'memory') throw new AiConfigurationError('Vercel requires shared Redis admission')
  const reasoningEffort = z.enum(['minimal', 'low', 'medium', 'high']).optional().safeParse(env.AZURE_REASONING_EFFORT || undefined)
  if (!reasoningEffort.success) throw new AiConfigurationError('Invalid AZURE_REASONING_EFFORT')
  return {
    route,
    environment,
    maxBodyBytes: integerSetting(env, 'AI_MAX_BODY_BYTES', 128 * 1024, 1024, 256 * 1024),
    maxInputBytes: integerSetting(env, 'AI_MAX_INPUT_BYTES', 160 * 1024, 2048, 256 * 1024),
    maxOutputTokens: integerSetting(env, 'AZURE_MAX_COMPLETION_TOKENS', 4000, 256, 16000),
    maxResponseBytes: integerSetting(env, 'AI_MAX_RESPONSE_BYTES', 256 * 1024, 1024, 1024 * 1024),
    timeoutMs: integerSetting(env, 'AI_TIMEOUT_MS', 45000, 1000, 50000),
    reasoningEffort: reasoningEffort.data,
    inputPricePerMillion: numberSetting(env, 'AI_INPUT_PRICE_PER_MILLION', 0, route.kind === 'disabled' ? 0 : 0.000001, 1000),
    outputPricePerMillion: numberSetting(env, 'AI_OUTPUT_PRICE_PER_MILLION', 0, route.kind === 'disabled' ? 0 : 0.000001, 10000),
    admissionCostMultiplier: numberSetting(env, 'AI_ADMISSION_COST_MULTIPLIER', 2, 1, 100),
    clientPerMinute: integerSetting(env, 'AI_CLIENT_REQUESTS_PER_MINUTE', 6, 1, 1000),
    globalPerMinute: integerSetting(env, 'AI_GLOBAL_REQUESTS_PER_MINUTE', 30, 1, 10000),
    dailyBudgetMicros: Math.floor(numberSetting(env, 'AI_DAILY_BUDGET_USD', 5, 0.001, 10000) * 1000000),
    concurrency: integerSetting(env, 'AI_MAX_CONCURRENT', 3, 1, 100),
    admissionStore: store,
  }
}

export function providerEndpoint(route: Exclude<AiRoute, { kind: 'disabled' }>): string {
  const { resource, deployment, apiVersion } = route.azure
  const path = route.kind === 'gateway'
    ? `https://gateway.ai.cloudflare.com/v1/${route.accountId}/${route.gatewayId}/azure-openai/${resource}/${deployment}/chat/completions`
    : `https://${resource}.openai.azure.com/openai/deployments/${deployment}/chat/completions`
  return `${path}?api-version=${apiVersion}`
}

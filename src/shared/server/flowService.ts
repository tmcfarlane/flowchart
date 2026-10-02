// Chart operations shared by the REST API and the MCP server: validate, lay
// out, and store with optimistic concurrency. Callers parse request shapes
// with zod first; this layer handles semantics.

import {
  LIMITS,
  type Chart,
  type ChartEdge,
  type ChartNode,
  type DraftNode,
  type LayoutDirection,
  type UpdateSource,
} from '../flowTypes.js'
import {
  edgeFromInput,
  nodeFromInput,
  validateChart,
  type EdgeInput,
  type IconResolver,
  type NodeInput,
  type Operation,
  type ValidationIssue,
} from '../flowSchema.js'
import { applyOperations } from '../patch.js'
import { arrangeChart, layoutWorkUnits, planLayout, type ArrangeResult } from '../layout.js'
import { resolveIconRef } from '../icons.js'
import { generateChartId, generateEditToken, hashToken, isValidChartId, verifyToken } from './tokens.js'
import type { QuotaDecision, WriteQuota } from './rateLimit.js'
import type { FlowStore, StoredRecord } from './store.js'

export type ServiceError =
  | { ok: false; code: 'validation'; message: string; issues: ValidationIssue[] }
  | { ok: false; code: 'not_found'; message: string }
  | { ok: false; code: 'unauthorized'; message: string }
  | { ok: false; code: 'conflict'; message: string; currentVersion: number }
  | { ok: false; code: 'too_large'; message: string }
  | { ok: false; code: 'rate_limited'; message: string; retryAfterSeconds: number }

export interface WriteSuccess {
  ok: true
  chart: Chart
  layout: ArrangeResult['layout']
  direction: LayoutDirection
  summary: string[]
}

export interface CreateSuccess extends WriteSuccess {
  editToken: string
}

export interface CreateInput {
  title: string
  nodes: NodeInput[]
  edges?: EdgeInput[]
  direction?: LayoutDirection
  source: UpdateSource
  /** Charges for expensive layouts and storage growth (rate limits and budgets). */
  quota?: WriteQuota
}

export interface ReplaceInput {
  title?: string
  nodes: NodeInput[]
  edges?: EdgeInput[]
  expectedVersion?: number
  direction?: LayoutDirection
  relayout?: boolean
  source: UpdateSource
  quota?: WriteQuota
}

export interface OperationsInput {
  operations: Operation[]
  title?: string
  expectedVersion?: number
  direction?: LayoutDirection
  relayout?: boolean
  source: UpdateSource
  quota?: WriteQuota
}

export interface FlowServiceOptions {
  store: FlowStore
  now?: () => Date
  generateId?: () => string
  generateToken?: () => string
  resolveIcon?: IconResolver
}

export const defaultIconResolver: IconResolver = (ref, options) => {
  const resolved = resolveIconRef(ref, options)
  return { id: resolved.icon?.id, suggestions: resolved.suggestions.map((s) => ({ id: s.id, name: s.name })) }
}

const notFound = (id: string): ServiceError => ({
  ok: false,
  code: 'not_found',
  message: `No flowchart with id ${JSON.stringify(id)}. Chart ids are 10 letters and digits, as in https://flowchart.zeroclickdev.ai/f/<id>.`,
})

const unauthorized: ServiceError = {
  ok: false,
  code: 'unauthorized',
  message:
    'The edit token is missing or does not match this chart. Open the private browser edit link for this chart.',
}

function conflict(expected: number, current: number): ServiceError {
  return {
    ok: false,
    code: 'conflict',
    currentVersion: current,
    message: `Version conflict: the chart is at version ${current}, not ${expected}. Someone (probably the user, in the browser) changed it since.`,
  }
}

function chartBytes(chart: Chart): number {
  return Buffer.byteLength(JSON.stringify(chart), 'utf8')
}

function sizeError(bytes: number): ServiceError | null {
  if (bytes <= LIMITS.maxChartBytes) return null
  return {
    ok: false,
    code: 'too_large',
    message: `The chart would be ${Math.round(bytes / 1024)} KB; the limit is ${Math.round(LIMITS.maxChartBytes / 1024)} KB. Shorten labels, remove nodes, or avoid embedded (data:) images.`,
  }
}

function validationError(validated: { issues: ValidationIssue[]; issueCount?: number }): ServiceError {
  const count = validated.issueCount ?? validated.issues.length
  return {
    ok: false,
    code: 'validation',
    issues: validated.issues,
    message: `The chart has ${count} problem${count === 1 ? '' : 's'}.`,
  }
}

/** Runs a quota charge; returns the error to send when it's refused. */
async function charge(
  run: ((amount: number) => Promise<QuotaDecision>) | undefined,
  amount: number,
): Promise<ServiceError | null> {
  if (!run || amount <= 0) return null
  const decision = await run(amount)
  return decision.allowed
    ? null
    : { ok: false, code: 'rate_limited', message: decision.message, retryAfterSeconds: decision.retryAfterSeconds }
}

export class FlowService {
  private readonly store: FlowStore
  private readonly now: () => Date
  private readonly generateId: () => string
  private readonly generateToken: () => string
  private readonly resolveIcon: IconResolver

  constructor(options: FlowServiceOptions) {
    this.store = options.store
    this.now = options.now ?? (() => new Date())
    this.generateId = options.generateId ?? generateChartId
    this.generateToken = options.generateToken ?? generateEditToken
    this.resolveIcon = options.resolveIcon ?? defaultIconResolver
  }

  get storeDescription(): string {
    return this.store.description
  }

  async create(input: CreateInput): Promise<CreateSuccess | ServiceError> {
    const validated = validateChart(input.nodes.map(nodeFromInput), (input.edges ?? []).map(edgeFromInput), {
      resolveIcon: this.resolveIcon,
    })
    if (validated.issues.length) return validationError(validated)

    const charges = new Charges(input.quota)
    const denied = await charges.work(validated.nodes, validated.edges, {})
    if (denied) return denied
    const arranged = await arrangeChart(validated.nodes, validated.edges, { direction: input.direction })
    const timestamp = this.now().toISOString()
    const editToken = this.generateToken()
    const base: Omit<Chart, 'id'> = {
      version: 1,
      title: input.title,
      nodes: arranged.nodes,
      edges: arranged.edges,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedVia: input.source,
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const chart: Chart = { id: this.generateId(), ...base }
      const bytes = chartBytes(chart)
      const refused = sizeError(bytes) ?? (await charges.growth(bytes))
      if (refused) return refused
      if (await this.store.create({ chart, tokenHash: hashToken(editToken) })) {
        return {
          ok: true,
          chart,
          editToken,
          layout: arranged.layout,
          direction: arranged.direction,
          summary: [`created ${chart.nodes.length} nodes and ${chart.edges.length} edges`],
        }
      }
    }
    throw new Error('Could not allocate a unique chart id')
  }

  async get(id: string): Promise<Chart | null> {
    if (!isValidChartId(id)) return null
    return (await this.store.get(id))?.chart ?? null
  }

  async getVersion(id: string): Promise<number | null> {
    if (!isValidChartId(id)) return null
    return this.store.getVersion(id)
  }

  /** Replace the whole document (the browser's autosave, update_flowchart with `replace`). */
  async replace(id: string, token: string | undefined, input: ReplaceInput): Promise<WriteSuccess | ServiceError> {
    if (!isValidChartId(id)) return notFound(id)
    const record = await this.store.get(id)
    if (!record) return notFound(id)
    if (!verifyToken(token, record.tokenHash)) return unauthorized
    if (input.expectedVersion !== undefined && input.expectedVersion !== record.chart.version) {
      return conflict(input.expectedVersion, record.chart.version)
    }

    const validated = validateChart(input.nodes.map(nodeFromInput), (input.edges ?? []).map(edgeFromInput), {
      resolveIcon: this.resolveIcon,
    })
    if (validated.issues.length) return validationError(validated)

    const charges = new Charges(input.quota)
    const denied = await charges.work(validated.nodes, validated.edges, input)
    if (denied) return denied
    const arranged = await arrangeChart(validated.nodes, validated.edges, {
      direction: input.direction,
      relayout: input.relayout,
    })
    const result = await this.write(record, arranged, input.title, input.source, charges)
    if (!result.ok) return result
    return { ...result, summary: [`replaced the chart (${arranged.nodes.length} nodes, ${arranged.edges.length} edges)`] }
  }

  async delete(id: string, token: string | undefined): Promise<{ ok: true } | ServiceError> {
    if (!isValidChartId(id)) return notFound(id)
    if (!token) return unauthorized
    const result = await this.store.delete(id, hashToken(token))
    return result === 'deleted' ? { ok: true } : result === 'unauthorized' ? unauthorized : notFound(id)
  }

  /** Apply incremental operations (update_flowchart with `operations`, PATCH). */
  async applyOperations(id: string, token: string | undefined, input: OperationsInput): Promise<WriteSuccess | ServiceError> {
    if (!isValidChartId(id)) return notFound(id)
    const charges = new Charges(input.quota)

    // Operations are relative, so when no version was pinned a concurrent
    // write is handled by re-applying them on top of the newer version.
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = await this.store.get(id)
      if (!record) return notFound(id)
      if (!verifyToken(token, record.tokenHash)) return unauthorized
      if (input.expectedVersion !== undefined && input.expectedVersion !== record.chart.version) {
        return conflict(input.expectedVersion, record.chart.version)
      }

      const patched = applyOperations(record.chart.nodes, record.chart.edges, input.operations)
      if (!patched.ok) return validationError(patched)
      const validated = validateChart(patched.nodes, patched.edges, { resolveIcon: this.resolveIcon, refStyle: 'id' })
      if (validated.issues.length) return validationError(validated)

      const denied = await charges.work(validated.nodes, validated.edges, input)
      if (denied) return denied
      const arranged = await arrangeChart(validated.nodes, validated.edges, {
        direction: input.direction,
        relayout: input.relayout,
      })
      const result = await this.write(record, arranged, input.title, input.source, charges)
      if (result.ok) {
        const summary = [...patched.summary]
        if (input.title && input.title !== record.chart.title) summary.push(`renamed to ${JSON.stringify(input.title)}`)
        if (arranged.layout === 'full') summary.push('re-laid out the whole chart')
        return { ...result, summary }
      }
      if (result.code !== 'conflict' || input.expectedVersion !== undefined) return result
    }
    return {
      ok: false,
      code: 'conflict',
      currentVersion: (await this.store.getVersion(id)) ?? 0,
      message: 'The chart is being changed by someone else right now. Load the latest version and try again.',
    }
  }

  private async write(
    record: StoredRecord,
    arranged: { nodes: ChartNode[]; edges: ChartEdge[]; layout: ArrangeResult['layout']; direction: LayoutDirection },
    title: string | undefined,
    source: UpdateSource,
    charges: Charges,
  ): Promise<Omit<WriteSuccess, 'summary'> | ServiceError> {
    const current = record.chart
    const next: Chart = {
      ...current,
      title: title ?? current.title,
      nodes: arranged.nodes,
      edges: arranged.edges,
      version: current.version + 1,
      updatedAt: this.now().toISOString(),
      updatedVia: source,
    }
    const bytes = chartBytes(next)
    const refused =
      sizeError(bytes) ?? (await charges.growth(bytes - (record.bytes ?? chartBytes(current)), FREE_GROWTH_BYTES))
    if (refused) return refused
    const stored = await this.store.update(current.id, current.version, next)
    if (!stored.ok) {
      return stored.reason === 'conflict' ? conflict(current.version, stored.currentVersion) : notFound(current.id)
    }
    return { ok: true, chart: next, layout: arranged.layout, direction: arranged.direction }
  }
}

/**
 * Growth per update below this isn't charged to the storage budget, so ordinary
 * edits (moving or relabeling nodes) don't cost an extra Redis call. It stays
 * bounded: every update is charged to the write budget.
 */
const FREE_GROWTH_BYTES = 256

/**
 * Quota charges for one create or update. The request already paid one work
 * unit when it arrived; retries after a conflict aren't charged twice.
 */
class Charges {
  private workPaid = 1
  private growthPaid = 0

  constructor(private readonly quota: WriteQuota | undefined) {}

  work(nodes: DraftNode[], edges: ChartEdge[], options: { relayout?: boolean }): Promise<ServiceError | null> {
    const units = layoutWorkUnits(planLayout(nodes, options), nodes.length, edges.length)
    const extra = units - this.workPaid
    if (extra <= 0) return Promise.resolve(null)
    this.workPaid = units
    return charge(this.quota?.work, extra)
  }

  growth(bytes: number, free = 0): Promise<ServiceError | null> {
    const extra = bytes - this.growthPaid
    if (bytes <= free || extra <= 0) return Promise.resolve(null)
    this.growthPaid = bytes
    return charge(this.quota?.growth, extra)
  }
}

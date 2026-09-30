#!/usr/bin/env node
// One-off helper: picks the Azure icons for the montage's icon wall and writes
// src/data/rain-icons.json. Famous services first, then a seeded spread across categories
// ("general" and "menu" are mostly generic glyphs, so they are skipped).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const index = JSON.parse(readFileSync(join(ROOT, 'public', 'icons', 'index.json'), 'utf8'))
const ids = new Set(index.map((i) => i.id))

const famous = [
  'app-services', 'function-apps', 'azure-cosmos-db', 'kubernetes-services', 'virtual-machine', 'sql-database',
  'cache-redis', 'application-insights', 'api-management-services', 'logic-apps', 'event-hubs', 'azure-service-bus',
  'container-instances', 'container-registries', 'storage-accounts', 'key-vaults', 'microsoft-entra-id', 'front-door-and-cdn-profiles',
  'load-balancers', 'application-gateways', 'virtual-networks', 'azure-openai', 'machine-learning', 'cognitive-services',
  'azure-communication-services', 'static-apps', 'azure-databricks', 'azure-synapse-analytics', 'data-factories', 'stream-analytics-jobs',
  'iot-hub', 'azure-devops', 'monitor', 'log-analytics-workspaces', 'dns-zones', 'firewalls', 'azure-sql', 'azure-database-postgresql-server',
  'azure-database-mysql-server', 'signalr', 'notification-hubs', 'event-grid-topics', 'batch-accounts', 'azure-spring-apps',
  'container-apps-environments', 'app-configuration', 'managed-identities', 'bastions', 'traffic-manager-profiles', 'expressroute-circuits',
]
const picked = famous.filter((id) => ids.has(id))

let seed = 42
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const pool = index
  .filter((i) => !['general', 'menu', 'intune', 'azure stack'].includes(i.category) && !picked.includes(i.id))
  .map((i) => ({ id: i.id, r: rand() }))
  .sort((a, b) => a.r - b.r)
for (const { id } of pool) {
  if (picked.length >= 160) break
  picked.push(id)
}
writeFileSync(join(ROOT, 'src', 'data', 'rain-icons.json'), JSON.stringify(picked, null, 0))
console.log(`[rain-icons] ${picked.length} icons (${famous.filter((id) => ids.has(id)).length} famous)`)

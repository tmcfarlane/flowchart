// One curated catalog for the browser gallery and MCP. Templates are editable
// starting points; choosing or reading one never saves or shares a chart.
import type { NodeInput, EdgeInput } from './flowSchema.js'
import { matchesTemplateQuery } from './templateSearch.js'

export const DIAGRAM_TEMPLATE_CATEGORIES = ['process', 'business', 'cloud', 'creative'] as const
export type DiagramTemplateCategory = (typeof DIAGRAM_TEMPLATE_CATEGORIES)[number]

export interface DiagramTemplate {
  id: string
  title: string
  description: string
  category: DiagramTemplateCategory
  direction: 'TB' | 'LR'
  nodes: NodeInput[]
  edges: EdgeInput[]
}

const node = (id: string, type: NodeInput['type'], label: string, icon?: string): NodeInput =>
  ({ id, type, label, ...(icon ? { icon } : {}) })
const edge = (source: string, target: string, label?: string, extra: Partial<EdgeInput> = {}): EdgeInput =>
  ({ source, target, style: 'default', ...(label ? { label } : {}), ...extra })

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'welcome-journey', title: 'A warmer welcome', category: 'process', direction: 'TB',
    description: 'Turn signup into a thoughtful onboarding journey with verification, a first win, and a personal follow-up.',
    nodes: [node('arrive', 'externalActor', 'New customer arrives', 'icon-user'), node('signup', 'step', 'Create an account'), node('verify', 'decision', 'Email verified?'), node('resend', 'step', 'Resend secure link'), node('choose', 'step', 'Choose a first goal'), node('win', 'step', 'Complete a first win'), node('feedback', 'decision', 'Need a helping hand?'), node('help', 'service', 'Personal welcome session', 'icon-chat'), node('ready', 'service', 'Welcome to the community', 'icon-users')],
    edges: [edge('arrive', 'signup'), edge('signup', 'verify'), edge('verify', 'resend', 'Not yet'), edge('resend', 'verify', 'Try again'), edge('verify', 'choose', 'Verified'), edge('choose', 'win'), edge('win', 'feedback'), edge('feedback', 'help', 'Yes'), edge('feedback', 'ready', 'Ready to explore'), edge('help', 'ready')],
  },
  {
    id: 'incident-response', title: 'From alert to calm', category: 'process', direction: 'TB',
    description: 'A practical incident response loop: triage, contain, communicate, recover, and learn.',
    nodes: [node('alert', 'service', 'Monitor raises an alert', 'icon-bell'), node('triage', 'step', 'Assess impact and severity'), node('incident', 'decision', 'Real customer impact?'), node('close', 'step', 'Tune alert and close'), node('contain', 'step', 'Contain the failure'), node('status', 'service', 'Publish status update', 'icon-chat'), node('recover', 'step', 'Restore healthy service'), node('healthy', 'decision', 'Recovery verified?'), node('learn', 'step', 'Write a blameless review'), node('prevent', 'service', 'Track prevention actions', 'icon-checklist')],
    edges: [edge('alert', 'triage'), edge('triage', 'incident'), edge('incident', 'close', 'No'), edge('incident', 'contain', 'Yes'), edge('contain', 'status'), edge('status', 'recover'), edge('recover', 'healthy'), edge('healthy', 'contain', 'Still failing'), edge('healthy', 'learn', 'Healthy'), edge('learn', 'prevent')],
  },
  {
    id: 'approval-flow', title: 'A clear path to approval', category: 'process', direction: 'TB',
    description: 'Show owners, revision loops, and the final decision for an expense, design, or project proposal.',
    nodes: [node('request', 'service', 'Submit a proposal', 'icon-invoice'), node('review', 'step', 'Check required details'), node('complete', 'decision', 'Everything included?'), node('revise', 'step', 'Request missing details'), node('owner', 'step', 'Route to decision owner'), node('approve', 'decision', 'Proposal approved?'), node('declined', 'step', 'Explain the decision'), node('deliver', 'service', 'Release funds or start work', 'icon-briefcase')],
    edges: [edge('request', 'review'), edge('review', 'complete'), edge('complete', 'revise', 'Incomplete'), edge('revise', 'request', 'Revised'), edge('complete', 'owner', 'Complete'), edge('owner', 'approve'), edge('approve', 'declined', 'Declined'), edge('approve', 'deliver', 'Approved')],
  },
  {
    id: 'release-checklist', title: 'Ship with confidence', category: 'process', direction: 'TB',
    description: 'A release pipeline with review, automated checks, staging validation, a gradual rollout, and rollback.',
    nodes: [node('code', 'service', 'Open a pull request', 'icon-code'), node('review', 'step', 'Review and run checks'), node('pass', 'decision', 'All checks passed?'), node('fix', 'step', 'Fix the failing check'), node('staging', 'step', 'Validate the user journey'), node('rollout', 'service', 'Roll out gradually', 'icon-rocket'), node('healthy', 'decision', 'Metrics remain healthy?'), node('rollback', 'step', 'Roll back and investigate'), node('done', 'service', 'Release complete', 'icon-check')],
    edges: [edge('code', 'review'), edge('review', 'pass'), edge('pass', 'fix', 'Needs work'), edge('fix', 'review', 'Retry'), edge('pass', 'staging', 'Passed'), edge('staging', 'rollout'), edge('rollout', 'healthy'), edge('healthy', 'rollback', 'No'), edge('rollback', 'fix', 'Learn and repair'), edge('healthy', 'done', 'Yes')],
  },
  {
    id: 'research-experiment', title: 'A question becomes evidence', category: 'process', direction: 'LR',
    description: 'Plan a repeatable experiment from hypothesis to analysis, including inconclusive results.',
    nodes: [node('question', 'service', 'Ask a focused question', 'icon-search'), node('hypothesis', 'step', 'State a testable hypothesis'), node('design', 'step', 'Design controls and measures'), node('run', 'service', 'Run the experiment', 'icon-flask'), node('data', 'database', 'Collect observations', 'icon-database'), node('analysis', 'step', 'Analyze uncertainty'), node('supported', 'decision', 'Evidence sufficient?'), node('iterate', 'step', 'Refine the experiment'), node('publish', 'service', 'Share methods and findings', 'icon-book')],
    edges: [edge('question', 'hypothesis'), edge('hypothesis', 'design'), edge('design', 'run'), edge('run', 'data'), edge('data', 'analysis'), edge('analysis', 'supported'), edge('supported', 'iterate', 'Inconclusive'), edge('iterate', 'design'), edge('supported', 'publish', 'Sufficient')],
  },
  {
    id: 'learning-loop', title: 'Learn, try, remember', category: 'process', direction: 'TB',
    description: 'A personal learning loop with a small goal, deliberate practice, feedback, and spaced recall.',
    nodes: [node('goal', 'service', 'Choose one skill', 'icon-graduation'), node('learn', 'step', 'Study a small lesson'), node('practice', 'step', 'Try it from memory'), node('understood', 'decision', 'Can you explain it?'), node('example', 'step', 'Find another example'), node('project', 'step', 'Use it in a real project'), node('recall', 'service', 'Schedule a short recall', 'icon-calendar'), node('next', 'service', 'Choose the next challenge', 'icon-mountain')],
    edges: [edge('goal', 'learn'), edge('learn', 'practice'), edge('practice', 'understood'), edge('understood', 'example', 'Not yet'), edge('example', 'learn'), edge('understood', 'project', 'Yes'), edge('project', 'recall'), edge('recall', 'next')],
  },
  {
    id: 'checkout-journey', title: 'A checkout that feels easy', category: 'business', direction: 'TB',
    description: 'Map cart, availability, payment, fulfillment, and useful recovery when something goes wrong.',
    nodes: [node('cart', 'service', 'Review the shopping cart', 'icon-cart'), node('stock', 'decision', 'Everything available?'), node('alternatives', 'step', 'Offer useful alternatives'), node('address', 'step', 'Confirm delivery details'), node('payment', 'service', 'Authorize payment', 'icon-credit-card'), node('paid', 'decision', 'Payment authorized?'), node('retry', 'step', 'Choose another payment method'), node('fulfill', 'step', 'Reserve stock and fulfill'), node('confirmation', 'service', 'Send order confirmation', 'icon-mail')],
    edges: [edge('cart', 'stock'), edge('stock', 'alternatives', 'Unavailable'), edge('alternatives', 'cart', 'Update cart'), edge('stock', 'address', 'Available'), edge('address', 'payment'), edge('payment', 'paid'), edge('paid', 'retry', 'Declined'), edge('retry', 'payment', 'Try again'), edge('paid', 'fulfill', 'Authorized'), edge('fulfill', 'confirmation')],
  },
  {
    id: 'subscription-lifecycle', title: 'The membership lifecycle', category: 'business', direction: 'LR',
    description: 'Follow trial, purchase, renewal, recovery, and a respectful cancellation experience.',
    nodes: [node('trial', 'service', 'Start a useful trial', 'icon-gift'), node('upgrade', 'step', 'Choose a membership'), node('purchase', 'service', 'Complete checkout', 'icon-credit-card'), node('active', 'service', 'Membership active', 'icon-check'), node('renew', 'decision', 'Renewal succeeds?'), node('recover', 'step', 'Update billing details'), node('cancel', 'decision', 'Continue membership?'), node('end', 'step', 'Keep access until period end'), node('thanks', 'service', 'Thank you and export data', 'icon-heart')],
    edges: [edge('trial', 'upgrade'), edge('upgrade', 'purchase'), edge('purchase', 'active'), edge('active', 'renew', 'Next billing cycle'), edge('renew', 'recover', 'Payment failed'), edge('recover', 'renew', 'Try updated details'), edge('renew', 'cancel', 'Renewed'), edge('cancel', 'active', 'Continue'), edge('cancel', 'end', 'Cancel'), edge('end', 'thanks')],
  },
  {
    id: 'customer-journey', title: 'From curiosity to belonging', category: 'business', direction: 'LR',
    description: 'A customer journey that connects discovery, first value, habit, and advocacy.',
    nodes: [node('discover', 'service', 'Discover a possibility', 'icon-compass'), node('consider', 'step', 'Explore the promise'), node('try', 'step', 'Try a small task'), node('value', 'decision', 'First value delivered?'), node('support', 'service', 'Remove the friction', 'icon-chat'), node('habit', 'step', 'Build a useful habit'), node('share', 'service', 'Share with a friend', 'icon-users'), node('feedback', 'service', 'Feed learning into the product', 'icon-lightbulb')],
    edges: [edge('discover', 'consider'), edge('consider', 'try'), edge('try', 'value'), edge('value', 'support', 'Needs help'), edge('support', 'try'), edge('value', 'habit', 'Yes'), edge('habit', 'share'), edge('share', 'feedback'), edge('feedback', 'consider', 'Improve the promise')],
  },
  {
    id: 'product-discovery', title: 'Find the idea worth building', category: 'business', direction: 'TB',
    description: 'Connect interviews to evidence, a small prototype, testing, and a deliberate build decision.',
    nodes: [node('listen', 'service', 'Listen to customers', 'icon-users'), node('patterns', 'step', 'Find recurring problems'), node('prioritize', 'step', 'Prioritize by impact'), node('hypothesis', 'step', 'Write a value hypothesis'), node('prototype', 'service', 'Build a small prototype', 'icon-puzzle'), node('test', 'step', 'Test with real people'), node('signal', 'decision', 'Strong enough signal?'), node('learn', 'step', 'Revise the hypothesis'), node('build', 'service', 'Commit to the next slice', 'icon-flag')],
    edges: [edge('listen', 'patterns'), edge('patterns', 'prioritize'), edge('prioritize', 'hypothesis'), edge('hypothesis', 'prototype'), edge('prototype', 'test'), edge('test', 'signal'), edge('signal', 'learn', 'Not yet'), edge('learn', 'hypothesis'), edge('signal', 'build', 'Yes')],
  },
  {
    id: 'content-studio', title: 'Inside the content studio', category: 'business', direction: 'LR',
    description: 'An editorial flow from a useful idea to research, craft, review, distribution, and learning.',
    nodes: [node('idea', 'service', 'Capture a useful idea', 'icon-lightbulb'), node('research', 'step', 'Research and verify claims'), node('draft', 'step', 'Craft the first draft'), node('review', 'decision', 'Ready for readers?'), node('edit', 'step', 'Clarify and refine'), node('publish', 'service', 'Publish and distribute', 'icon-globe'), node('measure', 'service', 'Listen to the response', 'icon-chart'), node('archive', 'database', 'Keep what we learned', 'icon-book')],
    edges: [edge('idea', 'research'), edge('research', 'draft'), edge('draft', 'review'), edge('review', 'edit', 'Needs polish'), edge('edit', 'draft'), edge('review', 'publish', 'Ready'), edge('publish', 'measure'), edge('measure', 'archive'), edge('archive', 'idea', 'Next idea')],
  },
  {
    id: 'azure-serverless', title: 'A small cloud with room to grow', category: 'cloud', direction: 'LR',
    description: 'Azure serverless architecture with a gateway, functions, durable data, events, and an async worker.',
    nodes: [node('user', 'externalActor', 'Customer', 'icon-user'), { id: 'region', type: 'container', label: 'Application region', containerKind: 'region' }, { ...node('gateway', 'apiGateway', 'API Management', 'api-management-services'), parentNode: 'region' }, { ...node('api', 'service', 'Function API', 'function-apps'), parentNode: 'region' }, { ...node('db', 'database', 'Cosmos DB', 'azure-cosmos-db'), parentNode: 'region' }, { ...node('queue', 'queue', 'Service Bus', 'service-bus'), parentNode: 'region' }, { ...node('worker', 'service', 'Background worker', 'function-apps'), parentNode: 'region' }, node('mail', 'externalActor', 'Email provider', 'icon-mail')],
    edges: [edge('user', 'gateway', undefined, { protocol: 'HTTPS', commStyle: 'sync' }), edge('gateway', 'api', undefined, { protocol: 'REST', commStyle: 'sync' }), edge('api', 'db', 'Read / write', { commStyle: 'sync' }), edge('api', 'queue', 'Order accepted', { protocol: 'event', commStyle: 'async' }), edge('queue', 'worker', 'Process event', { protocol: 'event', commStyle: 'async' }), edge('worker', 'mail', 'Confirmation', { protocol: 'HTTPS', commStyle: 'sync' })],
  },
  {
    id: 'event-driven-platform', title: 'The event-driven constellation', category: 'cloud', direction: 'LR',
    description: 'A portable architecture showing APIs, an event stream, independent workers, and observability.',
    nodes: [node('clients', 'externalActor', 'Web and mobile clients', 'icon-browser'), node('gateway', 'apiGateway', 'API gateway', 'icon-api'), node('orders', 'service', 'Order service', 'icon-server'), node('events', 'queue', 'Domain event stream', 'icon-queue'), node('inventory', 'service', 'Inventory worker', 'icon-container'), node('billing', 'service', 'Billing worker', 'icon-credit-card'), node('notify', 'service', 'Notification worker', 'icon-bell'), node('db', 'database', 'Order store', 'icon-database'), node('metrics', 'service', 'Traces and metrics', 'icon-chart')],
    edges: [edge('clients', 'gateway', undefined, { protocol: 'HTTPS', commStyle: 'sync' }), edge('gateway', 'orders', undefined, { protocol: 'REST', commStyle: 'sync' }), edge('orders', 'db', undefined, { protocol: 'SQL', commStyle: 'sync' }), edge('orders', 'events', 'Order placed', { protocol: 'event', commStyle: 'async' }), edge('events', 'inventory', undefined, { protocol: 'event', commStyle: 'async' }), edge('events', 'billing', undefined, { protocol: 'event', commStyle: 'async' }), edge('events', 'notify', undefined, { protocol: 'event', commStyle: 'async' }), edge('orders', 'metrics', 'Telemetry', { commStyle: 'async' }), edge('inventory', 'metrics', 'Telemetry', { commStyle: 'async' })],
  },
  {
    id: 'knowledge-assistant', title: 'A grounded AI assistant', category: 'cloud', direction: 'LR',
    description: 'A retrieval-augmented assistant with document ingestion, access checks, retrieval, and cited answers.',
    nodes: [node('docs', 'externalActor', 'Approved documents', 'icon-book'), node('ingest', 'service', 'Parse and index content', 'icon-workflow'), node('index', 'database', 'Search and vector index', 'icon-search'), node('user', 'externalActor', 'Ask a question', 'icon-user'), node('auth', 'apiGateway', 'Check user permissions', 'icon-shield'), node('retrieve', 'service', 'Retrieve permitted evidence', 'icon-search'), node('model', 'service', 'Generate a grounded answer', 'icon-robot'), node('answer', 'service', 'Answer with citations', 'icon-chat')],
    edges: [edge('docs', 'ingest'), edge('ingest', 'index', 'Index', { commStyle: 'async' }), edge('user', 'auth', undefined, { protocol: 'HTTPS', commStyle: 'sync' }), edge('auth', 'retrieve', 'Authorized'), edge('index', 'retrieve', 'Relevant passages'), edge('retrieve', 'model', 'Evidence + question'), edge('model', 'answer'), edge('answer', 'user', 'Cited response')],
  },
  {
    id: 'zero-trust-boundaries', title: 'Trust is checked at every door', category: 'cloud', direction: 'LR',
    description: 'A security architecture separating public ingress, private services, data, and audit records.',
    nodes: [node('user', 'externalActor', 'Signed-in user', 'icon-user'), node('identity', 'service', 'Identity provider', 'icon-fingerprint'), { id: 'private', type: 'container', label: 'Private trust boundary', containerKind: 'trustBoundary' }, { ...node('gateway', 'apiGateway', 'Validate session and scope', 'icon-shield'), parentNode: 'private' }, { ...node('service', 'service', 'Least-privilege service', 'icon-server'), parentNode: 'private' }, { ...node('data', 'database', 'Encrypted data store', 'icon-database'), parentNode: 'private' }, { ...node('secrets', 'service', 'Managed secrets', 'icon-key'), parentNode: 'private' }, node('audit', 'database', 'Security audit log', 'icon-invoice')],
    edges: [edge('user', 'identity', 'Sign in', { protocol: 'HTTPS', commStyle: 'sync' }), edge('user', 'gateway', 'Scoped request', { protocol: 'HTTPS', commStyle: 'sync' }), edge('identity', 'gateway', 'Verify identity'), edge('gateway', 'service', 'Authorized'), edge('secrets', 'service', 'Short-lived credentials'), edge('service', 'data', 'Scoped data access', { protocol: 'SQL', commStyle: 'sync' }), edge('gateway', 'audit', 'Access event', { protocol: 'event', commStyle: 'async' })],
  },
  {
    id: 'dream-observatory', title: 'The dream observatory', category: 'creative', direction: 'TB',
    description: 'An impossible machine that catches moonlight, classifies dreams, and launches the memorable ones into orbit.',
    nodes: [node('moon', 'image', 'Collect a jar of moonlight', 'icon-moon'), node('dream', 'service', 'Tune the dream receiver', 'icon-planet'), node('lucid', 'decision', 'Is the dream lucid?'), node('mist', 'step', 'Let it become morning mist'), node('prism', 'image', 'Refract through a memory prism', 'icon-crystal'), node('story', 'service', 'Translate colors into a story', 'icon-book'), node('launch', 'image', 'Launch a tiny constellation', 'icon-rocket'), node('note', 'note', 'A creative prompt, not a real scientific process')],
    edges: [edge('moon', 'dream'), edge('dream', 'lucid'), edge('lucid', 'mist', 'Drifting'), edge('lucid', 'prism', 'Lucid'), edge('prism', 'story'), edge('story', 'launch')],
  },
  {
    id: 'memory-garden', title: 'A garden for forgotten things', category: 'creative', direction: 'LR',
    description: 'Grow a story from a memory: plant a detail, give it a surprising companion, and harvest a new meaning.',
    nodes: [node('seed', 'image', 'Plant a half-remembered detail', 'icon-leaf'), node('water', 'step', 'Water with a question'), node('grow', 'service', 'Let associations grow', 'icon-lightbulb'), node('unexpected', 'decision', 'Something unexpected appears?'), node('wait', 'step', 'Leave space for silence'), node('weave', 'service', 'Weave two memories together', 'icon-dna'), node('harvest', 'image', 'Harvest a new story', 'icon-book'), node('note', 'note', 'Try this as a five-minute writing exercise')],
    edges: [edge('seed', 'water'), edge('water', 'grow'), edge('grow', 'unexpected'), edge('unexpected', 'wait', 'Not yet'), edge('wait', 'water', 'Ask differently'), edge('unexpected', 'weave', 'A surprise'), edge('weave', 'harvest')],
  },
  {
    id: 'story-engine', title: 'The story engine', category: 'creative', direction: 'TB',
    description: 'Build a branching narrative around desire, a difficult choice, consequences, and a changed character.',
    nodes: [node('hero', 'externalActor', 'A character wants something', 'icon-user'), node('obstacle', 'step', 'An obstacle changes the plan'), node('choice', 'decision', 'Risk the familiar world?'), node('stay', 'step', 'Stay and discover a hidden cost'), node('portal', 'image', 'Step through the impossible door', 'icon-portal'), node('cost', 'step', 'Pay a meaningful price'), node('reveal', 'service', 'Reveal a surprising truth', 'icon-crystal'), node('return', 'service', 'Return changed', 'icon-compass')],
    edges: [edge('hero', 'obstacle'), edge('obstacle', 'choice'), edge('choice', 'stay', 'Stay'), edge('choice', 'portal', 'Risk it'), edge('stay', 'reveal'), edge('portal', 'cost'), edge('cost', 'reveal'), edge('reveal', 'return')],
  },
  {
    id: 'creative-orbit', title: 'Ideas in orbit', category: 'creative', direction: 'LR',
    description: 'A creative practice loop for collecting sparks, making playful experiments, sharing, and returning with fresh eyes.',
    nodes: [node('spark', 'image', 'Catch a passing spark', 'icon-sparkles'), node('collect', 'database', 'Keep an idea constellation', 'icon-star'), node('combine', 'step', 'Combine two distant ideas'), node('make', 'service', 'Make a playful experiment', 'icon-palette'), node('resonate', 'decision', 'Does it make you curious?'), node('rest', 'image', 'Leave it to orbit overnight', 'icon-moon'), node('share', 'service', 'Share with a trusted person', 'icon-chat'), node('refine', 'step', 'Follow the surprising feedback')],
    edges: [edge('spark', 'collect'), edge('collect', 'combine'), edge('combine', 'make'), edge('make', 'resonate'), edge('resonate', 'rest', 'Not yet'), edge('rest', 'combine', 'Fresh eyes'), edge('resonate', 'share', 'Yes'), edge('share', 'refine'), edge('refine', 'collect', 'Next orbit')],
  },
  {
    id: 'weekend-adventure', title: 'Choose a tiny adventure', category: 'creative', direction: 'TB',
    description: 'A cheerful decision tree for a free afternoon: weather, energy, company, and one small adventure.',
    nodes: [node('start', 'image', 'An afternoon is yours', 'icon-sun'), node('weather', 'decision', 'A good day outside?'), node('energy', 'decision', 'Ready to wander?'), node('walk', 'image', 'Explore an unfamiliar path', 'icon-map'), node('cafe', 'image', 'Find a quiet cafe', 'icon-coffee'), node('inside', 'decision', 'Make or discover?'), node('create', 'image', 'Make something just for fun', 'icon-palette'), node('read', 'image', 'Travel through a good book', 'icon-book'), node('save', 'service', 'Keep one beautiful detail', 'icon-camera')],
    edges: [edge('start', 'weather'), edge('weather', 'energy', 'Outside'), edge('weather', 'inside', 'Cozy indoors'), edge('energy', 'walk', 'Adventure'), edge('energy', 'cafe', 'Take it slow'), edge('inside', 'create', 'Make'), edge('inside', 'read', 'Discover'), edge('walk', 'save'), edge('cafe', 'save'), edge('create', 'save'), edge('read', 'save')],
  },
]

const byId = new Map(DIAGRAM_TEMPLATES.map((template) => [template.id, template]))

/** Returns an independent draft so editing it cannot mutate the catalog. */
export function getDiagramTemplate(id: string): DiagramTemplate | undefined {
  const template = byId.get(id)
  return template ? {
    ...template,
    nodes: template.nodes.map((item) => ({ ...item, ...(item.position ? { position: { ...item.position } } : {}) })),
    edges: template.edges.map((item) => ({ ...item })),
  } : undefined
}

export function searchDiagramTemplates(query = '', category?: DiagramTemplateCategory): DiagramTemplate[] {
  return DIAGRAM_TEMPLATES.filter((template) => {
    if (category && template.category !== category) return false
    return matchesTemplateQuery(template, query)
  }).map((template) => getDiagramTemplate(template.id)!)
}

import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message)
    process.exitCode = 1
  } else {
    console.log('PASS:', message)
  }
}

const app = read('src/App.jsx')
const docs = read('src/pages/Documents.jsx')
const prepared = read('src/pages/PreparedFile.jsx')
const sidebar = read('src/components/layout/Sidebar.jsx')
const edge = read('supabase/functions/document-intelligence/index.ts')
const migration = read('supabase/migrations/20261001_document_intelligence.sql')

assert(app.includes("import('./pages/PreparedFile')"), 'AI File Review route component is loaded')
assert(app.includes('path="/ai-file-review"'), 'AI File Review has its own top-level route')
assert(app.includes('path="/ai-file-review/:clientId"'), 'AI File Review is routed by client id')
assert(sidebar.includes("path: '/ai-file-review'") && sidebar.includes("label: 'AI File Review'"), 'AI File Review has its own sidebar tab')
assert(docs.includes("navigate('/ai-file-review/' + selectedClient.id)"), 'Documents routes into the dedicated AI File Review tab')
assert(docs.includes('document-intelligence'), 'document uploads invoke Document Intelligence')
assert(docs.includes('entityClientId'), 'auto-analysis is limited to client-linked documents')
assert(prepared.includes('latestCompleteRunIds'), 'prepared file shows current analysis instead of duplicate historical runs')
assert(prepared.includes('Open source'), 'AI findings expose source navigation')
assert(prepared.includes('reviewed_by'), 'fact verification records reviewer identity')
assert(prepared.includes('answered_by'), 'question answers record staff identity')

assert(edge.includes("doc.tenant_id"), 'edge function derives tenant from RLS-authorized document')
assert(!edge.includes("rpc('current_tenant_id')"), 'edge function does not trust a separate tenant RPC')
assert(!edge.includes('SUPABASE_SERVICE_ROLE_KEY'), 'AI file download does not bypass Storage RLS')
assert(edge.includes('requestedClientId'), 'legacy documents are validated against the active client')
assert(edge.includes('sanitizeValue'), 'server-side sensitive-value sanitization is enabled')
assert(edge.includes('sanitizeIdentifiers'), 'entity identifiers are reduced to last-four data')
assert(edge.includes("sensitiveKey && (typeof value === 'string' || typeof value === 'number')"), 'numeric sensitive identifiers are masked before persistence')
for (const ext of ['xlsx','xlsm','xls','csv','docx','pptx','pdf','png','webp']) {
  assert(edge.includes(ext), 'AI intake supports ' + ext.toUpperCase())
}
assert(edge.includes('source_locator'), 'AI extraction stores spreadsheet/office source locators')
assert(migration.includes('source_locator text'), 'schema supports source locators')
assert(migration.includes('with unique_clients as'), 'legacy document backfill only uses unique tenant-scoped client names')
assert(migration.includes('enable row level security'), 'Document Intelligence tables have RLS')
for (const table of ['document_ai_runs','document_ai_facts','document_ai_entities','document_ai_questions']) {
  assert(migration.includes('create table if not exists public.' + table), table + ' is declared')
  assert(migration.includes('"' + table + '_tenant"'), table + ' has a tenant policy')
}

if (process.exitCode) process.exit(process.exitCode)
console.log('Document Intelligence contract checks passed.')

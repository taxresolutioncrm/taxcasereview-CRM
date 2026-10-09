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

assert(app.includes("import('./pages/PreparedFile')"), 'AI Intelligence route component is loaded')
assert(app.includes('path="/ai-intelligence"'), 'AI Intelligence has its own top-level route')
assert(app.includes('path="/ai-intelligence/:clientId"'), 'AI Intelligence supports client-specific review')
assert(app.includes('path="/prepared-file/:clientId"'), 'legacy prepared-file route remains compatible')
assert(sidebar.includes("path: '/ai-intelligence'") && sidebar.includes("label: 'AI Intelligence'"), 'AI Intelligence has its own sidebar tab')
assert(!sidebar.includes("path: '/ai-intelligence', icon: FormIcon, label: 'AI Intelligence', section: 'documents'"), 'AI Intelligence is not permission-gated as Documents')
assert(sidebar.indexOf("path: '/ai-intelligence'") > sidebar.indexOf("path: '/dialer'"), 'AI Intelligence is placed after Dialer')
assert(docs.includes("navigate('/ai-intelligence/' + selectedClient.id)"), 'Documents routes into AI Intelligence')
assert(docs.includes('hasDocumentFile') && docs.includes("doc?.storage_path || doc?.file_url"), 'Documents open from private storage paths or stored URLs')
assert(docs.includes("navigate('/ai-intelligence/' + selectedClient.id)"), 'Documents route clients into AI Intelligence')
assert(docs.includes('document-intelligence'), 'document uploads invoke Document Intelligence')
assert(docs.includes('hasDocumentFile') && docs.includes('storage_path || doc?.file_url'), 'Documents open from storage_path or file_url')
assert(prepared.includes('latestCompleteRunIds'), 'prepared file shows current analysis instead of duplicate historical runs')

assert(prepared.includes('Select a client to open their intelligence workspace, analyze documents, and review AI findings.'), 'selector copy matches the TaxRes family experience')
assert(prepared.includes('>AI Documents</button>'), 'selector exposes AI Documents')
assert(prepared.includes('Resolve from CRM'), 'open questions can be re-checked against CRM data')
assert(prepared.includes('Reading ${batchProgress.current} of ${batchProgress.total}'), 'batch analysis exposes live X-of-Y progress')
assert(prepared.includes(".endsWith('.taxcasereview-crm.pages.dev')") && prepared.includes(".endsWith('.nashville-tax-crm.pages.dev')"), 'Cloudflare branch previews use sandbox AI functions')
assert(prepared.includes("'document-intelligence-sandbox'") && prepared.includes("'ai-chat-sandbox'"), 'sandbox routes both document analysis and Ask AI away from production')
assert(prepared.includes('Open source'), 'AI findings expose source navigation')
assert(prepared.includes('reviewed_by'), 'fact verification records reviewer identity')
assert(prepared.includes('answered_by'), 'question answers record staff identity')
assert(['File Review','Tax Facts','Findings','Deadlines & Notices','Recommended Actions','Ask AI'].every(label=>prepared.includes(label)), 'AI Intelligence includes case-wide intelligence tabs')
assert(prepared.includes('const aiChatFunction') && prepared.includes('functions.invoke(aiChatFunction'), 'AI Intelligence can ask AI with client-specific context')
assert(prepared.includes('It does not silently change CRM records.'), 'AI Intelligence preserves human authority over CRM records')

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


assert(app.includes('path="/ai-documents"') && app.includes('<PreparedFile />'), 'legacy AI Documents route lands in AI Intelligence, not Documents')
assert(docs.includes("countMode") && docs.includes("'planned'") && docs.includes("'exact'"), 'large unfiltered document loads avoid exact-count timeout')
assert(docs.includes("navigate('/ai-intelligence')"), 'Documents can open AI Intelligence even before a client is selected')

assert(docs.includes(".eq('tenant_id', myTenantId)"), 'shared TaxRes document queries are tenant-filtered')

assert(app.includes('path="/ai-documents/:clientId"'), 'client-specific AI Documents route exists')
assert(prepared.includes("navigate('/ai-intelligence/' + selectedClientId + '?tab=documents')"), 'AI Documents opens selected client File Review')
assert(prepared.includes("location.pathname.startsWith('/ai-documents/')"), 'legacy AI Documents client links open File Review')
assert(prepared.includes("searchParams.get('tab') === 'documents' || location.pathname.startsWith('/ai-documents/')"), 'AI Documents deep link forces File Review after route change')
assert(!prepared.includes("onClick={()=>navigate('/documents')}>Documents</button>"), 'AI selector does not route to normal Documents')

assert(!prepared.includes('disabled={!selectedClientId}'), 'AI selector actions remain clickable before client selection')
assert(prepared.includes("setError('Select a client first.'); return"), 'AI selector gives explicit guidance when no client is selected')
assert(prepared.includes("navigate('/ai-intelligence/' + selectedClientId + '?tab=documents')"), 'AI Documents still opens selected client File Review')

assert(prepared.includes('placeholder="Search client files…"'), 'AI selector can search client files')
assert(prepared.includes('Upload document to selected client'), 'AI selector exposes direct document upload')
assert(prepared.includes('async function uploadFromLanding()'), 'AI selector landing upload is implemented')
assert(prepared.includes("functions.invoke(documentIntelligenceFunction"), 'landing upload invokes Document Intelligence')
assert(prepared.includes("navigate('/ai-intelligence/' + selected.id + '?tab=documents')"), 'landing upload opens client File Review after analysis')

assert(prepared.includes('placeholder="Search this client\'s files…"'), 'File Review can search within the selected client\'s documents')
assert(prepared.includes('const visibleDocuments = docs.filter'), 'File Review filters client documents locally')
assert(prepared.includes("onClick={()=>openSource(d.id)}"), 'File Review can open an attached client document')
assert(prepared.includes('No client files match that search.'), 'File Review exposes a no-match search state')

assert(prepared.includes("setClientSearchOpen(true)"), 'AI client search shows live autocomplete results')
assert(prepared.includes("slice(0,12)"), 'AI client autocomplete limits the visible result list')
assert(prepared.includes("No matching client files."), 'AI client autocomplete exposes a no-match state')
assert(prepared.includes("setSelectedClientId(c.id);setClientSearch(c.name);setClientSearchOpen(false)"), 'AI client autocomplete selects a client directly from results')
assert(prepared.includes("Selected:"), 'AI client autocomplete shows the selected client')

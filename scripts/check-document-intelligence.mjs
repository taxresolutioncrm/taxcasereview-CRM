import fs from 'node:fs'

function read(path){return fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')}
function assert(ok,msg){if(!ok){console.error('FAIL:',msg);process.exitCode=1}else console.log('PASS:',msg)}

const app=read('src/App.jsx')
const docs=read('src/pages/Documents.jsx')
const prepared=read('src/pages/PreparedFile.jsx')
const helper=read('src/lib/documentIntelligenceInput.js')
const sidebar=read('src/components/layout/Sidebar.jsx')
const edge=read('supabase/functions/document-intelligence/index.ts')
const core=read('supabase/functions/tax-document-ai-core/index.ts')
const migration=read('supabase/migrations/20261001_document_intelligence.sql')

assert(app.includes("import('./pages/PreparedFile')"),'AI Intelligence route component is loaded')
assert(app.includes('path="/ai-intelligence"')&&app.includes('path="/ai-intelligence/:clientId"'),'AI Intelligence has standalone and client routes')
assert(sidebar.includes("path: '/ai-intelligence'")&&sidebar.includes("label: 'AI Intelligence'"),'AI Intelligence has its own sidebar tab')
assert(sidebar.indexOf("path: '/ai-intelligence'")>sidebar.indexOf("path: '/dialer'"),'AI Intelligence is placed after Dialer')
assert(!sidebar.includes("label: 'AI Intelligence', section: 'documents'"),'AI Intelligence is independent of Documents permission')

assert(docs.includes('prepareFileForDocumentAI'),'Documents prepares PDFs/images before AI invocation')
assert(docs.includes("functions.invoke('document-intelligence'"),'Documents uploads invoke document intelligence')
assert(docs.includes('clientId: entityClientId'),'Documents sends the selected client id to AI')
assert(docs.includes('hasDocumentFile')&&docs.includes('storage_path'),'Documents retains durable private-file opening')

assert(prepared.includes('Upload & Analyze')&&prepared.includes('Profit & Loss (P&L)'),'AI workspace supports direct upload and P&L analysis')
assert(prepared.includes('prepareStoredDocumentForAI'),'existing stored documents are prepared for AI before analysis')
assert(prepared.includes('prepareFileForDocumentAI'),'direct AI uploads prepare PDFs/images before analysis')
assert(prepared.includes('const readableDocs = docs.filter(hasReadableFile)'),'readiness is based on readable files, not placeholder records')
assert(prepared.includes('latestCompleteRunIds'),'current facts use latest successful runs')
assert(prepared.includes('Open source'),'AI findings expose source navigation')
assert(prepared.includes('reviewed_by')&&prepared.includes('answered_by'),'human review and question answers are auditable')
assert(['File Review','Tax Facts','Findings','Deadlines & Notices','Recommended Actions','Ask AI'].every(x=>prepared.includes(x)),'AI Intelligence includes the full case-wide workspace')
assert(prepared.includes('It does not silently change CRM records.'),'AI preserves human authority over CRM records')

assert(helper.includes("import('pdfjs-dist')"),'PDF text extraction uses PDF.js')
assert(helper.includes("page.render"),'scanned PDFs fall back to rendered page images')
assert(helper.includes("toDataURL('image/jpeg'"),'scanned-page images are encoded for multimodal analysis')
assert(helper.includes('prepareStoredDocumentForAI'),'stored documents can be securely prepared through signed URLs')

assert(edge.includes("SOURCE_PROJECT='mpxgxfqdbquzkrvvejkh'"),'TCR edge identifies its source project')
assert(edge.includes('AI_CORE_URL'),'document analysis routes through shared AI core')
assert(!edge.includes('ANTHROPIC_API_KEY')&&!edge.includes('GROQ_API_KEY'),'tenant edge does not own provider credentials')
assert(!edge.includes('SUPABASE_SERVICE_ROLE_KEY'),'document read/write stays caller-scoped')
assert(edge.includes("userClient.storage.from('documents').download"),'document download uses caller Storage RLS')
assert(edge.includes('providedText')&&edge.includes('providedImages'),'prepared PDF text/images are accepted by the edge')
assert(edge.includes('normalizeFact')&&edge.includes('normalizeEntity')&&edge.includes('normalizeQuestion'),'AI output is normalized before persistence')
assert(edge.includes('sanitizeValue')&&edge.includes('sanitizeIdentifiers'),'sensitive identifiers are sanitized before persistence')

assert(core.includes("MODEL='qwen/qwen3.8-27b'"),'shared AI core uses the validated multimodal model')
assert(core.includes('PROJECTS')&&core.includes('mpxgxfqdbquzkrvvejkh')&&core.includes('ydrvncdedgjtcprczwpu'),'shared AI core recognizes TCR and Nashville source projects')
assert(core.includes('caller.auth.getUser()'),'shared AI core validates the source-project user session')
assert(!core.includes('SUPABASE_SERVICE_ROLE_KEY'),'shared AI core does not bypass source-project authorization')
assert(core.includes("Deno.env.get('GROQ_API_KEY')"),'provider credential remains server-side in the shared core')
assert(core.includes("response_format:{type:'json_object'}"),'shared AI core requests structured JSON')
assert(core.includes('Profit & Loss / P&L'),'shared AI core has dedicated P&L extraction rules')
assert(core.includes('Image source page'),'scanned-image page provenance is preserved')

assert(migration.includes('enable row level security'),'Document Intelligence tables have RLS')
for(const table of ['document_ai_runs','document_ai_facts','document_ai_entities','document_ai_questions']){
  assert(migration.includes('create table if not exists public.'+table),table+' is declared')
  assert(migration.includes('"'+table+'_tenant"'),table+' has a tenant policy')
}

if(process.exitCode)process.exit(process.exitCode)
console.log('Document Intelligence contract checks passed.')

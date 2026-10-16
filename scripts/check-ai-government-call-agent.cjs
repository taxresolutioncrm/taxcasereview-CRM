const fs=require('fs')

const read=p=>fs.readFileSync(p,'utf8')
const recipes=read('src/lib/governmentCallRecipes.js')
const modal=read('src/components/calling/AIGovernmentCallModal.jsx')
const dashboard=read('src/pages/AIGovernmentCalls.jsx')
const notifier=read('src/components/calling/AIGovernmentCallNotifier.jsx')
const calls=read('src/context/CallContext.jsx')
const clients=read('src/pages/Clients.jsx')
const cases=read('src/pages/Cases.jsx')
const dialer=read('src/pages/Dialer.jsx')
const app=read('src/App.jsx')
const sidebar=read('src/components/layout/Sidebar.jsx')
const migration=read('supabase/migrations/20261016134500_ai_government_call_agent.sql')
const start=read('supabase/functions/ai-government-call-start/index.ts')
const leg=read('supabase/functions/ai-government-call-leg/index.ts')
const status=read('supabase/functions/ai-government-call-status/index.ts')
const cancel=read('supabase/functions/ai-government-call-cancel/index.ts')
const receive=read('supabase/functions/receive-call/index.ts')
const config=read('supabase/config.toml')

const checks=[
  ['purpose-first launcher exists',recipes.includes("'irs-investigation'")&&recipes.includes("'irs-acs-business'")&&recipes.includes("'irs-payment-plan'")&&recipes.includes("'state-custom'")],
  ['known IRS practitioner number seeded',recipes.includes("phone: '8668604259'")],
  ['ACS route is 1 English -> 2 practitioner -> 3 business -> 4 ACS',recipes.includes("intent: 'English', digit: '1'")&&recipes.includes("intent: 'Tax practitioner / tax professional line', digit: '2'")&&recipes.includes("intent: 'Business taxpayer', digit: '3'")&&recipes.includes("intent: 'ACS / collections', digit: '4'")],
  ['launcher sends objective and hints to server',modal.includes("'ai-government-call-start'")&&modal.includes('route_hints: purpose.routeHints')&&modal.includes('objective: objective.trim()')],
  ['launcher lets staff choose the takeover employee',modal.includes('Takeover Employee')&&modal.includes('assigned_to_email: assignedToEmail || null')],
  ['server validates assigned takeover employee',start.includes("requestedAssignee=String(body.assigned_to_email||user.email)")&&start.includes("Takeover employee must be an active staff member with communications access")&&start.includes("assigned_to_email:String(assignee.email).toLowerCase()")],
  ['government calls prefer the dedicated direct-return caller ID',start.includes("const from=norm(settings.sw_outbound_did||settings.sw_inbound_did)")&&start.includes('Government calls intentionally present the local direct-return DID first.')],
  ['schema is tenant scoped and realtime enabled',migration.includes('tenant_id uuid not null references tenants')&&migration.includes('client_id text references clients(id)')&&migration.includes('case_id text references cases(id)')&&migration.includes('tenant_id=current_tenant_id()')&&migration.includes('supabase_realtime add table ai_government_call_sessions')],
  ['session stores durable conference and human handoff state',migration.includes('conference_name text')&&migration.includes("'human_detected'")&&migration.includes("'human_joined'")],
  ['server starts SignalWire call and durable outbound row',start.includes("entity_type:'ai-government'")&&start.includes('/Calls.json')&&start.includes('ai-government-call-leg?session=')&&start.includes('ai-government-call-status?session=')],
  ['IVR controller listens before acting',leg.includes('<Gather input="speech"')&&leg.includes("choice.action==='press'")&&leg.includes("confidence<.82")],
  ['agent cannot authenticate or conduct taxpayer discussion',leg.includes('You NEVER discuss taxpayer facts, authenticate a taxpayer, claim to be the practitioner, or speak substantively to a live representative.')],
  ['live-human threshold and handoff conference exist',leg.includes("action==='human'")&&leg.includes("confidence<.9")&&leg.includes("status='human_detected'")&&leg.includes('connect you to the tax professional')],
  ['takeover session is claimed before browser self dial',calls.includes("status:'takeover_requested'")&&calls.includes('joinAIGovernmentCall')],
  ['completion event remains tenant scoped',calls.includes('activeAIGovTenantRef')&&calls.includes('tenant_id: aiGovTenantId')],
  ['verified phone callback prioritizes requested AI conference',receive.includes("from('ai_government_call_sessions')")&&receive.includes(".eq('status','takeover_requested')")&&receive.includes('aiTakeover.conference_name')],
  ['shared SignalWire phone account can hand off cross-tenant session',receive.includes("select('id,tenant_id,conference_name,outbound_call_id')")&&receive.includes(".eq('tenant_id',aiTakeover.tenant_id)")],
  ['dashboard exposes takeover and cancel controls',dashboard.includes('TAKE OVER NOW')&&dashboard.includes("'ai-government-call-cancel'")],
  ['global assigned-staff alert exists',notifier.includes('Government Representative Connected')&&notifier.includes('assigned_to_email')&&notifier.includes('playSound')],
  ['client record has AI Call trigger',clients.includes('AIGovernmentCallModal')&&clients.includes('label="AI Call"')&&clients.includes('IRS / State Agent')],
  ['main Dialer exposes AI Government Call trigger',dialer.includes('AIGovernmentCallModal')&&dialer.includes('🤖 AI Government Call')&&dialer.includes("navigate('/ai-government-calls')")],
  ['Dialer AI trigger is family-shared not tenant hard-coded',!dialer.includes('TRC-004')&&!dialer.includes('Centurion Firm')&&!dialer.includes('TRC-003')],
  ['case record has AI Call trigger',cases.includes('AIGovernmentCallModal')&&cases.includes('🤖 AI Call')],
  ['app route and global notifier mounted',app.includes('AIGovernmentCallNotifier')&&app.includes('path="/ai-government-calls"')],
  ['sidebar navigation is under Communications',sidebar.includes("key: 'comms'")&&sidebar.indexOf("path: '/ai-government-calls'")>sidebar.indexOf("key: 'comms'")&&sidebar.indexOf("path: '/ai-government-calls'")<sidebar.indexOf("key: 'billing'")&&!sidebar.slice(sidebar.indexOf("key: 'irs'"),sidebar.indexOf("key: 'taxreturns'")).includes("path: '/ai-government-calls'")],
  ['provider callbacks use opaque session token',leg.includes(".eq('callback_token',token)")&&status.includes(".eq('callback_token',token)")],
  ['cancel is authenticated and tenant scoped',cancel.includes("rpc('current_tenant_id')")&&cancel.includes(".eq('tenant_id',tenant)")],
  ['cancel provider URL normalization is bundle-safe',cancel.includes("replace(/^https?:[/][/]/,'')")&&!cancel.includes("replace(/^https?:\\\\/\\\\//")],
  ['edge auth config is correct',config.includes('[functions.ai-government-call-start]\nverify_jwt = true')&&config.includes('[functions.ai-government-call-leg]\nverify_jwt = false')&&config.includes('[functions.ai-government-call-status]\nverify_jwt = false')&&config.includes('[functions.ai-government-call-cancel]\nverify_jwt = true')],
]

let failed=0
for(const [name,ok] of checks){
  console.log((ok?'PASS':'FAIL')+'  '+name)
  if(!ok)failed++
}
if(failed){
  console.error('AI Government Call Agent contract failed: '+failed+' check(s)')
  process.exit(1)
}
console.log('PASS  AI Government Call Agent source contract')

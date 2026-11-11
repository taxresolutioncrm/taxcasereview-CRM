import assert from 'node:assert/strict'
import fs from 'node:fs'
import {getRecentClients,rememberRecentClient,recentClientsKey,MAX_RECENT_CLIENTS} from '../src/lib/recentClients.js'

const store = new Map(),events=[]
globalThis.localStorage = {getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}
globalThis.CustomEvent = class {constructor(type,props){this.type=type;this.detail=props?.detail}}
globalThis.window = {dispatchEvent:event=>events.push(event)}
for(let n=1;n<=13;n++)rememberRecentClient('tenant-a','EMP@EXAMPLE.COM',{id:'c'+n,name:'Client '+n,clientNum:'T'+n})
assert.equal(MAX_RECENT_CLIENTS,10)
assert.deepEqual(getRecentClients('tenant-a','emp@example.com').map(x=>x.id),['c13','c12','c11','c10','c9','c8','c7','c6','c5','c4'])
rememberRecentClient('tenant-a','EMP@example.com',{id:'c5',name:'Client 5',clientNum:'T5'})
assert.equal(getRecentClients('tenant-a','emp@example.com')[0].id,'c5','Reopening moves client to the top')
rememberRecentClient('tenant-a','EMP@example.com',{id:'shared-1',name:'Shared Client',custnum:'000135'})
assert.equal(getRecentClients('tenant-a','emp@example.com')[0].number,'000135','Shared schema client number custnum must retain leading zeros')
assert.equal(getRecentClients('tenant-a','other@example.com').length,0,'Employees must not share local history')
assert.equal(getRecentClients('tenant-b','emp@example.com').length,0,'Tenants must not share local history')
assert.equal(recentClientsKey('tenant-a','EMP@EXAMPLE.COM'),recentClientsKey('tenant-a','emp@example.com'))
assert(events.length>=14,'Opened client event must notify sidebar immediately')

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8')
const clients=read('src/pages/Clients.jsx')
const sidebar=read('src/components/layout/Sidebar.jsx')
const employees=read('src/pages/Employees.jsx')
const context=read('src/context/AppContext.jsx')
const translations=read('src/lib/i18n.js')
const contacts=read('src/components/ClientIRSContacts.jsx')
const emailBlast=read('src/pages/EmailBlast.jsx')
const sendEmailFn=read('supabase/functions/send-email/index.ts')
const sql=read('supabase/migrations/20261109180500_shared_three_office_contacts_and_nested_folders.sql')
const lightPolish=read('src/taxres-light-polish.css')
assert(lightPolish.includes('Nashville v3.1.89 parity'),'Shared Nashville light-mode polish is missing')
for(const sel of [
  'html.light .nav-item.active',
  'html.light .nav-item:hover',
  'html.light .nav-badge',
  'html.light th',
  'html.light tbody tr:hover td',
  'html.light button:focus-visible',
  'html.light .field input',
  'html.light .search-input',
  'html.light [data-card-idx]',
  ':not(.danger):not(.success):not(.warning)',
]) assert(lightPolish.includes(sel),'Light mode regression: missing '+sel)
assert(!lightPolish.includes('html.dark'),'Nashville light-mode rules must not override dark mode')


/* v3.1.91 KPI font parity: only the theme-neutral baseline owns geometry.
   Reject light-specific dimensions / numeric truncation regressions. */
const kpiBaseline=read('src/taxres-dashboard.css')
const kpiOfficeCards=read('src/tax-office-dashboard-cards.css')
for(const required of [
  'font-size: clamp(22px, 1.75vw, 27px) !important',
  'font-size: clamp(17px, 4.7vw, 21px) !important',
  'font-variant-numeric: tabular-nums',
  'white-space: nowrap !important',
  'repeat(3, minmax(0,1fr))',
  '.tax-mobile-parity [data-card-idx].tax-kpi-wide'
]) assert(kpiBaseline.includes(required),'Missing shared KPI contract: '+required)
for(const block of lightPolish.matchAll(/html\\.light\\s+\\[data-card-idx\\][^{]*\\{([^}]*)\\}/g)) {
  assert(!/(?:font-size|font-weight|line-height|min-height|height|padding|letter-spacing|text-overflow|grid-template-columns)\\s*:/.test(block[1]),'Light mode may not change KPI card geometry or font sizing')
}
assert(!/font-size\\s*:\\s*clamp/.test(kpiOfficeCards),'Office appearance file must not override shared KPI font size')
assert(!/text-overflow\\s*:\\s*ellipsis/.test(kpiOfficeCards),'Office appearance file must not truncate values')
assert(kpiOfficeCards.includes('repeat(2, minmax(0, 1fr))'),'Shared tax offices must preserve two-across mobile grid')

const dashboardSource=read('src/pages/Dashboard.jsx')
assert(lightPolish.includes('Nashville v3.1.90 follow-up'),'Nashville 3.1.90 dashboard light-mode follow-up missing')
assert(dashboardSource.includes('tax-dashboard-theme-root'),'Shared dashboard theme scope class missing')
assert(dashboardSource.includes("className={String(val ?? '').length > 11 ? 'tax-kpi-wide' : undefined}"),'Long financial values must expand on small phones')
assert(dashboardSource.includes("title={String(val ?? '—')}"),'Financial amounts must remain retrievable in full')
assert(dashboardSource.includes("overflow: 'visible'"),'KPI amounts must not be clipped by inline styles')
for(const cls of [
 'tax-dashboard-timezones',
 'tax-dashboard-widget-title',
 'tax-dashboard-tas-skeleton',
 'tax-dashboard-tas-entry',
 'tax-dashboard-tas-text',
 'tax-dashboard-tas-link',
 'tax-dashboard-tip-panel',
 'tax-dashboard-tip-text',
]) {
  assert(dashboardSource.includes(cls),'Dashboard widget missing class '+cls)
  assert(lightPolish.includes('html.light .'+cls),'Light stylesheet missing widget rule '+cls)
}
assert(!dashboardSource.includes('onMouseEnter={e => e.currentTarget.style.background='),
  'Direct inline hover mutations would override the light-theme IRS widget')
for(const zone of ['Eastern','Central','Mountain','Pacific','Alaska','Hawaii']) {
  assert(dashboardSource.includes("label: '"+zone+"'"),'Clock zone lost: '+zone)
}
assert(dashboardSource.includes('setInterval(() => setTime(new Date()), 1000)'),'Live timezone clock update removed')
assert(dashboardSource.includes('tasFeeds.map((item, i)'),'Taxpayer Advocate feed integration removed')
assert(dashboardSource.includes('CRM_TIPS[tipIdx].tip'),'Rotating tip text removed')
assert(dashboardSource.includes('setTipIdx(i =>') && dashboardSource.includes('Previous CRM tip') && dashboardSource.includes('Next CRM tip'),'Accessible tip navigation missing')
assert(lightPolish.includes('html.light .tax-dashboard-tas-entry:hover'),'Article hover state missing')
assert(dashboardSource.includes('aria-label="CRM tip navigation"') && dashboardSource.includes('aria-label="Previous CRM tip"') && dashboardSource.includes('aria-label="Next CRM tip"'),'Accessible tip controls must replace obsolete dot indicator')


const formacorp=read('src/pages/FormaCorp.jsx')
assert(formacorp.includes("client_id:linkedClient.id"),'FormaCorp must save a stable CRM client ID')
assert(formacorp.includes("supabase.rpc('archive_shared_sunbiz_document'"),'Sunbiz PDF must atomically index both document views')
assert(!formacorp.includes("let indexed=false\n    try {\n      const {error:docError}=await supabase.from('documents').insert"),'Sunbiz importer must not use partial sequential inserts')
assert(formacorp.includes('if(caseSyncAllowed)'),'Sunbiz metadata import must synchronize existing and newly created business cases')
assert(formacorp.includes("await syncFormationBusiness(payload,linkedClient.id)"),'Formation saves must sync business information')
assert(formacorp.includes("eq('tenant_id',tenantId)"),'Formation client lookup must be tenant-scoped')
assert(formacorp.includes("eq('id',client.id).eq('tenant_id',client.tenant_id)"),'Business Info writes must be tenant and client scoped')
for(const key of ['business_name','businessType','ein','biz_street','biz_city','biz_state','biz_zip']) {
  assert(formacorp.includes('patch.'+key+'='),'Business info sync missing '+key)
}
assert(formacorp.includes('data.length !== 1'),'Unmatched and ambiguous client names must not silently link')

assert(clients.includes('rememberRecentClient(myTenantId, user.email, c)'),'Only actual client detail opens should record history')
assert(sidebar.includes('getRecentClients(activeTenantId, user?.email)'),'Sidebar must scope recent clients to employee and active tenant')
assert(sidebar.includes('Search recent clients') && sidebar.includes("'/clients/'+encodeURIComponent(client.id)"),'History must be searchable and clickable')
assert(sidebar.includes('No recently viewed clients'),'Nashville v3.1.87 empty-state label must remain exact')
for(const key of ['No recently viewed clients','Search recent clients…','Tax Preparer','Revenue Officer','New subfolder','Delete empty folder']) {
  assert(translations.includes("'"+key+"':"),'New feature needs a Spanish translation: '+key)
}
assert(clients.includes("id,name,custnum,status"),'Shared client listing must select actual custnum column')
assert(sidebar.includes("setMobileNavOpen(false)"),'Recent navigation must close mobile sidebar')
assert(clients.includes('ClientIRSContacts client={c} tenantId={myTenantId}'),'IRS contacts must be tenant-scoped on client overview')
assert(contacts.includes("'revenueOfficerContact'")&&contacts.includes("'taxpayerAdvocateContact'"),'Both contact sections required')
for(const field of ['name','department','manager','phone','fax','email','address','notes'])assert(contacts.includes("'"+field+"'"),'IRS contacts missing '+field)
assert(contacts.includes(".eq('tenant_id',tenantId).eq('id',client.id)"),'IRS contact save must bind client + tenant')
assert(employees.includes("'Tax Preparer':")&&context.includes("'Tax Preparer':"),'Tax Preparer missing in UI or auth')
assert(employees.includes("'Tax Advisor':")&&context.includes("'Tax Advisor':"),'Existing Tax Advisor role must remain')
assert(/'Tax Preparer':\s*\{[^}]*perm_billing:0[^}]*perm_hr:0, perm_settings:0/.test(employees),'Tax Preparer must have no billing, HR or settings')
assert(employees.includes('saveInFlightRef.current') && employees.includes('await load()') && employees.includes('Employee save failed: '),'Employee saves must be guarded and refresh')
assert(emailBlast.includes("const canSendBlast = can('edit','email')"),'Bulk email UI must require Communications Edit')
assert(emailBlast.includes("disabled={!canSendBlast||sending"),'Unauthorized staff must not submit blasts')
assert(sendEmailFn.includes("Number(employee?.perm_comms || 0) < 2"),'Send-email backend must independently deny staff without comms Edit')
assert(clients.includes("const folderLoadRequestRef = useRef(0)") && clients.includes("if (requestId !== folderLoadRequestRef.current) return"),'Stale folder requests must not leak records across clients')
assert(clients.includes('client_document_folder_id:form.folderId || null'),'Uploads must target exact folder IDs')
assert(clients.includes('addNestedFolders(item.id,depth+1)'),'Nested folders must support deeper levels')
assert(clients.includes('setCustomFolders([])') && clients.includes('setDocs([])'), 'Switching clients must clear prior client folder and document state')
assert(clients.includes('database record first') || clients.includes('database refuses an unauthorized deletion'),'Storage cleanup must never precede database authorization')
assert(clients.includes(".delete()\n      .eq('id',doc.id).eq('tenant_id',tenantId).eq('client_id',String(clientId))"),'Document deletion must confirm tenant and client ownership')
assert(clients.includes('deleteFolder(item)')&&clients.includes('renameFolder(item)'),'Folder maintenance controls required')
assert(sql.includes('ENABLE ROW LEVEL SECURITY') && sql.includes('current_employee_permission')&&sql.includes('current_tenant_id'),'Folder DB RLS must enforce tenant and permissions')
assert(sql.includes('validate_shared_document_folder')&&sql.includes('validate_shared_client_folder'),'Folder hierarchy + document ownership DB constraints required')
assert(sql.includes('SECURITY INVOKER')&&sql.includes('archive_shared_sunbiz_document'),'Atomic Sunbiz indexing must run as invoker under RLS')
assert(sql.includes('shared_sunbiz_document_hash_unique'),'Sunbiz imports must prevent duplicate document hashes')
assert(sql.includes('reject_nonempty_shared_folder_delete') && sql.includes('legacy documents'),'Folder deletion must fail with documents, children, or ambiguous legacy docs')
assert(sql.includes('shared_preparer_client_select_restrict') && sql.includes('shared_preparer_document_select_restrict'), 'Tax Preparer client/document row scoping must be enforced with restrictive RLS')
assert(sql.includes("e.access='Tax Preparer'") && sql.includes("e.tenant_id=public.current_tenant_id()"), 'Prep assignment checker must scope by authenticated office and role')
assert(sql.includes('"revenueOfficerContact" jsonb')&&sql.includes('"taxpayerAdvocateContact" jsonb'),'IRS contact schema columns missing')
assert(!sql.includes('CREATE POLICY shared_folders_read ON public.client_document_folders\n  FOR SELECT TO anon'),'Anonymous cannot view folders')
console.log('PASS: shared TaxRes/TCR/Centurion Recent Clients, Tax Preparer, IRS contacts, nested folder security, employee save safeguards')

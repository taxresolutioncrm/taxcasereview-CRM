import fs from 'node:fs'
import path from 'node:path'

const NASH='489ace07-1a6b-4864-833a-4f8420568b40'
const read=p=>fs.readFileSync(p,'utf8')
const need=(ok,msg)=>{if(!ok)throw new Error('NASHVILLE CENTRAL QUARANTINE FAIL: '+msg);console.log('PASS',msg)}

const app=read('src/App.jsx')
const dashboard=read('src/pages/Dashboard.jsx')
const settings=read('src/pages/Settings.jsx')
const email=read('src/pages/Email.jsx')
const esign=read('src/pages/Esign.jsx')
const migration=read('supabase/migrations/20261013004500_quarantine_legacy_nashville_central_runtime.sql')
const m365=read('supabase/functions/m365-sync/index.ts')
const qb=read('supabase/functions/quickbooks-oauth-start/index.ts')
const formaIntent=read('supabase/functions/formacorp-state-fee-intent/index.ts')
const formaConfirm=read('supabase/functions/formacorp-state-fee-confirm/index.ts')

need(app.includes('NashvilleCentralHostBoundary') && app.includes('https://nashville.taxrescrm.app/login?switch=1'),'central host retains redirect-only Nashville boundary')
for(const [name,src] of [['Dashboard',dashboard],['Settings',settings],['Email',email],['Esign',esign]]){
  need(!src.includes(NASH),name+' has no hardcoded Nashville tenant identifier')
}
need(migration.includes("status='cancelled'") && migration.includes("set status='Inactive'"),'legacy Nashville central tenant and employees are deactivated')
need(migration.includes('not public.central_nashville_quarantined(t.id)'),'current tenant resolution excludes Nashville')
need(migration.includes("raise exception 'Nashville is isolated in its dedicated CRM.'"),'admin tenant override rejects Nashville')
need(migration.includes('not public.central_nashville_quarantined(t.id)') && migration.includes('create or replace function public.list_tenants'),'central operational tenant list excludes Nashville')
for(const fn of ['booking_get_config','booking_get_public_meta','booking_get_slots','booking_create','kiosk_load_secure','kiosk_login','emp_login','emp_login_branding','portal_login','organizer_get','organizer_save_answers','organizer_submit','financial_intake_load','financial_intake_save','financial_intake_submit']){
  need(migration.includes('create or replace function public.'+fn),'public surface '+fn+' is wrapped by Nashville quarantine')
}
need(m365.includes('status: 410') && !m365.includes(NASH),'central M365 worker is retired and has no Nashville data path')
need(qb.includes("admin.rpc('central_nashville_quarantined'") && qb.includes("status || '').toLowerCase() !== 'active'") && qb.includes('Nashville QuickBooks is managed in the dedicated Nashville CRM.'),'central QuickBooks OAuth rejects stale Nashville employee context')
need(!formaIntent.includes(NASH) && !formaConfirm.includes(NASH),'central FormaCorp Stripe tenant set excludes Nashville')
need(!migration.includes('storage.objects') && !migration.includes('office_agreements') && !migration.includes('romylabs_office_signing_documents'),'quarantine preserves legal/control-plane storage history')

console.log('Nashville central quarantine contract: PASS')

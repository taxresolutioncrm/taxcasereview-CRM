const fs=require('fs')

const checks=[
  ['src/pages/Reports.jsx',[
    "const BOOK_WHIP_PAGE_SIZE = 100",
    "pagedBookWhip.map",
    "overflowX:'auto'",
    "minWidth:640",
  ]],
  ['src/pages/EmployeePortal.jsx',[
    "supabase.rpc('emp_login_auth')",
    "bootstrapAuthenticatedPortal",
  ]],
  ['supabase/functions/quickbooks-sync/index.ts',[
    "const isHistorical=",
    "reconnect_required",
    "skipped_historical_imports",
    "ensureCustomer",
  ]],
  ['supabase/functions/quickbooks-oauth-callback/index.ts',[
    ".eq('tenant_id',tenantId).eq('provider','quickbooks')",
    "company_id:realmId",
  ]],
  ['supabase/functions/quickbooks-oauth-start/index.ts',[
    "com.intuit.quickbooks.accounting",
    "const APP_URL = 'https://nashville.taxrescrm.app'",
    "${APP_URL}/auth/quickbooks-callback",
  ]],
  ['src/pages/Clients.jsx',[
    "q.eq('client_id', String(clientId))",
    "client_id: clientId ? String(clientId) : null",
    "storage_path: storagePath",
  ]],
  ['src/pages/Documents.jsx',[
    "clientFilter.startsWith('client:')",
    "client_id: entityClientId",
    "storage_path: storagePath",
  ]],
  ['supabase/migrations/20260919_nashville_document_client_identity.sql',[
    "sync_document_client_identity",
    "before insert or update of client_id, client, clientname, tenant_id",
  ]],
  ['src/pages/Dashboard.jsx',[
    "nashville_dashboard_snapshot",
    "NASHVILLE_TENANT_ID",
  ]],
  ['supabase/migrations/20260919_nashville_scale_100_users.sql',[
    "idx_employee_portal_sessions_tenant_employee_expires",
    "idx_time_entries_tenant_worker_started",
    "idx_billing_time_tenant_employee_date",
  ]],
  ['supabase/migrations/20260919_nashville_dashboard_snapshot_scale.sql',[
    "nashville_dashboard_snapshot",
    "Active Nashville employee required",
  ]],
  ['supabase/migrations/20260919_nashville_closeout.sql',[
    "dedupe_nashville_book_whip_month",
    "emp_login_auth",
    "accounting_connections_tenant_provider_uidx",
  ]],
]

let failed=false
for(const [file,tokens] of checks){
  const src=fs.readFileSync(file,'utf8')
  for(const token of tokens){
    if(!src.includes(token)){
      console.error(`Nashville closeout invariant missing in ${file}: ${token}`)
      failed=true
    }
  }
}
if(failed) process.exit(1)
console.log('✓ Nashville closeout invariants: Book Whip, QuickBooks, Employee Portal, Documents, 100-user scale')

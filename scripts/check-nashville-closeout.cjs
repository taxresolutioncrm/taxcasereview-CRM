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
    "DOC_PAGE_SIZE = 250",
    "select('*', { count:'exact' })",
    "docTotal > DOC_PAGE_SIZE",
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
  ['src/pages/TimeClock.jsx',[
    "timeclock_history_page",
    "HISTORY_PAGE_SIZE = 250",
    "supabase.from('timeentries').select('*').eq('date', todayKey)",
    "historyTotal > HISTORY_PAGE_SIZE",
  ]],
  ['src/pages/Payroll.jsx',[
    "payroll-timeentries-rt",
    ".gte('date', jan1)",
    ".limit(30000)",
    ".eq('status','Active')",
  ]],
  ['supabase/migrations/20260919_nashville_timeclock_scale.sql',[
    "timeclock_history_page",
    "idx_timeentries_tenant_employee_date_created",
  ]],
  ['supabase/migrations/20260919_nashville_internal_rpc_privileges.sql',[
    "revoke all on function public.create_book_whip_month(date) from public, anon",
    "revoke all on function public.get_sidebar_badge_counts() from public, anon",
    "revoke all on function public.reports_overview_snapshot(date) from public, anon",
  ]],
  ['src/pages/SignPage.jsx',[
    "signerToken",
    "action:'load'",
    "action:'sign'",
    "uploadToSignedUrl",
    "action:'finalize'",
  ]],
  ['src/pages/Esign.jsx',[
    "?token=${encodeURIComponent(token)}",
    "data.signer_token",
    "item.signer_token",
  ]],
  ['supabase/functions/esign-archive-upload/index.ts',[
    "action==='load'",
    "action==='sign'",
    "action==='prepare'",
    "action==='finalize'",
    "eq('signer_token',token)",
    "storage_path||a?.path",
  ]],
  ['supabase/migrations/20260919_nashville_esign_rpc_lockdown.sql',[
    "revoke all on function public.esign_public_load(text,text) from public, anon, authenticated",
    "revoke all on function public.esign_public_mark_signed(text,text,text,text) from public, anon, authenticated",
    "revoke all on function public.esign_public_track_event(text,text,text,integer,text,text,jsonb) from public, anon, authenticated",
  ]],
  ['src/lib/transcriptPull.js',[
    "client_id: client.id",
    "storage://documents/",
    "transcripts/${client.id}/",
    "storage_path: filePath",
  ]],
  ['src/pages/IRSPortal.jsx',[
    "openTranscriptFile(row)",
    "createSignedUrl(path, 3600)",
  ]],
  ['supabase/migrations/20260919_nashville_transcript_indexes.sql',[
    "idx_transcript_analyses_tenant_client_year",
    "idx_transcript_analyses_tenant_name_year",
    "idx_poa_records_tenant_client_status",
  ]],
  ['supabase/functions/nashville-esign-reminders/index.ts',[
    "signer_token",
    "?token=",
    "x-internal-cron-token",
    "platform_internal_secrets",
    "reminder_1_sent_at",
    "event_type:'reminder_sent'",
  ]],
  ['supabase/migrations/20260919_nashville_esign_reminder_worker.sql',[
    "nashville_esign_reminders_cron",
    "cron.unschedule",
    "nashville-esign-reminders",
    "x-internal-cron-token",
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

const payrollSrc=fs.readFileSync('src/pages/Payroll.jsx','utf8')
if((payrollSrc.match(/activeTab==='punch'/g)||[]).length!==1){
  console.error('Nashville closeout invariant: Payroll must render exactly one punch-history tab block')
  failed=true
}
if(payrollSrc.includes('+ Add Entry via Time Clock')){
  console.error('Nashville closeout invariant: legacy duplicate Payroll punch-history block is still present')
  failed=true
}
if(failed) process.exit(1)
console.log('✓ Nashville closeout invariants: Book Whip, QuickBooks, Employee Portal, Documents, E-Sign, 100-user scale')

const fs=require('fs')

const checks=[
  ['src/pages/Login.jsx',[
    "const NASHVILLE_LOGIN = 'https://nashville.taxrescrm.app/login?switch=1'",
    "isNashvilleIdentity",
    "isCentralTaxResHost",
    "window.location.replace(NASHVILLE_LOGIN)",
  ]],
  ['src/App.jsx',[
    "NashvilleCentralHostBoundary",
    "const NASHVILLE_TENANT_ID = '489ace07-1a6b-4864-833a-4f8420568b40'",
    "window.location.replace(NASHVILLE_LOGIN_URL)",
  ]],
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
    "https://taxrescrm.app",
    "NASHVILLE_DEDICATED_TENANT",
    "Nashville QuickBooks is managed in the dedicated Nashville CRM.",
    "${origin}/auth/quickbooks-callback",
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
    "countMode",
    "'planned'",
    "'exact'",
    "docTotal > DOC_PAGE_SIZE",
  ]],
  ['supabase/migrations/20260919_nashville_document_client_identity.sql',[
    "sync_document_client_identity",
    "before insert or update of client_id, client, clientname, tenant_id",
  ]],
  ['src/pages/Dashboard.jsx',[
    "Dedicated Nashville is quarantined from the central runtime.",
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
    "supabase.functions.invoke('send-email'",
    "esign_request",
    "esign_reminder",
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
    "client_id: clientId",
    "storage://documents/",
    "transcripts/${clientId}/",
    "storage_path: filePath",
  ]],
  ['src/pages/IRSPortal.jsx',[
    "openTranscriptPdf(row)",
    "createSignedUrl(row.file_path, 900)",
  ]],
  ['supabase/migrations/20260919_nashville_transcript_indexes.sql',[
    "idx_transcript_analyses_tenant_client_year",
    "idx_transcript_analyses_tenant_name_year",
    "idx_poa_records_tenant_client_status",
  ]],
  ['supabase/functions/nashville-system-mail-relay/index.ts',[
    "nashville_system_mail_relay_v1",
    "romylabs_stalwart_transport_for_product",
    "taxres_stalwart_relay",
    "employee_access",
  ]],
  ['supabase/functions/nashville-esign-mail/index.ts',[
    "nashville-system-mail-relay",
    "esign_request",
    "esign_reminder",
    "esign_signed_copy",
    "esign_internal_notification",
  ]],
  ['supabase/functions/employee-access-link/index.ts',[
    "SYSTEM_MAIL_RELAY",
    "SYSTEM_MAIL_SECRET_KEY",
    "employee_access",
    "duplicate_employee_email",
    "delivery:via==='both'",
    "/functions/v1/send-sms",
  ]],
  ['supabase/functions/nashville-esign-reminders/index.ts',[
    "signer_token",
    "?token=",
    "x-internal-cron-token",
    "nashville-esign-mail",
    "kind:'esign_reminder'",
    "esign_id:doc.id",
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
  ['src/pages/Email.jsx',[
    "const isNashville = false // Nashville mailbox runtime is dedicated",
    "gmail-sync-cron",
    "sendGmailEmail",
  ]],
  ['supabase/functions/m365-mail-gateway/index.ts',[
    "action==='send'",
    "action==='reply'",
    "action==='message_action'",
    "m365_message_id",
    "deleteditems",
    "destinationId",
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

// Cross-office isolation: Nashville integrations may exist in the shared TaxRes
// source tree, but TCR must never execute or render them without an exact
// Nashville tenant gate.
const emailSrc=fs.readFileSync('src/pages/Email.jsx','utf8')
const settingsSrc=fs.readFileSync('src/pages/Settings.jsx','utf8')
const quickBooksCallbackSrc=fs.readFileSync('src/pages/QuickBooksCallback.jsx','utf8')
const quickBooksStartSrc=fs.readFileSync('supabase/functions/quickbooks-oauth-start/index.ts','utf8')
const quickBooksOAuthCallbackSrc=fs.readFileSync('supabase/functions/quickbooks-oauth-callback/index.ts','utf8')
const quickBooksSyncSrc=fs.readFileSync('supabase/functions/quickbooks-sync/index.ts','utf8')
const manualSrc=fs.readFileSync('src/pages/Manual.jsx','utf8')

const isolationChecks=[
  ['central Email runtime has no Nashville tenant UUID',!emailSrc.includes('489ace07-1a6b-4864-833a-4f8420568b40')],
  ['central Settings runtime has no Nashville tenant UUID',!settingsSrc.includes('489ace07-1a6b-4864-833a-4f8420568b40')],
  ['central M365 email branch is disabled',emailSrc.includes('const isNashville = false // Nashville mailbox runtime is dedicated')],
  ['central M365/Verizon Settings branches are disabled',settingsSrc.includes('const isNashville = false // Nashville runs only in its dedicated CRM')],
  ['shared QuickBooks callback has no Nashville fallback branding',!quickBooksCallbackSrc.includes('Nashville QuickBooks')],
  ['central QuickBooks OAuth start rejects the dedicated Nashville tenant',quickBooksStartSrc.includes('NASHVILLE_DEDICATED_TENANT')&&quickBooksStartSrc.includes('Nashville QuickBooks is managed in the dedicated Nashville CRM.')],
  ['central QuickBooks OAuth start does not allow Nashville browser origin',!quickBooksStartSrc.includes("'https://nashville.taxrescrm.app'")],
  ['central QuickBooks OAuth callback does not allow Nashville browser origin',!quickBooksOAuthCallbackSrc.includes("'https://nashville.taxrescrm.app'")],
  ['shared QuickBooks sync copy is office-neutral',!quickBooksSyncSrc.includes('Nashville company')],
  ['TCR Manual contains no Nashville-only instructions',!manualSrc.includes('Nashville')],
]
for(const [label,ok] of isolationChecks){
  if(!ok){
    console.error(`TaxRes provider isolation invariant failed: ${label}`)
    failed=true
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
console.log('✓ Nashville closeout invariants: dedicated-host routing, Book Whip, QuickBooks, Employee Portal, Documents, E-Sign, 100-user scale')

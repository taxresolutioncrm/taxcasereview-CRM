import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-secret, x-romylabs-internal-token',
}
const NASHVILLE_TENANT = '489ace07-1a6b-4864-833a-4f8420568b40'
const ROMYLABS_SUPABASE_URL = 'https://mpxgxfqdbquzkrvvejkh.supabase.co'
// SEC-002 fix: key stored in Supabase Edge Function Secrets as ROMYLABS_ANON_KEY
const ROMYLABS_ANON_KEY = Deno.env.get('ROMYLABS_ANON_KEY') ?? ''
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const incomingInternalToken = req.headers.get('x-romylabs-internal-token') || ''
  const { data: internalSecret } = await sb
    .from('platform_internal_secrets')
    .select('secret')
    .eq('key', 'nashville_metrics_token')
    .limit(1)
    .maybeSingle()
  const expectedInternalToken = String(internalSecret?.secret || '')

  const incomingHubSecret = req.headers.get('x-hub-secret') || ''
  const expectedHubSecret = Deno.env.get('HUB_METRICS_SECRET') || ''
  let authorized = Boolean(
    (expectedInternalToken && incomingInternalToken && incomingInternalToken === expectedInternalToken) ||
    (expectedHubSecret && incomingHubSecret && incomingHubSecret === expectedHubSecret)
  )

  if (!authorized) {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)

    // Validate the caller against the central RomyLabs auth project. The anon key is public;
    // the bearer token is the signed Admin Portal session and is never persisted here.
    const hubAuth = createClient(ROMYLABS_SUPABASE_URL, ROMYLABS_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await hubAuth.auth.getUser()
    if (authError || !user) return json({ error: 'Invalid or expired session' }, 401)

    const allowedOwners = new Set([
      'info@romylabs.com',
      'romy@romylabs.com',
    ])
    authorized = allowedOwners.has(String(user.email || '').toLowerCase())
    if (!authorized) return json({ error: 'Forbidden' }, 403)
  }

  try {
    // Total cards use non-deleted records; active counts remain separate operational metrics.
    const todayEt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
    const [tenantDetails, totalClients, activeClients, totalLeads, activeLeads, tasks, employees, timeEntries, billing, cases, invoices, esigns, demos, storage, activity] = await Promise.all([
      sb.from('tenants').select('id,tenant_code,firm_name,firm_address,firm_phone,plan_tier,status,primary_contact_name,primary_contact_email,contract_start_date,contract_end_date,monthly_rate,per_seat_rate,notes,created_at').eq('id',NASHVILLE_TENANT).single(),
      sb.from('clients').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).is('deleted_at', null),
      sb.from('clients').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).is('deleted_at', null).eq('status', 'Active'),
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).is('deleted_at', null),
      sb.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).is('deleted_at', null),
      sb.from('tasks').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).eq('done', false),
      sb.from('employees').select('email').eq('tenant_id', NASHVILLE_TENANT).eq('status', 'Active'),
      sb.from('time_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT),
      sb.from('billing_time_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT),
      sb.from('cases').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT),
      sb.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).in('status',['Unpaid','Partial','Overdue','Past Due','Open','unpaid','partial','overdue','past_due','open']),
      sb.from('esigns').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).in('status',['pending','sent','awaiting','Pending','Sent','Awaiting']),
      sb.from('calevents').select('id', { count: 'exact', head: true }).eq('tenant_id', NASHVILLE_TENANT).ilike('eventType','%demo%').eq('date',todayEt),
      sb.rpc('platform_storage_metrics'),
      sb.from('activity_log').select('created_at').eq('tenant_id', NASHVILLE_TENANT).order('created_at', { ascending: false }).limit(1),
    ])
    if(tenantDetails.error || !tenantDetails.data) return json({ok:false,error:'Nashville office details unavailable'},503)
    const tenant=tenantDetails.data
    const storageData = storage.data || {}
    const activeEmployees = employees.data || []
    const staffEmails = new Set(activeEmployees.map((employee: any) => String(employee.email || '').trim().toLowerCase()).filter(Boolean))
    let authLastSignIn: string | null = null
    if (staffEmails.size) {
      const { data: authUsers, error: authUsersError } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (authUsersError) console.warn('platform-metrics auth activity unavailable:', authUsersError.message)
      for (const authUser of authUsers?.users || []) {
        const email = String(authUser.email || '').trim().toLowerCase()
        if (!staffEmails.has(email) || !authUser.last_sign_in_at) continue
        if (!authLastSignIn || new Date(authUser.last_sign_in_at).getTime() > new Date(authLastSignIn).getTime()) authLastSignIn = authUser.last_sign_in_at
      }
    }
    const crmLastActivity = activity.data?.[0]?.created_at || null
    const lastActivity = [crmLastActivity, authLastSignIn].filter(Boolean).reduce<string | null>((latest, current) => {
      if (!latest) return String(current)
      return new Date(String(current)).getTime() > new Date(latest).getTime() ? String(current) : latest
    }, null)
    return json({
      ok: true,
      product: 'nashville_tax_solutions',
      product_label: 'Nashville Tax Solutions',
      tenant_id: NASHVILLE_TENANT,
      fetched_at: new Date().toISOString(),
      metrics: {
        mrr: 0,
        arr: 0,
        total_clients: totalClients.count || 0,
        active_clients: activeClients.count || 0,
        total_leads: totalLeads.count || 0,
        active_leads: activeLeads.count || 0,
        pending_tasks: tasks.count || 0,
        outstanding_invoices: invoices.count || 0,
        pending_esigns: esigns.count || 0,
        demos_today: demos.count || 0,
        storage_bytes: Number(storageData.bytes || 0),
        storage_objects: Number(storageData.objects || 0),
        active_offices: 1,
        total_offices: 1,
        active_users: activeEmployees.length,
        active_staff: activeEmployees.length,
        active_cases: cases.count || 0,
        time_entries: timeEntries.count || 0,
        billing_entries: billing.count || 0,
        last_activity: lastActivity,
      },
      offices: [{
        id: NASHVILLE_TENANT,
        name: tenant.firm_name || 'Nashville Tax Solutions',
        tenant_code: tenant.tenant_code,
        plan_tier: tenant.plan_tier,
        status: tenant.status,
        is_active: tenant.status === 'active',
        primary_contact_name: tenant.primary_contact_name,
        primary_contact_email: tenant.primary_contact_email,
        phone: tenant.firm_phone,
        firm_address: tenant.firm_address,
        contract_start_date: tenant.contract_start_date,
        contract_end_date: tenant.contract_end_date,
        per_seat_rate: tenant.per_seat_rate,
        monthly_rate: tenant.monthly_rate,
        notes: tenant.notes,
        since: tenant.created_at,
        mrr: tenant.monthly_rate ?? null,
        employee_count: activeEmployees.length,
        active_staff: activeEmployees.length,
        total_clients: totalClients.count || 0,
        client_count: totalClients.count || 0,
        active_clients: activeClients.count || 0,
        total_leads: totalLeads.count || 0,
        lead_count: totalLeads.count || 0,
        active_leads: activeLeads.count || 0,
        job_count: cases.count || 0,
        active_cases: cases.count || 0,
        pending_tasks: tasks.count || 0,
        outstanding_invoices: invoices.count || 0,
        pending_esigns: esigns.count || 0,
        demos_today: demos.count || 0,
        storage_bytes: Number(storageData.bytes || 0),
        storage_objects: Number(storageData.objects || 0),
        storage_files: Number(storageData.objects || 0),
        last_activity: lastActivity,
      }],
      recent_activity: crmLastActivity ? [{ ts: crmLastActivity, text: 'Nashville CRM activity' }] : [],
    })
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500)
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_APP_ORIGINS = new Set([
  'https://taxrescrm.app',
  'https://www.taxrescrm.app',
])

function appOrigin(req: Request) {
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '')
  return ALLOWED_APP_ORIGINS.has(origin) ? origin : ''
}

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || 'https://taxrescrm.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

Deno.serve(async req => {
  const origin = appOrigin(req)
  if (req.method === 'OPTIONS') {
    if (!origin) return new Response('Forbidden', { status: 403 })
    return new Response('ok', { headers: cors(origin) })
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'content-type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!origin) return json({ error: 'Unapproved CRM origin.' }, 403)

  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!url || !anon || !service || !token) return json({ error: 'QuickBooks connection is unavailable.' }, 503)

    const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: userErr } = await caller.auth.getUser()
    if (userErr || !user?.email) return json({ error: 'Invalid session' }, 401)

    const admin = createClient(url, service)
    const { data: emp } = await admin.from('employees').select('tenant_id,role,access,status').eq('email', user.email).maybeSingle()
    if (!emp?.tenant_id || String(emp.status || '').toLowerCase() !== 'active') return json({ error: 'No active office access.' }, 403)
    const { data: isDedicatedNashville } = await admin.rpc('central_nashville_quarantined', { p_tenant: emp.tenant_id })
    if (isDedicatedNashville) return json({ error: 'Nashville QuickBooks is managed in the dedicated Nashville CRM.' }, 410)
    const privileged = ['super admin','admin'].includes(String(emp.role || emp.access || '').toLowerCase())
    if (!privileged) return json({ error: 'Admin access required.' }, 403)

    const { data: settings } = await admin.from('settings').select('qb_client_id').eq('tenant_id', emp.tenant_id).maybeSingle()
    if (!settings?.qb_client_id) return json({ error: 'QuickBooks Client ID is not configured.' }, 400)

    const { data: state, error: stateErr } = await caller.rpc('create_accounting_oauth_state', { p_provider: 'quickbooks' })
    if (stateErr || !state) return json({ error: 'Could not start a secure QuickBooks connection.' }, 500)

    const redirectUri = `${origin}/auth/quickbooks-callback`
    const qs = new URLSearchParams({
      client_id: settings.qb_client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state,
    })
    return json({ authorize_url: `https://appcenter.intuit.com/connect/oauth2?${qs.toString()}` })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

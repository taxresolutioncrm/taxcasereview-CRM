import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL = 'https://nashville.taxrescrm.app'
const cors = {
  'Access-Control-Allow-Origin': APP_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

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
    const privileged = ['super admin','admin'].includes(String(emp.role || emp.access || '').toLowerCase())
    if (!privileged) return json({ error: 'Admin access required.' }, 403)

    const { data: settings } = await admin.from('settings').select('qb_client_id').eq('tenant_id', emp.tenant_id).maybeSingle()
    if (!settings?.qb_client_id) return json({ error: 'QuickBooks Client ID is not configured.' }, 400)

    const { data: state, error: stateErr } = await caller.rpc('create_accounting_oauth_state', { p_provider: 'quickbooks' })
    if (stateErr || !state) return json({ error: 'Could not start a secure QuickBooks connection.' }, 500)
    const redirectUri = `${APP_URL}/auth/quickbooks-callback`
    const qs = new URLSearchParams({
      client_id: settings.qb_client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'com.intuit.quickbooks.accounting',
      state
    })
    return json({ authorize_url: `https://appcenter.intuit.com/connect/oauth2?${qs.toString()}` })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-qa-certification',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'Server configuration missing' }, 500)
    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'Unauthorized' }, 401)
    const token = authHeader.slice(7).trim()
    const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: userErr } = await authClient.auth.getUser(token)
    if (userErr || !user?.email) return json({ error: 'Unauthorized' }, 401)

    const { destinationNumber, displayName, entityType, callerIdPreference, phoneContext, qa_certification, dry_run } = await req.json()
    const digits = String(destinationNumber || '').replace(/\D/g, '')
    const e164 = digits.length === 10 ? `+1${digits}` : (digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '')
    if (!e164) return json({ error: 'Enter a valid 10-digit US phone number.' }, 400)

    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
    const romylabsContext = phoneContext === 'romylabs' && isPlatformAdmin === true
    let tenantId: string | null = null
    if (!romylabsContext) {
      const { data, error } = await authClient.rpc('current_tenant_id')
      if (error || !data) return json({ error: 'No active office context' }, 403)
      tenantId = data
    }
    const effectiveTenantId = romylabsContext ? 'a0000000-0000-0000-0000-000000000001' : tenantId!
    const { data: employee } = await db.from('employees')
      .select('tenant_id,name,extension,status,perm_comms')
      .eq('tenant_id', effectiveTenantId)
      .ilike('email', user.email)
      .limit(1)
      .maybeSingle()
    const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
    if (!isPlatformAdmin && (!active || Number(employee?.perm_comms || 0) < 2)) return json({ error: 'Phone permission denied' }, 403)

    let { data: settings, error: sErr } = await db.from('settings')
      .select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,sw_outbound_did,tenant_id')
      .eq('tenant_id', effectiveTenantId).limit(1).maybeSingle()
    if (romylabsContext && (!settings?.sw_space_url || !settings?.sw_project_id || !settings?.sw_api_token)) {
      const fallback = await db.from('settings')
        .select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,sw_outbound_did,tenant_id')
        .eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
      if (fallback.data) settings = fallback.data
      if (!sErr) sErr = fallback.error
    }
    if (sErr || !settings?.sw_space_url || !settings?.sw_project_id || !settings?.sw_api_token) {
      return json({ error: 'SignalWire credentials missing for this calling context.' }, 422)
    }

    const normalize = (d: string) => {
      const digits = String(d || '').replace(/\D/g, '')
      return digits.length === 10 ? `+1${digits}` : (digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '')
    }
    let romylabsNumber = ''
    if (romylabsContext) {
      const { data: adminPhone } = await db.from('settings').select('sw_inbound_did').eq('tenant_id','a0000000-0000-0000-0000-000000000001').limit(1).maybeSingle()
      romylabsNumber = normalize(adminPhone?.sw_inbound_did || '')
    }
    const localNumber = normalize(settings.sw_outbound_did || '')
    const tollFreeNumber = normalize(settings.sw_inbound_did || '')
    const requestedCallerId = callerIdPreference === 'tollfree' ? tollFreeNumber : localNumber
    const fromNumber = romylabsContext ? romylabsNumber : (requestedCallerId || localNumber || tollFreeNumber)
    if (!fromNumber) return json({ error: romylabsContext ? 'RomyLabs phone number is not configured.' : 'Configured outbound caller ID is invalid.' }, 422)

    if (qa_certification === true && dry_run === true) {
      return json({ success: true, dry_run: true, delivery: false, provider: 'signalwire', tenant_id: effectiveTenantId })
    }

    const conferenceName = `outbound-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const { data: insertedCall, error: insErr } = await db.from('outbound_calls').insert({
      conference_name: conferenceName,
      destination_number: e164,
      display_name: String(displayName || '').trim() || null,
      entity_type: String(entityType || '').trim() || null,
      status: 'pending',
      tenant_id: effectiveTenantId,
      agent_name: employee?.name || user.email,
      agent_extension: employee?.extension || null,
    }).select('id').single()
    if (insErr) return json({ error: insErr.message }, 500)

    const spaceDomain = String(settings.sw_space_url).replace(/^https?:\/\//, '')
    const providerAuth = 'Basic ' + btoa(`${settings.sw_project_id}:${settings.sw_api_token}`)
    const outboundLegUrl = `${SUPABASE_URL}/functions/v1/outbound-leg?conf=${encodeURIComponent(conferenceName)}&tenant=${encodeURIComponent(effectiveTenantId)}`
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/outbound-call-status?conf=${encodeURIComponent(conferenceName)}&tenant=${encodeURIComponent(effectiveTenantId)}`

    const resp = await fetch(`https://${spaceDomain}/api/laml/2010-04-01/Accounts/${settings.sw_project_id}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: providerAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: e164,
        From: fromNumber,
        Url: outboundLegUrl,
        Method: 'POST',
        StatusCallback: statusCallbackUrl,
        StatusCallbackEvent: 'completed',
        StatusCallbackMethod: 'POST',
      }),
    })

    const text = await resp.text()
    if (!resp.ok) {
      let providerMessage = ''
      try {
        const parsed = JSON.parse(text)
        providerMessage = parsed?.message || parsed?.error || parsed?.errors?.[0]?.detail || ''
      } catch {}
      await db.from('outbound_calls').update({
        status: 'failed',
        provider_status: 'failed',
        ended_at: new Date().toISOString(),
        disconnect_source: 'provider_failure',
        disconnect_reason: providerMessage || `HTTP ${resp.status}`,
        disconnect_details: { provider_http_status: resp.status, provider_response: text.slice(0, 2000) },
        provider_http_status: resp.status,
        provider_error: providerMessage || text.slice(0, 1000),
      }).eq('tenant_id', effectiveTenantId).eq('conference_name', conferenceName)
      console.error('start-outbound-call: SignalWire rejected call', resp.status, providerMessage || text)
      return json({
        error: providerMessage ? `SignalWire rejected the call: ${providerMessage}` : `SignalWire rejected the call (HTTP ${resp.status}).`,
        provider_status: resp.status,
      }, 502)
    }

    let clientCallsid = null
    try { clientCallsid = JSON.parse(text)?.sid || null } catch {}
    if (clientCallsid) {
      await db.from('outbound_calls').update({ provider_call_sid: clientCallsid }).eq('tenant_id', effectiveTenantId).eq('conference_name', conferenceName)
    }
    return json({ ok: true, conferenceName, clientCallsid, outboundCallId: insertedCall?.id || null, fromNumber })
  } catch (err) {
    console.error('start-outbound-call error:', err)
    return json({ error: 'Unable to start call.' }, 500)
  }
})

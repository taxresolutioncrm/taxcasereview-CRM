import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-qa-certification',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (!url || !service || !anon) return json({ error: 'Server configuration missing' }, 500)

    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'Unauthorized' }, 401)
    const token = authHeader.slice(7).trim()
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: userData, error: userErr } = await authClient.auth.getUser(token)
    const user = userData?.user
    if (userErr || !user?.email) return json({ error: 'Unauthorized' }, 401)

    const { data: tenantId, error: tenantErr } = await authClient.rpc('current_tenant_id')
    if (tenantErr || !tenantId) return json({ error: 'No active office context' }, 403)

    const admin = createClient(url, service)
    const { data: employee } = await admin.from('employees')
      .select('id,email,status,perm_comms,tenant_id')
      .eq('tenant_id', tenantId)
      .ilike('email', user.email)
      .limit(1)
      .maybeSingle()
    const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
    const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
    const allowed = Boolean(isPlatformAdmin) || Boolean(active && Number(employee?.perm_comms || 0) >= 2)
    if (!allowed) return json({ error: 'Fax permission denied' }, 403)

    const payload = await req.json()
    const { to, document_url, qa_certification, dry_run } = payload || {}
    const toDigits = digits(to)
    const toNumber = toDigits.length === 10 ? `+1${toDigits}` : (toDigits.length === 11 && toDigits.startsWith('1') ? `+${toDigits}` : '')
    if (!toNumber || !document_url) return json({ error: 'to and document_url are required' }, 400)

    let docUrl: URL
    try { docUrl = new URL(String(document_url)) } catch { return json({ error: 'Invalid document_url' }, 400) }
    const allowedHost = new URL(url).hostname
    if (docUrl.protocol !== 'https:' || docUrl.hostname !== allowedHost) return json({ error: 'document_url must use this office storage host' }, 400)

    let { data: settings } = await admin
      .from('settings')
      .select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,telnyx_api_key,firm_fax_number,tenant_id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()

    let platformRelay = false
    // CloudCPA TRC-003 is an active prospect workspace. Until Tony connects
    // CloudCPA's own fax carrier, allow authenticated CloudCPA staff with
    // communications permission to transmit outbound faxes through the proven
    // Tax Case Review SignalWire transport. The CRM keeps the fax log and
    // callback tenant scoped to CloudCPA; the response truthfully identifies
    // the physical relay number/provider.
    const hasTenantFaxProvider = Boolean(
      settings?.telnyx_api_key ||
      (settings?.sw_space_url && settings?.sw_project_id && settings?.sw_api_token)
    )
    if (!hasTenantFaxProvider) {
      const { data: cloudTenant } = await admin.from('tenants')
        .select('tenant_code').eq('id', tenantId).maybeSingle()
      if (cloudTenant?.tenant_code === 'TRC-003') {
        const { data: relaySettings } = await admin.from('settings')
          .select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,telnyx_api_key,firm_fax_number,tenant_id')
          .eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a')
          .limit(1).maybeSingle()
        const relayReady = Boolean(
          relaySettings?.telnyx_api_key ||
          (relaySettings?.sw_space_url && relaySettings?.sw_project_id && relaySettings?.sw_api_token)
        )
        if (relayReady) {
          settings = relaySettings
          platformRelay = true
        }
      }
    }

    const configuredFrom = settings?.firm_fax_number || settings?.sw_inbound_did || ''
    const fromDigits = digits(configuredFrom)
    const fromNumber = fromDigits.length === 10 ? `+1${fromDigits}` : (fromDigits.length === 11 && fromDigits.startsWith('1') ? `+${fromDigits}` : '')
    if (!fromNumber) return json({ error: 'Fax sending number is not a valid US E.164 number' }, 422)
    const provider = settings?.telnyx_api_key ? 'telnyx' : (settings?.sw_space_url && settings?.sw_project_id && settings?.sw_api_token ? 'signalwire' : null)
    if (!provider) return json({ error: 'No fax provider configured (Telnyx or SignalWire)' }, 422)

    // Production-safe validation path. Authorization, tenant resolution, recipient
    // validation, storage-host validation and provider configuration all run first.
    // No provider request and no database delivery log happens in dry-run mode.
    if (qa_certification === true && dry_run === true) {
      return json({ success: true, dry_run: true, delivery: false, provider, tenant_id: tenantId, platform_relay: platformRelay, from: fromNumber })
    }

    let faxResult: any = null
    if (provider === 'telnyx') {
      const res = await fetch('https://api.telnyx.com/v2/faxes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings!.telnyx_api_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connection_id: Deno.env.get('TELNYX_CONNECTION_ID') || '',
          from: fromNumber,
          to: toNumber,
          media_url: docUrl.toString(),
        }),
      })
      faxResult = await res.json()
      if (!res.ok) return json({ error: faxResult.errors?.[0]?.detail || 'Telnyx fax error' }, 400)
      return json({ success: true, provider, sid: faxResult.data?.id, platform_relay: platformRelay, from: fromNumber })
    }

    const auth = btoa(`${settings!.sw_project_id}:${settings!.sw_api_token}`)
    const statusCallback = `${url}/functions/v1/receive-fax?outbound=1&tenant=${encodeURIComponent(String(tenantId))}`
    const formData = new URLSearchParams({
      From: fromNumber,
      To: toNumber,
      MediaUrl: docUrl.toString(),
      StatusCallback: statusCallback,
      StatusCallbackMethod: 'POST',
    })
    const res = await fetch(
      `https://${String(settings!.sw_space_url).replace(/^https?:\/\//, '')}/api/laml/2010-04-01/Accounts/${settings!.sw_project_id}/Faxes.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      }
    )
    const faxText = await res.text()
    try { faxResult = JSON.parse(faxText) } catch { faxResult = { raw: faxText } }
    if (!res.ok) {
      const providerError = faxResult?.message || faxResult?.error || faxResult?.detail || faxResult?.raw || 'SignalWire fax error'
      console.error('[send-fax][signalwire]', JSON.stringify({
        status: res.status,
        from: fromNumber,
        to: toNumber,
        provider_error: providerError,
      }))
      return json({ error: providerError, provider_status: res.status }, 400)
    }
    return json({ success: true, provider, sid: faxResult.sid, provider_status: res.status, platform_relay: platformRelay, from: fromNumber })
  } catch (err) {
    console.error('[send-fax]', err)
    return json({ error: err instanceof Error ? err.message : 'Fax send failed' }, 500)
  }
})
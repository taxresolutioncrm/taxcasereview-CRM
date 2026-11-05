import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Called by the browser (CallContext.jsx addParticipant) to conference a
// third person into the active call. Uses the SignalWire REST API to
// place a new outbound call FROM the business number TO the given number;
// when they answer, join-conference returns LaML that drops them straight
// into the same conference the agent and caller are already in.
//
// Anti-abuse: the target conference must actually exist and be
// in-progress. Conference names are unguessable (they embed the call's
// SID/uuid), so this can't be used to place arbitrary calls without
// already being party to a live call.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { conference_name, number, phoneContext } = await req.json()
    if (!conference_name || !number) {
      return json({ error: 'conference_name and number required' }, 400)
    }
    if (!/^[A-Za-z0-9_-]+$/.test(conference_name)) {
      return json({ error: 'invalid conference name' }, 400)
    }

    // Normalize the number: strip formatting, require a real 10-digit US
    // number (or 11 starting with 1), dial as E.164.
    const digits = String(number).replace(/\D/g, '')
    let e164 = ''
    if (digits.length === 10) e164 = '+1' + digits
    else if (digits.length === 11 && digits.startsWith('1')) e164 = '+' + digits
    else return json({ error: 'Enter a valid 10-digit US phone number.' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Resolve the caller's tenant from their JWT so we get the right SW creds.
    const authHeader = req.headers.get('Authorization') || ''
    const userJwt = authHeader.replace('Bearer ', '')
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await userClient.auth.getUser()
    const { data: isPlatformAdmin } = await userClient.rpc('_is_platform_admin')
    const isRomyLabs = phoneContext === 'romylabs' && isPlatformAdmin === true
    const userId = user?.id

    // Look up the tenant for this user
    const { data: emp } = userId ? await supabase
      .from('employees')
      .select('tenant_id')
      .eq('user_id', userId)
      .maybeSingle() : { data: null }

    const tenantId = isRomyLabs ? 'a0000000-0000-0000-0000-000000000001' : emp?.tenant_id
    if (!tenantId) return json({ error: 'Unauthorized' }, 403)

    let { data: settings, error: sErr } = await supabase
      .from('settings')
      .select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did')
      .eq('tenant_id', tenantId)
      .limit(1).maybeSingle()
    if (isRomyLabs && (!settings?.sw_space_url || !settings?.sw_project_id || !settings?.sw_api_token)) {
      const fallback = await supabase.from('settings')
        .select('sw_space_url,sw_project_id,sw_api_token,sw_inbound_did')
        .eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
      if (fallback.data) settings = fallback.data
      if (!sErr) sErr = fallback.error
    }

    let romylabsDid = ''
    if (isRomyLabs) {
      const { data: adminPhone } = await supabase.from('settings').select('sw_inbound_did').eq('tenant_id','a0000000-0000-0000-0000-000000000001').limit(1).maybeSingle()
      romylabsDid = String(adminPhone?.sw_inbound_did || '').trim()
    }
    const fromDid = isRomyLabs ? romylabsDid : (settings?.sw_inbound_did || '')
    if (sErr || !settings?.sw_space_url || !settings?.sw_project_id || !settings?.sw_api_token || !fromDid) {
      console.error('call-add-participant: missing SignalWire credentials/DID', sErr)
      return json({ error: 'SignalWire credentials missing in Settings' }, 400)
    }

    const spaceDomain = settings.sw_space_url.replace(/^https?:\/\//, '')
    const auth = 'Basic ' + btoa(`${settings.sw_project_id}:${settings.sw_api_token}`)
    const base = `https://${spaceDomain}/api/laml/2010-04-01/Accounts/${settings.sw_project_id}`

    // The conference must belong to THIS tenant in our own database before
    // we even ask SignalWire whether it is live.
    const [{ data: inConf }, { data: outConf }] = await Promise.all([
      supabase.from('incoming_calls').select('id').eq('tenant_id', tenantId).eq('conference_name', conference_name)
        .in('status', ['ringing','answered']).limit(1).maybeSingle(),
      supabase.from('outbound_calls').select('id').eq('tenant_id', tenantId).eq('conference_name', conference_name)
        .in('status', ['pending','ringing','answered','connected']).limit(1).maybeSingle(),
    ])
    if (!inConf && !outConf) return json({ error: 'Call not found — it may have already ended.' }, 404)

    // The conference must also be live at SignalWire — this keeps the endpoint
    // from placing arbitrary calls against a stale local row.
    const confResp = await fetch(
      `${base}/Conferences.json?FriendlyName=${encodeURIComponent(conference_name)}&Status=in-progress`,
      { headers: { Authorization: auth } }
    )
    const confData = await confResp.json()
    if (!confData?.conferences?.[0]?.sid) {
      return json({ error: 'Call not found — it may have already ended.' }, 404)
    }

    const joinUrl = `https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/join-conference?conf=${encodeURIComponent(conference_name)}&tenant=${encodeURIComponent(tenantId)}`

    const dialResp = await fetch(`${base}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        To: e164,
        From: fromDid,
        Url: joinUrl,
        Method: 'POST',
        Timeout: '30',
      }),
    })

    const text = await dialResp.text()
    if (!dialResp.ok) {
      console.error('call-add-participant: SignalWire rejected the dial', dialResp.status, text)
      return json({ error: 'Could not place the call: ' + text }, 502)
    }

    const result = JSON.parse(text || '{}')
    const callSid = String(result?.sid || '')
    if (!/^[0-9a-f-]{36}$/i.test(callSid)) {
      console.error('call-add-participant: missing provider call SID')
      return json({ error: 'Provider did not return an identifiable participant call' }, 502)
    }
    console.log('call-add-participant: invitation placed', callSid, 'into', conference_name)
    return json({ ok: true, call_sid: callSid, status: 'ringing' })

  } catch (err) {
    console.error('call-add-participant error:', err)
    return json({ error: String(err) }, 500)
  }
})

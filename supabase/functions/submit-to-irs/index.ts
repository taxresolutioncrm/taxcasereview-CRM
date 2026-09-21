import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const cleanDigits = (v: unknown) => String(v || '').replace(/\D/g, '')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ success:false, error:'POST only' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ success:false, error:'Authentication required' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const admin = createClient(url, serviceRole)

    const { data:userData, error:userError } = await caller.auth.getUser()
    if (userError || !userData?.user) return json({ success:false, error:'Invalid session' }, 401)

    const { data:tenantId, error:tenantError } = await caller.rpc('current_tenant_id')
    if (tenantError || !tenantId) return json({ success:false, error:'No active office/tenant context' }, 403)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'submit')
    const adapterUrl = Deno.env.get('EFILE_ADAPTER_URL') || ''
    const adapterToken = Deno.env.get('EFILE_ADAPTER_TOKEN') || ''
    const providerName = Deno.env.get('EFILE_PROVIDER_NAME') || 'Approved e-file transmitter'

    const { data:settings, error:settingsError } = await admin
      .from('settings')
      .select('tenant_id,name,firmname,ein,preparer_name,ptin,efin')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
    if (settingsError || !settings) return json({ success:false, error:'Could not load this office e-file settings' }, 500)

    const efin = cleanDigits(settings.efin)
    const configured = Boolean(adapterUrl && adapterToken && efin.length === 6)

    if (action === 'status') {
      return json({
        success:true,
        configured,
        providerName,
        efinPresent: efin.length === 6,
        adapterConfigured: Boolean(adapterUrl && adapterToken),
        message: configured
          ? 'E-file transmission is configured for this office.'
          : 'E-file requires this office\'s valid 6-digit EFIN plus an approved transmitter/software adapter.'
      })
    }

    if (efin.length !== 6) {
      return json({ success:false, code:'EFIN_REQUIRED', error:'A valid 6-digit EFIN is required for this office. Add it in Settings → Integrations → IRS Preparer Credentials.' }, 400)
    }

    if (!adapterUrl || !adapterToken) {
      return json({
        success:false,
        code:'TRANSMITTER_NOT_CONFIGURED',
        error:'E-file transmitter is not configured yet. An EFIN identifies the firm/ERO, but IRS e-file transmission must use approved/tested software or an authorized transmitter connection.'
      }, 409)
    }

    const returnData = body?.returnData || {}
    const returnId = String(body?.returnId || returnData?.id || '')
    if (!returnId) return json({ success:false, error:'Save the return before e-filing.' }, 400)
    if (!returnData?.clientName || !returnData?.taxYear || !returnData?.returnType) {
      return json({ success:false, error:'Client, tax year, and return type are required.' }, 400)
    }
    if (String(returnData?.status || '') !== 'Ready to File') {
      return json({ success:false, error:'Set the return status to Ready to File before transmission.' }, 409)
    }

    const { data:returnRow, error:returnError } = await admin
      .from('tax_returns')
      .select('id,tenant_id,status')
      .eq('id', returnId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (returnError || !returnRow) return json({ success:false, error:'Return not found in this office.' }, 404)

    const payload = {
      source: 'TaxRes CRM',
      tenantId,
      returnId,
      firm: {
        name: settings.name || settings.firmname || 'TaxRes CRM',
        ein: settings.ein || '',
        efin,
        preparerName: settings.preparer_name || '',
        ptin: settings.ptin || '',
      },
      returnData,
      requestedBy: userData.user.email || userData.user.id,
    }

    const providerRes = await fetch(adapterUrl, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${adapterToken}`,
        'X-Efile-Source':'taxres-crm',
      },
      body:JSON.stringify(payload),
    })

    const raw = await providerRes.text()
    let providerData:any = {}
    try { providerData = raw ? JSON.parse(raw) : {} } catch { providerData = { raw: raw.slice(0,1000) } }

    if (!providerRes.ok || providerData?.success === false) {
      const message = providerData?.error || providerData?.message || `E-file provider returned HTTP ${providerRes.status}`
      try {
        await admin.from('efile_submissions').insert({
          tenant_id:tenantId,
          tax_return_id:returnId,
          provider:providerName,
          status:'error',
          error_message:String(message).slice(0,2000),
          requested_by:userData.user.email || userData.user.id,
        })
      } catch (_) {}
      return json({ success:false, code:'PROVIDER_ERROR', error:message }, 502)
    }

    const providerStatus = String(providerData?.status || 'Submitted')
    const submissionId = String(providerData?.submissionId || providerData?.submission_id || '')
    const ackNumber = String(providerData?.ackNumber || providerData?.ack_number || '')
    const normalized = /accept/i.test(providerStatus) ? 'Accepted'
      : /reject/i.test(providerStatus) ? 'Rejected'
      : 'Filed'

    await admin.from('efile_submissions').insert({
      tenant_id:tenantId,
      tax_return_id:returnId,
      provider:providerName,
      provider_submission_id:submissionId || null,
      acknowledgement_number:ackNumber || null,
      status:providerStatus,
      requested_by:userData.user.email || userData.user.id,
      provider_response:providerData,
    })

    await admin.from('tax_returns').update({
      status:normalized,
      efile_provider:providerName,
      efile_submission_id:submissionId || null,
      efile_ack_number:ackNumber || null,
      efile_status:providerStatus,
      efile_submitted_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    }).eq('id', returnId).eq('tenant_id', tenantId)

    return json({
      success:true,
      providerName,
      status:providerStatus,
      submissionId,
      ackNumber,
      message: providerData?.message || `Return sent through ${providerName}.`,
    })
  } catch (e) {
    console.error('submit-to-irs error:', e)
    return json({ success:false, error:(e as Error).message }, 500)
  }
})

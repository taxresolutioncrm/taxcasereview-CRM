import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

function env(name: string) { return (Deno.env.get(name) || '').trim() }

function configured() {
  return Boolean(
    env('IRS_TDS_WIRE_VERSION') &&
    env('IRS_TDS_CLIENT_ID') &&
    env('IRS_TDS_REQUEST_URL') &&
    env('IRS_TDS_REQUEST_TEMPLATE') &&
    env('IRS_TDS_STATUS_URL_TEMPLATE')
  )
}

function getPath(obj: any, path: string) {
  if (!path) return undefined
  return path.split('.').reduce((v, k) => v == null ? undefined : v[k], obj)
}

function renderValue(value: any, ctx: Record<string, any>): any {
  if (Array.isArray(value)) return value.map(v => renderValue(v, ctx))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderValue(v, ctx)]))
  }
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/)
  if (exact) return ctx[exact[1]] ?? null
  return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, k) => String(ctx[k] ?? ''))
}

function renderTemplate(raw: string, ctx: Record<string, any>) {
  const parsed = JSON.parse(raw)
  return renderValue(parsed, ctx)
}

function renderUrl(raw: string, ctx: Record<string, any>) {
  return raw.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, k) => encodeURIComponent(String(ctx[k] ?? '')))
}

async function authHeaders() {
  const mode = env('IRS_TDS_AUTH_MODE') || 'none'
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, application/pdf' }
  const clientHeader = env('IRS_TDS_CLIENT_ID_HEADER')
  if (clientHeader) headers[clientHeader] = env('IRS_TDS_CLIENT_ID')

  const extra = env('IRS_TDS_EXTRA_HEADERS_JSON')
  if (extra) Object.assign(headers, JSON.parse(extra))

  if (mode === 'bearer') {
    const token = env('IRS_TDS_BEARER_TOKEN')
    if (!token) throw new Error('IRS TDS bearer token is not configured.')
    headers.Authorization = `Bearer ${token}`
  } else if (mode === 'oauth2-client-credentials') {
    const tokenUrl = env('IRS_TDS_TOKEN_URL')
    const secret = env('IRS_TDS_CLIENT_SECRET')
    if (!tokenUrl || !secret) throw new Error('IRS TDS OAuth credentials are incomplete.')
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: env('IRS_TDS_CLIENT_ID'), client_secret: secret })
    const scope = env('IRS_TDS_OAUTH_SCOPE')
    if (scope) form.set('scope', scope)
    const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
    if (!r.ok) throw new Error(`IRS TDS token request failed (${r.status}).`)
    const body = await r.json()
    if (!body?.access_token) throw new Error('IRS TDS token response did not include access_token.')
    headers.Authorization = `Bearer ${body.access_token}`
  } else if (mode !== 'none') {
    throw new Error(`Unsupported IRS_TDS_AUTH_MODE: ${mode}`)
  }
  return headers
}

async function readBody(resp: Response) {
  const type = (resp.headers.get('content-type') || '').toLowerCase()
  if (type.includes('application/pdf')) return { kind: 'pdf', bytes: new Uint8Array(await resp.arrayBuffer()) }
  const text = await resp.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  return { kind: 'json', data }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)

    const url = env('SUPABASE_URL')
    const anon = env('SUPABASE_ANON_KEY')
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !serviceKey) return json({ error: 'Supabase runtime is not configured' }, 500)

    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const service = createClient(url, serviceKey)
    const { data: userData, error: userErr } = await userDb.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'Authentication required' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'capabilities')

    if (action === 'capabilities') {
      return json({
        directConfigured: configured(),
        wireVersion: configured() ? env('IRS_TDS_WIRE_VERSION') : null,
      })
    }

    const requestId = String(body?.requestId || '').trim()
    if (!requestId) return json({ error: 'requestId is required' }, 400)

    const { data: pull, error: pullErr } = await userDb.from('transcript_pull_requests').select('*').eq('id', requestId).maybeSingle()
    if (pullErr || !pull) return json({ error: 'Transcript pull request not found or not authorized' }, 404)
    if (pull.provider !== 'irs_a2a') return json({ error: 'This request is not configured for direct IRS TDS.' }, 400)

    if (!configured()) {
      await userDb.from('transcript_pull_requests').update({ provider_status: 'Configuration required', provider_error: 'IRS TDS API client/product configuration is not installed.' }).eq('id', requestId)
      return json({ error: 'IRS TDS direct connection is not configured yet.', code: 'TDS_NOT_CONFIGURED' }, 409)
    }

    const { data: poa, error: poaErr } = await userDb.from('poa_records').select('id,status,form_type,tax_years').eq('id', pull.poa_record_id).maybeSingle()
    if (poaErr || !poa || poa.status !== 'On File') return json({ error: 'A valid POA/TIA with status On File is required.' }, 409)

    const { data: clients, error: clientErr } = await userDb.from('clients').select('id,name,ssn,ein').eq('name', pull.client_name).limit(2)
    if (clientErr) return json({ error: clientErr.message }, 500)
    if (!clients || clients.length !== 1) return json({ error: 'Direct TDS requires exactly one matching client record.' }, 409)
    const client = clients[0]
    const tin = String(client.ein || client.ssn || '').replace(/\D/g, '')
    if (!tin) return json({ error: 'Client SSN/EIN is required for direct TDS.' }, 409)

    const { data: settings } = await userDb.from('settings').select('caf_number').limit(1).maybeSingle()
    const caf = String(settings?.caf_number || '').trim()
    if (!caf) return json({ error: 'Office CAF number is required for direct TDS.' }, 409)

    const years = String(pull.tax_years || '').match(/(?:19|20)\d{2}/g) || []
    const ctx: Record<string, any> = {
      requestId: pull.id,
      clientId: client.id,
      clientName: pull.client_name,
      tin,
      tinType: client.ein ? 'EIN' : 'SSN',
      caf,
      poaId: poa.id,
      poaFormType: poa.form_type,
      taxYears: years,
      transcriptTypes: pull.transcript_types || [],
      requestedBy: pull.requested_by || '',
      providerRequestId: pull.provider_request_id || '',
    }

    if (action === 'submit') {
      const headers = await authHeaders()
      const payload = renderTemplate(env('IRS_TDS_REQUEST_TEMPLATE'), ctx)
      const resp = await fetch(env('IRS_TDS_REQUEST_URL'), { method: env('IRS_TDS_REQUEST_METHOD') || 'POST', headers, body: JSON.stringify(payload) })
      const parsed = await readBody(resp)
      if (!resp.ok) {
        const detail = parsed.kind === 'json' ? JSON.stringify(parsed.data).slice(0, 1000) : `HTTP ${resp.status}`
        await userDb.from('transcript_pull_requests').update({ provider_status: 'Error', provider_error: detail, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
        return json({ error: `IRS TDS request failed (${resp.status}).` }, 502)
      }
      if (parsed.kind !== 'json') return json({ error: 'IRS TDS submit response format was unexpected.' }, 502)
      const idPath = env('IRS_TDS_RESPONSE_ID_PATH') || 'transactionId'
      const externalId = String(getPath(parsed.data, idPath) || '').trim()
      if (!externalId) return json({ error: `IRS TDS response did not contain a request ID at ${idPath}.` }, 502)
      await userDb.from('transcript_pull_requests').update({
        provider_request_id: externalId,
        provider_status: 'Submitted',
        provider_error: null,
        provider_submitted_at: new Date().toISOString(),
        provider_last_checked_at: new Date().toISOString(),
        status: 'In Progress',
      }).eq('id', requestId)
      return json({ ok: true, providerRequestId: externalId, status: 'Submitted' })
    }

    if (action === 'status') {
      if (!pull.provider_request_id) return json({ error: 'This request has not been submitted to IRS TDS yet.' }, 409)
      ctx.providerRequestId = pull.provider_request_id
      const headers = await authHeaders()
      const statusUrl = renderUrl(env('IRS_TDS_STATUS_URL_TEMPLATE'), ctx)
      const resp = await fetch(statusUrl, { method: env('IRS_TDS_STATUS_METHOD') || 'GET', headers })
      const parsed = await readBody(resp)
      if (!resp.ok) {
        await userDb.from('transcript_pull_requests').update({ provider_status: 'Error', provider_error: `IRS TDS status HTTP ${resp.status}`, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
        return json({ error: `IRS TDS status request failed (${resp.status}).` }, 502)
      }

      let pdfBytes: Uint8Array | null = parsed.kind === 'pdf' ? parsed.bytes : null
      let remoteStatus = 'In Progress'
      if (parsed.kind === 'json') {
        remoteStatus = String(getPath(parsed.data, env('IRS_TDS_STATUS_PATH') || 'status') || 'In Progress')
        const base64Path = env('IRS_TDS_PDF_BASE64_PATH')
        const downloadPath = env('IRS_TDS_DOWNLOAD_URL_PATH')
        const b64 = base64Path ? getPath(parsed.data, base64Path) : null
        if (b64) pdfBytes = Uint8Array.from(atob(String(b64)), c => c.charCodeAt(0))
        if (!pdfBytes && downloadPath) {
          const downloadUrl = getPath(parsed.data, downloadPath)
          if (downloadUrl) {
            const d = await fetch(String(downloadUrl), { headers })
            if (!d.ok) throw new Error(`IRS TDS transcript download failed (${d.status}).`)
            pdfBytes = new Uint8Array(await d.arrayBuffer())
          }
        }
      }

      if (pdfBytes && pdfBytes.length > 0) {
        const filePath = `tds-direct/${pull.tenant_id}/${pull.id}/${crypto.randomUUID()}.pdf`
        const { error: uploadErr } = await service.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: false })
        if (uploadErr) throw new Error(`Could not store IRS transcript: ${uploadErr.message}`)
        const { data: signed, error: signErr } = await service.storage.from('documents').createSignedUrl(filePath, 900)
        if (signErr || !signed?.signedUrl) throw new Error('Could not create secure transcript link.')
        await userDb.from('transcript_pull_requests').update({
          provider_status: 'Delivered',
          provider_error: null,
          provider_last_checked_at: new Date().toISOString(),
          provider_file_path: filePath,
        }).eq('id', requestId)
        return json({ ok: true, status: 'Delivered', filePath, signedUrl: signed.signedUrl })
      }

      await userDb.from('transcript_pull_requests').update({ provider_status: remoteStatus, provider_error: null, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
      return json({ ok: true, status: remoteStatus })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    console.error('[transcript-pull]', e)
    return json({ error: e instanceof Error ? e.message : 'Transcript pull failed' }, 500)
  }
})

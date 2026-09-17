import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const env = (name: string) => (Deno.env.get(name) || '').trim()
const configured = () => Boolean(env('IRS_TDS_WIRE_VERSION') && env('IRS_TDS_CLIENT_ID') && env('IRS_TDS_REQUEST_URL') && env('IRS_TDS_REQUEST_TEMPLATE') && env('IRS_TDS_STATUS_URL_TEMPLATE'))

function getPath(obj: any, path: string) {
  if (!path) return undefined
  return path.split('.').reduce((v, k) => v == null ? undefined : v[k], obj)
}
function renderValue(value: any, ctx: Record<string, any>): any {
  if (Array.isArray(value)) return value.map(v => renderValue(v, ctx))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderValue(v, ctx)]))
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/)
  if (exact) return ctx[exact[1]] ?? null
  return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, k) => String(ctx[k] ?? ''))
}
const renderTemplate = (raw: string, ctx: Record<string, any>) => renderValue(JSON.parse(raw), ctx)
const renderUrl = (raw: string, ctx: Record<string, any>) => raw.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, k) => encodeURIComponent(String(ctx[k] ?? '')))

async function sha256Hex(bytes: Uint8Array) {
  const copy = bytes.slice().buffer
  const hash = await crypto.subtle.digest('SHA-256', copy)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function authHeaders() {
  const mode = env('IRS_TDS_AUTH_MODE') || 'none'
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, application/pdf' }
  const clientHeader = env('IRS_TDS_CLIENT_ID_HEADER')
  if (clientHeader) headers[clientHeader] = env('IRS_TDS_CLIENT_ID')
  const extra = env('IRS_TDS_EXTRA_HEADERS_JSON')
  if (extra) Object.assign(headers, JSON.parse(extra))
  if (mode === 'bearer') {
    const token = env('IRS_TDS_BEARER_TOKEN')
    if (!token) throw new Error('IRS TDS bearer token is not configured.')
    headers.Authorization = `Bearer ${token}`
  } else if (mode === 'oauth2-client-credentials') {
    const tokenUrl = env('IRS_TDS_TOKEN_URL'), secret = env('IRS_TDS_CLIENT_SECRET')
    if (!tokenUrl || !secret) throw new Error('IRS TDS OAuth credentials are incomplete.')
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: env('IRS_TDS_CLIENT_ID'), client_secret: secret })
    const scope = env('IRS_TDS_OAUTH_SCOPE')
    if (scope) form.set('scope', scope)
    const r = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
    if (!r.ok) throw new Error(`IRS TDS token request failed (${r.status}).`)
    const body = await r.json()
    if (!body?.access_token) throw new Error('IRS TDS token response did not include access_token.')
    headers.Authorization = `Bearer ${body.access_token}`
  } else if (mode !== 'none') throw new Error(`Unsupported IRS_TDS_AUTH_MODE: ${mode}`)
  return headers
}

async function readBody(resp: Response) {
  const type = (resp.headers.get('content-type') || '').toLowerCase()
  if (type.includes('application/pdf')) return { kind: 'pdf', bytes: new Uint8Array(await resp.arrayBuffer()) } as const
  const text = await resp.text()
  let data: any
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  return { kind: 'json', data } as const
}

async function resolveContext(userDb: any, pull: any) {
  if (!pull || pull.provider !== 'irs_a2a') throw new Error('This request is not configured for direct IRS TDS.')
  const { data: poa, error: poaErr } = await userDb.from('poa_records').select('id,status,form_type,tax_years').eq('id', pull.poa_record_id).maybeSingle()
  if (poaErr || !poa || poa.status !== 'On File') throw new Error('A valid POA/TIA with status On File is required.')
  const { data: clients, error: clientErr } = await userDb.from('clients').select('id,name,ssn,ein').eq('name', pull.client_name).limit(2)
  if (clientErr) throw new Error(clientErr.message)
  if (!clients || clients.length !== 1) throw new Error('Direct TDS requires exactly one matching client record.')
  const client = clients[0]
  const tin = String(client.ein || client.ssn || '').replace(/\D/g, '')
  if (!tin) throw new Error('Client SSN/EIN is required for direct TDS.')
  const { data: settings } = await userDb.from('settings').select('caf_number').limit(1).maybeSingle()
  const caf = String(settings?.caf_number || '').trim()
  if (!caf) throw new Error('Office CAF number is required for direct TDS.')
  return {
    requestId: pull.id,
    clientId: client.id,
    clientName: pull.client_name,
    tin,
    tinType: client.ein ? 'EIN' : 'SSN',
    caf,
    poaId: poa.id,
    poaFormType: poa.form_type,
    taxYears: String(pull.tax_years || '').match(/(?:19|20)\d{2}/g) || [],
    transcriptTypes: pull.transcript_types || [],
    requestedBy: pull.requested_by || '',
    providerRequestId: pull.provider_request_id || '',
  }
}

async function submitWire(ctx: Record<string, any>) {
  const headers = await authHeaders()
  const payload = renderTemplate(env('IRS_TDS_REQUEST_TEMPLATE'), ctx)
  const resp = await fetch(env('IRS_TDS_REQUEST_URL'), { method: env('IRS_TDS_REQUEST_METHOD') || 'POST', headers, body: JSON.stringify(payload) })
  const parsed = await readBody(resp)
  if (!resp.ok) throw new Error(`IRS TDS request failed (${resp.status}).`)
  if (parsed.kind !== 'json') throw new Error('IRS TDS submit response format was unexpected.')
  const idPath = env('IRS_TDS_RESPONSE_ID_PATH') || 'transactionId'
  const externalId = String(getPath(parsed.data, idPath) || '').trim()
  if (!externalId) throw new Error(`IRS TDS response did not contain a request ID at ${idPath}.`)
  return externalId
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !serviceKey) return json({ error: 'Supabase runtime is not configured' }, 500)
    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const service = createClient(url, serviceKey)
    const { data: userData, error: userErr } = await userDb.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'Authentication required' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'capabilities')
    if (action === 'capabilities') return json({ directConfigured: configured(), wireVersion: configured() ? env('IRS_TDS_WIRE_VERSION') : null })
    if (!configured()) return json({ error: 'IRS TDS direct connection is not configured yet.', code: 'TDS_NOT_CONFIGURED' }, 409)

    if (action === 'submitDraft') {
      const pull = body?.request || null
      if (!pull?.id) return json({ error: 'Draft request id is required' }, 400)
      const externalId = await submitWire(await resolveContext(userDb, pull))
      return json({ ok: true, providerRequestId: externalId, status: 'Submitted', submittedAt: new Date().toISOString() })
    }

    const requestId = String(body?.requestId || '').trim()
    if (!requestId) return json({ error: 'requestId is required' }, 400)
    const { data: pull, error: pullErr } = await userDb.from('transcript_pull_requests').select('*').eq('id', requestId).maybeSingle()
    if (pullErr || !pull) return json({ error: 'Transcript pull request not found or not authorized' }, 404)
    const ctx = await resolveContext(userDb, pull)

    if (action === 'submit') {
      const externalId = await submitWire(ctx)
      const { error } = await userDb.from('transcript_pull_requests').update({
        provider_request_id: externalId,
        provider_status: 'Submitted',
        provider_error: null,
        provider_submitted_at: new Date().toISOString(),
        provider_last_checked_at: new Date().toISOString(),
        status: 'In Progress',
      }).eq('id', requestId)
      if (error) throw new Error(error.message)
      return json({ ok: true, providerRequestId: externalId, status: 'Submitted' })
    }

    if (action === 'status') {
      if (pull.provider_status === 'Filed' && pull.status === 'Completed') return json({ ok: true, status: 'Filed' })

      const resultKeys: string[] = pull.provider_result_keys || []
      const filePaths: string[] = pull.provider_file_paths || []
      const filedKeys: string[] = pull.provider_filed_keys || []
      const pendingIndex = resultKeys.findIndex((k: string) => !filedKeys.includes(k))
      if (pendingIndex >= 0 && filePaths[pendingIndex]) {
        const filePath = filePaths[pendingIndex]
        const { data: signed, error: signErr } = await service.storage.from('documents').createSignedUrl(filePath, 900)
        if (signErr || !signed?.signedUrl) throw new Error('Could not create secure transcript link.')
        return json({ ok: true, status: 'Delivered', resultKey: resultKeys[pendingIndex], filePath, signedUrl: signed.signedUrl })
      }

      if (!pull.provider_request_id) return json({ error: 'This request has not been submitted to IRS TDS yet.' }, 409)
      ctx.providerRequestId = pull.provider_request_id
      const headers = await authHeaders()
      const resp = await fetch(renderUrl(env('IRS_TDS_STATUS_URL_TEMPLATE'), ctx), { method: env('IRS_TDS_STATUS_METHOD') || 'GET', headers })
      const parsed = await readBody(resp)
      if (!resp.ok) return json({ error: `IRS TDS status request failed (${resp.status}).` }, 502)

      let pdfBytes: Uint8Array | null = parsed.kind === 'pdf' ? parsed.bytes : null
      let remoteStatus = 'In Progress'
      if (parsed.kind === 'json') {
        remoteStatus = String(getPath(parsed.data, env('IRS_TDS_STATUS_PATH') || 'status') || 'In Progress')
        const base64Path = env('IRS_TDS_PDF_BASE64_PATH'), downloadPath = env('IRS_TDS_DOWNLOAD_URL_PATH')
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

      if (pdfBytes?.length) {
        const resultKey = await sha256Hex(pdfBytes)
        const existingIndex = resultKeys.indexOf(resultKey)
        if (existingIndex >= 0) {
          await userDb.from('transcript_pull_requests').update({ provider_status: remoteStatus, provider_error: null, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
          return json({ ok: true, status: remoteStatus, duplicate: true, resultKey })
        }
        const filePath = `tds-direct/${pull.tenant_id}/${pull.id}/${resultKey}.pdf`
        const { error: uploadErr } = await service.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: false })
        if (uploadErr) throw new Error(`Could not store IRS transcript: ${uploadErr.message}`)
        const { data: signed, error: signErr } = await service.storage.from('documents').createSignedUrl(filePath, 900)
        if (signErr || !signed?.signedUrl) throw new Error('Could not create secure transcript link.')
        const nextKeys = [...resultKeys, resultKey]
        const nextPaths = [...filePaths, filePath]
        const { error: updateErr } = await userDb.from('transcript_pull_requests').update({
          provider_status: 'Delivered',
          provider_error: null,
          provider_last_checked_at: new Date().toISOString(),
          provider_file_path: filePath,
          provider_result_keys: nextKeys,
          provider_file_paths: nextPaths,
        }).eq('id', requestId)
        if (updateErr) throw new Error(updateErr.message)
        return json({ ok: true, status: 'Delivered', resultKey, filePath, signedUrl: signed.signedUrl })
      }

      const { error: updateErr } = await userDb.from('transcript_pull_requests').update({ provider_status: remoteStatus, provider_error: null, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
      if (updateErr) throw new Error(updateErr.message)
      return json({ ok: true, status: remoteStatus })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    console.error('[transcript-pull]', e)
    return json({ error: e instanceof Error ? e.message : 'Transcript pull failed' }, 500)
  }
})

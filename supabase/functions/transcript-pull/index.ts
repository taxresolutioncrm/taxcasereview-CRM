import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const env = (name: string) => (Deno.env.get(name) || '').trim()

const sessionSetupConfigured = () => Boolean(
  env('IRS_TDS_CLIENT_ID') &&
  env('IRS_TDS_ISP_AUTHORIZE_URL_TEMPLATE') &&
  env('IRS_TDS_ISP_TOKEN_URL') &&
  env('IRS_TDS_ISP_TOKEN_BODY_TEMPLATE') &&
  env('IRS_TDS_REDIRECT_URI') &&
  env('IRS_TDS_REQUEST_URL') &&
  env('IRS_TDS_REQUEST_TEMPLATE') &&
  env('IRS_TDS_STATUS_URL_TEMPLATE')
)

function getPath(obj: any, path: string) {
  if (!path) return undefined
  return path.split('.').reduce((v, k) => v == null ? undefined : v[k], obj)
}

function renderText(raw: string, ctx: Record<string, any>, encode = false) {
  return raw.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, k) => {
    const value = String(ctx[k] ?? '')
    return encode ? encodeURIComponent(value) : value
  })
}

function renderValue(value: any, ctx: Record<string, any>): any {
  if (Array.isArray(value)) return value.map(v => renderValue(v, ctx))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderValue(v, ctx)]))
  if (typeof value !== 'string') return value
  const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/)
  if (exact) return ctx[exact[1]] ?? null
  return renderText(value, ctx)
}

const renderTemplate = (raw: string, ctx: Record<string, any>) => renderValue(JSON.parse(raw), ctx)
const renderUrl = (raw: string, ctx: Record<string, any>) => renderText(raw, ctx, true)

function parseYears(value: any) {
  const out = new Set<string>()
  const s = String(value || '')
  const ranges = s.match(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g) || []
  for (const r of ranges) {
    const nums = r.match(/(?:19|20)\d{2}/g)?.map(Number) || []
    if (nums.length === 2) {
      for (let y = Math.min(nums[0], nums[1]); y <= Math.max(nums[0], nums[1]); y++) out.add(String(y))
    }
  }
  const rest = s.replace(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g, ' ')
  for (const y of rest.match(/(?:19|20)\d{2}/g) || []) out.add(y)
  return out
}

function b64url(bytes: Uint8Array) {
  let s = ''
  bytes.forEach(b => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return b64url(a)
}

async function sha256Bytes(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function tokenKey() {
  const seed = env('SUPABASE_SERVICE_ROLE_KEY') + ':irs-tds-session:v1'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptText(value: string) {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const key = await tokenKey()
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value)))
  return `${b64url(iv)}.${b64url(cipher)}`
}

function fromB64url(value: string) {
  let s = value.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const raw = atob(s)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function decryptText(value: string) {
  const [ivPart, dataPart] = String(value || '').split('.')
  if (!ivPart || !dataPart) throw new Error('IRS session token is invalid.')
  const key = await tokenKey()
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(ivPart) }, key, fromB64url(dataPart))
  return new TextDecoder().decode(clear)
}

async function readBody(resp: Response) {
  const type = (resp.headers.get('content-type') || '').toLowerCase()
  if (type.includes('application/pdf')) return { kind: 'pdf', bytes: new Uint8Array(await resp.arrayBuffer()) } as const
  const text = await resp.text()
  let data: any
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  return { kind: 'json', data } as const
}

async function resolveEmployee(userDb: any, user: any) {
  const email = String(user?.email || '').trim()
  if (!email) throw new Error('Signed-in employee email is required.')
  const { data, error } = await userDb.from('employees').select('tenant_id,perm_irs,email').ilike('email', email).limit(2)
  if (error) throw new Error(error.message)
  if (!data || data.length !== 1) throw new Error('Could not resolve one tenant-scoped employee record for this IRS session.')
  if (Number(data[0].perm_irs || 0) < 2) throw new Error('IRS write permission is required for direct TDS pulls.')
  return data[0]
}

async function getSession(service: any, tenantId: string, userId: string) {
  const { data, error } = await service.from('irs_tds_sessions').select('*').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

function sessionIsActive(row: any) {
  return Boolean(row?.access_token_ciphertext && row?.expires_at && new Date(row.expires_at).getTime() > Date.now() + 15000)
}

async function requireActiveSession(service: any, tenantId: string, userId: string) {
  const row = await getSession(service, tenantId, userId)
  if (!sessionIsActive(row)) {
    const e: any = new Error('Your IRS TDS session is not active. Sign in to the IRS again and then retry the request.')
    e.code = 'IRS_SESSION_REQUIRED'
    throw e
  }
  return { row, token: await decryptText(row.access_token_ciphertext) }
}

async function resolveContext(service: any, pull: any) {
  if (!pull || pull.provider !== 'irs_a2a') throw new Error('This request is not configured for direct IRS TDS.')
  const tenantId = String(pull.tenant_id || '')
  if (!tenantId) throw new Error('Transcript pull request is missing tenant scope.')
  const { data: poa, error: poaErr } = await service.from('poa_records').select('id,status,form_type,tax_years').eq('tenant_id', tenantId).eq('id', pull.poa_record_id).maybeSingle()
  if (poaErr || !poa || poa.status !== 'On File') throw new Error('A valid POA/TIA with status On File is required.')
  const requestedYears = parseYears(pull.tax_years)
  if (requestedYears.size > 0) {
    const authorizedYears = parseYears(poa.tax_years)
    if (authorizedYears.size === 0 || [...requestedYears].some(y => !authorizedYears.has(y))) throw new Error('The recorded POA/TIA does not cover every requested tax year.')
  }
  const { data: clients, error: clientErr } = await service.from('clients').select('id,name,ssn,ein').eq('tenant_id', tenantId).eq('name', pull.client_name).limit(2)
  if (clientErr) throw new Error(clientErr.message)
  if (!clients || clients.length !== 1) throw new Error('Direct TDS requires exactly one matching client record.')
  const client = clients[0]
  const tin = String(client.ein || client.ssn || '').replace(/\D/g, '')
  if (!tin) throw new Error('Client SSN/EIN is required for direct TDS.')
  const { data: settings, error: settingsErr } = await service.from('settings').select('caf_number').eq('tenant_id', tenantId).limit(1).maybeSingle()
  if (settingsErr) throw new Error(settingsErr.message)
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
    taxYears: [...requestedYears],
    transcriptTypes: pull.transcript_types || [],
    requestedBy: pull.requested_by || '',
    providerRequestId: pull.provider_request_id || '',
  }
}

function sessionHeaders(token: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, application/pdf' }
  const authHeader = env('IRS_TDS_SESSION_AUTH_HEADER') || 'Authorization'
  const authPrefix = env('IRS_TDS_SESSION_AUTH_PREFIX') || 'Bearer '
  headers[authHeader] = `${authPrefix}${token}`
  const clientHeader = env('IRS_TDS_CLIENT_ID_HEADER')
  if (clientHeader) headers[clientHeader] = env('IRS_TDS_CLIENT_ID')
  const extra = env('IRS_TDS_EXTRA_HEADERS_JSON')
  if (extra) Object.assign(headers, JSON.parse(extra))
  return headers
}

async function submitWire(ctx: Record<string, any>, token: string) {
  const payload = renderTemplate(env('IRS_TDS_REQUEST_TEMPLATE'), ctx)
  const resp = await fetch(env('IRS_TDS_REQUEST_URL'), {
    method: env('IRS_TDS_REQUEST_METHOD') || 'POST',
    headers: sessionHeaders(token),
    body: JSON.stringify(payload),
  })
  const parsed = await readBody(resp)
  if (!resp.ok) throw new Error(`IRS TDS request failed (${resp.status}).`)
  if (parsed.kind !== 'json') throw new Error('IRS TDS submit response format was unexpected.')
  const idPath = env('IRS_TDS_RESPONSE_ID_PATH') || 'transactionId'
  const externalId = String(getPath(parsed.data, idPath) || '').trim()
  if (!externalId) throw new Error(`IRS TDS response did not contain a request ID at ${idPath}.`)
  return externalId
}

async function handleCallback(req: Request, service: any) {
  const u = new URL(req.url)
  const state = u.searchParams.get('state') || ''
  const code = u.searchParams.get('code') || ''
  const providerError = u.searchParams.get('error') || ''
  if (!state) return new Response('Missing IRS authorization state.', { status: 400 })
  const { data: session, error } = await service.from('irs_tds_sessions').select('*').eq('state', state).maybeSingle()
  if (error || !session) return new Response('IRS authorization state was not recognized.', { status: 400 })
  if (!session.state_expires_at || new Date(session.state_expires_at).getTime() < Date.now()) return new Response('IRS authorization request expired. Return to the CRM and sign in again.', { status: 400 })
  if (providerError) return new Response(`IRS authorization failed: ${providerError}`, { status: 400 })
  if (!code) return new Response('IRS authorization did not return a code.', { status: 400 })

  const verifier = await decryptText(session.pkce_verifier_ciphertext)
  const ctx = { code, clientId: env('IRS_TDS_CLIENT_ID'), redirectUri: env('IRS_TDS_REDIRECT_URI'), codeVerifier: verifier }
  const tokenBody = renderText(env('IRS_TDS_ISP_TOKEN_BODY_TEMPLATE'), ctx, true)
  const tokenHeaders: Record<string, string> = { 'Content-Type': env('IRS_TDS_ISP_TOKEN_CONTENT_TYPE') || 'application/x-www-form-urlencoded' }
  const extra = env('IRS_TDS_ISP_TOKEN_HEADERS_JSON')
  if (extra) Object.assign(tokenHeaders, JSON.parse(extra))
  const tokenResp = await fetch(env('IRS_TDS_ISP_TOKEN_URL'), { method: 'POST', headers: tokenHeaders, body: tokenBody })
  const tokenParsed = await readBody(tokenResp)
  if (!tokenResp.ok || tokenParsed.kind !== 'json') return new Response(`IRS session token exchange failed (${tokenResp.status}).`, { status: 502 })
  const accessPath = env('IRS_TDS_ISP_ACCESS_TOKEN_PATH') || 'access_token'
  const expiresPath = env('IRS_TDS_ISP_EXPIRES_IN_PATH') || 'expires_in'
  const orgPath = env('IRS_TDS_ISP_ORGANIZATION_PATH')
  const accessToken = String(getPath(tokenParsed.data, accessPath) || '').trim()
  if (!accessToken) return new Response(`IRS token response did not include a token at ${accessPath}.`, { status: 502 })
  const rawSeconds = Number(getPath(tokenParsed.data, expiresPath) || 3600)
  const expiresSeconds = Math.max(60, Math.min(Number.isFinite(rawSeconds) ? rawSeconds : 3600, 3600))
  const organizationName = orgPath ? String(getPath(tokenParsed.data, orgPath) || '').trim() : null
  const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString()
  const encrypted = await encryptText(accessToken)
  const { error: saveErr } = await service.from('irs_tds_sessions').update({ access_token_ciphertext: encrypted, organization_name: organizationName || session.organization_name || null, expires_at: expiresAt, state: null, state_expires_at: null, pkce_verifier_ciphertext: null, updated_at: new Date().toISOString() }).eq('id', session.id)
  if (saveErr) return new Response('IRS session was authorized but could not be stored securely.', { status: 500 })
  return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:32px"><h2>IRS TDS connected</h2><p>You can close this window and return to the CRM.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !serviceKey) return json({ error: 'Supabase runtime is not configured' }, 500)
  const service = createClient(url, serviceKey)
  const requestUrl = new URL(req.url)
  if (req.method === 'GET' && requestUrl.searchParams.has('state')) {
    try { return await handleCallback(req, service) } catch (e) { return new Response(e instanceof Error ? e.message : 'IRS authorization failed.', { status: 500 }) }
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)
    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const { data: userData, error: userErr } = await userDb.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'Authentication required' }, 401)
    const employee = await resolveEmployee(userDb, userData.user)
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'capabilities')
    const session = await getSession(service, employee.tenant_id, userData.user.id)

    if (action === 'capabilities') {
      const active = sessionSetupConfigured() && sessionIsActive(session)
      return json({ directConfigured: active, sessionSetupConfigured: sessionSetupConfigured(), sessionActive: active, expiresAt: active ? session.expires_at : null, organizationName: active ? session.organization_name : null })
    }

    if (action === 'begin-session') {
      if (!sessionSetupConfigured()) return json({ error: 'IRS TDS ISP authorization is not configured yet.', code: 'IRS_ISP_NOT_CONFIGURED' }, 409)
      const state = randomToken(32)
      const verifier = randomToken(48)
      const challenge = b64url(await sha256Bytes(verifier))
      const stateExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      const encryptedVerifier = await encryptText(verifier)
      const { error: upsertErr } = await service.from('irs_tds_sessions').upsert({ tenant_id: employee.tenant_id, user_id: userData.user.id, user_email: userData.user.email || null, state, state_expires_at: stateExpiresAt, pkce_verifier_ciphertext: encryptedVerifier, access_token_ciphertext: null, expires_at: null, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,user_id' })
      if (upsertErr) throw new Error(upsertErr.message)
      const authorizationUrl = renderUrl(env('IRS_TDS_ISP_AUTHORIZE_URL_TEMPLATE'), { clientId: env('IRS_TDS_CLIENT_ID'), redirectUri: env('IRS_TDS_REDIRECT_URI'), state, codeChallenge: challenge })
      return json({ ok: true, authorizationUrl })
    }

    if (action === 'end-session') {
      await service.from('irs_tds_sessions').update({ access_token_ciphertext: null, expires_at: null, state: null, state_expires_at: null, pkce_verifier_ciphertext: null, updated_at: new Date().toISOString() }).eq('tenant_id', employee.tenant_id).eq('user_id', userData.user.id)
      return json({ ok: true })
    }

    const requestId = String(body?.requestId || '').trim()
    if (!requestId) return json({ error: 'requestId is required' }, 400)
    const { data: pull, error: pullErr } = await userDb.from('transcript_pull_requests').select('*').eq('id', requestId).maybeSingle()
    if (pullErr || !pull) return json({ error: 'Transcript pull request not found or not authorized' }, 404)
    if (String(pull.tenant_id) !== String(employee.tenant_id)) return json({ error: 'Transcript pull request tenant mismatch' }, 403)
    const activeSession = await requireActiveSession(service, employee.tenant_id, userData.user.id)
    const ctx = await resolveContext(service, pull)

    if (action === 'submit') {
      try {
        const externalId = await submitWire(ctx, activeSession.token)
        const { error } = await userDb.from('transcript_pull_requests').update({ provider_request_id: externalId, provider_status: 'Submitted', provider_error: null, provider_submitted_at: new Date().toISOString(), provider_last_checked_at: new Date().toISOString(), status: 'In Progress' }).eq('id', requestId)
        if (error) throw new Error(error.message)
        return json({ ok: true, providerRequestId: externalId, status: 'Submitted' })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'IRS TDS submission failed.'
        await userDb.from('transcript_pull_requests').update({ provider_status: 'Error', provider_error: message, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId)
        return json({ error: message, code: (e as any)?.code || null }, 502)
      }
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
      const resp = await fetch(renderUrl(env('IRS_TDS_STATUS_URL_TEMPLATE'), ctx), { method: env('IRS_TDS_STATUS_METHOD') || 'GET', headers: sessionHeaders(activeSession.token) })
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
            const d = await fetch(String(downloadUrl), { headers: sessionHeaders(activeSession.token) })
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
        const { error: updateErr } = await userDb.from('transcript_pull_requests').update({ provider_status: 'Delivered', provider_error: null, provider_last_checked_at: new Date().toISOString(), provider_file_path: filePath, provider_result_keys: [...resultKeys, resultKey], provider_file_paths: [...filePaths, filePath] }).eq('id', requestId)
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
    const code = (e as any)?.code || null
    return json({ error: e instanceof Error ? e.message : 'Transcript pull failed', code }, code === 'IRS_SESSION_REQUIRED' ? 409 : 500)
  }
})

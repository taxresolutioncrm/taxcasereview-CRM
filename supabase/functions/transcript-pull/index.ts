import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const env = (name: string) => (Deno.env.get(name) || '').trim()
const AUTHORIZE_URL = () => env('IRS_TDS_ISP_AUTHORIZE_URL') || 'https://api.www4.irs.gov/auth/oauth/v2/authorize'
const TOKEN_URL = () => env('IRS_TDS_ISP_TOKEN_URL') || 'https://api.www4.irs.gov/auth/oauth/v2/token'
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

const sessionSetupConfigured = () => Boolean(
  env('IRS_TDS_CLIENT_ID') && env('IRS_TDS_JWT_KID') && env('IRS_TDS_JWT_PRIVATE_KEY_PEM') &&
  env('IRS_TDS_REDIRECT_URI') && env('IRS_TDS_REQUEST_URL') && env('IRS_TDS_REQUEST_TEMPLATE') && env('IRS_TDS_STATUS_URL_TEMPLATE')
)

function getPath(obj: any, path: string) { if (!path) return undefined; return path.split('.').reduce((v, k) => v == null ? undefined : v[k], obj) }
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

function parseYears(value: any) {
  const out = new Set<string>(), s = String(value || '')
  const ranges = s.match(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g) || []
  for (const r of ranges) { const nums = r.match(/(?:19|20)\d{2}/g)?.map(Number) || []; if (nums.length === 2) for (let y = Math.min(nums[0], nums[1]); y <= Math.max(nums[0], nums[1]); y++) out.add(String(y)) }
  const rest = s.replace(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g, ' ')
  for (const y of rest.match(/(?:19|20)\d{2}/g) || []) out.add(y)
  return out
}

function b64url(bytes: Uint8Array) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b) }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function b64urlJson(value: unknown) { return b64url(new TextEncoder().encode(JSON.stringify(value))) }
function fromB64url(value: string) { let s = value.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)) }
function randomToken(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a) }

async function importPrivateKey() {
  const body = env('IRS_TDS_JWT_PRIVATE_KEY_PEM').replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  if (!body) throw new Error('IRS TDS JWT private key is not configured.')
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}
async function createClientAssertion() {
  const clientId = env('IRS_TDS_CLIENT_ID'), now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64urlJson({ alg: 'RS256', kid: env('IRS_TDS_JWT_KID'), typ: 'JWT' })}.${b64urlJson({ iss: clientId, sub: clientId, aud: TOKEN_URL(), iat: now, exp: now + 900, jti: crypto.randomUUID() })}`
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importPrivateKey(), new TextEncoder().encode(unsigned)))
  return `${unsigned}.${b64url(sig)}`
}
async function sha256Hex(bytes: Uint8Array) { const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer); return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('') }
async function tokenKey() { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env('SUPABASE_SERVICE_ROLE_KEY') + ':irs-tds-session:v2')); return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']) }
async function encryptText(value: string) { const iv = new Uint8Array(12); crypto.getRandomValues(iv); const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(), new TextEncoder().encode(value))); return `${b64url(iv)}.${b64url(cipher)}` }
async function decryptText(value: string) { const [ivPart, dataPart] = String(value || '').split('.'); if (!ivPart || !dataPart) throw new Error('IRS session token is invalid.'); const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(ivPart) }, await tokenKey(), fromB64url(dataPart)); return new TextDecoder().decode(clear) }
async function readBody(resp: Response) { const type = (resp.headers.get('content-type') || '').toLowerCase(); if (type.includes('application/pdf')) return { kind: 'pdf', bytes: new Uint8Array(await resp.arrayBuffer()) } as const; const text = await resp.text(); let data: any; try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }; return { kind: 'json', data } as const }

async function resolveEmployee(userDb: any, user: any) {
  const email = String(user?.email || '').trim(); if (!email) throw new Error('Signed-in employee email is required.')
  const { data, error } = await userDb.from('employees').select('tenant_id,perm_irs,email').ilike('email', email).limit(2)
  if (error) throw new Error(error.message); if (!data || data.length !== 1) throw new Error('Could not resolve one tenant-scoped employee record for this IRS session.'); if (Number(data[0].perm_irs || 0) < 2) throw new Error('IRS write permission is required for direct TDS pulls.'); return data[0]
}
async function getSession(service: any, tenantId: string, userId: string) { const { data, error } = await service.from('irs_tds_sessions').select('*').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(); if (error) throw new Error(error.message); return data || null }
function sessionWindowActive(row: any) { return Boolean(row?.session_expires_at && new Date(row.session_expires_at).getTime() > Date.now() + 15000) }
async function refreshAccessToken(service: any, row: any) {
  if (!row?.refresh_token_ciphertext || !sessionWindowActive(row)) throw Object.assign(new Error('Your IRS TDS session expired. Sign in to the IRS again.'), { code: 'IRS_SESSION_REQUIRED' })
  const refreshToken = await decryptText(row.refresh_token_ciphertext)
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_assertion_type: ASSERTION_TYPE, client_assertion: await createClientAssertion() })
  const resp = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), parsed = await readBody(resp)
  if (!resp.ok || parsed.kind !== 'json') throw Object.assign(new Error(`IRS TDS token refresh failed (${resp.status}). Sign in again.`), { code: 'IRS_SESSION_REQUIRED' })
  const accessToken = String(parsed.data?.access_token || '').trim(); if (!accessToken) throw Object.assign(new Error('IRS TDS token refresh returned no access token. Sign in again.'), { code: 'IRS_SESSION_REQUIRED' })
  const nextRefresh = String(parsed.data?.refresh_token || refreshToken).trim(), seconds = Math.max(60, Math.min(Number(parsed.data?.expires_in || 900) || 900, 900))
  const patch = { access_token_ciphertext: await encryptText(accessToken), refresh_token_ciphertext: await encryptText(nextRefresh), access_expires_at: new Date(Date.now() + seconds * 1000).toISOString(), updated_at: new Date().toISOString() }
  const { error } = await service.from('irs_tds_sessions').update(patch).eq('id', row.id); if (error) throw new Error(error.message); return { ...row, ...patch, accessToken }
}
async function requireActiveSession(service: any, tenantId: string, userId: string) {
  let row = await getSession(service, tenantId, userId)
  if (!sessionWindowActive(row)) throw Object.assign(new Error('Your IRS TDS session is not active. Sign in to the IRS again.'), { code: 'IRS_SESSION_REQUIRED' })
  if (row.access_token_ciphertext && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now() + 15000) return { row, token: await decryptText(row.access_token_ciphertext) }
  row = await refreshAccessToken(service, row); return { row, token: row.accessToken }
}

async function resolveContext(service: any, pull: any) {
  if (!pull || pull.provider !== 'irs_a2a') throw new Error('This request is not configured for direct IRS TDS.')
  const tenantId = String(pull.tenant_id || ''); if (!tenantId) throw new Error('Transcript pull request is missing tenant scope.')
  const { data: poa, error: poaErr } = await service.from('poa_records').select('id,status,form_type,tax_years').eq('tenant_id', tenantId).eq('id', pull.poa_record_id).maybeSingle()
  if (poaErr || !poa || poa.status !== 'On File') throw new Error('A valid POA/TIA with status On File is required.')
  const requestedYears = parseYears(pull.tax_years)
  if (requestedYears.size > 0) { const authorizedYears = parseYears(poa.tax_years); if (authorizedYears.size === 0 || [...requestedYears].some(y => !authorizedYears.has(y))) throw new Error('The recorded POA/TIA does not cover every requested tax year.') }
  const { data: clients, error: clientErr } = await service.from('clients').select('id,name,ssn,ein').eq('tenant_id', tenantId).eq('name', pull.client_name).limit(2)
  if (clientErr) throw new Error(clientErr.message); if (!clients || clients.length !== 1) throw new Error('Direct TDS requires exactly one matching client record.')
  const client = clients[0], tin = String(client.ein || client.ssn || '').replace(/\D/g, ''); if (!tin) throw new Error('Client SSN/EIN is required for direct TDS.')
  const { data: settings, error: settingsErr } = await service.from('settings').select('caf_number').eq('tenant_id', tenantId).limit(1).maybeSingle(); if (settingsErr) throw new Error(settingsErr.message)
  const caf = String(settings?.caf_number || '').trim(); if (!caf) throw new Error('Office CAF number is required for direct TDS.')
  return { requestId: pull.id, clientId: client.id, clientName: pull.client_name, tin, tinType: client.ein ? 'EIN' : 'SSN', caf, poaId: poa.id, poaFormType: poa.form_type, taxYears: [...requestedYears], transcriptTypes: pull.transcript_types || [], requestedBy: pull.requested_by || '', providerRequestId: pull.provider_request_id || '' }
}
function sessionHeaders(token: string) { const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, application/pdf', Authorization: `Bearer ${token}` }; const extra = env('IRS_TDS_EXTRA_HEADERS_JSON'); if (extra) Object.assign(headers, JSON.parse(extra)); return headers }
async function submitWire(ctx: Record<string, any>, token: string) {
  const resp = await fetch(env('IRS_TDS_REQUEST_URL'), { method: env('IRS_TDS_REQUEST_METHOD') || 'POST', headers: sessionHeaders(token), body: JSON.stringify(renderTemplate(env('IRS_TDS_REQUEST_TEMPLATE'), ctx)) }), parsed = await readBody(resp)
  if (!resp.ok) throw new Error(`IRS TDS request failed (${resp.status}).`); if (parsed.kind !== 'json') throw new Error('IRS TDS submit response format was unexpected.')
  const idPath = env('IRS_TDS_RESPONSE_ID_PATH') || 'transactionId', externalId = String(getPath(parsed.data, idPath) || '').trim(); if (!externalId) throw new Error(`IRS TDS response did not contain a request ID at ${idPath}.`); return externalId
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS }); if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !anon || !serviceKey) return json({ error: 'Supabase runtime is not configured' }, 500)
    const auth = req.headers.get('Authorization') || ''; if (!auth.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)
    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } }), service = createClient(url, serviceKey)
    const { data: userData, error: userErr } = await userDb.auth.getUser(); if (userErr || !userData?.user) return json({ error: 'Authentication required' }, 401)
    const employee = await resolveEmployee(userDb, userData.user), body = await req.json().catch(() => ({})), action = String(body?.action || 'capabilities'), session = await getSession(service, employee.tenant_id, userData.user.id)
    if (action === 'capabilities') { const active = sessionSetupConfigured() && sessionWindowActive(session); return json({ directConfigured: active, sessionSetupConfigured: sessionSetupConfigured(), sessionActive: active, expiresAt: active ? session.session_expires_at : null, accessExpiresAt: active ? session.access_expires_at : null, organizationName: active ? session.organization_name : null }) }
    if (action === 'begin-session') {
      if (!sessionSetupConfigured()) return json({ error: 'IRS TDS ISP authorization is not configured yet.', code: 'IRS_ISP_NOT_CONFIGURED' }, 409)
      const state = randomToken(32), { error } = await service.from('irs_tds_sessions').upsert({ tenant_id: employee.tenant_id, user_id: userData.user.id, user_email: userData.user.email || null, state, state_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), access_token_ciphertext: null, refresh_token_ciphertext: null, access_expires_at: null, session_expires_at: null, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,user_id' }); if (error) throw new Error(error.message)
      const u = new URL(AUTHORIZE_URL()); u.searchParams.set('client_id', env('IRS_TDS_CLIENT_ID')); u.searchParams.set('response_type', 'code'); u.searchParams.set('state', state); return json({ ok: true, authorizationUrl: u.toString(), redirectUri: env('IRS_TDS_REDIRECT_URI') })
    }
    if (action === 'end-session') { await service.from('irs_tds_sessions').update({ access_token_ciphertext: null, refresh_token_ciphertext: null, access_expires_at: null, session_expires_at: null, state: null, state_expires_at: null, updated_at: new Date().toISOString() }).eq('tenant_id', employee.tenant_id).eq('user_id', userData.user.id); return json({ ok: true }) }
    const requestId = String(body?.requestId || '').trim(); if (!requestId) return json({ error: 'requestId is required' }, 400)
    const { data: pull, error: pullErr } = await userDb.from('transcript_pull_requests').select('*').eq('id', requestId).maybeSingle(); if (pullErr || !pull) return json({ error: 'Transcript pull request not found or not authorized' }, 404); if (String(pull.tenant_id) !== String(employee.tenant_id)) return json({ error: 'Transcript pull request tenant mismatch' }, 403)
    const activeSession = await requireActiveSession(service, employee.tenant_id, userData.user.id), ctx = await resolveContext(service, pull)
    if (action === 'submit') {
      try { const externalId = await submitWire(ctx, activeSession.token); const { error } = await userDb.from('transcript_pull_requests').update({ provider_request_id: externalId, provider_status: 'Submitted', provider_error: null, provider_submitted_at: new Date().toISOString(), provider_last_checked_at: new Date().toISOString(), status: 'In Progress' }).eq('id', requestId); if (error) throw new Error(error.message); return json({ ok: true, providerRequestId: externalId, status: 'Submitted' }) }
      catch (e) { const message = e instanceof Error ? e.message : 'IRS TDS submission failed.'; await userDb.from('transcript_pull_requests').update({ provider_status: 'Error', provider_error: message, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId); return json({ error: message }, 502) }
    }
    if (action === 'status') {
      if (pull.provider_status === 'Filed' && pull.status === 'Completed') return json({ ok: true, status: 'Filed' })
      const resultKeys: string[] = pull.provider_result_keys || [], filePaths: string[] = pull.provider_file_paths || [], filedKeys: string[] = pull.provider_filed_keys || [], pendingIndex = resultKeys.findIndex((k: string) => !filedKeys.includes(k))
      if (pendingIndex >= 0 && filePaths[pendingIndex]) { const filePath = filePaths[pendingIndex], { data: signed, error: signErr } = await service.storage.from('documents').createSignedUrl(filePath, 900); if (signErr || !signed?.signedUrl) throw new Error('Could not create secure transcript link.'); return json({ ok: true, status: 'Delivered', resultKey: resultKeys[pendingIndex], filePath, signedUrl: signed.signedUrl }) }
      if (!pull.provider_request_id) return json({ error: 'This request has not been submitted to IRS TDS yet.' }, 409)
      ctx.providerRequestId = pull.provider_request_id
      const resp = await fetch(renderUrl(env('IRS_TDS_STATUS_URL_TEMPLATE'), ctx), { method: env('IRS_TDS_STATUS_METHOD') || 'GET', headers: sessionHeaders(activeSession.token) }), parsed = await readBody(resp); if (!resp.ok) return json({ error: `IRS TDS status request failed (${resp.status}).` }, 502)
      let pdfBytes: Uint8Array | null = parsed.kind === 'pdf' ? parsed.bytes : null; let remoteStatus = 'In Progress'
      if (parsed.kind === 'json') { remoteStatus = String(getPath(parsed.data, env('IRS_TDS_STATUS_PATH') || 'status') || 'In Progress'); const base64Path = env('IRS_TDS_PDF_BASE64_PATH'), downloadPath = env('IRS_TDS_DOWNLOAD_URL_PATH'), b64 = base64Path ? getPath(parsed.data, base64Path) : null; if (b64) pdfBytes = Uint8Array.from(atob(String(b64)), c => c.charCodeAt(0)); if (!pdfBytes && downloadPath) { const downloadUrl = getPath(parsed.data, downloadPath); if (downloadUrl) { const d = await fetch(String(downloadUrl), { headers: sessionHeaders(activeSession.token) }); if (!d.ok) throw new Error(`IRS TDS transcript download failed (${d.status}).`); pdfBytes = new Uint8Array(await d.arrayBuffer()) } } }
      if (pdfBytes?.length) { const resultKey = await sha256Hex(pdfBytes); if (resultKeys.includes(resultKey)) return json({ ok: true, status: remoteStatus, duplicate: true, resultKey }); const filePath = `tds-direct/${pull.tenant_id}/${pull.id}/${resultKey}.pdf`, { error: uploadErr } = await service.storage.from('documents').upload(filePath, pdfBytes, { contentType: 'application/pdf', upsert: false }); if (uploadErr) throw new Error(`Could not store IRS transcript: ${uploadErr.message}`); const { data: signed, error: signErr } = await service.storage.from('documents').createSignedUrl(filePath, 900); if (signErr || !signed?.signedUrl) throw new Error('Could not create secure transcript link.'); const { error: updateErr } = await userDb.from('transcript_pull_requests').update({ provider_status: 'Delivered', provider_error: null, provider_last_checked_at: new Date().toISOString(), provider_file_path: filePath, provider_result_keys: [...resultKeys, resultKey], provider_file_paths: [...filePaths, filePath] }).eq('id', requestId); if (updateErr) throw new Error(updateErr.message); return json({ ok: true, status: 'Delivered', resultKey, filePath, signedUrl: signed.signedUrl }) }
      const { error: updateErr } = await userDb.from('transcript_pull_requests').update({ provider_status: remoteStatus, provider_error: null, provider_last_checked_at: new Date().toISOString() }).eq('id', requestId); if (updateErr) throw new Error(updateErr.message); return json({ ok: true, status: remoteStatus })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) { console.error('[transcript-pull]', e); const code = (e as any)?.code || null; return json({ error: e instanceof Error ? e.message : 'Transcript pull failed', code }, code === 'IRS_SESSION_REQUIRED' ? 409 : 500) }
})

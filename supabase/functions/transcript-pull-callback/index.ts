import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const env = (name: string) => (Deno.env.get(name) || '').trim()

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

function b64url(bytes: Uint8Array) {
  let s = ''
  bytes.forEach(b => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64url(value: string) {
  let s = value.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const raw = atob(s)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
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

async function decryptText(value: string) {
  const [ivPart, dataPart] = String(value || '').split('.')
  if (!ivPart || !dataPart) throw new Error('IRS authorization verifier is invalid.')
  const key = await tokenKey()
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(ivPart) }, key, fromB64url(dataPart))
  return new TextDecoder().decode(clear)
}

function html(title: string, message: string, status = 200) {
  return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:32px"><h2>${title}</h2><p>${message}</p>${status < 400 ? '<script>setTimeout(()=>window.close(),1200)</script>' : ''}</body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  try {
    const url = env('SUPABASE_URL')
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return html('IRS TDS connection failed', 'Supabase runtime is not configured.', 500)
    const service = createClient(url, serviceKey)
    const u = new URL(req.url)
    const state = u.searchParams.get('state') || ''
    const code = u.searchParams.get('code') || ''
    const providerError = u.searchParams.get('error') || ''
    if (!state) return html('IRS TDS connection failed', 'Missing IRS authorization state.', 400)

    const { data: session, error } = await service.from('irs_tds_sessions').select('*').eq('state', state).maybeSingle()
    if (error || !session) return html('IRS TDS connection failed', 'IRS authorization state was not recognized.', 400)
    if (!session.state_expires_at || new Date(session.state_expires_at).getTime() < Date.now()) return html('IRS TDS connection expired', 'Return to the CRM and sign in again.', 400)
    if (providerError) return html('IRS TDS connection denied', providerError, 400)
    if (!code) return html('IRS TDS connection failed', 'IRS authorization did not return a code.', 400)

    const verifier = await decryptText(session.pkce_verifier_ciphertext)
    const ctx = { code, clientId: env('IRS_TDS_CLIENT_ID'), redirectUri: env('IRS_TDS_REDIRECT_URI'), codeVerifier: verifier }
    const tokenBody = renderText(env('IRS_TDS_ISP_TOKEN_BODY_TEMPLATE'), ctx, true)
    const tokenHeaders: Record<string, string> = { 'Content-Type': env('IRS_TDS_ISP_TOKEN_CONTENT_TYPE') || 'application/x-www-form-urlencoded' }
    const extra = env('IRS_TDS_ISP_TOKEN_HEADERS_JSON')
    if (extra) Object.assign(tokenHeaders, JSON.parse(extra))

    const tokenResp = await fetch(env('IRS_TDS_ISP_TOKEN_URL'), { method: 'POST', headers: tokenHeaders, body: tokenBody })
    const text = await tokenResp.text()
    let tokenData: any = {}
    try { tokenData = text ? JSON.parse(text) : {} } catch { return html('IRS TDS connection failed', `IRS token exchange returned an unexpected response (${tokenResp.status}).`, 502) }
    if (!tokenResp.ok) return html('IRS TDS connection failed', `IRS token exchange failed (${tokenResp.status}).`, 502)

    const accessPath = env('IRS_TDS_ISP_ACCESS_TOKEN_PATH') || 'access_token'
    const expiresPath = env('IRS_TDS_ISP_EXPIRES_IN_PATH') || 'expires_in'
    const orgPath = env('IRS_TDS_ISP_ORGANIZATION_PATH')
    const accessToken = String(getPath(tokenData, accessPath) || '').trim()
    if (!accessToken) return html('IRS TDS connection failed', `IRS token response did not include a token at ${accessPath}.`, 502)

    const rawSeconds = Number(getPath(tokenData, expiresPath) || 3600)
    const expiresSeconds = Math.max(60, Math.min(Number.isFinite(rawSeconds) ? rawSeconds : 3600, 3600))
    const organizationName = orgPath ? String(getPath(tokenData, orgPath) || '').trim() : null
    const accessCipher = await encryptText(accessToken)
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString()

    const { error: saveErr } = await service.from('irs_tds_sessions').update({
      access_token_ciphertext: accessCipher,
      organization_name: organizationName || session.organization_name || null,
      expires_at: expiresAt,
      state: null,
      state_expires_at: null,
      pkce_verifier_ciphertext: null,
      updated_at: new Date().toISOString(),
    }).eq('id', session.id)
    if (saveErr) return html('IRS TDS connection failed', 'Authorization succeeded but the CRM could not store the short-lived session.', 500)

    return html('IRS TDS connected', 'You can close this window and return to the CRM.')
  } catch (e) {
    return html('IRS TDS connection failed', e instanceof Error ? e.message : 'Unexpected callback error.', 500)
  }
})

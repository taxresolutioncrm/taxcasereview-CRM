import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const env = (name: string) => (Deno.env.get(name) || '').trim()
const TOKEN_URL = () => env('IRS_TDS_ISP_TOKEN_URL') || 'https://api.www4.irs.gov/auth/oauth/v2/token'
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
const CRM_ORIGIN = env('IRS_TDS_CRM_ORIGIN') || 'https://taxrescrm.app'

function b64url(bytes: Uint8Array) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b) }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function b64urlJson(value: unknown) { return b64url(new TextEncoder().encode(JSON.stringify(value))) }
function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)) }

function derLength(n: number) {
  if (n < 128) return new Uint8Array([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff)
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}
function derTag(tag: number, value: Uint8Array) {
  const len = derLength(value.length), out = new Uint8Array(1 + len.length + value.length)
  out[0] = tag; out.set(len, 1); out.set(value, 1 + len.length); return out
}
function concatBytes(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}
function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const rsaOidAndNull = new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00])
  return derTag(0x30, concatBytes(version, rsaOidAndNull, derTag(0x04, pkcs1)))
}
async function importPrivateKey() {
  const pem = env('IRS_TDS_JWT_PRIVATE_KEY_PEM')
  if (!pem) throw new Error('IRS TDS JWT private key is not configured.')
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY')
  const body = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('IRS TDS JWT private key is empty.')
  const raw = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  const der = isPkcs1 ? pkcs1ToPkcs8(raw) : raw
  try {
    return await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } catch {
    throw new Error('IRS TDS JWT private key must be an RSA PKCS#8 or PKCS#1 PEM key matching the registered IRS JWK/certificate.')
  }
}
async function createClientAssertion() {
  const clientId = env('IRS_TDS_CLIENT_ID'), now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64urlJson({ alg: 'RS256', kid: env('IRS_TDS_JWT_KID'), typ: 'JWT' })}.${b64urlJson({ iss: clientId, sub: clientId, aud: TOKEN_URL(), iat: now, exp: now + 900, jti: crypto.randomUUID() })}`
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importPrivateKey(), new TextEncoder().encode(unsigned)))
  return `${unsigned}.${b64url(sig)}`
}
async function tokenKey() { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env('SUPABASE_SERVICE_ROLE_KEY') + ':irs-tds-session:v2')); return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']) }
async function encryptText(value: string) { const iv = new Uint8Array(12); crypto.getRandomValues(iv); const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(), new TextEncoder().encode(value))); return `${b64url(iv)}.${b64url(cipher)}` }
function html(title: string, message: string, status = 200) {
  const payload = JSON.stringify({
    type: 'nashville-irs-tds-oauth',
    ok: status < 400,
    message,
  }).replace(/</g, '\\u003c')
  const target = JSON.stringify(CRM_ORIGIN)
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:32px"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><script>try{window.opener&&window.opener.postMessage(${payload},${target})}catch(e){};setTimeout(()=>window.close(),1200)</script></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Pragma': 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
      },
    },
  )
}

serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  try {
    const url = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !serviceKey) return html('IRS TDS connection failed', 'Supabase runtime is not configured.', 500)
    const service = createClient(url, serviceKey), u = new URL(req.url), state = u.searchParams.get('state') || '', code = u.searchParams.get('code') || '', providerError = u.searchParams.get('error') || ''
    if (!state) return html('IRS TDS connection failed', 'Missing IRS authorization state.', 400)
    const { data: session, error } = await service.from('irs_tds_sessions').select('*').eq('state', state).maybeSingle()
    if (error || !session) return html('IRS TDS connection failed', 'IRS authorization state was not recognized.', 400)
    if (!session.state_expires_at || new Date(session.state_expires_at).getTime() < Date.now()) return html('IRS TDS connection expired', 'Return to the CRM and sign in again.', 400)

    // Claim the state exactly once before processing the provider response.
    // Concurrent/replayed callbacks cannot exchange the same authorization flow.
    const { data: claimed, error: claimErr } = await service.from('irs_tds_sessions')
      .update({ state: null, state_expires_at: null, updated_at: new Date().toISOString() })
      .eq('id', session.id)
      .eq('state', state)
      .select('id')
      .maybeSingle()
    if (claimErr || !claimed?.id) return html('IRS TDS connection failed', 'This IRS authorization response was already used. Start a new sign-in from the CRM.', 400)

    if (providerError) return html('IRS TDS connection denied', providerError, 400)
    if (!code) return html('IRS TDS connection failed', 'IRS authorization did not return a code.', 400)
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_assertion_type: ASSERTION_TYPE,
      client_assertion: await createClientAssertion(),
    })
    const tokenResp = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), text = await tokenResp.text()
    let tokenData: any = {}; try { tokenData = text ? JSON.parse(text) : {} } catch { return html('IRS TDS connection failed', `IRS token exchange returned an unexpected response (${tokenResp.status}).`, 502) }
    if (!tokenResp.ok) return html('IRS TDS connection failed', `IRS token exchange failed (${tokenResp.status}).`, 502)
    const accessToken = String(tokenData?.access_token || '').trim(), refreshToken = String(tokenData?.refresh_token || '').trim(); if (!accessToken || !refreshToken) return html('IRS TDS connection failed', 'IRS token response did not include both access and refresh tokens.', 502)
    const seconds = Math.max(60, Math.min(Number(tokenData?.expires_in || 900) || 900, 900)), now = Date.now()
    const { error: saveErr } = await service.from('irs_tds_sessions').update({ access_token_ciphertext: await encryptText(accessToken), refresh_token_ciphertext: await encryptText(refreshToken), access_expires_at: new Date(now + seconds * 1000).toISOString(), session_expires_at: new Date(now + 60 * 60 * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', session.id)
    if (saveErr) return html('IRS TDS connection failed', 'Authorization succeeded but the CRM could not store the short-lived session.', 500)
    return html('IRS TDS connected', 'You can close this window and return to the CRM.')
  } catch (e) { return html('IRS TDS connection failed', e instanceof Error ? e.message : 'Unexpected callback error.', 500) }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const env = (name: string) => (Deno.env.get(name) || '').trim()
const TOKEN_URL = () => env('IRS_TDS_ISP_TOKEN_URL') || 'https://api.www4.irs.gov/auth/oauth/v2/token'
const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'

function b64url(bytes: Uint8Array) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b) }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '') }
function b64urlJson(value: unknown) { return b64url(new TextEncoder().encode(JSON.stringify(value))) }

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
async function tokenKey() { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env('SUPABASE_SERVICE_ROLE_KEY') + ':irs-tds-session:v2')); return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']) }
async function encryptText(value: string) { const iv = new Uint8Array(12); crypto.getRandomValues(iv); const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(), new TextEncoder().encode(value))); return `${b64url(iv)}.${b64url(cipher)}` }
function html(title: string, message: string, status = 200) { return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:32px"><h2>${title}</h2><p>${message}</p>${status < 400 ? '<script>setTimeout(()=>window.close(),1200)</script>' : ''}</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) }

serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  try {
    const url = env('SUPABASE_URL'), serviceKey = env('SUPABASE_SERVICE_ROLE_KEY'); if (!url || !serviceKey) return html('IRS TDS connection failed', 'Supabase runtime is not configured.', 500)
    const service = createClient(url, serviceKey), u = new URL(req.url), state = u.searchParams.get('state') || '', code = u.searchParams.get('code') || '', providerError = u.searchParams.get('error') || ''
    if (!state) return html('IRS TDS connection failed', 'Missing IRS authorization state.', 400)
    const { data: session, error } = await service.from('irs_tds_sessions').select('*').eq('state', state).maybeSingle()
    if (error || !session) return html('IRS TDS connection failed', 'IRS authorization state was not recognized.', 400)
    if (!session.state_expires_at || new Date(session.state_expires_at).getTime() < Date.now()) return html('IRS TDS connection expired', 'Return to the CRM and sign in again.', 400)
    if (providerError) return html('IRS TDS connection denied', providerError, 400)
    if (!code) return html('IRS TDS connection failed', 'IRS authorization did not return a code.', 400)
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_assertion_type: ASSERTION_TYPE, client_assertion: await createClientAssertion() })
    const tokenResp = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), text = await tokenResp.text()
    let tokenData: any = {}; try { tokenData = text ? JSON.parse(text) : {} } catch { return html('IRS TDS connection failed', `IRS token exchange returned an unexpected response (${tokenResp.status}).`, 502) }
    if (!tokenResp.ok) return html('IRS TDS connection failed', `IRS token exchange failed (${tokenResp.status}).`, 502)
    const accessToken = String(tokenData?.access_token || '').trim(), refreshToken = String(tokenData?.refresh_token || '').trim(); if (!accessToken || !refreshToken) return html('IRS TDS connection failed', 'IRS token response did not include both access and refresh tokens.', 502)
    const seconds = Math.max(60, Math.min(Number(tokenData?.expires_in || 900) || 900, 900)), now = Date.now()
    const { error: saveErr } = await service.from('irs_tds_sessions').update({ access_token_ciphertext: await encryptText(accessToken), refresh_token_ciphertext: await encryptText(refreshToken), access_expires_at: new Date(now + seconds * 1000).toISOString(), session_expires_at: new Date(now + 60 * 60 * 1000).toISOString(), state: null, state_expires_at: null, updated_at: new Date().toISOString() }).eq('id', session.id)
    if (saveErr) return html('IRS TDS connection failed', 'Authorization succeeded but the CRM could not store the short-lived session.', 500)
    return html('IRS TDS connected', 'You can close this window and return to the CRM.')
  } catch (e) { return html('IRS TDS connection failed', e instanceof Error ? e.message : 'Unexpected callback error.', 500) }
})

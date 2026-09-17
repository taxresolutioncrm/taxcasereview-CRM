import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mpxgxfqdbquzkrvvejkh.supabase.co'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weGd4ZnFkYnF1emtydnZlamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTk5MzksImV4cCI6MjA5NDg3NTkzOX0.puvhU1MV5nGOykizeTkwCpRR7NKKaGsVpA8oqjVjmu4'

// admin.romylabs.com is the platform control plane. A stale Jump In flag from
// a prior tenant session must never prevent the platform owner from reaching
// /crm-admin. Explicit ?imp=1 sessions are preserved so intentional Jump In
// behavior continues to work unchanged.
if (typeof window !== 'undefined' && window.location.hostname.toLowerCase() === 'admin.romylabs.com') {
  const impParam = new URLSearchParams(window.location.search).get('imp')
  if (!impParam) {
    try { sessionStorage.removeItem('admin_impersonation') } catch (_) {}
  }
}

const PORTAL_PAYMENT_FUNCTIONS = [
  'stripe-set-autopay',
  'stripe-setup-intent',
  'stripe-save-payment-method',
  'stripe-invoice-pay-intent',
  'stripe-invoice-pay-confirm',
]

const DEMO_LOGIN = 'demo@taxrescrm.net'
const DEMO_TENANT = 'a0000000-0000-0000-0000-000000000001'
const DEMO_PUBLIC_KINDS = new Set(['esign_signed_copy', 'employee_timeoff_notification'])

function requestHeaders(input, init) {
  return new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {})
}

function jwtEmail(headers) {
  try {
    const auth = headers.get('Authorization') || headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const payload = token.split('.')[1]
    if (!payload) return ''
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
    return String(JSON.parse(atob(padded))?.email || '').toLowerCase()
  } catch { return '' }
}

function jsonBody(init) {
  try {
    if (typeof init?.body !== 'string') return null
    return JSON.parse(init.body)
  } catch { return null }
}

async function demoMailRequest(url, init, body) {
  const demoUrl = url.replace('/functions/v1/send-email', '/functions/v1/demo-send-email')
  const res = await fetch(demoUrl, { ...init, body: JSON.stringify(body || {}) })
  if (res.status === 409) {
    try {
      const data = await res.clone().json()
      if (data?.passthrough === true) return null
    } catch {}
  }
  return res
}

async function secureFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  const headers = requestHeaders(input, init)

  if (typeof sessionStorage !== 'undefined' && PORTAL_PAYMENT_FUNCTIONS.some(fn => url.includes(`/functions/v1/${fn}`))) {
    const tokenKey = Object.keys(sessionStorage).find(k => k.startsWith('tcr_portal_token_'))
    const portalToken = tokenKey ? sessionStorage.getItem(tokenKey) : ''
    if (portalToken) headers.set('x-portal-token', portalToken)
  }
  init = { ...init, headers }

  const email = jwtEmail(headers)
  const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase()
  const body = jsonBody(init)

  // Every authenticated Demo action that would normally call the generic
  // send-email function is routed through the TaxRes-only Stalwart gateway.
  // Public signed-copy/time-off flows are tried there first; non-Demo tenants
  // receive passthrough=true and continue to the existing provider path.
  if (url.includes('/functions/v1/send-email')) {
    const shouldTryDemo = email === DEMO_LOGIN || DEMO_PUBLIC_KINDS.has(String(body?.kind || ''))
    if (shouldTryDemo) {
      const routed = await demoMailRequest(url, init, body)
      if (routed) return routed
    }
  }

  // The legacy Demo Email page used to insert a fake Sent row instead of
  // delivering mail. Keep its UI/data contract intact, but replace that one
  // POST with a real TaxRes CRM Stalwart send. The gateway writes the canonical
  // Sent row with the actual provider submission id, preventing duplicates.
  if (email === DEMO_LOGIN && method === 'POST' && url.includes('/rest/v1/emails')) {
    const rows = Array.isArray(body) ? body : body ? [body] : []
    const row = rows.find(r =>
      String(r?.tenant_id || '') === DEMO_TENANT &&
      String(r?.direction || '').toLowerCase() === 'outbound' &&
      r?.recipient && r?.subject
    )
    if (row) {
      const demoUrl = `${SUPABASE_URL}/functions/v1/demo-send-email`
      const res = await fetch(demoUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: row.recipient,
          subject: row.subject,
          html: row.body_html || undefined,
          text: row.body || '',
        }),
      })
      if (!res.ok) return res
      return new Response(null, { status: 201, headers: { 'Cache-Control': 'no-store' } })
    }
  }

  return fetch(input, init)
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: secureFetch },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    reconnectAfterMs: (attempts) => Math.min(1000 * Math.pow(2, attempts), 30000),
  },
})
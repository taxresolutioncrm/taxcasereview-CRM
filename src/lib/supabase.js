import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mpxgxfqdbquzkrvvejkh.supabase.co'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weGd4ZnFkYnF1emtydnZlamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTk5MzksImV4cCI6MjA5NDg3NTkzOX0.puvhU1MV5nGOykizeTkwCpRR7NKKaGsVpA8oqjVjmu4'

const EXPECTED_SUPABASE_PROJECT_REF = 'mpxgxfqdbquzkrvvejkh'
function projectRefFromUrl(value) {
  try {
    const host = new URL(value).hostname
    return host.endsWith('.supabase.co') ? host.split('.')[0] : ''
  } catch (_) { return '' }
}
const configuredProjectRef = projectRefFromUrl(SUPABASE_URL)
if (configuredProjectRef !== EXPECTED_SUPABASE_PROJECT_REF) {
  throw new Error(`Blocked CRM startup: this build is wired to Supabase project ${configuredProjectRef || 'unknown'}, expected ${EXPECTED_SUPABASE_PROJECT_REF}.`)
}

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

async function secureFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  if (typeof sessionStorage !== 'undefined' && PORTAL_PAYMENT_FUNCTIONS.some(fn => url.includes(`/functions/v1/${fn}`))) {
    const tokenKey = Object.keys(sessionStorage).find(k => k.startsWith('tcr_portal_token_'))
    const portalToken = tokenKey ? sessionStorage.getItem(tokenKey) : ''
    if (portalToken) {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined) || {})
      headers.set('x-portal-token', portalToken)
      init = { ...init, headers }
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
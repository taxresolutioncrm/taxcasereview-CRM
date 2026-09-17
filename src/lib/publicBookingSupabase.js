import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://mpxgxfqdbquzkrvvejkh.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1weGd4ZnFkYnF1emtydnZlamtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyOTk5MzksImV4cCI6MjA5NDg3NTkzOX0.puvhU1MV5nGOykizeTkwCpRR7NKKaGsVpA8oqjVjmu4'

async function publicBookingFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  if (!url.includes('/functions/v1/send-email')) return fetch(input, init)

  // Booking pages are public, so there is no employee JWT to tell us whether
  // the booking belongs to Demo. Ask the Demo gateway first. It validates the
  // opaque booking token against the database and returns passthrough=true for
  // every non-Demo tenant, which then continues through the normal mail path.
  const demoUrl = url.replace('/functions/v1/send-email', '/functions/v1/demo-send-email')
  const demoRes = await fetch(demoUrl, init)
  if (demoRes.status === 409) {
    try {
      const data = await demoRes.clone().json()
      if (data?.passthrough === true) return fetch(input, init)
    } catch {}
  }
  return demoRes
}

// Public booking must never inherit the CRM/admin user's persisted auth session.
// These RPCs are deliberately exposed to anon through SECURITY DEFINER functions.
export const publicBookingSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: publicBookingFetch },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

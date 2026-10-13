// Nashville Microsoft 365 sync moved to the dedicated Nashville Supabase project.
// This central endpoint is intentionally retired so stale central Nashville rows can
// never resume mailbox/fax synchronization.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-m365-sync-secret',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  return new Response(JSON.stringify({
    error: 'Nashville Microsoft 365 sync is isolated to the dedicated Nashville CRM.',
    code: 'NASHVILLE_DEDICATED_RUNTIME',
  }), { status: 410, headers: cors })
})

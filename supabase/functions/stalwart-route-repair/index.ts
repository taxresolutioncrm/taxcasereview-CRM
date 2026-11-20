/**
 * stalwart-route-repair
 *
 * One-shot edge function that removes the broken
 * `sender_domain == 'romylabs.com'  →  mx` routing rule
 * from Stalwart's live MtaOutboundStrategy singleton.
 *
 * That rule forces direct MX delivery (port 25) which OCI blocks.
 * Removing it makes romylabs.com outbound fall through to the
 * default relay (Oracle Email Delivery, port 587) — the same path
 * every other working domain uses.
 *
 * This function delegates the actual JMAP write to the romylabs-stalwart-api
 * Cloudflare Worker via its /api/mta-route-repair endpoint. The Worker
 * holds STALWART_API_TOKEN as a Cloudflare encrypted secret; this edge
 * function only needs REPAIR_SERVICE_SECRET (a shared service-to-service
 * secret) to authenticate to the Worker.
 *
 * Required Supabase secrets:
 *   REPAIR_SERVICE_SECRET   Shared secret that also lives in the CF Worker
 *
 * This edge function is also protected by:
 *   X-Repair-Secret header  (matches REPAIR_SECRET env var, or any value
 *   when REPAIR_SECRET is unset during the initial diagnostic run)
 *
 * Safe to call multiple times — idempotent.
 * Returns full audit JSON so the result can be verified without SSH.
 */

const CF_WORKER_URL = 'https://stalwart-api.romylabs.com'

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers })

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ── Caller auth (protects the edge function itself) ───────────────────────
  const repairSecret = Deno.env.get('REPAIR_SECRET') || ''
  const supplied = req.headers.get('x-repair-secret') || ''
  if (repairSecret && supplied !== repairSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Service secret for the CF Worker ─────────────────────────────────────
  const serviceSecret = Deno.env.get('REPAIR_SERVICE_SECRET') || ''
  if (!serviceSecret) {
    return json({ error: 'REPAIR_SERVICE_SECRET not configured', hint: 'Set as Supabase secret' }, 503)
  }

  // ── Delegate to CF Worker repair endpoint ─────────────────────────────────
  let workerResponse: Response
  try {
    workerResponse = await fetch(`${CF_WORKER_URL}/api/mta-route-repair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Repair-Secret': serviceSecret,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ ok: false, error: 'cf_worker_unreachable', detail: msg }, 502)
  }

  const workerBody = await workerResponse.json().catch(() => ({ ok: false, error: 'cf_worker_non_json' }))
  return json(workerBody, workerResponse.status)
})

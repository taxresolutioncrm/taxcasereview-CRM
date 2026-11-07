// Daily read-only Google Analytics ingestion orchestrator for all registered products.
// Authenticated only by the existing RomyLabs internal cron secret. Does not modify
// tracking IDs, provider OAuth, web pages, or the existing ga4-sync implementation.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const response = (data: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
  })

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return response({error: 'Method not allowed'}, 405)
  if (!url || !serviceKey) return response({error: 'Internal configuration unavailable'}, 503)
  const token = request.headers.get('x-internal-cron-token') || ''
  if (!token) return response({error: 'Unauthorized'}, 401)

  const admin = createClient(url, serviceKey, {auth: {persistSession: false}})
  const {data: authorized, error: authError} = await admin.rpc(
    'verify_internal_cron_token', {provided: token},
  )
  if (authError || authorized !== true) return response({error: 'Unauthorized'}, 401)

  const {data: channels, error: registryError} = await admin
    .from('product_traffic_channels')
    .select('product_id,tracking_id,status')
    .eq('channel_key', 'ga4')
    .not('tracking_id', 'is', null)
  if (registryError) return response({error: 'GA4 registry unavailable'}, 503)

  // Null or planned properties are excluded; do not write synthetic zeros.
  const products = [...new Set((channels || [])
    .filter(row => row.product_id && row.tracking_id && row.status !== 'not_applicable' && row.status !== 'planned')
    .map(row => String(row.product_id)))]
    .sort().slice(0, 25)

  if (!products.length) return response({ok: true, success: 0, failed: 0, skipped: 'no_configured_products'})
  const results: Array<{product_id: string; ok: boolean; rows?: number; error?: string}> = []
  let next = 0
  async function worker() {
    while (next < products.length) {
      const productId = products[next++]
      try {
        const upstream = await fetch((url.endsWith('/') ? url.slice(0, -1) : url) + '/functions/v1/ga4-sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + serviceKey,
            'apikey': serviceKey,
          },
          body: JSON.stringify({product_id: productId}),
          signal: AbortSignal.timeout(45000),
        })
        const payload = await upstream.json().catch(() => ({}))
        if (!upstream.ok || payload?.ok !== true) {
          results.push({product_id: productId, ok: false, error: String(payload?.error || ('HTTP ' + upstream.status)).slice(0, 160)})
        } else {
          results.push({product_id: productId, ok: true, rows: Number(payload.rows || 0)})
        }
      } catch (error) {
        results.push({product_id: productId, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 160)})
      }
    }
  }
  // Keep Google Data API requests and Edge concurrency bounded.
  await Promise.all(Array.from({length: Math.min(3, products.length)}, () => worker()))
  const failed = results.filter(item => !item.ok)
  console.log('[ga4-portfolio-refresh]', {products: products.length, succeeded: results.length - failed.length, failed: failed.length})
  return response({
    ok: failed.length === 0,
    products_checked: products.length,
    success: results.length - failed.length,
    failed: failed.length,
    results: results.sort((a, b) => a.product_id.localeCompare(b.product_id)),
    completed_at: new Date().toISOString(),
  }, failed.length ? 502 : 200)
})

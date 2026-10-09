import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FIXED_PRODUCTS = new Set([
  'taxres_crm',
  'tax_case_review',
  'nashville',
  'cloudcpa',
  'demo',
  'camvella',
  'arcvena',
  'bocasync',
  'groundivo',
  'oculivo',
  'restore_relay',
])

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { product?: string; source_schema?: string; source_table?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const product = String(body.product || '').trim().toLowerCase()
  if (!/^[a-z0-9_:-]{2,80}$/.test(product)) {
    return json({ error: 'Invalid product key' }, 400)
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let known = FIXED_PRODUCTS.has(product)
  if (!known) {
    const { data } = await serviceClient
      .from('romylabs_products')
      .select('product_id')
      .eq('product_id', product)
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    known = Boolean(data?.product_id)
  }
  if (!known) return json({ error: 'Unknown product' }, 404)

  // The receiver is intentionally credential-free because it carries no data and
  // grants no read/write capability. Abuse is bounded by this atomic per-product
  // claim; accepted signals only request a trusted server-side aggregate refresh.
  const { data: claimed, error: claimError } = await serviceClient.rpc(
    'claim_romylabs_metrics_refresh',
    { p_product_key: product, p_min_interval_ms: 30000 },
  )
  if (claimError) {
    console.error('metrics-signal claim failed', claimError.message)
    return json({ error: 'Signal gate unavailable' }, 503)
  }
  if (!claimed) return json({ ok: true, accepted: false, coalesced: true }, 202)

  const cleanPart = (value: unknown) => {
    const text = String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80)
    return text || null
  }

  const { error: queueError } = await serviceClient
    .from('romylabs_metrics_signal_queue')
    .upsert({
      product_key: product,
      source_schema: cleanPart(body.source_schema),
      source_table: cleanPart(body.source_table),
      requested_at: new Date().toISOString(),
    }, { onConflict: 'product_key' })

  if (queueError) {
    console.error('metrics-signal queue failed', queueError.message)
    return json({ error: 'Signal queue unavailable' }, 503)
  }

  return json({ ok: true, accepted: true }, 202)
})

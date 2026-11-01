import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Action = 'suspend' | 'restore'

const REMOTE_ENDPOINTS: Record<string,string> = {
  camvella: 'https://vgflyyazjvsdtoecvega.supabase.co/functions/v1/romylabs-entitlement',
  arcvena: 'https://wzalqfxovxxszojfbnis.supabase.co/functions/v1/romylabs-entitlement',
  bocasync: 'https://zmejbkttzvaqzzbmjclz.supabase.co/functions/v1/romylabs-entitlement',
  // GroundIVO intentionally excluded until its recovery/stabilization freeze is lifted.
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const sharedSecret = Deno.env.get('ROMYLABS_ENTITLEMENT_SECRET')
  if (!sharedSecret || req.headers.get('x-entitlement-secret') !== sharedSecret) return json({ error: 'Unauthorized' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const accountId = String(body?.account_id || '')
  const action = body?.action as Action
  if (!accountId || !['suspend','restore'].includes(action)) return json({ error: 'account_id and action=suspend|restore are required' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: account, error } = await db.from('romylabs_billing_accounts').select('id,product_key,external_tenant_id,account_name').eq('id', accountId).single()
  if (error || !account) return json({ error: error?.message || 'Billing account not found' }, 404)

  try {
    if (account.product_key === 'taxres_crm') {
      // TaxRes CRM and its customer offices live in this same Supabase project.
      // The live tenant schema has a status column but no `suspended_at` column.
      // AppContext already rejects suspended/cancelled tenant status, so changing only
      // status is sufficient and avoids inventing schema fields.
      const nextStatus = action === 'suspend' ? 'suspended' : 'active'
      let result = await db.from('tenants').update({ status: nextStatus }).eq('id', account.external_tenant_id).select('id,status').maybeSingle()
      if (!result.data && !result.error) {
        result = await db.from('tenants').update({ status: nextStatus }).eq('tenant_code', account.external_tenant_id).select('id,status').maybeSingle()
      }
      if (result.error) throw result.error
      if (!result.data) return json({ error: `TaxRes tenant not found: ${account.external_tenant_id}` }, 404)
      return json({ ok: true, product_key: account.product_key, tenant_id: result.data.id, action, enforced_status: result.data.status })
    }

    const target = REMOTE_ENDPOINTS[account.product_key]
    if (!target) return json({ error: `Entitlement adapter not enabled for ${account.product_key}` }, 409)
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-entitlement-secret': sharedSecret },
      body: JSON.stringify({ tenant_id: account.external_tenant_id, action, source: 'romylabs_billing', account_id: account.id }),
    })
    const payload = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (!res.ok || payload?.ok !== true) return json({ error: payload?.error || `Product adapter failed (${res.status})`, product_key: account.product_key }, 502)
    return json({ ok: true, product_key: account.product_key, action, product: payload })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e), product_key: account.product_key }, 500)
  }
})

// stripe-charge
// Charges a saved Stripe payment method off-session — used for a manual
// "Charge Now" click, each step of the autopay batch run, and each leg of a
// split payment across multiple saved cards. Logs the result into the
// payments table and (for clients) updates the autopay status so failures
// are visible, not silent.
//
// By default charges the record's current default card. Pass
// paymentMethodRowId (a payment_methods.id) to charge a specific saved card
// instead — that's what powers "switch cards" and split payments.
//
// Needs the STRIPE_SECRET_KEY secret set in Supabase → Edge Functions → Secrets.
// Deploy via: Supabase Dashboard → Edge Functions → Deploy new function
// (paste this file in as index.ts), name it "stripe-charge".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const PRIMARY_TENANT_ID = '61a89aef-0e7e-4ea2-b222-44ab2024655a'

async function stripeRequest(path: string, body: Record<string, string>, connectedAccount?: string | null) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(connectedAccount ? { 'Stripe-Account': connectedAccount } : {}),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe request failed')
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(url, service)

  let clientId: string | null = null
  let tenantId: string | null = null
  let connectedAccount: string | null = null
  let table = 'clients'

  try {
    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY is not set in Edge Function secrets' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.toLowerCase().startsWith('bearer ') || !anon || !service || !url) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const jwt = authHeader.slice(7).trim()
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
    if (userErr || !userData?.user?.email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: resolvedTenant } = await authClient.rpc('current_tenant_id')
    tenantId = resolvedTenant || null
    if (!tenantId) return new Response(JSON.stringify({ error: 'No active office context' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: employee } = await supabase.from('employees')
      .select('status,perm_billing').eq('tenant_id', tenantId).ilike('email', userData.user.email).limit(1).maybeSingle()
    const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
    const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
    if (!isPlatformAdmin && (!active || Number(employee?.perm_billing || 0) < 2)) {
      return new Response(JSON.stringify({ error: 'Billing permission denied' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const { data: tenant } = await supabase.from('tenants').select('stripe_connect_account_id').eq('id', tenantId).maybeSingle()
    connectedAccount = tenantId === PRIMARY_TENANT_ID ? null : (tenant?.stripe_connect_account_id || null)
    if (tenantId !== PRIMARY_TENANT_ID && !connectedAccount) {
      return new Response(JSON.stringify({ error: 'Online payments are not connected for this office. Connect the office payment processor in Settings first.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    clientId = body.clientId
    // amount in dollars, source: 'manual' | 'autopay' | 'split'
    const { amount, description, source, recordType, paymentMethodRowId } = body
    table = recordType === 'lead' ? 'leads' : 'clients'
    if (!clientId || !amount) {
      return new Response(JSON.stringify({ error: 'Missing clientId or amount' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: record } = await supabase.from(table)
      .select('name, stripe_customer_id, default_payment_method_id, payment_method_type')
      .eq('id', clientId).eq('tenant_id', tenantId).maybeSingle()

    let paymentMethodId = record?.default_payment_method_id || null
    let pmType = record?.payment_method_type || null

    // Charging a specific saved card (switch/split) instead of the default
    if (paymentMethodRowId) {
      const { data: pmRow } = await supabase.from('payment_methods')
        .select('stripe_payment_method_id, type').eq('id', paymentMethodRowId).eq('tenant_id', tenantId).maybeSingle()
      if (!pmRow) {
        return new Response(JSON.stringify({ error: 'Selected saved card not found' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      paymentMethodId = pmRow.stripe_payment_method_id
      pmType = pmRow.type
    }

    if (!record?.stripe_customer_id || !paymentMethodId) {
      return new Response(JSON.stringify({ error: 'No saved payment method on file' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const intent = await stripeRequest('payment_intents', {
      amount: String(Math.round(parseFloat(amount) * 100)),
      currency: 'usd',
      customer: record.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: 'true',
      confirm: 'true',
      description: description || `${record.name} payment`,
    }, connectedAccount)

    // Cards settle near-instantly ('succeeded'); ACH bank debits take days
    // and come back 'processing' first — both are a real, non-failed charge.
    const ok = intent.status === 'succeeded' || intent.status === 'processing'

    await supabase.from('payments').insert([{
      clientName: record.name, amount, method: pmType === 'us_bank_account' ? 'ACH / Bank Transfer' : 'Credit Card',
      status: intent.status === 'succeeded' ? 'Cleared' : intent.status === 'processing' ? 'Pending' : 'Failed',
      date: new Date().toISOString().slice(0, 10),
      notes: description || null,
      stripe_payment_intent_id: intent.id,
      source: source || 'manual',
      created_at: new Date().toISOString(),
      tenant_id: tenantId,
    }])

    if (table === 'clients') {
      await supabase.from('clients').update({
        autopay_last_result: ok ? 'succeeded' : 'failed',
        autopay_last_charged_at: new Date().toISOString(),
      }).eq('id', clientId).eq('tenant_id', tenantId)
    }

    if (!ok) {
      return new Response(JSON.stringify({ error: `Charge ${intent.status}`, status: intent.status }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true, status: intent.status, payment_intent_id: intent.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('stripe-charge error:', err)
    if (clientId && table === 'clients') {
      let q=supabase.from('clients').update({
        autopay_last_result: 'failed', autopay_last_charged_at: new Date().toISOString(),
      }).eq('id', clientId)
      if (tenantId) q=q.eq('tenant_id', tenantId)
      await q
    }
    return new Response(JSON.stringify({ error: err.message || 'Charge failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

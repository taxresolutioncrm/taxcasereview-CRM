// stripe-create-checkout-session
// Creates a Stripe Checkout Session — a hosted payment page that a lead or
// client fills in themselves (card never touches our servers, even less of
// our code in the loop than the embedded PaymentElement flow). Used by the
// "Send Payment Link" button on the Leads/Clients Payments tab.
//
// Also saves the card for future use (setup_future_usage: 'off_session'),
// so a paid Checkout link leaves a reusable payment method on file too —
// the actual save happens in stripe-checkout-webhook once Stripe confirms
// the session completed.
//
// Needs these Edge Function secrets:
//   STRIPE_SECRET_KEY, STRIPE_PRICE_NAME, STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL
// Deploy via: Supabase Dashboard → Edge Functions → Deploy new function
// (paste this file in as index.ts), name it "stripe-create-checkout-session".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY  = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const STRIPE_PRICE_NAME  = Deno.env.get('STRIPE_PRICE_NAME') ?? 'Tax Case Review'
const STRIPE_SUCCESS_URL = Deno.env.get('STRIPE_SUCCESS_URL') ?? ''
const STRIPE_CANCEL_URL  = Deno.env.get('STRIPE_CANCEL_URL') ?? ''
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

  try {
    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY is not set in Edge Function secrets' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.toLowerCase().startsWith('bearer ') || !anon || !service || !url) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const jwt = authHeader.slice(7).trim()
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
    if (userErr || !userData?.user?.email) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const { data: tenantId } = await authClient.rpc('current_tenant_id')
    if (!tenantId) return new Response(JSON.stringify({ error: 'No active office context' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const supabase = createClient(url, service)
    const { data: employee } = await supabase.from('employees')
      .select('status,perm_billing').eq('tenant_id', tenantId).ilike('email', userData.user.email).limit(1).maybeSingle()
    const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
    const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
    if (!isPlatformAdmin && (!active || Number(employee?.perm_billing || 0) < 2)) {
      return new Response(JSON.stringify({ error: 'Billing permission denied' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const { data: tenant } = await supabase.from('tenants').select('stripe_connect_account_id').eq('id', tenantId).maybeSingle()
    const connectedAccount = tenantId === PRIMARY_TENANT_ID ? null : (tenant?.stripe_connect_account_id || null)
    if (tenantId !== PRIMARY_TENANT_ID && !connectedAccount) {
      return new Response(JSON.stringify({ error: 'Online payments are not connected for this office. Connect the office payment processor in Settings first.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fall back to the CRM app URL if success/cancel URLs not explicitly set
    const successUrl = STRIPE_SUCCESS_URL || 'https://taxrescrm.app/'
    const cancelUrl  = STRIPE_CANCEL_URL  || 'https://taxrescrm.app/'

    const { recordType, recordId, name, email, amount, description, purpose } = await req.json()
    if (!recordId || !recordType || !amount) {
      return new Response(JSON.stringify({ error: 'Missing recordId, recordType, or amount' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const table = recordType === 'lead' ? 'leads' : 'clients'

    const { data: record } = await supabase.from(table).select('stripe_customer_id').eq('id', recordId).eq('tenant_id', tenantId).maybeSingle()
    if (!record) {
      return new Response(JSON.stringify({ error: 'Record not found in this office' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    let customerId = record?.stripe_customer_id || null

    if (!customerId) {
      const customer = await stripeRequest('customers', {
        name: name || '',
        ...(email ? { email } : {}),
        [`metadata[${recordType === 'lead' ? 'lead_id' : 'client_id'}]`]: String(recordId),
      }, connectedAccount)
      customerId = customer.id
      await supabase.from(table).update({ stripe_customer_id: customerId }).eq('id', recordId).eq('tenant_id', tenantId)
    }

    const amountCents = Math.round(parseFloat(amount) * 100)
    if (!amountCents || amountCents <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      customer: customerId,
      'payment_method_types[0]': 'card',
      'payment_method_types[1]': 'us_bank_account',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': description || STRIPE_PRICE_NAME,
      'payment_intent_data[setup_future_usage]': 'off_session',
      [`metadata[record_type]`]: recordType,
      [`metadata[record_id]`]: String(recordId),
      ...(purpose ? { [`metadata[purpose]`]: String(purpose) } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
    }, connectedAccount)

    await supabase.from(table).update({
      stripe_checkout_url: session.url,
      stripe_checkout_sent_at: new Date().toISOString(),
    }).eq('id', recordId).eq('tenant_id', tenantId)

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('stripe-create-checkout-session error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Checkout session creation failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

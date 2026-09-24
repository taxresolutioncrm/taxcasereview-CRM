// stripe-resolution-fee-confirm
// After the browser confirms payment with Stripe.js, this verifies the
// PaymentIntent's real status directly with Stripe (never trust the browser
// alone for something this important) and logs it to the payments table.
// The actual lead → client conversion happens in the app afterward, reusing
// the existing convertToClient flow — this function's only job is to verify
// and record the charge.
//
// Needs the STRIPE_SECRET_KEY secret set in Supabase → Edge Functions → Secrets.
// Deploy via: Supabase Dashboard → Edge Functions → Deploy new function
// (paste this file in as index.ts), name it "stripe-resolution-fee-confirm".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
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

    const { paymentIntentId, leadName, amount } = await req.json()
    if (!paymentIntentId) {
      return new Response(JSON.stringify({ error: 'Missing paymentIntentId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const intent = await stripeGet(`payment_intents/${paymentIntentId}?expand[]=payment_method`)
    const ok = intent.status === 'succeeded' || intent.status === 'processing'
    if (!ok) {
      return new Response(JSON.stringify({ error: `Charge ${intent.status}`, status: intent.status }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const pm = intent.payment_method
    const method = pm?.type === 'us_bank_account' ? 'ACH / Bank Transfer' : 'Credit Card'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const leadId = intent.metadata?.lead_id
    const tenantId = intent.metadata?.tenant_id
    if (!leadId || !tenantId) {
      return new Response(JSON.stringify({ error: 'PaymentIntent is missing lead/tenant metadata' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: lead, error: leadErr } = await supabase.from('leads')
      .select('id,name,tenant_id')
      .eq('id', leadId)
      .maybeSingle()
    if (leadErr) throw leadErr
    if (!lead || lead.tenant_id !== tenantId) {
      return new Response(JSON.stringify({ error: 'PaymentIntent tenant does not match lead' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { error: paymentErr } = await supabase.from('payments').insert([{
      clientName: lead.name || leadName || '', amount,
      method,
      status: intent.status === 'succeeded' ? 'Cleared' : 'Pending',
      date: new Date().toISOString().slice(0, 10),
      notes: 'Resolution fee',
      stripe_payment_intent_id: intent.id,
      source: 'resolution_fee',
      enrolled_by: intent.metadata?.enrolled_by || null,
      created_at: new Date().toISOString(),
      tenant_id: tenantId,
    }])
    if (paymentErr) throw paymentErr

    return new Response(JSON.stringify({ success: true, status: intent.status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('stripe-resolution-fee-confirm error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Confirm failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// stripe-resolution-fee-intent
// Creates a one-time PaymentIntent for a lead's resolution fee (the 2nd fee,
// charged once IRS results come back and the addendum is signed — separate
// from the investigation fee, which goes through LeadFlow before the lead
// even lands here, and separate from Client autopay, which leads never use).
//
// Reuses the lead's stripe_customer_id if LeadFlow already created one,
// otherwise creates a new Stripe Customer and saves it back to the lead.
//
// Needs the STRIPE_SECRET_KEY secret set in Supabase → Edge Functions → Secrets.
// Deploy via: Supabase Dashboard → Edge Functions → Deploy new function
// (paste this file in as index.ts), name it "stripe-resolution-fee-intent".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

async function stripeRequest(path: string, body: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
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

    const { leadId, leadName, email, amount, description, enrolledBy } = await req.json()
    if (!leadId || !amount) {
      return new Response(JSON.stringify({ error: 'Missing leadId or amount' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: lead, error: leadErr } = await supabase.from('leads')
      .select('id,name,email,stripe_customer_id,tenant_id')
      .eq('id', leadId)
      .maybeSingle()
    if (leadErr) throw leadErr
    if (!lead?.tenant_id) {
      return new Response(JSON.stringify({ error: 'Lead not found or tenant missing' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    let customerId = lead.stripe_customer_id || null

    if (!customerId) {
      const customer = await stripeRequest('customers', {
        name: lead.name || leadName || '',
        ...((lead.email || email) ? { email: lead.email || email } : {}),
        'metadata[lead_id]': String(leadId),
        'metadata[tenant_id]': String(lead.tenant_id),
      })
      customerId = customer.id
      await supabase.from('leads').update({ stripe_customer_id: customerId }).eq('id', leadId)
    }

    const intent = await stripeRequest('payment_intents', {
      amount: String(Math.round(parseFloat(amount) * 100)),
      currency: 'usd',
      customer: customerId,
      'payment_method_types[0]': 'card',
      'payment_method_types[1]': 'us_bank_account',
      description: description || `Resolution fee — ${leadName || ''}`,
      'metadata[lead_id]': String(leadId),
      'metadata[tenant_id]': String(lead.tenant_id),
      ...(enrolledBy ? { 'metadata[enrolled_by]': String(enrolledBy) } : {}),
    })

    return new Response(JSON.stringify({
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('stripe-resolution-fee-intent error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Failed to create charge' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// booking-checkout
// Public (anon) endpoint for the pay-to-book flow on the /book page. Creates a
// Stripe Checkout Session for the appointment fee and returns the hosted URL.
// The appointment itself is NOT created here — it's created by
// stripe-checkout-webhook once payment actually completes (purpose =
// 'booking_payment'), so we never create an unpaid booking.
//
// The amount and label are read SERVER-SIDE from the canonical tenant's
// settings.booking_config.payment (the client value is ignored) so a visitor
// can't tamper with the price or accidentally read another tenant's config.
//
// Needs Edge Function secrets: STRIPE_SECRET_KEY, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
// Deploy with JWT Verification OFF — the public booking page calls it with only
// the anon key, same as the other public booking endpoints.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const TAXRESCRM_TENANT = 'a0000000-0000-0000-0000-000000000001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
      return new Response(JSON.stringify({ error: 'Payments are not configured.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { name, email, phone, event_type, date, time, notes, tenant, success_url, cancel_url } = await req.json()
    if (!email || !date || !time) {
      return new Response(JSON.stringify({ error: 'Missing booking details.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const tenantId = (tenant || TAXRESCRM_TENANT).toString().trim()
    if (!UUID_RE.test(tenantId)) {
      return new Response(JSON.stringify({ error: 'Invalid booking tenant.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Read ONLY this tenant's real amount + label. Never fall back to another
    // settings row: a missing/disabled tenant must fail closed.
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('booking_config')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (settingsError) throw settingsError
    if (!settings?.booking_config) {
      return new Response(JSON.stringify({ error: 'Online booking is not configured for this office.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const pay = settings.booking_config?.payment || {}
    if (!pay.required) {
      return new Response(JSON.stringify({ error: 'Payment is not required for booking.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const amountCents = Math.round(parseFloat(pay.amount) * 100)
    if (!amountCents || amountCents <= 0) {
      return new Response(JSON.stringify({ error: 'Booking fee is not set correctly.' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const label = (pay.label || event_type || 'Appointment').toString().slice(0, 120)

    const session = await stripeRequest('checkout/sessions', {
      mode: 'payment',
      'payment_method_types[0]': 'card',
      ...(email ? { customer_email: email } : {}),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][product_data][name]': label,
      'metadata[purpose]': 'booking_payment',
      'metadata[tenant_id]': tenantId,
      'metadata[b_name]': (name || '').toString().slice(0, 120),
      'metadata[b_email]': email.toString().slice(0, 160),
      'metadata[b_phone]': (phone || '').toString().slice(0, 40),
      'metadata[b_type]': (event_type || '').toString().slice(0, 120),
      'metadata[b_date]': date.toString().slice(0, 10),
      'metadata[b_time]': time.toString().slice(0, 8),
      'metadata[b_notes]': (notes || '').toString().slice(0, 480),
      success_url: (success_url || 'https://taxrescrm.app/'),
      cancel_url: (cancel_url || 'https://taxrescrm.app/'),
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('booking-checkout error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Could not start checkout.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

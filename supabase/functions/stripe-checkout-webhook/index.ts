// stripe-checkout-webhook
// Receives Stripe's webhook for completed Checkout Sessions (Option 2 — the
// "Send Payment Link" flow) and:
//   1. Verifies the signature, so only real Stripe events get processed.
//   2. Logs the payment to the payments table.
//   3. Saves the resulting card/bank's safe display info (brand/last4) back
//      to the lead or client — same as the embedded SetupIntent flow does —
//      so a paid Checkout link also leaves a saved payment method on file.
//
// Needs these Edge Function secrets:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Setup order matters:
//   1. Deploy this function first (JWT verification OFF — Stripe calls this
//      directly, with no Supabase auth token, same as the SignalWire inbound
//      functions).
//   2. Copy its URL into Stripe Dashboard → Developers → Webhooks → Add
//      endpoint, select event "checkout.session.completed".
//   3. Stripe gives you a signing secret (whsec_...) — paste that into
//      STRIPE_WEBHOOK_SECRET in Supabase → Edge Functions → Secrets.
// Deploy via: Supabase Dashboard → Edge Functions → Deploy new function
// (paste this file in as index.ts), name it "stripe-checkout-webhook".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const cryptoProvider = Stripe.createSubtleCryptoProvider()

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
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      console.error('stripe-checkout-webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
      return new Response('Webhook not configured', { status: 422 })
    }

    const sig = req.headers.get('stripe-signature')
    const rawBody = await req.text()
    if (!sig) return new Response('Missing stripe-signature header', { status: 400 })

    let event
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return new Response('Webhook signature verification failed', { status: 400 })
    }

    if (event.type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    const session = event.data.object as any
    const recordType = session.metadata?.record_type
    const recordId = session.metadata?.record_id
    const purpose = session.metadata?.purpose
    const table = recordType === 'lead' ? 'leads' : 'clients'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ── Pay-to-book: the appointment was deliberately NOT created until
    // payment cleared. This path MUST carry the canonical tenant stamped by
    // booking-checkout. Missing/invalid tenant metadata fails closed — never
    // fall back to TCR or any other office. ────────────────────────────────
    if (purpose === 'booking_payment') {
      const m = session.metadata || {}
      const tenantId = (m.tenant_id || '').toString().trim()
      if (!UUID_RE.test(tenantId)) {
        console.error('booking_payment: missing or invalid tenant_id metadata', { session_id: session.id })
        return new Response(JSON.stringify({ error: 'Invalid booking tenant metadata' }), {
          status: 422, headers: { 'Content-Type': 'application/json' }
        })
      }

      const { data: tenantExists, error: tenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .maybeSingle()
      if (tenantError) throw tenantError
      if (!tenantExists) {
        console.error('booking_payment: unknown tenant_id metadata', { session_id: session.id, tenant_id: tenantId })
        return new Response(JSON.stringify({ error: 'Unknown booking tenant' }), {
          status: 422, headers: { 'Content-Type': 'application/json' }
        })
      }

      const { data: created, error: bookingError } = await supabase.rpc('booking_create', {
        p_name: m.b_name || '', p_email: m.b_email || '', p_phone: m.b_phone || '',
        p_event_type: m.b_type || '', p_date: m.b_date || '', p_time: m.b_time || '',
        p_notes: m.b_notes || '', p_tenant: tenantId,
      })
      if (bookingError) {
        console.error('booking_payment: booking_create failed:', bookingError.message)
        throw bookingError
      }

      const booked = created && created.ok !== false
      const when = `${m.b_date} at ${m.b_time} (Eastern)`
      const paidAmt = (session.amount_total || 0) / 100

      // Route confirmation/office notification through the canonical booking
      // token path. send-email resolves tenant + branding + physical transport
      // from the booking instead of accepting an unscoped arbitrary sender.
      const bookingToken = booked ? created?.booking_token : null
      if (bookingToken) {
        const mailResults = await Promise.allSettled([
          supabase.functions.invoke('send-email', {
            body: { kind: 'booking_confirmation', booking_token: bookingToken }
          }),
          supabase.functions.invoke('send-email', {
            body: { kind: 'booking_firm_notification', booking_token: bookingToken }
          }),
        ])
        for (const result of mailResults) {
          if (result.status === 'rejected') console.error('booking_payment: booking email invocation failed:', result.reason)
        }
      }

      // Log the payment to the SAME tenant that owned the booking config and
      // appointment. Never use a hard-coded TCR tenant here.
      const { error: paymentError } = await supabase.from('payments').insert([{
        clientName: m.b_name || session.customer_details?.name || '',
        amount: paidAmt,
        method: 'Stripe Checkout',
        status: 'Cleared',
        tenant_id: tenantId,
        date: new Date().toISOString().slice(0, 10),
        notes: booked ? `Booking payment — ${m.b_type || ''} ${when}` : `Booking payment — SLOT TAKEN, needs reschedule (${when})`,
        stripe_payment_intent_id: session.payment_intent || null,
        source: 'booking',
        created_at: new Date().toISOString(),
      }])
      if (paymentError) throw paymentError

      return new Response(JSON.stringify({ received: true, booked }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Forward-only pipeline advance — mirrors src/lib/leadStatus.js. Kept as
    // a separate inline copy since this runs in Deno, not the React app.
    const STATUS_ORDER = [
      'New Lead', 'Contacted', 'Consultation Scheduled', 'Consultation Completed',
      'Tax Inv Agreement Sent', 'Tax Inv Agreement Signed', 'Tax Inv Fee Paid',
      'Tax Investigation Active', 'IRS Facts Received', 'Addendum Sent', 'Addendum Signed',
      'Resolution Fee Paid', 'Converted to Client',
    ]
    if (recordType === 'lead' && purpose === 'investigation_fee' && recordId) {
      const { data: lead } = await supabase.from('leads').select('id,name,status,assignedTo').eq('id', recordId).maybeSingle()
      if (lead) {
        const curIdx       = STATUS_ORDER.indexOf(lead.status)
        const feePaidIdx   = STATUS_ORDER.indexOf('Tax Inv Fee Paid')
        const signedIdx    = STATUS_ORDER.indexOf('Tax Inv Agreement Signed')
        const activeIdx    = STATUS_ORDER.indexOf('Tax Investigation Active')

        if (curIdx < feePaidIdx) {
          await supabase.from('leads').update({ status: 'Tax Inv Fee Paid' }).eq('id', recordId)
        }

        // Both conditions met (agreement already signed + fee now paid) —
        // auto-advance straight to Tax Investigation Active and fire the
        // same call-IRS task creation the manual status change does in
        // Leads.jsx. curIdx >= signedIdx covers leads that were already
        // sitting at "Tax Inv Agreement Signed" (or anywhere past it) the
        // moment this webhook fires.
        if (curIdx >= signedIdx && curIdx < activeIdx) {
          await supabase.from('leads').update({ status: 'Tax Investigation Active' }).eq('id', recordId)

          const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 1)
          const dueDateStr = dueDate.toISOString().slice(0, 10)
          const assignee = lead.assignedTo || 'Unassigned'

          await supabase.from('tasks').insert([
            {
              title: `📞 Call IRS — gather tax investigation info for ${lead.name}`,
              clientName: lead.name,
              priority: 'High',
              dueDate: dueDateStr,
              tenant_id: '61a89aef-0e7e-4ea2-b222-44ab2024655a',
              done: false,
              assignedTo: assignee,
              notes: 'Call IRS with POA to pull transcripts, balances, lien info, assessment dates, and filing history. Enter results into the Compliance tab on this lead.',
              created_at: new Date().toISOString(),
            },
            {
              title: `🧾 Review financial intake — build resolution plan for ${lead.name}`,
              clientName: lead.name,
              priority: 'High',
              dueDate: dueDateStr,
              tenant_id: '61a89aef-0e7e-4ea2-b222-44ab2024655a',
              done: false,
              assignedTo: assignee,
              notes: 'Review the Financial Profile (I&E, Assets & Equity tabs) populated from the client\'s intake submission. Cross-reference with IRS results to determine the best resolution path (OIC, IA, CNC, etc.).',
              created_at: new Date().toISOString(),
            },
          ])

          await supabase.from('lead_notes').insert([{
            lead_id: recordId, lead_name: lead.name, tenant_id: '61a89aef-0e7e-4ea2-b222-44ab2024655a',
            text: `💳 Investigation fee paid — agreement already signed, auto-advanced to Tax Investigation Active. 2 tasks created for ${assignee}.`,
            type: 'System', author: 'System (Stripe)', created_at: new Date().toISOString(),
          }])
        }
      }
    }

    if (recordId) {
      const amount = (session.amount_total || 0) / 100
      await supabase.from('payments').insert([{
        clientName: session.customer_details?.name || '',
        amount,
        method: 'Stripe Checkout',
        status: 'Cleared',
        tenant_id: '61a89aef-0e7e-4ea2-b222-44ab2024655a',
        date: new Date().toISOString().slice(0, 10),
        notes: 'Paid via Stripe Checkout link',
        stripe_payment_intent_id: session.payment_intent || null,
        source: 'checkout',
        created_at: new Date().toISOString(),
      }])

      // Save the card/bank on file too, same safe display-only info the
      // embedded SetupIntent flow saves.
      if (session.payment_intent) {
        try {
          const intent = await stripeGet(`payment_intents/${session.payment_intent}?expand[]=payment_method`)
          const pm = intent.payment_method
          if (pm) {
            const isCard = pm.type === 'card'
            await supabase.from(table).update({
              default_payment_method_id: pm.id,
              payment_method_type: isCard ? 'card' : 'us_bank_account',
              payment_method_brand: isCard ? (pm.card?.brand || 'card') : (pm.us_bank_account?.bank_name || 'Bank account'),
              payment_method_last4: isCard ? (pm.card?.last4 || '') : (pm.us_bank_account?.last4 || ''),
            }).eq('id', recordId)
          }
        } catch (pmErr) {
          // Payment already succeeded and is logged above either way --
          // failing to save the reusable payment method shouldn't mask that.
          console.error('stripe-checkout-webhook: payment method save failed:', pmErr.message)
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('stripe-checkout-webhook error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Webhook handling failed' }), { status: 500 })
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const OWNER_EMAILS = new Set(['info@romylabs.com','romy@romylabs.com','romy@taxrescrm.net','romy@taxcasereview.org'])
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{ ...corsHeaders, 'Content-Type':'application/json' } })

async function stripeRequest(path:string, body:Record<string,string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe request failed')
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders})
  try {
    if (!STRIPE_SECRET_KEY) return json({error:'Payments are not configured'},503)
    const { caseId } = await req.json()
    if (!caseId) return json({error:'Missing caseId'},400)

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader || !anon) return json({error:'Unauthorized'},401)

    const uc = createClient(url, anon, { global:{headers:{Authorization:authHeader}} })
    const { data:{user} } = await uc.auth.getUser()
    if (!user) return json({error:'Unauthorized'},401)

    const admin = createClient(url, service)
    const { data: fc, error:fcErr } = await admin.from('formacorp').select('*').eq('id',caseId).maybeSingle()
    if (fcErr) throw fcErr
    if (!fc) return json({error:'FormaCorp case not found'},404)

    const email=(user.email||'').toLowerCase()
    let authorized=OWNER_EMAILS.has(email)
    if (!authorized && fc.tenant_id) {
      const { data:emp } = await admin.from('employees').select('id').eq('tenant_id',fc.tenant_id).ilike('email',email).eq('status','Active').limit(1).maybeSingle()
      authorized=!!emp
    }
    if (!authorized) return json({error:'Unauthorized'},401)

    const amount = Number(fc.fl_state_fee ?? fc.fee ?? 0)
    if (!(amount > 0)) return json({error:'State filing fee is not configured for this case'},409)

    let client = null
    if (fc.client_id) {
      const { data } = await admin.from('clients').select('id,name,email,stripe_customer_id,tenant_id').eq('id',fc.client_id).maybeSingle()
      client=data
    }
    if (!client && fc.client_name) {
      let q = admin.from('clients').select('id,name,email,stripe_customer_id,tenant_id').eq('name',fc.client_name)
      if (fc.tenant_id) q=q.eq('tenant_id',fc.tenant_id)
      const { data } = await q.limit(1).maybeSingle()
      client=data
    }

    let customerId=client?.stripe_customer_id || null
    if (!customerId) {
      const customer = await stripeRequest('customers',{
        name:client?.name || fc.client_name || fc.entity_name || 'FormaCorp client',
        ...(client?.email || fc.correspondence_email ? {email:client?.email || fc.correspondence_email}:{}),
        'metadata[formacorp_case_id]':String(fc.id),
        ...(fc.tenant_id ? {'metadata[tenant_id]':String(fc.tenant_id)}:{}),
      })
      customerId=customer.id
      if (client?.id) {
        const { error } = await admin.from('clients').update({stripe_customer_id:customerId}).eq('id',client.id)
        if (error) throw error
      }
    }

    const intent = await stripeRequest('payment_intents',{
      amount:String(Math.round(amount*100)),
      currency:'usd',
      customer:customerId,
      'payment_method_types[0]':'card',
      'payment_method_types[1]':'us_bank_account',
      description:`FormaCorp state filing funds — ${fc.entity_name || fc.client_name || fc.id}`,
      'metadata[formacorp_case_id]':String(fc.id),
      ...(fc.tenant_id ? {'metadata[tenant_id]':String(fc.tenant_id)}:{}),
      'metadata[purpose]':'state_filing_funds',
    })

    const { error:updErr } = await admin.from('formacorp').update({
      formation_funds_status:'processing',
      formation_payment_intent_id:intent.id,
    }).eq('id',fc.id)
    if (updErr) throw updErr

    return json({client_secret:intent.client_secret,payment_intent_id:intent.id,amount})
  } catch (err) {
    console.error('stripe-formacorp-fee-intent error:',err)
    return json({error:err?.message || 'Failed to create FormaCorp payment'},500)
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const OWNER_EMAILS = new Set(['info@romylabs.com','romy@romylabs.com','romy@taxrescrm.net','romy@taxcasereview.org'])
const json = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})

async function stripeGet(path:string){
  const res=await fetch(`https://api.stripe.com/v1/${path}`,{headers:{Authorization:`Bearer ${STRIPE_SECRET_KEY}`}})
  const data=await res.json()
  if(!res.ok) throw new Error(data?.error?.message || 'Stripe request failed')
  return data
}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  try{
    if(!STRIPE_SECRET_KEY) return json({error:'Payments are not configured'},503)
    const {caseId,paymentIntentId}=await req.json()
    if(!caseId||!paymentIntentId) return json({error:'Missing caseId or paymentIntentId'},400)

    const url=Deno.env.get('SUPABASE_URL')??''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')??''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??''
    const authHeader=req.headers.get('authorization')||''
    if(!authHeader||!anon) return json({error:'Unauthorized'},401)

    const uc=createClient(url,anon,{global:{headers:{Authorization:authHeader}}})
    const {data:{user}}=await uc.auth.getUser()
    if(!user) return json({error:'Unauthorized'},401)

    const admin=createClient(url,service)
    const {data:fc,error:fcErr}=await admin.from('formacorp').select('*').eq('id',caseId).maybeSingle()
    if(fcErr) throw fcErr
    if(!fc) return json({error:'FormaCorp case not found'},404)

    const email=(user.email||'').toLowerCase()
    let authorized=OWNER_EMAILS.has(email)
    if(!authorized&&fc.tenant_id){
      const {data:emp}=await admin.from('employees').select('id').eq('tenant_id',fc.tenant_id).ilike('email',email).eq('status','Active').limit(1).maybeSingle()
      authorized=!!emp
    }
    if(!authorized) return json({error:'Unauthorized'},401)

    const intent=await stripeGet(`payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=payment_method`)
    if(String(intent.metadata?.formacorp_case_id||'')!==String(caseId)) return json({error:'Payment does not belong to this FormaCorp case'},409)
    if(fc.tenant_id&&intent.metadata?.tenant_id&&String(intent.metadata.tenant_id)!==String(fc.tenant_id)) return json({error:'Payment tenant mismatch'},409)

    if(intent.status==='processing'){
      await admin.from('formacorp').update({formation_funds_status:'processing',formation_payment_intent_id:intent.id}).eq('id',caseId)
      return json({success:true,pending:true,status:'processing'})
    }
    if(intent.status!=='succeeded') return json({error:`Charge ${intent.status}`,status:intent.status},402)

    const amount=(intent.amount_received||intent.amount||0)/100
    const {error:updErr}=await admin.from('formacorp').update({
      formation_funds_status:'received',
      formation_payment_reference:intent.id,
      formation_payment_intent_id:intent.id,
      fl_payment_status:'received',
    }).eq('id',caseId)
    if(updErr) throw updErr

    await admin.from('formacorp_filing_events').insert({
      case_id:caseId,
      event_type:'formation_payment',
      status:'Funds Received',
      note:`State filing funds received in CRM: $${amount.toFixed(2)}. State disbursement remains separate until the filing channel actually charges/deducts the government fee.`,
      metadata:{payment_intent_id:intent.id,amount,status:intent.status},
      ...(fc.tenant_id?{tenant_id:fc.tenant_id}:{}),
    })

    return json({success:true,status:intent.status,amount})
  }catch(err){
    console.error('stripe-formacorp-fee-confirm error:',err)
    return json({error:err?.message||'Confirmation failed'},500)
  }
})

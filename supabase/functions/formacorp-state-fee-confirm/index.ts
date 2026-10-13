import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
}
const PLATFORM_STRIPE_TENANTS=new Set(['61a89aef-0e7e-4ea2-b222-44ab2024655a','a0000000-0000-0000-0000-000000000001','518808b4-10dd-47fd-900e-6c3fc1ff2e7e'])

async function stripeGet(secret:string,id:string,connectedAccount?:string|null){
  const res=await fetch('https://api.stripe.com/v1/payment_intents/'+encodeURIComponent(id),{
    headers:{Authorization:'Bearer '+secret,...(connectedAccount?{'Stripe-Account':connectedAccount}:{})}
  })
  const data=await res.json()
  if(!res.ok)throw new Error(data?.error?.message||'Stripe verification failed')
  return data
}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const secret=Deno.env.get('STRIPE_SECRET_KEY')||''
    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const auth=req.headers.get('authorization')||''
    if(!secret||!url||!anon||!service||!auth.toLowerCase().startsWith('bearer '))throw new Error('Payment service is not configured')

    const jwt=auth.slice(7).trim()
    const authClient=createClient(url,anon,{global:{headers:{Authorization:'Bearer '+jwt}}})
    const {data:userData,error:userErr}=await authClient.auth.getUser(jwt)
    if(userErr||!userData?.user?.email)return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{...corsHeaders,'Content-Type':'application/json'}})
    const {data:tenantId}=await authClient.rpc('current_tenant_id')
    if(!tenantId)return new Response(JSON.stringify({error:'No active office context'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const admin=createClient(url,service)
    const {data:employee}=await admin.from('employees').select('status,perm_billing').eq('tenant_id',tenantId).ilike('email',userData.user.email).limit(1).maybeSingle()
    const {data:isPlatformAdmin}=await authClient.rpc('_is_platform_admin')
    const active=employee&&String(employee.status||'Active').toLowerCase()==='active'
    if(!isPlatformAdmin&&(!active||Number(employee?.perm_billing||0)<2))return new Response(JSON.stringify({error:'Billing permission denied'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const {caseId,paymentIntentId,expectedAmount}=await req.json()
    if(!caseId||!paymentIntentId)return new Response(JSON.stringify({error:'caseId and paymentIntentId are required'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const {data:c}=await admin.from('formacorp').select('id,tenant_id,state,entity_type,entity_name,fee,fl_state_fee,state_fee_amount,state_fee_payment_status,state_fee_payment_intent_id,state_fee_collected_amount').eq('id',caseId).eq('tenant_id',tenantId).maybeSingle()
    if(!c)return new Response(JSON.stringify({error:'FormaCorp case not found in this office'}),{status:404,headers:{...corsHeaders,'Content-Type':'application/json'}})
    const {data:tenant}=await admin.from('tenants').select('stripe_connect_account_id').eq('id',tenantId).maybeSingle()
    const connectedAccount=PLATFORM_STRIPE_TENANTS.has(String(tenantId))?null:(tenant?.stripe_connect_account_id||null)

    const pi=await stripeGet(secret,String(paymentIntentId),connectedAccount)
    if(pi.status!=='succeeded')return new Response(JSON.stringify({error:'Payment is not complete (status: '+pi.status+')'}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}})
    if(String(pi.metadata?.purpose||'')!=='formacorp_state_fee'||String(pi.metadata?.case_id||'')!==String(caseId)||String(pi.metadata?.tenant_id||'')!==String(tenantId))return new Response(JSON.stringify({error:'Payment metadata does not match this formation case'}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const paid=Number(pi.amount_received||pi.amount||0)/100
    const expected=Number(expectedAmount)
    if(Number.isFinite(expected)&&expected>0&&Math.abs(paid-expected)>0.009)return new Response(JSON.stringify({error:'Verified payment amount does not match the expected state fee'}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}})
    const metadataAmount=Number(pi.metadata?.government_amount)
    if(!Number.isFinite(metadataAmount)||Math.abs(paid-metadataAmount)>0.009)return new Response(JSON.stringify({error:'Stripe payment metadata amount does not match the verified payment'}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const isFloridaFormation=String(c.state)==='FL' && ['LLC','Professional LLC (PLLC)','C-Corp','Non-Profit 501(c)(3)'].includes(String(c.entity_type||''))
    const canonical=Number(c.state_fee_amount ?? (isFloridaFormation ? c.fl_state_fee : c.fee) ?? 0)
    if(!Number.isFinite(canonical)||canonical<=0||Math.abs(paid-canonical)>0.009)return new Response(JSON.stringify({error:'Verified payment no longer matches the government filing amount on this case'}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const now=new Date().toISOString()
    async function ensurePaymentAuditEvent(){
      const {data:existingEvent,error:findEventErr}=await admin.from('formacorp_filing_events')
        .select('id').eq('case_id',caseId).eq('tenant_id',tenantId).eq('event_type','state_fee_payment')
        .contains('metadata',{payment_intent_id:String(pi.id)}).limit(1).maybeSingle()
      if(findEventErr)throw findEventErr
      if(existingEvent?.id)return
      const {error:eventErr}=await admin.from('formacorp_filing_events').insert([{
        tenant_id:tenantId,
        case_id:caseId,
        event_type:'state_fee_payment',
        status:'received',
        note:'Government formation filing funds collected inside FormaCorp; state remittance remains pending until submitted through the supported state filing channel.',
        metadata:{payment_intent_id:String(pi.id),amount:paid,currency:String(pi.currency||'usd')},
        actor_email:userData.user.email,
        created_at:now,
      }])
      if(eventErr)throw eventErr
    }

    if(String(c.state_fee_payment_status||'')==='received'&&String(c.state_fee_payment_intent_id||'')===String(pi.id)){
      await ensurePaymentAuditEvent()
      return new Response(JSON.stringify({ok:true,amount:Number(c.state_fee_collected_amount||paid),payment_intent_id:String(pi.id),status:'received',idempotent:true}),{headers:{...corsHeaders,'Content-Type':'application/json'}})
    }

    const paymentPatch:any={
      state_fee_amount:paid,
      state_fee_payment_status:'received',
      state_fee_payment_reference:String(pi.id),
      state_fee_collected_amount:paid,
      state_fee_payment_intent_id:String(pi.id),
      state_fee_collected_at:now,
      fee_paid:true,
    }
    if(isFloridaFormation){
      paymentPatch.fl_payment_status='received'
      paymentPatch.fl_payment_reference=String(pi.id)
    }
    const {error:updateErr}=await admin.from('formacorp').update(paymentPatch).eq('id',caseId).eq('tenant_id',tenantId)
    if(updateErr)throw updateErr

    await ensurePaymentAuditEvent()

    return new Response(JSON.stringify({ok:true,amount:paid,payment_intent_id:String(pi.id),status:'received'}),{headers:{...corsHeaders,'Content-Type':'application/json'}})
  }catch(err){
    console.error('[formacorp-state-fee-confirm]',err)
    return new Response(JSON.stringify({error:err instanceof Error?err.message:'Could not verify payment'}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}})
  }
})

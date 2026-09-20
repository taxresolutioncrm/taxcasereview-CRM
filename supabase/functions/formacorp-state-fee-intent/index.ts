import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
}
const PLATFORM_STRIPE_TENANTS=new Set(['61a89aef-0e7e-4ea2-b222-44ab2024655a','a0000000-0000-0000-0000-000000000001','518808b4-10dd-47fd-900e-6c3fc1ff2e7e','489ace07-1a6b-4864-833a-4f8420568b40'])

async function stripeRequest(secret:string,path:string,body:Record<string,string>,connectedAccount?:string|null,idempotencyKey?:string){
  const res=await fetch('https://api.stripe.com/v1/'+path,{
    method:'POST',
    headers:{
      Authorization:'Bearer '+secret,
      ...(connectedAccount?{'Stripe-Account':connectedAccount}:{}),
      ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}),
      'Content-Type':'application/x-www-form-urlencoded',
    },
    body:new URLSearchParams(body),
  })
  const data=await res.json()
  if(!res.ok)throw new Error(data?.error?.message||'Stripe request failed')
  return data
}

async function stripeGet(secret:string,id:string,connectedAccount?:string|null){
  const res=await fetch('https://api.stripe.com/v1/payment_intents/'+encodeURIComponent(id),{
    headers:{Authorization:'Bearer '+secret,...(connectedAccount?{'Stripe-Account':connectedAccount}:{})}
  })
  const data=await res.json()
  if(!res.ok)throw new Error(data?.error?.message||'Stripe request failed')
  return data
}

async function stablePaymentKey(parts:string[]){
  const bytes=new TextEncoder().encode(parts.join('|'))
  const digest=await crypto.subtle.digest('SHA-256',bytes)
  return 'formacorp-'+Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')
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

    const {caseId,amount}=await req.json()
    if(!caseId)return new Response(JSON.stringify({error:'caseId is required'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}})
    const {data:c}=await admin.from('formacorp').select('id,tenant_id,state,entity_type,entity_name,client_name,correspondence_email,fee,fl_state_fee,state_fee_amount,state_fee_payment_status,state_fee_payment_intent_id,state_fee_collected_amount').eq('id',caseId).eq('tenant_id',tenantId).maybeSingle()
    if(!c)return new Response(JSON.stringify({error:'FormaCorp case not found in this office'}),{status:404,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const requested=Number(amount)
    const isFloridaFormation=String(c.state)==='FL' && ['LLC','Professional LLC (PLLC)','C-Corp','Non-Profit 501(c)(3)'].includes(String(c.entity_type||''))
    const canonical=Number(c.state_fee_amount ?? (isFloridaFormation ? c.fl_state_fee : c.fee) ?? 0)
    if(!Number.isFinite(requested)||requested<=0)return new Response(JSON.stringify({error:'Valid state filing amount is required'}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}})
    if(canonical>0&&Math.abs(requested-canonical)>0.009)return new Response(JSON.stringify({error:'Amount does not match the government filing amount on this case'}),{status:409,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const {data:tenant}=await admin.from('tenants').select('stripe_connect_account_id').eq('id',tenantId).maybeSingle()
    const usePlatformStripe=PLATFORM_STRIPE_TENANTS.has(String(tenantId))
    const connectedAccount=usePlatformStripe?null:(tenant?.stripe_connect_account_id||null)
    if(!usePlatformStripe&&!connectedAccount)return new Response(JSON.stringify({error:'Online payments are not connected for this office'}),{status:422,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const {data:platformSettings}=await admin.from('settings').select('stripe_publishable_key').in('tenant_id',Array.from(PLATFORM_STRIPE_TENANTS)).not('stripe_publishable_key','is',null).limit(1).maybeSingle()
    const platformPublishableKey=String(platformSettings?.stripe_publishable_key||'').trim()
    let publishableKey=platformPublishableKey
    if(usePlatformStripe){
      const {data:ownSettings}=await admin.from('settings').select('stripe_publishable_key').eq('tenant_id',tenantId).limit(1).maybeSingle()
      publishableKey=String(ownSettings?.stripe_publishable_key||platformPublishableKey).trim()
    }
    if(!publishableKey)return new Response(JSON.stringify({error:'Stripe publishable key is not configured for the payment account'}),{status:422,headers:{...corsHeaders,'Content-Type':'application/json'}})

    const cents=Math.round(requested*100)
    if(['received','remitted'].includes(String(c.state_fee_payment_status||'')) && Number.isFinite(Number(c.state_fee_collected_amount)) && Math.abs(Number(c.state_fee_collected_amount)-requested)<0.009){
      return new Response(JSON.stringify({already_collected:true,amount:Number(c.state_fee_collected_amount),payment_intent_id:c.state_fee_payment_intent_id||null,status:c.state_fee_payment_status}),{headers:{...corsHeaders,'Content-Type':'application/json'}})
    }

    const existingId=String(c.state_fee_payment_intent_id||'').trim()
    if(existingId){
      try{
        const existing=await stripeGet(secret,existingId,connectedAccount)
        const metadataOk=String(existing.metadata?.purpose||'')==='formacorp_state_fee' && String(existing.metadata?.case_id||'')===String(c.id) && String(existing.metadata?.tenant_id||'')===String(tenantId)
        const amountOk=Number(existing.amount||0)===cents
        if(metadataOk&&amountOk&&!['canceled'].includes(String(existing.status||''))){
          return new Response(JSON.stringify({
            client_secret:existing.client_secret,
            payment_intent_id:existing.id,
            amount:requested,
            publishable_key:publishableKey,
            stripe_account:connectedAccount||null,
            already_succeeded:String(existing.status||'')==='succeeded',
            reused:true,
          }),{headers:{...corsHeaders,'Content-Type':'application/json'}})
        }
      }catch(existingErr){
        console.warn('[formacorp-state-fee-intent] existing payment intent could not be reused',existingErr)
      }
    }

    const idempotencyKey=await stablePaymentKey([
      String(tenantId),String(c.id),String(cents),String(c.entity_name||''),String(c.correspondence_email||''),existingId||'initial'
    ])
    const pi=await stripeRequest(secret,'payment_intents',{
      amount:String(cents),
      currency:'usd',
      'automatic_payment_methods[enabled]':'true',
      description:'Government formation filing funds — '+(c.entity_name||c.client_name||'FormaCorp'),
      ...(c.correspondence_email?{receipt_email:String(c.correspondence_email)}:{}),
      'metadata[purpose]':'formacorp_state_fee',
      'metadata[tenant_id]':String(tenantId),
      'metadata[case_id]':String(c.id),
      'metadata[government_amount]':requested.toFixed(2),
    },connectedAccount,idempotencyKey)

    const {error:saveIntentErr}=await admin.from('formacorp').update({
      state_fee_amount:requested,
      state_fee_payment_intent_id:String(pi.id),
      state_fee_payment_reference:String(pi.id),
    }).eq('id',caseId).eq('tenant_id',tenantId)
    if(saveIntentErr)throw saveIntentErr

    return new Response(JSON.stringify({client_secret:pi.client_secret,payment_intent_id:pi.id,amount:requested,publishable_key:publishableKey,stripe_account:connectedAccount||null,already_succeeded:false,reused:false}),{headers:{...corsHeaders,'Content-Type':'application/json'}})
  }catch(err){
    console.error('[formacorp-state-fee-intent]',err)
    return new Response(JSON.stringify({error:err instanceof Error?err.message:'Could not start payment'}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}})
  }
})

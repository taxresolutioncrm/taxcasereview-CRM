// stripe-charge
// Charges a saved Stripe payment method off-session. Tenant isolation is
// resolved before any Stripe or database operation. Browser staff calls use
// the authenticated office; the server-side autopay runner may use service-role
// auth only when it passes an explicit tenant_id for each client.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const PLATFORM_STRIPE_TENANTS = new Set([
  '61a89aef-0e7e-4ea2-b222-44ab2024655a',
  'a0000000-0000-0000-0000-000000000001',
  '518808b4-10dd-47fd-900e-6c3fc1ff2e7e',
])

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders,'Content-Type':'application/json'}
})

async function stripeRequest(path:string,body:Record<string,string>,connectedAccount?:string|null){
  const res=await fetch(`https://api.stripe.com/v1/${path}`,{
    method:'POST',
    headers:{
      Authorization:`Bearer ${STRIPE_SECRET_KEY}`,
      ...(connectedAccount?{'Stripe-Account':connectedAccount}:{}),
      'Content-Type':'application/x-www-form-urlencoded',
    },
    body:new URLSearchParams(body),
  })
  const data=await res.json()
  if(!res.ok)throw new Error(data?.error?.message||'Stripe request failed')
  return data
}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)

  const url=Deno.env.get('SUPABASE_URL')??''
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??''
  const anon=Deno.env.get('SUPABASE_ANON_KEY')??''
  const admin=createClient(url,service)

  let clientId:string|null=null
  let tenantId:string|null=null
  let table='clients'

  try{
    if(!STRIPE_SECRET_KEY)return json({error:'STRIPE_SECRET_KEY is not set in Edge Function secrets'},422)
    const body=await req.json()
    clientId=String(body?.clientId||'').trim()||null
    const {amount,description,source,recordType,paymentMethodRowId}=body||{}
    table=recordType==='lead'?'leads':'clients'
    if(!clientId||!amount)return json({error:'Missing clientId or amount'},400)

    const authHeader=req.headers.get('authorization')||''
    if(!authHeader.toLowerCase().startsWith('bearer ')||!url||!service||!anon)return json({error:'Unauthorized'},401)
    const token=authHeader.slice(7).trim()
    const serviceRoleCall=token===service

    if(serviceRoleCall){
      tenantId=String(body?.tenant_id||'').trim()||null
      if(!tenantId)return json({error:'Server-to-server charge requires tenant_id'},400)
    }else{
      const authClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}}})
      const {data:userData,error:userErr}=await authClient.auth.getUser(token)
      if(userErr||!userData?.user?.email)return json({error:'Unauthorized'},401)
      const {data:resolvedTenant}=await authClient.rpc('current_tenant_id')
      tenantId=resolvedTenant||null
      if(!tenantId)return json({error:'No active office context'},403)
      const {data:employee}=await admin.from('employees')
        .select('status,perm_billing').eq('tenant_id',tenantId)
        .ilike('email',userData.user.email).limit(1).maybeSingle()
      const {data:isPlatformAdmin}=await authClient.rpc('_is_platform_admin')
      const active=employee&&String(employee.status||'Active').toLowerCase()==='active'
      if(!isPlatformAdmin&&(!active||Number(employee?.perm_billing||0)<2))return json({error:'Billing permission denied'},403)
    }

    const {data:tenant}=await admin.from('tenants').select('stripe_connect_account_id').eq('id',tenantId).maybeSingle()
    const usePlatformStripe=PLATFORM_STRIPE_TENANTS.has(String(tenantId))
    const connectedAccount=usePlatformStripe?null:(tenant?.stripe_connect_account_id||null)
    if(!usePlatformStripe&&!connectedAccount){
      return json({error:'Online payments are not connected for this office. Connect the office payment processor in Settings first.'},422)
    }

    const {data:record}=await admin.from(table)
      .select('name,stripe_customer_id,default_payment_method_id,payment_method_type')
      .eq('id',clientId).eq('tenant_id',tenantId).maybeSingle()
    if(!record)return json({error:'Record not found in this office'},404)

    let paymentMethodId=record.default_payment_method_id||null
    let pmType=record.payment_method_type||null
    if(paymentMethodRowId){
      const {data:pmRow}=await admin.from('payment_methods')
        .select('stripe_payment_method_id,type').eq('id',paymentMethodRowId)
        .eq('tenant_id',tenantId).maybeSingle()
      if(!pmRow)return json({error:'Selected saved card not found'},422)
      paymentMethodId=pmRow.stripe_payment_method_id
      pmType=pmRow.type
    }
    if(!record.stripe_customer_id||!paymentMethodId)return json({error:'No saved payment method on file'},422)

    const amountCents=Math.round(parseFloat(String(amount))*100)
    if(!Number.isFinite(amountCents)||amountCents<=0)return json({error:'Invalid amount'},400)

    const intent=await stripeRequest('payment_intents',{
      amount:String(amountCents),
      currency:'usd',
      customer:record.stripe_customer_id,
      payment_method:paymentMethodId,
      off_session:'true',
      confirm:'true',
      description:description||`${record.name} payment`,
    },connectedAccount)

    const ok=intent.status==='succeeded'||intent.status==='processing'
    await admin.from('payments').insert([{
      clientName:record.name,client_id:clientId,amount:String(amount),
      method:pmType==='us_bank_account'?'ACH / Bank Transfer':'Credit Card',
      status:intent.status==='succeeded'?'Cleared':intent.status==='processing'?'Pending':'Failed',
      payment_status:intent.status==='succeeded'?'Paid':'Pending',
      date:new Date().toISOString().slice(0,10),
      notes:description||null,stripe_payment_intent_id:intent.id,
      source:source||'manual',created_at:new Date().toISOString(),tenant_id:tenantId,
    }])

    if(table==='clients'){
      await admin.from('clients').update({
        autopay_last_result:ok?'succeeded':'failed',
        autopay_last_charged_at:new Date().toISOString(),
      }).eq('id',clientId).eq('tenant_id',tenantId)
    }
    if(!ok)return json({error:`Charge ${intent.status}`,status:intent.status},402)
    return json({success:true,status:intent.status,payment_intent_id:intent.id})
  }catch(err){
    console.error('stripe-charge error:',err)
    if(clientId&&table==='clients'){
      let q=admin.from('clients').update({
        autopay_last_result:'failed',autopay_last_charged_at:new Date().toISOString(),
      }).eq('id',clientId)
      if(tenantId)q=q.eq('tenant_id',tenantId)
      await q
    }
    return json({error:err instanceof Error?err.message:'Charge failed'},500)
  }
})

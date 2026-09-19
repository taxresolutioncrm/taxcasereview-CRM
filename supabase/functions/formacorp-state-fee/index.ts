import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const PLATFORM_STRIPE_TENANTS = new Set(['61a89aef-0e7e-4ea2-b222-44ab2024655a','a0000000-0000-0000-0000-000000000001','518808b4-10dd-47fd-900e-6c3fc1ff2e7e'])

async function stripePost(path:string, body:Record<string,string>, connectedAccount?:string|null) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {method:'POST',headers:{Authorization:'Bearer ' + STRIPE_SECRET_KEY,...(connectedAccount ? {'Stripe-Account':connectedAccount} : {}),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)})
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe request failed')
  return data
}
async function stripeGet(path:string, connectedAccount?:string|null) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {headers:{Authorization:'Bearer ' + STRIPE_SECRET_KEY,...(connectedAccount ? {'Stripe-Account':connectedAccount} : {})}})
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe request failed')
  return data
}
function json(body:unknown,status=200){ return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}}) }

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:corsHeaders})
  try {
    const url=Deno.env.get('SUPABASE_URL') ?? '', anon=Deno.env.get('SUPABASE_ANON_KEY') ?? '', service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader=req.headers.get('authorization') || ''
    if (!STRIPE_SECRET_KEY || !url || !anon || !service || !authHeader.toLowerCase().startsWith('bearer ')) return json({error:'Unauthorized'},401)
    const jwt=authHeader.slice(7).trim()
    const authClient=createClient(url,anon,{global:{headers:{Authorization:'Bearer ' + jwt}}})
    const userResult=await authClient.auth.getUser(jwt)
    if (userResult.error || !userResult.data?.user?.email) return json({error:'Unauthorized'},401)
    const tenantResult=await authClient.rpc('current_tenant_id'), tenantId=tenantResult.data
    if (!tenantId) return json({error:'No active office context'},403)

    const supabase=createClient(url,service)
    const employeeResult=await supabase.from('employees').select('status,perm_billing').eq('tenant_id',tenantId).ilike('email',userResult.data.user.email).limit(1).maybeSingle()
    const adminResult=await authClient.rpc('_is_platform_admin')
    const employee=employeeResult.data, active=employee && String(employee.status || 'Active').toLowerCase()==='active'
    if (!adminResult.data && (!active || Number(employee?.perm_billing || 0)<2)) return json({error:'Billing permission denied'},403)

    const body=await req.json(), caseId=body.caseId, clientId=body.clientId
    if (!caseId || !clientId) return json({error:'Missing formation case or client'},400)
    const formationResult=await supabase.from('formacorp').select('id,client_id,client_name,entity_name,state,fee,fl_state_fee,fee_paid').eq('id',caseId).eq('tenant_id',tenantId).maybeSingle()
    const formation=formationResult.data
    if (!formation) return json({error:'Formation case not found in this office'},404)
    const clientResult=await supabase.from('clients').select('id,name,email,stripe_customer_id').eq('id',clientId).eq('tenant_id',tenantId).maybeSingle()
    const client=clientResult.data
    if (!client) return json({error:'Linked client not found in this office'},404)
    if (formation.client_id && String(formation.client_id)!==String(client.id)) return json({error:'Formation case is linked to a different client'},409)
    if (!formation.client_id) await supabase.from('formacorp').update({client_id:client.id}).eq('id',caseId).eq('tenant_id',tenantId)

    const amount=Number(formation.state==='FL' ? formation.fl_state_fee : formation.fee), amountCents=Math.round(amount*100)
    if (!Number.isFinite(amountCents) || amountCents<=0) return json({error:'Formation case has no valid state filing fee'},422)
    const tenantRow=await supabase.from('tenants').select('stripe_connect_account_id').eq('id',tenantId).maybeSingle()
    const isPlatform=PLATFORM_STRIPE_TENANTS.has(String(tenantId)), connectedAccount=isPlatform ? null : (tenantRow.data?.stripe_connect_account_id || null)
    if (!isPlatform && !connectedAccount) return json({error:'Online payments are not connected for this office'},422)

    if (body.action==='intent') {
      if (formation.fee_paid) return json({error:'This state filing fee is already marked paid'},409)
      let customerId=client.stripe_customer_id || null
      if (!customerId) {
        const customer=await stripePost('customers',{name:client.name || formation.client_name || '',...(client.email ? {email:client.email} : {}),'metadata[client_id]':String(client.id),'metadata[tenant_id]':String(tenantId)},connectedAccount)
        customerId=customer.id
        await supabase.from('clients').update({stripe_customer_id:customerId}).eq('id',client.id).eq('tenant_id',tenantId)
      }
      const intent=await stripePost('payment_intents',{amount:String(amountCents),currency:'usd',customer:customerId,'payment_method_types[0]':'card',description:String(formation.state)+' state formation filing fee — '+String(formation.entity_name || ''),'metadata[purpose]':'formacorp_state_fee','metadata[tenant_id]':String(tenantId),'metadata[formacorp_case_id]':String(caseId),'metadata[client_id]':String(client.id)},connectedAccount)
      return json({client_secret:intent.client_secret,payment_intent_id:intent.id,amount})
    }

    if (body.action==='confirm') {
      if (!body.paymentIntentId) return json({error:'Missing payment intent'},400)
      const intent=await stripeGet('payment_intents/'+encodeURIComponent(body.paymentIntentId)+'?expand[]=payment_method',connectedAccount)
      if (intent.metadata?.purpose!=='formacorp_state_fee' || intent.metadata?.tenant_id!==String(tenantId) || intent.metadata?.formacorp_case_id!==String(caseId) || intent.metadata?.client_id!==String(clientId)) return json({error:'Payment does not belong to this FormaCorp case'},409)
      if (Number(intent.amount)!==amountCents || String(intent.currency).toLowerCase()!=='usd') return json({error:'Payment amount does not match the state filing fee'},409)
      if (intent.status!=='succeeded') return json({error:'Payment '+String(intent.status),status:intent.status},402)
      const already=await supabase.from('payments').select('id').eq('stripe_payment_intent_id',intent.id).eq('tenant_id',tenantId).limit(1).maybeSingle()
      if (!already.data) {
        const inserted=await supabase.from('payments').insert([{clientName:client.name || formation.client_name || '',client_id:String(client.id),amount:String(Number(intent.amount)/100),method:'Credit Card',status:'Cleared',date:new Date().toISOString().slice(0,10),notes:'FormaCorp state filing fee — '+String(formation.entity_name || '')+' ('+String(formation.state || '')+')',stripe_payment_intent_id:intent.id,source:'formacorp_state_fee',tenant_id:tenantId,created_at:new Date().toISOString()}])
        if (inserted.error) throw inserted.error
      }
      const patch:any={fee_paid:true}
      if (formation.state==='FL') { patch.fl_payment_status='received'; patch.fl_payment_reference=intent.id }
      const updated=await supabase.from('formacorp').update(patch).eq('id',caseId).eq('tenant_id',tenantId)
      if (updated.error) throw updated.error
      await supabase.from('formacorp_service_requests').update({payment_status:'Received'}).eq('case_id',caseId).eq('tenant_id',tenantId).eq('service_type','State Formation Filing')
      return json({success:true,status:'succeeded',payment_intent_id:intent.id})
    }
    return json({error:'Unknown action'},400)
  } catch (err) {
    console.error('formacorp-state-fee error',err)
    return json({error:err?.message || 'FormaCorp state-fee payment failed'},500)
  }
})

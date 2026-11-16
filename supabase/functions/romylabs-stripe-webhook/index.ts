import {serve} from 'https://deno.land/std@0.177.0/http/server.ts'
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
// This function intentionally has NO browser CORS. Stripe webhooks have no JWT;
// authenticity comes from raw-body signature verification with replay protection.
const root=Deno.env.get('SUPABASE_URL')||''
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const encoder=new TextEncoder()
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})
const safeEqual=(a:string,b:string)=>{
  if(a.length!==b.length)return false
  let diff=0
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i)
  return diff===0
}
async function signatureOkay(raw:string,header:string,secret:string){
  const fields=header.split(',').map(x=>x.split('=',2))
  const t=fields.find(x=>x[0]==='t')?.[1]||''
  const values=fields.filter(x=>x[0]==='v1').map(x=>x[1])
  const ts=Number(t)
  if(!Number.isSafeInteger(ts)||Math.abs(Math.floor(Date.now()/1000)-ts)>300||!values.length)return false
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const bits=await crypto.subtle.sign('HMAC',key,encoder.encode(t+'.'+raw))
  const hex=Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('')
  return values.some(x=>safeEqual(hex,x))
}
serve(async req=>{
  if(req.method!=='POST')return response({error:'Method not allowed'},405)
  if(!root||!service)return response({error:'Webhook unavailable'},503)
  const raw=await req.text()
  if(raw.length>512000)return response({error:'Event too large'},413)
  const auth=req.headers.get('stripe-signature')||''
  const db=createClient(root,service,{auth:{persistSession:false}})
  const getSecret=async(name:string)=>{
    const {data,error}=await db.rpc('romylabs_stripe_merchant_secret',{p_name:name,p_new_value:null})
    return error?'':String(data||'')
  }
  let verifiedMode:'test'|'live'|null=null
  for(const mode of ['test','live'] as const){
    const signing=await getSecret('romylabs_stripe_'+mode+'_webhook')
    if(signing&&await signatureOkay(raw,auth,signing)){verifiedMode=mode;break}
  }
  if(!verifiedMode)return response({error:'Invalid Stripe signature'},401)
  let event:any
  try{event=JSON.parse(raw)}catch{return response({error:'Invalid payload'},400)}
  if(!/^evt_[a-zA-Z0-9]+$/.test(String(event.id||''))||
    typeof event.type!=='string'||Boolean(event.livemode)!==(verifiedMode==='live'))
    return response({error:'Event identity or mode mismatch'},400)
  const now=new Date().toISOString()
  const {data:settings,error:settingsError}=await db.from('romylabs_stripe_settings').select('*').eq('id',true).single()
  if(settingsError||settings?.stripe_account_id!=='acct_1UaFszFomt0HrzTf')
    return response({error:'Merchant not configured'},503)
  const {data:stored,error:storeError}=await db.from('romylabs_stripe_webhook_events')
    .upsert({event_id:event.id,event_type:event.type,livemode:Boolean(event.livemode),received_at:now},
      {onConflict:'event_id',ignoreDuplicates:true}).select('event_id,processed_at').maybeSingle()
  if(storeError)return response({error:'Could not record signed event'},503)
  if(!stored){
    const {data:prior}=await db.from('romylabs_stripe_webhook_events').select('processed_at').eq('event_id',event.id).single()
    if(prior?.processed_at)return response({received:true,duplicate:true})
  }
  try{
    const {data:key,error:keyError}=await db.rpc('romylabs_stripe_merchant_secret',{
      p_name:'romylabs_stripe_'+verifiedMode+'_key',p_new_value:null
    })
    if(keyError||!key)throw Error('Matching merchant key is not configured')
    // A signed event confirms Stripe can reach the endpoint. A harmless
    // verification event may activate invoice checkout, but never a charge.
    if(event.type==='ping'){
      const {error}=await db.from('romylabs_stripe_settings').update({
        webhook_verified_at:now,webhook_configured:true,mode:verifiedMode,updated_at:now
      }).eq('id',true)
      if(error)throw Error('Could not confirm webhook connection')
    }
    if(['checkout.session.completed','checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed'].includes(event.type)){
      const checkout=event.data?.object||{}
      if(checkout.object!=='checkout.session')throw Error('Unexpected Checkout object')
      const {data:entry,error:entryError}=await db.from('romylabs_stripe_checkout_sessions')
        .select('session_id,invoice_id,amount_cents,livemode,status').eq('session_id',checkout.id).maybeSingle()
      if(entryError)throw Error('Could not verify Checkout against billing records')
      if(!entry && /^[-0-9a-f]{36}$/i.test(String(checkout.metadata?.romylabs_invoice_id||'')))
        throw Error('Invoice Checkout has not been registered yet; retry delivery')
      if(entry){
        if(Boolean(entry.livemode)!==Boolean(event.livemode)||
          Number(checkout.amount_total)!==Number(entry.amount_cents)||
          String(checkout.currency).toLowerCase()!=='usd')
          throw Error('Checkout amount, currency, or environment mismatch')
        if(event.type!=='checkout.session.async_payment_failed'&&checkout.payment_status!=='paid'){
          // Async payment still pending; do not mark invoice paid.
        }else{
          const resultStatus=event.type==='checkout.session.async_payment_failed'?'failed':'succeeded'
          const paymentId=String(checkout.payment_intent||checkout.id)
          const billingSecret=Deno.env.get('ROMYLABS_BILLING_WEBHOOK_SECRET')||''
          if(!billingSecret)throw Error('Internal billing webhook authorization unavailable')
          const paid=await fetch(root+'/functions/v1/romylabs-billing-payment',{
            method:'POST',headers:{'Content-Type':'application/json','x-billing-secret':billingSecret},
            body:JSON.stringify({provider:'stripe',provider_payment_id:paymentId,invoice_id:entry.invoice_id,
              amount_cents:entry.amount_cents,status:resultStatus})
          })
          const result=await paid.json().catch(()=>({}))
          if(!paid.ok||result.ok!==true)throw Error('RomyLabs ledger did not confirm Stripe payment')
          const {error:updateError}=await db.from('romylabs_stripe_checkout_sessions')
            .update({status:resultStatus,paid_at:resultStatus==='succeeded'?now:null})
            .eq('session_id',entry.session_id)
          if(updateError)throw Error('Could not update Checkout receipt')
        }
      }
    }
    // Refund, dispute and early fraud warning events must reach the operator.
    // Record actionable collection alerts only for charges that belong to the
    // RomyLabs SaaS ledger; never touch unrelated customer-facing CRM charges.
    if(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'].includes(event.type)){
      const obj=event.data?.object||{}
      const paymentIntent=String(obj.payment_intent||'')
      if(paymentIntent.startsWith('pi_')){
        const {data:payment}=await db.from('romylabs_subscription_payments')
          .select('account_id,invoice_id').eq('provider','stripe')
          .eq('provider_payment_id',paymentIntent).maybeSingle()
        if(payment){
          const {data:prior}=await db.from('romylabs_collection_events')
            .select('id').eq('account_id',payment.account_id)
            .contains('detail',{stripe_event_id:event.id}).limit(1)
          if(!prior?.length){
            const {error:alertError}=await db.from('romylabs_collection_events').insert({
              account_id:payment.account_id,invoice_id:payment.invoice_id,
              event_type:'manual_hold',channel:'stripe',
              detail:{stripe_event_id:event.id,stripe_event_type:event.type,review_required:true,
                note:'Review in Stripe Dashboard before manually reconciling funds; no automatic suspension'}
            })
            if(alertError)throw Error('Could not register Stripe finance review alert')
          }
        }
      }
    }
    const {error:completeError}=await db.from('romylabs_stripe_webhook_events')
      .update({processed_at:now,last_error:null}).eq('event_id',event.id)
    if(completeError)throw Error('Could not finalize signed event')
    return response({received:true})
  }catch(error){
    await db.from('romylabs_stripe_webhook_events').update({
      last_error:String((error as Error).message||'Processing failed').slice(0,350),
      processed_at:null
    }).eq('event_id',event.id)
    return response({error:'Stripe event could not be processed; retry required'},503)
  }
})

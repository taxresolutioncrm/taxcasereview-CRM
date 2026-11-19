import {serve} from 'https://deno.land/std@0.177.0/http/server.ts'
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'
const accountId='acct_1UaFszFomt0HrzTf'
const root=Deno.env.get('SUPABASE_URL')||''
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
const cors={'Access-Control-Allow-Origin':'https://admin.romylabs.com','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors})
const stripe=async(key:string,path:string,body?:URLSearchParams,idem?:string)=>{
  const headers:Record<string,string>={'Authorization':'Bearer '+key,'Stripe-Version':'2026-09-30.endive'}
  if(body)headers['Content-Type']='application/x-www-form-urlencoded'
  if(idem)headers['Idempotency-Key']=idem
  const res=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers,body})
  const payload=await res.json().catch(()=>({}))
  if(!res.ok)throw Error('Stripe request failed ('+res.status+'): '+String(payload?.error?.code||payload?.error?.type||'provider_error'))
  return payload
}
serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  if(!root||!service||!anon)return json({error:'Merchant service unavailable'},503)
  const authorization=req.headers.get('authorization')||''
  if(!/^Bearer \S+$/.test(authorization))return json({error:'Sign-in required'},401)
  const caller=createClient(root,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  const {data:admin,error:authError}=await caller.rpc('_is_platform_admin')
  if(authError||admin!==true)return json({error:'RomyLabs platform administrator required'},403)
  const db=createClient(root,service,{auth:{persistSession:false}})
  const input=await req.json().catch(()=>({}))
  const action=String(input.action||'status')
  const {data:settings,error:settingsError}=await db.from('romylabs_stripe_settings').select('*').eq('id',true).maybeSingle()
  if(settingsError||!settings)return json({error:'Stripe merchant settings unavailable'},503)
  const secret=async(name:string,value?:string)=>{
    const {data,error}=await db.rpc('romylabs_stripe_merchant_secret',{p_name:name,p_new_value:value??null})
    if(error)throw Error('Encrypted Stripe settings unavailable')
    return String(data||'')
  }
  if(action==='status'){
    const active=String(settings.mode||'disabled')
    const hasLive=Boolean(await secret('romylabs_stripe_live_key'))
    const hasTest=Boolean(await secret('romylabs_stripe_test_key'))
    const internalBillingReady=Boolean(Deno.env.get('ROMYLABS_BILLING_WEBHOOK_SECRET'))
    const {data:recentEvents,error:eventsError}=await db.from('romylabs_stripe_webhook_events')
      .select('event_id,event_type,livemode,received_at,processed_at,last_error')
      .order('received_at',{ascending:false}).limit(12)
    return json({ok:true,webhook_recent_events:eventsError?[]:(recentEvents||[]).map(e=>({
      id:e.event_id,type:e.event_type,mode:e.livemode?'live':'test',
      received_at:e.received_at,processed:!!e.processed_at,
      failed:!!e.last_error
    })),merchant:'Romy Labs, LLC',account_id:settings.stripe_account_id||null,
      mode:active,live_key_configured:hasLive,test_key_configured:hasTest,
      webhook_configured:Boolean(settings.webhook_configured),
      webhook_verified:Boolean(settings.webhook_verified_at),internal_billing_ready:internalBillingReady,
      checkout_ready:active!=='disabled'&&Boolean(settings.webhook_verified_at)&&internalBillingReady})
  }
  if(action==='connect'){
    const key=String(input.restricted_key||'').trim()
    const mode=String(input.mode||'test')
    if(!['test','live'].includes(mode))return json({error:'Invalid Stripe mode'},400)
    if(!key.startsWith(mode==='live'?'rk_live_':'rk_test_')||key.length<35||key.length>300)
      return json({error:'Use a restricted Stripe '+mode+' key (rk_ prefix). Do not use a secret sk_ key.'},400)
    try{
      const account=await stripe(key,'account')
      if(account.id!==accountId)return json({error:'That Stripe key belongs to another merchant account'},403)
      await secret(mode==='live'?'romylabs_stripe_live_key':'romylabs_stripe_test_key',key)
      // Do not discard a signing secret provisioned for the same Stripe
      // merchant through the connected Stripe account. A fresh signed ping is
      // still required before any real Checkout becomes available.
      const webhookConfigured=Boolean(await secret(mode==='live'?'romylabs_stripe_live_webhook':'romylabs_stripe_test_webhook'))
      const {error}=await db.from('romylabs_stripe_settings').update({
        stripe_account_id:accountId,mode:'disabled',
        webhook_configured:webhookConfigured,webhook_verified_at:null,
        updated_at:new Date().toISOString()
      }).eq('id',true)
      if(error)return json({error:'Verified Stripe credentials could not be recorded'},503)
      return json({ok:true,merchant:account.business_profile?.name||'Romy Labs, LLC',
        account_id:accountId,mode,verified:true,
        next_step:'Register a signed Stripe webhook and verify its delivery before enabling checkout'})
    }catch(error){return json({error:String((error as Error).message||'Stripe key validation failed')},400)}
  }
  if(action==='save_webhook'){
    const signing=String(input.signing_secret||'').trim()
    const mode=String(input.mode||'test')
    if(!['test','live'].includes(mode)||!/^whsec_[A-Za-z0-9_\-]{20,}$/.test(signing))
      return json({error:'A Stripe webhook signing secret (whsec_) is required'},400)
    try{
      if(!await secret(mode==='live'?'romylabs_stripe_live_key':'romylabs_stripe_test_key'))
        return json({error:'Verify your Stripe restricted key before connecting a webhook'},409)
      await secret(mode==='live'?'romylabs_stripe_live_webhook':'romylabs_stripe_test_webhook',signing)
      const {error}=await db.from('romylabs_stripe_settings').update({
        webhook_configured:true,webhook_verified_at:null,mode:'disabled',updated_at:new Date().toISOString()
      }).eq('id',true)
      if(error)return json({error:'Webhook configuration was not saved'},503)
      return json({ok:true,webhook_configured:true,
        next_step:'Send a Stripe signed test event to verify endpoint delivery; checkout remains disabled until verified'})
    }catch{return json({error:'Could not save webhook signing secret'},503)}
  }
  // The Restore Relay sales agreement uses one hosted recurring Checkout:
  // six $399 monthly billings total, including the first payment at signup.
  // A signed checkout.session.completed webhook converts the subscription into
  // a schedule that cancels after its sixth billing period.
  if(action==='restore_relay_six_month_link'){
    if(settings.mode!=='live'||!settings.webhook_verified_at||
       !Deno.env.get('ROMYLABS_BILLING_WEBHOOK_SECRET'))
      return json({error:'Live merchant webhook and billing reconciliation must be verified first'},409)
    const key=await secret('romylabs_stripe_live_key')
    if(!key)return json({error:'Live Stripe merchant key unavailable'},503)
    const officeName=String(input.office_name||'Calico GC LLC').trim()
    const officeRef=String(input.office_ref||'calico-gc-llc').trim()
    if(!/^[a-zA-Z0-9 _.,'&()\/-]{2,120}$/.test(officeName)||
       !/^[A-Za-z0-9_-]{2,80}$/.test(officeRef))
      return json({error:'Valid Restore Relay office name and office reference are required'},400)
    const priceId='price_1Ud2Q6Fomt0HrzTfApwGodx0'
    try{
      const price=await stripe(key,'prices/'+priceId)
      if(price?.livemode!==true||price?.active!==true||
         price?.currency!=='usd'||price?.unit_amount!==39900||
         price?.recurring?.interval!=='month'||price?.recurring?.interval_count!==1)
        return json({error:'Existing Restore Relay $399/month price failed validation'},409)
      // Locate an existing tagged link rather than producing a second live link
      // on refresh/retry. Never reuse the legacy one-time or $400 links.
      const existing=await stripe(key,'payment_links?limit=100')
      const matched=(existing?.data||[]).find((p:any)=>
        p?.livemode===true&&p?.metadata?.romylabs_term==='restore_relay_six_payments_v1'&&
        p?.metadata?.office_ref===officeRef&&p?.active===true)
      if(matched){
        const lineItems=await stripe(key,'payment_links/'+matched.id+'/line_items?limit=20')
        const items=lineItems?.data||[]
        if(items.length!==1||items[0]?.price?.id!==priceId||items[0]?.quantity!==1)
          return json({error:'A tagged Restore Relay link has the wrong price. Review before sending.'},409)
        return json({ok:true,link_url:matched.url,link_id:matched.id,
          price_id:priceId,monthly_amount_cents:39900,number_of_payments:6,existing:true})
      }
      const params=new URLSearchParams({
        'line_items[0][price]':priceId,'line_items[0][quantity]':'1',
        'automatic_tax[enabled]':'true',
        'billing_address_collection':'required',
        'payment_method_types[0]':'card',
        'payment_method_types[1]':'us_bank_account',
        'name_collection[business][enabled]':'true',
        'name_collection[business][optional]':'false',
        'name_collection[individual][enabled]':'true',
        'name_collection[individual][optional]':'false',
        'restrictions[completed_sessions][limit]':'1',
        'metadata[romylabs_term]':'restore_relay_six_payments_v1',
        'metadata[office]':officeName,
        'metadata[office_ref]':officeRef,
        'subscription_data[metadata][romylabs_term]':'restore_relay_six_payments_v1',
        'subscription_data[metadata][office]':officeName,
        'subscription_data[metadata][office_ref]':officeRef,
        'subscription_data[description]':'Restore Relay - '+officeName+' - $399/month for six billing periods'
      })
      const link=await stripe(key,'payment_links',params,
        'romylabs-restore-relay-six-payments-'+officeRef+'-20261119-v1')
      if(!link?.id||!link?.url||!link?.active)return json({error:'Stripe did not return an active payment link'},502)
      const lineItems=await stripe(key,'payment_links/'+link.id+'/line_items?limit=20')
      if(lineItems?.data?.length!==1||lineItems.data[0]?.price?.id!==priceId||
         lineItems.data[0]?.price?.recurring?.interval!=='month')
        return json({error:'Stripe created a link with unexpected pricing. Do not send.'},502)
      return json({ok:true,link_url:link.url,link_id:link.id,
        price_id:priceId,monthly_amount_cents:39900,number_of_payments:6,existing:false})
    }catch(error){return json({error:String((error as Error).message||'Could not create recurring link')},502)}
  }
  if(action==='checkout'){
    if(settings.mode==='disabled'||!settings.webhook_verified_at||!Deno.env.get('ROMYLABS_BILLING_WEBHOOK_SECRET'))
      return json({error:'Stripe checkout is not enabled. Verify the signed webhook first.'},409)
    const mode=String(settings.mode)
    const key=await secret(mode==='live'?'romylabs_stripe_live_key':'romylabs_stripe_test_key')
    if(!key)return json({error:'Stripe merchant key not configured'},503)
    const invoiceId=String(input.invoice_id||'')
    if(!/^[0-9a-f-]{36}$/i.test(invoiceId))return json({error:'Select a valid RomyLabs invoice'},400)
    const {data:invoice,error}=await db.from('romylabs_invoices')
      .select('id,invoice_number,account_id,status,amount_cents,amount_paid_cents')
      .eq('id',invoiceId).maybeSingle()
    if(error||!invoice||invoice.status!=='open')return json({error:'An unpaid open RomyLabs invoice is required'},409)
    const {data:account}=await db.from('romylabs_billing_accounts')
      .select('account_name,billing_email,currency').eq('id',invoice.account_id).maybeSingle()
    if(!account?.billing_email)return json({error:'Billing account email is required'},400)
    const remaining=Number(invoice.amount_cents)-Number(invoice.amount_paid_cents||0)
    if(!Number.isSafeInteger(remaining)||remaining<=0)return json({error:'Invoice has no outstanding balance'},409)
    if(String(account.currency||'usd').toLowerCase()!=='usd')
      return json({error:'Only USD RomyLabs invoices are configured for Stripe checkout'},400)
    const params=new URLSearchParams({
      mode:'payment',
      customer_email:String(account.billing_email),
      client_reference_id:invoice.id,
      success_url:'https://romylabs.com/?payment=received',
      cancel_url:'https://romylabs.com/?payment=cancelled',
      'line_items[0][price_data][currency]':'usd',
      'line_items[0][price_data][unit_amount]':String(remaining),
      'line_items[0][price_data][product_data][name]':'RomyLabs SaaS invoice '+invoice.invoice_number,
      'line_items[0][quantity]':'1',
      'metadata[romylabs_invoice_id]':invoice.id,
      'payment_intent_data[metadata][romylabs_invoice_id]':invoice.id,
      integration_identifier:'romylabs_'+Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>String.fromCharCode(97+n%26)).join('')
    })
    try{
      const session=await stripe(key,'checkout/sessions',params,'romylabs-invoice-'+invoice.id+'-'+remaining+'-'+mode)
      if(!session?.id||!session?.url)return json({error:'Stripe checkout session was not returned'},502)
      const {error:insertError}=await db.from('romylabs_stripe_checkout_sessions').upsert({
        session_id:session.id,invoice_id:invoice.id,amount_cents:remaining,currency:'usd',
        livemode:mode==='live',status:'created'
      },{onConflict:'session_id'})
      if(insertError)return json({error:'Could not register checkout session; do not send link'},503)
      return json({ok:true,checkout_url:session.url,session_id:session.id,invoice_id:invoice.id,amount_cents:remaining,invoice_number:invoice.invoice_number,billing_email:account.billing_email,account_name:account.account_name})
    }catch(error){return json({error:String((error as Error).message||'Could not create Stripe checkout')},502)}
  }
  return json({error:'Unsupported action'},400)
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Account = {
  id: string; account_name: string; billing_email: string|null;
  monthly_amount_cents: number; status: string; product_key: string
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json','cache-control':'no-store'},
})
const dollars=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100)
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[c]||c))
const monthInfo=(value:Date)=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',
    day:'2-digit',hour:'2-digit',hourCycle:'h23',
  }).formatToParts(value).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))
  return {year:parts.year,month:parts.month,day:parts.day,hour:parts.hour}
}
const PRODUCT_BRANDS:Record<string,string> = {
  taxres_crm:'TaxRes CRM', romylabs:'RomyLabs', arcvena:'Arcvena',
  camvella:'Camvella', bocasync:'BocaSync', restore_relay:'Restore Relay',
  pool_crm:'PoolVerge', oculivo:'Oculivo', groundivo:'GroundIVO',
  barbers_salons:'Barbers & Salons CRM', health_insurance:'Health Insurance CRM',
}
const sameMonth=(value:string,year:number,month:number)=>{
  const d=new Date(value)
  if(!Number.isFinite(d.getTime()))return false
  const p=monthInfo(d)
  return p.year===year&&p.month===month
}


// Dedicated product-specific, nonpersonal Stalwart sender only.
// Missing verified sender => no send, never fall back to an owner's mailbox.
async function sendViaStalwart(db:any,productKey:string,recipient:string,subject:string,html:string,brand:string){
  const {data:transport,error:transportError}=await db.rpc('romylabs_system_reminder_transport',{p_product_key:productKey})
  if(transportError||!transport?.ok||!transport.username||!transport.password)throw new Error('Private system sender not configured for '+productKey)
  const host=String(transport.host||'mail.taxrescrm.net').replace(/^https?:\/\//,'').replace(/\/$/,'')
  const from=String(transport.from_address||transport.username).toLowerCase()
  const auth='Basic '+btoa(String(transport.username)+':'+String(transport.password))
  const sessionRes=await fetch('https://'+host+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!sessionRes.ok)throw new Error('Stalwart session HTTP '+sessionRes.status)
  const session=await sessionRes.json()
  const accountId=session.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session.accounts||{})[0]
  if(!accountId||!session.apiUrl)throw new Error('Stalwart session missing account')
  const apiUrl=String(session.apiUrl).replace('{accountId}','')
  const metaRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[['Identity/get',{accountId},'i0'],['Mailbox/get',{accountId,properties:['id','name','role']},'m0']],
  })})
  if(!metaRes.ok)throw new Error('Stalwart mailbox lookup HTTP '+metaRes.status)
  const meta=await metaRes.json()
  const identities=meta.methodResponses?.find((v:any)=>v?.[0]==='Identity/get')?.[1]?.list||[]
  const boxes=meta.methodResponses?.find((v:any)=>v?.[0]==='Mailbox/get')?.[1]?.list||[]
  const identity=identities.find((v:any)=>String(v.email||'').toLowerCase()===from)
  const drafts=boxes.find((v:any)=>v.role==='drafts')
  const sentBox=boxes.find((v:any)=>v.role==='sent')
  if(!identity?.id||!drafts?.id||!sentBox?.id)throw new Error('Stalwart sender identity or Drafts/Sent unavailable')
  const draft={
    from:[{email:from,name:brand+' System Reminder'}],
    to:[{email:recipient}],
    replyTo:[{email:from}],
    subject,
    mailboxIds:{[drafts.id]:true},keywords:{'$draft':true},
    bodyValues:{body:{value:html,charset:'utf-8'}},
    htmlBody:[{partId:'body',type:'text/html'}],
  }
  const submitRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[
      ['Email/set',{accountId,create:{draft}},'e0'],
      ['EmailSubmission/set',{accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},
        onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sentBox.id]:true,'keywords/$draft':null}}},'s0'],
    ],
  })})
  if(!submitRes.ok)throw new Error('Stalwart submission HTTP '+submitRes.status)
  const result=await submitRes.json()
  const submission=result.methodResponses?.find((v:any)=>v?.[0]==='EmailSubmission/set')?.[1]
  if(submission?.notCreated?.sendIt||!submission?.created?.sendIt?.id)throw new Error('Stalwart did not accept submission')
  return String(submission.created.sendIt.id)
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{
    auth:{persistSession:false},
  })
  const token=req.headers.get('x-internal-cron-token')||''
  const {data:authorized,error:authError}=token
    ? await db.rpc('verify_internal_cron_token',{provided:token})
    : {data:false,error:null}
  if(authError||authorized!==true)return json({error:'Unauthorized'},401)
  const now=new Date(),clock=monthInfo(now)
  if(clock.day!==4||clock.hour<9||clock.hour>=12)return json({ok:true,skipped:'outside the 4th, 9–12 Eastern'})

  const period=clock.year+'-'+String(clock.month).padStart(2,'0')+'-01'
  const {data:accounts,error:accountError}=await db.from('romylabs_billing_accounts')
    .select('id,account_name,billing_email,monthly_amount_cents,status,product_key')
    .in('status',['active','past_due'])
  if(accountError)return json({error:'Account lookup failed'},500)
  const outcomes:Array<Record<string,unknown>>=[]
  for(const account of (accounts||[]) as Account[]){
    if(account.monthly_amount_cents<=0)continue
    const email=String(account.billing_email||'').trim()
    const brand=PRODUCT_BRANDS[account.product_key]
    if(!brand){outcomes.push({account_id:account.id,result:'unregistered_product_sender'});continue}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      outcomes.push({account_id:account.id,result:'missing_valid_billing_email'})
      continue
    }
    // Only the current SaaS month, not end-customer payments from CRM databases.
    // Recheck immediately before send, so manual/processor payments stop an alert.
    const {data:payments,error:paymentError}=await db.from('romylabs_subscription_payments')
      .select('amount_cents,paid_at,status').eq('account_id',account.id)
      .eq('status','succeeded').gte('paid_at',period)
    if(paymentError){outcomes.push({account_id:account.id,result:'payment_check_failed'});continue}
    const totalPaid=(payments||[]).filter(p=>p.paid_at&&sameMonth(p.paid_at,clock.year,clock.month))
      .reduce((sum,p)=>sum+Number(p.amount_cents||0),0)
    const {data:invoices,error:invoiceError}=await db.from('romylabs_invoices')
      .select('id,status,amount_paid_cents,amount_cents')
      .eq('account_id',account.id).eq('period_start',period)
    if(invoiceError){outcomes.push({account_id:account.id,result:'invoice_check_failed'});continue}
    const paidInvoice=(invoices||[]).some(i=>i.status==='paid'||Number(i.amount_paid_cents||0)>=Number(i.amount_cents||0))
    if(totalPaid>=account.monthly_amount_cents||paidInvoice){
      outcomes.push({account_id:account.id,result:'paid_skip'});continue
    }
    const due=account.monthly_amount_cents-totalPaid
    await db.from('romylabs_day4_payment_reminders').upsert({
      account_id:account.id,period_month:period,recipient:email,amount_cents:due,
    },{onConflict:'account_id,period_month',ignoreDuplicates:true})
    // Claim pending or stale-in-progress reminders exactly once.
    const {data:queued,error:queueError}=await db.from('romylabs_day4_payment_reminders')
      .select('id,status,last_attempt_at,attempts').eq('account_id',account.id)
      .eq('period_month',period).maybeSingle()
    if(queueError||!queued){outcomes.push({account_id:account.id,result:'outbox_error'});continue}
    if(queued.status==='sent'){outcomes.push({account_id:account.id,result:'already_sent'});continue}
    if(queued.status==='sending'&&queued.last_attempt_at&&
      now.getTime()-new Date(queued.last_attempt_at).getTime()<20*60_000)continue
    let claimQuery=db.from('romylabs_day4_payment_reminders')
      .update({status:'sending',last_attempt_at:now.toISOString(),recipient:email,amount_cents:due})
      .eq('id',queued.id).eq('status',queued.status)
    if(queued.status==='sending')claimQuery=claimQuery.eq('last_attempt_at',queued.last_attempt_at)
    const {data:claim}=await claimQuery.select('id').maybeSingle()
    if(!claim)continue

    // Check again after claim to avoid emailing offices that paid while job ran.
    const {data:latest,error:latestError}=await db.from('romylabs_subscription_payments')
      .select('amount_cents,paid_at').eq('account_id',account.id)
      .eq('status','succeeded').gte('paid_at',period)
    if(latestError){
      await db.from('romylabs_day4_payment_reminders').update({status:'pending',last_error:'payment recheck failed'}).eq('id',claim.id)
      outcomes.push({account_id:account.id,result:'payment_recheck_failed'});continue
    }
    const paidNow=(latest||[]).filter(p=>p.paid_at&&sameMonth(p.paid_at,clock.year,clock.month))
      .reduce((sum,p)=>sum+Number(p.amount_cents||0),0)
    if(paidNow>=account.monthly_amount_cents){
      await db.from('romylabs_day4_payment_reminders').update({status:'pending',last_error:'payment received; no email necessary'}).eq('id',claim.id)
      continue
    }

    const subject=brand+' payment reminder — '+account.account_name+' — '+new Intl.DateTimeFormat('en-US',{
      month:'long',year:'numeric',timeZone:'America/New_York',
    }).format(now)
    const html='<div style="font-family:Arial,sans-serif;max-width:620px">'+
      '<h2>Monthly subscription payment reminder</h2>'+
      '<p>Hello '+escapeHtml(account.account_name)+',</p>'+
      '<p>Our records do not yet show full payment of the <strong>'+escapeHtml(subject.split(' — ').slice(-1)[0])+
      '</strong> '+escapeHtml(brand)+' subscription. The remaining amount is <strong>'+dollars(Math.max(0,account.monthly_amount_cents-paidNow))+'</strong>.</p>'+
      '<p>Please arrange payment at your earliest convenience. If you have already paid, please reply with the date or confirmation so we can reconcile our records.</p>'+
      '<p>Thank you,<br><strong>'+escapeHtml(brand)+' System Reminder</strong></p></div>'
    try{
      const submissionId=await sendViaStalwart(db,account.product_key,email,subject,html,brand)
      await db.from('romylabs_day4_payment_reminders').update({
        status:'sent',sent_at:new Date().toISOString(),last_error:null,
        provider_message_id:'stalwart:'+submissionId,attempts:queued.attempts?Number(queued.attempts)+1:1,
      }).eq('id',claim.id)
      outcomes.push({account_id:account.id,result:'sent'})
    }catch(error){
      const message=String(error instanceof Error?error.message:error)
      await db.from('romylabs_day4_payment_reminders').update({
        status:'pending',last_error:message,attempts:Number(queued.attempts||0)+1,
      }).eq('id',claim.id)
      outcomes.push({account_id:account.id,result:'send_failed'})
    }
  }
  return json({ok:true,period,results:outcomes})
})

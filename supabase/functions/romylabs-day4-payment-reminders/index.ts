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

const BRAND_ASSET_ORIGIN='https://taxrescrm.app'
const EMAIL_LOGO_CID='billing-logo@romylabs.system'
const BRAND_LOGO_FILES:Record<string,string>={
  taxres_crm:'taxrescrm-logo.png',
  arcvena:'arcvena-logo.png',
  bocasync:'bocasync-logo.svg',
  camvella:'camvella-logo.svg',
  restore_relay:'restore-relay-logo.svg',
  romylabs:'romylabs-logo.png',
  oculivo:'oculivo-logo.svg',
  groundivo:'groundivo-logo.svg',
}
const BRAND_DEFAULTS:Record<string,{website:string;accent:string}>={
  taxres_crm:{website:'https://taxrescrm.net',accent:'#2563EB'},
  arcvena:{website:'https://www.arcvena.com',accent:'#00C2FF'},
  bocasync:{website:'https://bocasync.com',accent:'#1596A6'},
  camvella:{website:'https://www.camvella.com',accent:'#0F766E'},
  restore_relay:{website:'https://restorerelay.com',accent:'#C2410C'},
  romylabs:{website:'https://romylabs.com',accent:'#7256D5'},
  oculivo:{website:'https://oculivo.com',accent:'#7C3AED'},
  groundivo:{website:'https://groundivo.com',accent:'#16A34A'},
  pool_crm:{website:'https://poolverge.com',accent:'#14B8A6'},
}
type BrandDetails={name:string;logoUrl:string;website:string;accent:string}
const safeHttps=(value:unknown)=>{
  try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:''}
  catch{return ''}
}
const brandFor=(productKey:string,registry:any):BrandDetails|null=>{
  const defaults=BRAND_DEFAULTS[productKey]
  const name=PRODUCT_BRANDS[productKey]
  if(!name)return null
  // Prefer the registered CRM's own logo, then a file confirmed in the
  // published CRM asset bundle. Never borrow another product's logo.
  const logo=safeHttps(registry?.logo_url)||
    (BRAND_LOGO_FILES[productKey]?BRAND_ASSET_ORIGIN+'/'+BRAND_LOGO_FILES[productKey]:'')
  const website=safeHttps(registry?.marketing_url)||defaults?.website||''
  const accent=/^#[0-9a-f]{6}$/i.test(String(registry?.accent_color||''))
    ?String(registry.accent_color):defaults?.accent||'#334155'
  if(!logo||!website)return null
  return {name,logoUrl:logo,website,accent}
}
const renderBrandedPaymentReminder=(brand:BrandDetails,accountName:string,monthLabel:string,amountCents:number):string=>{
  const name=escapeHtml(brand.name)
  const office=escapeHtml(accountName)
  const month=escapeHtml(monthLabel)
  const website=escapeHtml(brand.website)
  const logo='cid:'+EMAIL_LOGO_CID
  const accent=escapeHtml(brand.accent)
  const amount=dollars(Math.max(0,amountCents))
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
    '<body style="margin:0;padding:0;background:#f0f3f9;color:#19253b;font-family:Arial,Helvetica,sans-serif">'+
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f3f9">'+
    '<tr><td align="center" style="padding:32px 14px 40px">'+
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e1e7f0">'+
    '<tr><td style="background:#101f3b;padding:23px 32px;border-bottom:4px solid '+accent+'">'+
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'+
    '<td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border-radius:9px;padding:10px 14px"><img src="'+logo+'" width="170" height="65" style="display:block;max-width:170px;width:auto;height:auto;max-height:65px;border:0;outline:none;text-decoration:none" alt="'+name+' logo"></td></tr></table></td>'+
    '<td align="right" style="color:#d7e3f9;font-size:11px;letter-spacing:1.2px;font-weight:700;vertical-align:middle">BILLING NOTICE</td>'+
    '</tr></table></td></tr>'+
    '<tr><td style="padding:34px 36px 12px">'+
    '<div style="font-size:12px;font-weight:700;color:'+accent+';letter-spacing:1.3px">MONTHLY SUBSCRIPTION</div>'+
    '<h1 style="margin:12px 0 13px;font-size:28px;line-height:1.26;font-weight:800;color:#101c32 !important">A friendly payment reminder</h1>'+
    '<p style="font-size:16px;line-height:1.7;color:#243149 !important;margin:0 0 16px">Hello '+office+',</p>'+
    '<p style="font-size:16px;line-height:1.7;color:#243149 !important;margin:0 0 20px">Our records do not yet reflect full payment for your <strong>'+month+'</strong> '+name+' subscription.</p>'+
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#d8eaff;border:1px solid #d5e6fa;border-radius:12px">'+
    '<tr><td style="padding:20px 22px">'+
    '<div style="font-size:11px;font-weight:700;letter-spacing:1.1px;color:#61718b">REMAINING BALANCE</div>'+
    '<div style="font-size:36px;line-height:1.3;font-weight:800;color:#101c32 !important;padding-top:4px">'+amount+'</div>'+
    '<div style="font-size:12px;color:#65758d;margin-top:7px">'+month+' &middot; '+name+'</div>'+
    '</td></tr></table>'+
    '<p style="font-size:16px;line-height:1.7;color:#243149 !important;margin:22px 0 14px">Please arrange payment through your existing payment method. If you have already paid, please reply with the payment date or confirmation so we can update our records.</p>'+
    '<p style="font-size:14px;line-height:1.6;color:#56667d;margin:0 0 24px">Thank you for being part of '+name+'.</p>'+
    '<p style="font-size:14px;line-height:1.6;color:#24354f;margin:0 0 14px"><strong>'+name+' Billing Team</strong></p>'+
    '</td></tr>'+
    '<tr><td style="padding:22px 36px 26px;background:#edf0f5;border-top:1px solid #e8edf5">'+
    '<p style="font-size:13px;font-weight:700;color:#2f425f;margin:0 0 6px">'+name+'</p>'+
    '<a href="'+website+'" style="font-size:13px;color:'+accent+';text-decoration:none">'+website+'</a>'+
    '<p style="font-size:11px;line-height:1.6;color:#6d7c91;margin:14px 0 0">This is an automated billing reminder from '+name+'. No payment is processed through this email. Please do not share passwords or sensitive financial details by email.</p>'+
    '</td></tr></table></td></tr></table></body></html>'
}

const sameMonth=(value:string,year:number,month:number)=>{
  const d=new Date(value)
  if(!Number.isFinite(d.getTime()))return false
  const p=monthInfo(d)
  return p.year===year&&p.month===month
}


// Dedicated product-specific, nonpersonal Stalwart sender only.
// Missing verified sender => no send, never fall back to an owner's mailbox.
async function sendViaStalwart(db:any,productKey:string,recipient:string,subject:string,html:string,brand:string,logoUrl:string){
  const {data:transport,error:transportError}=await db.rpc('romylabs_system_reminder_transport',{p_product_key:productKey})
  if(transportError||!transport?.ok||!transport.username||!transport.password)throw new Error('Private system sender not configured for '+productKey)
  const host=String(transport.host||'mail.taxrescrm.net').replace(/^https?:\/\//,'').replace(/\/$/,'')
  const from=String(transport.from_address||transport.username).toLowerCase()
  if(!/^(info|support|billing|notifications|no-reply|noreply|system|reminders)@/i.test(from))
    throw new Error('Personal mailbox cannot send system reminders')
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
  // Download the committed brand asset and embed its actual bytes in the email.
  // Do not rely on hotlinked image loading, SVG display, or an invented logo.
  const logoResponse=await fetch(logoUrl,{redirect:'follow'})
  if(!logoResponse.ok)throw new Error('Official CRM logo unavailable HTTP '+logoResponse.status)
  const rawLogo=new Uint8Array(await logoResponse.arrayBuffer())
  const isPng=rawLogo.length>=24 && rawLogo[0]===137 && rawLogo[1]===80 &&
    rawLogo[2]===78 && rawLogo[3]===71 && rawLogo[4]===13 &&
    rawLogo[5]===10 && rawLogo[6]===26 && rawLogo[7]===10
  if(!isPng||rawLogo.byteLength>2*1024*1024)
    throw new Error('Official logo must be a valid PNG smaller than 2MB; no reminder sent')
  const uploadUrl=String(session.uploadUrl||'').replace('{accountId}',encodeURIComponent(accountId))
  if(!uploadUrl.startsWith('https://'))throw new Error('Stalwart JMAP upload endpoint unavailable')
  const uploadResponse=await fetch(uploadUrl,{
    method:'POST',
    headers:{Authorization:auth,'Content-Type':'image/png'},
    body:rawLogo,
  })
  if(!uploadResponse.ok)throw new Error('Stalwart logo upload HTTP '+uploadResponse.status)
  const uploaded=await uploadResponse.json()
  if(!uploaded.blobId||!uploaded.size)throw new Error('Stalwart did not return a logo blob')
  const draft={
    attachments:[{blobId:uploaded.blobId,type:'image/png',name:'official-crm-logo.png',
      size:uploaded.size,cid:EMAIL_LOGO_CID,disposition:'inline'}],
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

    const monthLabel=new Intl.DateTimeFormat('en-US',{
      month:'long',year:'numeric',timeZone:'America/New_York',
    }).format(now)
    const {data:product,error:brandError}=await db.from('romylabs_products')
      .select('name,logo_url,marketing_url,accent_color')
      .eq('product_id',account.product_key).maybeSingle()
    if(brandError){
      await db.from('romylabs_day4_payment_reminders')
        .update({status:'pending',last_error:'CRM brand lookup failed'}).eq('id',claim.id)
      outcomes.push({account_id:account.id,result:'brand_lookup_failed'});continue
    }
    const brandDetails=brandFor(account.product_key,product)
    if(!brandDetails){
      await db.from('romylabs_day4_payment_reminders')
        .update({status:'pending',last_error:'CRM logo or website not configured'}).eq('id',claim.id)
      outcomes.push({account_id:account.id,result:'missing_branded_email_assets'});continue
    }
    const subject=brandDetails.name+' payment reminder — '+account.account_name+' — '+monthLabel
    const html=renderBrandedPaymentReminder(brandDetails,account.account_name,monthLabel,
      account.monthly_amount_cents-paidNow)
    try{
      const submissionId=await sendViaStalwart(db,account.product_key,email,subject,html,brandDetails.name,brandDetails.logoUrl)
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

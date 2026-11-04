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
// Every on-the-wire identity, including hidden CID and Message-ID headers,
// belongs to the selected CRM; a platform-domain fallback is prohibited.
const MAIL_DOMAINS:Record<string,string>={
  taxres_crm:'taxrescrm.net',arcvena:'arcvena.com',bocasync:'bocasync.com',
  camvella:'camvella.com',restore_relay:'restorerelay.com',romylabs:'romylabs.com',
  oculivo:'oculivo.com',groundivo:'groundivo.com',pool_crm:'poolverge.com',
}
const emailLogoCid=(key:string)=>'billing-logo@'+MAIL_DOMAINS[key]
const BRAND_LOGO_FILES:Record<string,string>={
  taxres_crm:'taxrescrm-logo.png',
  arcvena:'arcvena-logo.png',
  bocasync:'bocasync-logo.png',
  camvella:'camvella-logo.png',
  restore_relay:'restore-relay-logo.png',
  romylabs:'romylabs-logo.png',
  oculivo:'oculivo-logo.png',
  groundivo:'groundivo-logo.png',
  pool_crm:'poolverge-official-mark.png',
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
type BrandDetails={productKey:string;name:string;logoUrl:string;website:string;accent:string}
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
  // Billing is exclusively company-branded, not dynamically overridden by
  // central registry values (which may belong to a parent or another tenant).
  const logoFile=BRAND_LOGO_FILES[productKey]
  const logo=logoFile ? BRAND_ASSET_ORIGIN+'/'+logoFile : ''
  const website=defaults?.website||''
  const accent=defaults?.accent||'#334155'
  if(!logo||!website||!MAIL_DOMAINS[productKey])return null
  return {productKey,name,logoUrl:logo,website,accent}
}
const renderBrandedPaymentReminder=(brand:BrandDetails,accountName:string,monthLabel:string,amountCents:number):string=>{
  const name=escapeHtml(brand.name)
  const office=escapeHtml(accountName)
  const month=escapeHtml(monthLabel)
  const website=escapeHtml(brand.website)
  const EMAIL_LOGO_CID=emailLogoCid(brand.productKey)
  const logo='cid:'+EMAIL_LOGO_CID
  const iconOnly=brand.name==='BocaSync'||brand.name==='PoolVerge'
  const logoWidth=iconOnly?56:170
  const logoHeight=iconOnly?56:65
  const brandLockup=iconOnly?'<span style="font-size:19px;font-weight:800;color:#102a47;padding-left:13px;vertical-align:middle">'+name+'</span>':''
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
    '<td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border-radius:9px;padding:10px 14px"><img src="'+logo+'" width="'+logoWidth+'" height="'+logoHeight+'" style="display:inline-block;width:auto;height:auto;max-height:'+logoHeight+'px;max-width:'+logoWidth+'px;border:0;outline:none;text-decoration:none;vertical-align:middle" alt="'+name+' logo">'+brandLockup+'</td></tr></table></td>'+
    '<td align="right" style="color:#d7e3f9;font-size:11px;letter-spacing:1.2px;font-weight:700;vertical-align:middle">BILLING NOTICE</td>'+
    '</tr></table></td></tr>'+
    '<tr><td style="padding:34px 36px 12px">'+
    '<div style="font-size:12px;font-weight:700;color:'+accent+';letter-spacing:1.3px">MONTHLY SUBSCRIPTION</div>'+
    '<h1 style="margin:12px 0 13px;font-size:28px;line-height:1.26;font-weight:800;color:#101c32 !important">A friendly payment reminder</h1>'+
    '<p style="font-size:16px;line-height:1.7;color:#243149 !important;margin:0 0 16px">Hello '+office+',</p>'+
    '<p style="font-size:16px;line-height:1.7;color:#243149 !important;margin:0 0 20px">Our records do not yet reflect full payment for your <strong>'+month+'</strong> '+name+' subscription.</p>'+
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#d8eaff;border:1px solid #d5e6fa;border-radius:12px">'+
    '<tr><td style="padding:20px 22px">'+
    '<div style="font-size:12px;font-weight:700;letter-spacing:1.1px;color:#0d488d">REMAINING BALANCE</div>'+
    '<div style="font-size:36px;line-height:1.3;font-weight:800;color:#101c32 !important;padding-top:4px">'+amount+'</div>'+
    '<div style="font-size:12px;color:#65758d;margin-top:7px">'+month+' &middot; '+name+'</div>'+
    '</td></tr></table>'+
    '<p style="font-size:16px;line-height:1.7;color:#243149 !important;margin:22px 0 14px">Please arrange payment through your existing payment method. If you have already paid, please reply with the payment date or confirmation so we can update our records.</p>'+
    '<p style="font-size:14px;line-height:1.6;color:#56667d;margin:0 0 24px">Thank you for being part of '+name+'.</p>'+
    '<p style="font-size:15px;line-height:1.6;color:#101c32;margin:0 0 14px"><strong>'+name+' Billing Team</strong></p>'+
    '</td></tr>'+
    '<tr><td style="padding:22px 36px 26px;background:#edf0f5;border-top:1px solid #e8edf5;text-align:center">'+
    '<p style="font-size:15px;font-weight:800;color:#101c32;margin:0 0 6px;text-align:center">'+name+'</p>'+
    '<a href="'+website+'" style="font-size:14px;color:'+accent+';text-decoration:underline">'+website+'</a>'+
    '<p style="font-size:12px;line-height:1.6;color:#50617a;margin:14px 0 0;text-align:center">This is an automated billing reminder from '+name+'. No payment is processed through this email. Please do not share passwords or sensitive financial details by email.</p>'+
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
  const EMAIL_LOGO_CID=emailLogoCid(productKey)
  const from=String(transport.from_address||transport.username).trim().toLowerCase()
  if(!/^(info|support|billing|notifications|no-reply|noreply|system|reminders)@/i.test(from))
    throw new Error('Personal mailbox cannot send system reminders')
  // A working mailbox belonging to another CRM is not a valid fallback.
  // Even a valid generic sender must belong to the selected product domain.
  const domain=MAIL_DOMAINS[productKey]
  if(!domain||!from.endsWith('@'+domain)||
      from!==String(transport.username).trim().toLowerCase()||
      brand!==PRODUCT_BRANDS[productKey])
    throw new Error('Cross-product sender or branding rejected')
  // Strictly reject cross-company branding for every billing product.
  const officialLogo=BRAND_ASSET_ORIGIN+'/'+BRAND_LOGO_FILES[productKey]
  const productWebsite=BRAND_DEFAULTS[productKey]?.website
  if(logoUrl!==officialLogo||!productWebsite||
     !html.includes(escapeHtml(productWebsite))||
     !html.includes(escapeHtml(PRODUCT_BRANDS[productKey]+' Billing Team')))
    throw new Error('Company billing logo, website or signature mismatch')
  // TaxRes must never contain RomyLabs anywhere in visible message content.
  // Hidden email identifiers use the TaxRes domain, not the platform domain.
  if(productKey==='taxres_crm'&&/romylabs|romy\x40/i.test([subject,html,brand,logoUrl,from].join(' ')))
    throw new Error('TaxRes-only branding guard: prohibited parent-company or personal reference')
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
  // The MIME structure is created explicitly: multipart/alternative containing
  // multipart/related(HTML + official inline PNG). Some Stalwart versions put
  // JMAP Email/set inline attachments into multipart/mixed, breaking cid images.
  const bytes64=(data:Uint8Array)=>{
    let binary=''
    for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384))
    return btoa(binary)
  }
  const lines64=(data:Uint8Array)=>bytes64(data).match(/.{1,76}/g)?.join('\r\n')||''
  const encodeText=(value:string)=>lines64(new TextEncoder().encode(value))
  const header=(value:string)=>value.replace(/[\r\n]/g,' ')
  const alt='alt_'+crypto.randomUUID().replaceAll('-','')
  const related='rel_'+crypto.randomUUID().replaceAll('-','')
  const plaintext=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
  const mime=[
    'From: "'+header(brand)+' System Reminder" <'+from+'>',
    'To: <'+recipient+'>',
    'Reply-To: <'+from+'>',
    'Subject: '+header(subject),
    'Date: '+new Date().toUTCString(),
    'Message-ID: <'+crypto.randomUUID()+'@'+domain+'>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="'+alt+'"',
    '',
    '--'+alt,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeText(plaintext),
    '--'+alt,
    'Content-Type: multipart/related; boundary="'+related+'"',
    '',
    '--'+related,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeText(html),
    '--'+related,
    'Content-Type: image/png; name="official-crm-logo.png"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <'+EMAIL_LOGO_CID+'>',
    'Content-Disposition: inline; filename="official-crm-logo.png"',
    '',
    lines64(rawLogo),
    '--'+related+'--',
    '--'+alt+'--',
    '',
  ].join('\r\n')
  const uploadUrl=String(session.uploadUrl||'').replace('{accountId}',encodeURIComponent(accountId))
  if(!uploadUrl.startsWith('https://'))throw new Error('Stalwart JMAP upload endpoint unavailable')
  const uploadResponse=await fetch(uploadUrl,{
    method:'POST',
    headers:{Authorization:auth,'Content-Type':'message/rfc822'},
    body:new TextEncoder().encode(mime),
  })
  if(!uploadResponse.ok)throw new Error('Stalwart MIME upload HTTP '+uploadResponse.status)
  const uploaded=await uploadResponse.json()
  if(!uploaded.blobId||!uploaded.size)throw new Error('Stalwart did not return MIME blob')
  const importRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail'],
    methodCalls:[['Email/import',{accountId,emails:{
      reminder:{blobId:uploaded.blobId,mailboxIds:{[drafts.id]:true},keywords:{'$draft':true}},
    }},'i1']],
  })})
  if(!importRes.ok)throw new Error('Stalwart MIME import HTTP '+importRes.status)
  const importedResult=await importRes.json()
  const importData=importedResult.methodResponses?.find((v:any)=>v?.[0]==='Email/import')?.[1]
  if(importData?.notCreated?.reminder||!importData?.created?.reminder?.id)
    throw new Error('Stalwart rejected MIME import')
  const emailId=String(importData.created.reminder.id)
  const submitRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[
      ['EmailSubmission/set',{accountId,create:{sendIt:{emailId,identityId:identity.id}},
        onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sentBox.id]:true,'keywords/$draft':null}}},'s0'],
    ],
  })})
  if(!submitRes.ok)throw new Error('Stalwart submission HTTP '+submitRes.status)
  const result=await submitRes.json()
  const submission=result.methodResponses?.find((v:any)=>v?.[0]==='EmailSubmission/set')?.[1]
  if(submission?.notCreated?.sendIt||!submission?.created?.sendIt?.id)throw new Error('Stalwart did not accept submission')
  return String(submission.created.sendIt.id)
}


const standardEmail=(value:unknown)=>String(value||'').trim().toLowerCase()
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed'},405)
  const expected=Deno.env.get('ROMYLABS_BILLING_CRON_SECRET')
  if(!expected||req.headers.get('x-cron-secret')!==expected)
    return json({ok:false,error:'Unauthorized'},401)
  const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
  const {data:events,error}=await db.from('romylabs_collection_events')
    .select('*, romylabs_billing_accounts(account_name,billing_email,product_key), romylabs_invoices(invoice_number,amount_cents,due_at,final_deadline_at,issued_at)')
    .in('event_type',['invoice_created','notice_1_sent','notice_2_sent'])
    .eq('channel','email').is('detail->>delivered_at',null)
    .order('created_at',{ascending:true}).limit(100)
  if(error)return json({ok:false,error:'Collection lookup failed'},500)
  const results:Array<Record<string,unknown>>=[]
  for(const event of events||[]){
    const account=event.romylabs_billing_accounts as any
    const invoice=event.romylabs_invoices as any
    const productKey=String(account?.product_key||'')
    const to=standardEmail(event.recipient||account?.billing_email)
    const brandName=PRODUCT_BRANDS[productKey]
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!invoice||!brandName||!BRAND_LOGO_FILES[productKey]){
      results.push({event_id:event.id,ok:false,reason:'invalid_recipient_invoice_or_product'})
      continue
    }
    const {data:registry,error:registryError}=await db.from('romylabs_products')
      .select('name,logo_url,marketing_url,accent_color')
      .eq('product_id',productKey).maybeSingle()
    const brand=registryError?null:brandFor(productKey,registry)
    if(!brand){
      results.push({event_id:event.id,ok:false,reason:'no_official_product_brand'})
      continue
    }
    const statusLabel=event.event_type==='notice_2_sent'?'Final payment notice'
      :event.event_type==='notice_1_sent'?'Payment reminder':'Invoice issued'
    const monthDate=invoice.issued_at?new Date(invoice.issued_at):new Date()
    const monthLabel=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'America/New_York'}).format(
      Number.isFinite(monthDate.getTime())?monthDate:new Date())
    const subject=brand.name+' — '+statusLabel+' — '+String(invoice.invoice_number||'')
    const due=Number(invoice.amount_cents||0)
    let html=renderBrandedPaymentReminder(brand,String(account.account_name||''),monthLabel,due)
    const deadline=event.event_type==='notice_2_sent'&&invoice.final_deadline_at
      ?new Date(invoice.final_deadline_at).toLocaleDateString('en-US',{timeZone:'America/New_York'})
      :invoice.due_at?new Date(invoice.due_at).toLocaleDateString('en-US',{timeZone:'America/New_York'}):''
    const extra=(deadline?statusLabel+' for invoice '+String(invoice.invoice_number||'')+
      '. Payment due '+deadline+'. ':'')+'If payment has already been made, please reply with the confirmation.'
    const paragraph='<p style="font-size:14px;line-height:1.6;color:#243149">'+escapeHtml(extra)+'</p>'
    html=html.replace('</td></tr><tr><td style="padding:22px 36px 26px',paragraph+'</td></tr><tr><td style="padding:22px 36px 26px')
    try{
      const sent=await sendViaStalwart(db,productKey,to,subject,html,brand.name,brand.logoUrl)
      const detail={...(event.detail||{}),delivered_at:new Date().toISOString(),transport:'stalwart',message_id:'stalwart:'+sent}
      const {error:updateError}=await db.from('romylabs_collection_events').update({detail}).eq('id',event.id)
      if(updateError){results.push({event_id:event.id,ok:false,reason:'submitted_outbox_update_failed'});continue}
      if(event.event_type==='invoice_created'){
        await db.from('romylabs_collection_events').insert({account_id:event.account_id,invoice_id:event.invoice_id,
          event_type:'invoice_sent',channel:'email',recipient:to,detail:{source_event_id:event.id}})
      }
      results.push({event_id:event.id,ok:true,brand:brand.name})
    }catch(e){
      results.push({event_id:event.id,ok:false,reason:String(e instanceof Error?e.message:e)})
    }
  }
  return json({ok:true,processed:results.length,results})
})

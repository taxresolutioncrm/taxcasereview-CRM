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
  settlelift:'SettleLift',barbers_salons:'ChairStyle',health_insurance:'Health Insurance Agency CRM',phl_land_care:'PHL Land Care CRM',
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
  settlelift:{website:'https://settlelift.com/',accent:'#C6FF00'},
  barbers_salons:{website:'https://chairstyle.net/',accent:'#EC4899'},
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
  const industry=escapeHtml(INDUSTRY_DESCRIPTORS[brand.productKey]||'business software')
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


const INDUSTRY_DESCRIPTORS:Record<string,string>={
  taxres_crm:'tax practice and resolution case management',
  restore_relay:'contractor operations and job management',
  pool_crm:'pool service scheduling and route operations',
  bocasync:'dental practice management',
  arcvena:'field-service and trade business management',
  camvella:'HOA and community management',
  oculivo:'eye-care practice management',
  groundivo:'grounds and outdoor-service management',
  barbers_salons:'salon and barbershop management',
  settlelift:'debt-settlement client management',
  health_insurance:'health insurance agency management',
  phl_land_care:'land care business management',
  romylabs:'software and business operations'
}
type ReminderCopy={subject_override:string;opening_text:string;additional_text:string;closing_text:string}
const firstDayMessage=(brand:BrandDetails,office:string,monthLabel:string,amount:number,isAuto:boolean,nextBillDay:number,year:number,isChris:boolean,copy:ReminderCopy)=>{
  const name=escapeHtml(brand.name)
  const company=escapeHtml(office)
  const month=escapeHtml(monthLabel)
  const industry=escapeHtml(INDUSTRY_DESCRIPTORS[brand.productKey]||'business software')
  const chrisZelle= isChris && year<=2026
  const heading=isAuto?'Upcoming automatic subscription payment':isChris?'Friendly monthly reminder':'Monthly subscription payment reminder'
  const explanation=isAuto
    ?'Your '+name+' office subscription is already scheduled for automatic billing on the '+nextBillDay+
      'th. This is an advance notice only; no new payment link is needed and no additional charge is being requested.'
    :chrisZelle
      ?'Just a friendly reminder about your '+month+' '+name+' subscription. You can continue sending your payment through Zelle as usual. If you already sent it, thank you — no further action is needed.'
      :isChris
        ?'Just a friendly reminder about your '+month+' '+name+' subscription. Your usual payment arrangement remains available. If you already sent payment, thank you — no action is needed.'
        :'Your '+name+' office subscription for '+month+' is due. Please arrange your regular payment method. If you have already paid, reply with your confirmation.'
  // Do not imply that an already-running Stripe subscription needs a second payment.
  // A card-fee option is not yet live; only describe it as an advance policy disclosure.
  const paymentNotice=isAuto
    ?'Your existing authorization and subscription schedule remain unchanged. No action or additional payment is required for this notice.'
    :chrisZelle
      ?'Please continue with Zelle as usual for the remainder of 2026. This is only a courtesy reminder.'
      :'If you prefer to pay by credit card, contact our billing team for an available approved checkout. Any permitted credit-card processing fee will be clearly disclosed before payment is authorized.'
  return '<!doctype html><html><head><meta charset="utf-8"></head>'+
    '<body style="background:#f0f3f9;margin:0;font-family:Arial,sans-serif;color:#19253b">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 12px">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border:1px solid #e1e7f0;border-radius:13px;overflow:hidden">'+
    '<tr><td style="background:#101f3b;padding:22px;border-bottom:4px solid '+escapeHtml(brand.accent)+'">'+
    '<img alt="'+name+' logo" src="cid:'+emailLogoCid(brand.productKey)+'" width="170" style="max-width:170px;max-height:65px;background:white;padding:6px;border-radius:6px"></td></tr>'+
    '<tr><td style="padding:28px 34px">'+
    '<h1 style="font-size:23px;color:#101c32">'+heading+'</h1>'+
    '<p style="font-size:15px;line-height:1.6">Hello '+company+',</p>'+
    '<p style="font-size:15px;line-height:1.6">'+escapeHtml(explanation)+'</p>'+
    (copy.opening_text?'<p style="font-size:15px;line-height:1.6">'+escapeHtml(copy.opening_text).replaceAll(String.fromCharCode(10),'<br>')+'</p>':'')+
    '<div style="background:#d8eaff;padding:18px;border-radius:9px">'+
    '<div style="font-size:12px;font-weight:bold;color:#0d488d">'+(isAuto?'UPCOMING AUTOMATIC PAYMENT':'MONTHLY SUBSCRIPTION')+'</div>'+
    '<div style="font-size:28px;font-weight:800;color:#101c32 !important">'+dollars(amount)+'</div>'+
    '<div style="font-size:12px;color:#50617a">'+month+' · '+name+'</div>'+ 
    '<div style="font-size:12px;color:#50617a;margin-top:5px">For your '+industry+' team</div></div>'+
    (chrisZelle
      ?'<div style="margin:18px 0;padding:16px;border:1px solid #dbe3ef;border-radius:10px;background:#f8fafc">'+
        '<div style="font-size:14px;font-weight:800;color:#101c32">Your usual payment method</div>'+
        '<p style="font-size:13px;line-height:1.6;margin:10px 0 0;color:#243149"><strong>Zelle:</strong> Please use the same payment arrangement as before.</p>'+
        '</div>'
      :'<div style="margin:18px 0;padding:16px;border:1px solid #dbe3ef;border-radius:10px;background:#f8fafc">'+
        '<div style="font-size:14px;font-weight:800;color:#101c32">Payment options &amp; processing fees</div>'+
    '<p style="font-size:13px;line-height:1.6;margin:10px 0 5px;color:#243149"><strong>ACH / Bank Transfer:</strong> No additional card-processing fee.</p>'+
    '<p style="font-size:13px;line-height:1.6;margin:0;color:#243149"><strong>Credit Card:</strong> A processing fee may apply where permitted. The exact amount must be disclosed before payment. Debit and prepaid cards are not subject to a credit-card surcharge.</p>'+
    '</div>')+
    '<p style="font-size:14px;line-height:1.6">'+escapeHtml(paymentNotice)+'</p>'+
    (copy.additional_text?'<div style="font-size:14px;line-height:1.65;padding:14px;border:1px solid #e1e7f0;border-radius:9px;color:#243149">'+escapeHtml(copy.additional_text).replaceAll(String.fromCharCode(10),'<br>')+'</div>':'')+
    (copy.closing_text?'<p style="font-size:14px;line-height:1.6">'+escapeHtml(copy.closing_text).replaceAll(String.fromCharCode(10),'<br>')+'</p>':'')+
    '<p style="font-size:14px"><strong>'+name+' Billing Team</strong></p>'+
    '</td></tr><tr><td style="background:#edf0f5;padding:20px;text-align:center">'+
    '<a href="'+escapeHtml(brand.website)+'">'+escapeHtml(brand.website)+'</a>'+
    '<p style="font-size:11px;color:#64748b">This is an automated billing reminder from '+name+'. Do not email payment credentials.</p>'+
    '</td></tr></table></td></tr></table></body></html>'
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}})
  const token=req.headers.get('x-internal-cron-token')||''
  const {data:authorized,error:authError}=token
    ? await db.rpc('verify_internal_cron_token',{provided:token})
    : {data:false,error:null}
  if(authError||authorized!==true)return json({error:'Unauthorized'},401)
  const now=new Date(),clock=monthInfo(now)
  if(clock.day!==1||clock.hour<9||clock.hour>=12)
    return json({ok:true,skipped:'outside first day 9–12 Eastern'})
  const period=clock.year+'-'+String(clock.month).padStart(2,'0')+'-01'
  const monthLabel=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'America/New_York'}).format(now)
  // Only the explicitly approved accounts; never email other offices without a request.
  const {data:accounts,error:accountError}=await db.from('romylabs_billing_accounts')
    .select('id,account_name,billing_email,monthly_amount_cents,billing_day,auto_invoice,product_key,status')
    .in('status',['active','past_due'])
  if(accountError)return json({error:'Billing account query unavailable'},503)
  const outcomes:Array<Record<string,unknown>>=[]
  for(const a of accounts||[]){
    // Product identity comes from this account; special terms belong to the precise account, not the whole CRM.
    const isChris=a.id==='3aa7c0d0-3765-4e9c-9838-9e8efa6c4448'&&a.product_key==='taxres_crm'
    const isRafael=a.id==='339710c8-4739-450f-bac8-540a3a325cec'&&a.product_key==='restore_relay'
    // Never call a new office 'automatic' merely because it shares Restore Relay.
    // A separately hosted Stripe subscription is considered automatic only when
    // the SaaS ledger has a confirmed Stripe invoice for this exact account.
    let stripeManaged=false
    if(!isRafael && a.auto_invoice===false){
      const {data:priorStripe,error:stripeError}=await db.from('romylabs_invoices')
        .select('id').eq('account_id',a.id).eq('provider','stripe').limit(1)
      if(stripeError){outcomes.push({account_id:a.id,result:'stripe_subscription_check_failed'});continue}
      stripeManaged=Boolean(priorStripe?.length)
    }
    const isAuto=isRafael||stripeManaged
    const email=String(a.billing_email||'').trim()
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
       Number(a.monthly_amount_cents)<=0){outcomes.push({account_id:a.id,result:'invalid_recipient_or_amount'});continue}
    // Suppress an unnecessary payment demand if Chris's current period is already paid.
    if(!isAuto){
      const {data:invoices,error:invoiceError}=await db.from('romylabs_invoices')
        .select('status,amount_paid_cents,amount_cents').eq('account_id',a.id)
        .eq('period_start',period)
      if(invoiceError){outcomes.push({account_id:a.id,result:'invoice_lookup_failed'});continue}
      if((invoices||[]).some((i:any)=>i.status==='paid'||Number(i.amount_paid_cents)>=Number(i.amount_cents))){
        outcomes.push({account_id:a.id,result:'already_paid'});continue
      }
      const {data:payments,error:paymentError}=await db.from('romylabs_subscription_payments')
        .select('amount_cents,paid_at').eq('account_id',a.id).eq('status','succeeded').gte('paid_at',period)
      if(paymentError){outcomes.push({account_id:a.id,result:'payment_lookup_failed'});continue}
      const paid=(payments||[]).filter((p:any)=>p.paid_at&&sameMonth(p.paid_at,clock.year,clock.month))
        .reduce((n:number,p:any)=>n+Number(p.amount_cents||0),0)
      if(paid>=Number(a.monthly_amount_cents)){outcomes.push({account_id:a.id,result:'already_paid'});continue}
    }
    const {error:queueError}=await db.from('romylabs_first_day_office_reminders').upsert({
      account_id:a.id,period_month:period,recipient:email,
      amount_cents:Number(a.monthly_amount_cents)
    },{onConflict:'account_id,period_month',ignoreDuplicates:true})
    if(queueError){outcomes.push({account_id:a.id,result:'queue_unavailable'});continue}
    const {data:queued,error:readError}=await db.from('romylabs_first_day_office_reminders')
      .select('id,status,attempts,last_attempt_at').eq('account_id',a.id).eq('period_month',period).single()
    if(readError||!queued){outcomes.push({account_id:a.id,result:'queue_read_failed'});continue}
    if(queued.status==='sent'){outcomes.push({account_id:a.id,result:'already_sent'});continue}
    if(queued.status==='sending'&&queued.last_attempt_at&&now.getTime()-new Date(queued.last_attempt_at).getTime()<20*60_000)continue
    let claimQuery=db.from('romylabs_first_day_office_reminders')
      .update({status:'sending',recipient:email,last_attempt_at:now.toISOString()})
      .eq('id',queued.id).eq('status',queued.status)
    if(queued.status==='sending')claimQuery=claimQuery.eq('last_attempt_at',queued.last_attempt_at)
    const {data:claim}=await claimQuery.select('id').maybeSingle()
    if(!claim)continue
    // Avoid a misleading alert if the customer payment came in during queue processing.
    if(!isAuto){
      const {data:latest,error:recheckError}=await db.from('romylabs_invoices')
        .select('status,amount_paid_cents,amount_cents').eq('account_id',a.id).eq('period_start',period)
      if(recheckError||(latest||[]).some((i:any)=>i.status==='paid'||Number(i.amount_paid_cents)>=Number(i.amount_cents))){
        await db.from('romylabs_first_day_office_reminders')
          .update({status:'pending',last_error:recheckError?'recheck failed':'already paid'}).eq('id',claim.id)
        outcomes.push({account_id:a.id,result:recheckError?'recheck_failed':'already_paid'});continue
      }
    }
    const {data:product,error:brandError}=await db.from('romylabs_products')
      .select('name,logo_url,marketing_url,accent_color').eq('product_id',a.product_key).maybeSingle()
    const brand=brandError?null:brandFor(a.product_key,product)
    if(!brand){
      await db.from('romylabs_first_day_office_reminders')
        .update({status:'pending',last_error:'branded sender assets unavailable'}).eq('id',claim.id)
      outcomes.push({account_id:a.id,result:'brand_or_verified_sender_unavailable',product_key:a.product_key});continue
    }
    // Read platform-admin-managed per-CRM copy and optional office-specific override.
    // If the editor store cannot be read, do not send a silently stale email.
    const {data:customRows,error:customError}=await db.from('romylabs_monthly_reminder_content')
      .select('scope_key,subject_override,opening_text,additional_text,closing_text')
      .eq('product_key',a.product_key).in('scope_key',['product:'+a.product_key,'office:'+a.id])
    if(customError){
      await db.from('romylabs_first_day_office_reminders')
        .update({status:'pending',last_error:'editable reminder content could not be loaded'}).eq('id',claim.id)
      outcomes.push({account_id:a.id,result:'reminder_content_unavailable'});continue
    }
    const productCopy=customRows?.find((r:any)=>r.scope_key==='product:'+a.product_key)
    const officeCopy=customRows?.find((r:any)=>r.scope_key==='office:'+a.id)
    const copy:ReminderCopy={
      subject_override:String(officeCopy?.subject_override||productCopy?.subject_override||'').trim(),
      opening_text:String(officeCopy?.opening_text||productCopy?.opening_text||'').trim(),
      additional_text:String(officeCopy?.additional_text||productCopy?.additional_text||'').trim(),
      closing_text:String(officeCopy?.closing_text||productCopy?.closing_text||'').trim()
    }
    // Preserve sender product identity even when the admin changes the subject.
    const defaultSubject=(isAuto?'upcoming automatic payment notice':isChris?'friendly monthly reminder':'payment reminder')
    const customSubject=copy.subject_override.replaceAll(String.fromCharCode(10),' ').replaceAll(String.fromCharCode(13),' ').slice(0,180)
    const subject=brand.name+' — '+(customSubject||defaultSubject)+' — '+monthLabel
    const html=firstDayMessage(brand,a.account_name,monthLabel,Number(a.monthly_amount_cents),isAuto,Number(a.billing_day||19),clock.year,isChris,copy)
    try{
      const sent=await sendViaStalwart(db,a.product_key,email,subject,html,brand.name,brand.logoUrl)
      await db.from('romylabs_first_day_office_reminders').update({
        status:'sent',sent_at:new Date().toISOString(),last_error:null,
        provider_message_id:'stalwart:'+sent,attempts:Number(queued.attempts||0)+1
      }).eq('id',claim.id)
      outcomes.push({account_id:a.id,result:'sent',sender_product:a.product_key})
    }catch(error){
      await db.from('romylabs_first_day_office_reminders').update({
        status:'pending',last_error:String(error instanceof Error?error.message:error).slice(0,300),
        attempts:Number(queued.attempts||0)+1
      }).eq('id',claim.id)
      outcomes.push({account_id:a.id,result:'send_failed'})
    }
  }
  return json({ok:true,period,results:outcomes})
})

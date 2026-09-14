import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const safe=(v:unknown)=>String(v??'').replace(/[\r\n]+/g,' ').trim()
const nowIso=()=>new Date().toISOString()

async function sha256(s:string){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')
}

async function routeForProduct(admin:any,productKey:string){
  const {data:routes,error:routeError}=await admin.from('romylabs_mailboxes')
    .select('id,product_id,outbound_from,inbox_owner,tenant_id,display_name,active')
    .eq('product_id',productKey).eq('active',true).order('created_at',{ascending:true})
  if(routeError)throw routeError
  const {data:t}=await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:productKey})
  if(!t?.ok||!t?.username||!t?.password)throw new Error('Stalwart transport unavailable for '+productKey)
  const resolvedFrom=safe(t.from_address||t.username).toLowerCase()
  const route=(Array.isArray(routes)?routes:[]).find((r:any)=>safe(r.outbound_from).toLowerCase()===resolvedFrom)
  if(!route?.outbound_from)throw new Error('No active mailbox route matches Stalwart identity for '+productKey)
  return {route,transport:t}
}

async function sendViaStalwart(admin:any,doc:any,to:string,subject:string,html:string){
  const {route,transport:t}=await routeForProduct(admin,String(doc.product_key))
  const base='https://'+String(t.host||'mail.taxrescrm.net').replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(String(t.username)+':'+String(t.password))
  const sessionRes=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!sessionRes.ok)throw new Error('Stalwart session failed ('+sessionRes.status+')')
  const session=await sessionRes.json()
  const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
  const apiUrl=String(session.apiUrl||'').replace('{accountId}','')
  if(!apiUrl||!accountId)throw new Error('Stalwart mail account unavailable')
  const metaRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[['Identity/get',{accountId},'i0'],['Mailbox/get',{accountId,properties:['id','name','role']},'m0']]
  })})
  if(!metaRes.ok)throw new Error('Stalwart metadata failed ('+metaRes.status+')')
  const meta=await metaRes.json()
  const ids=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list||[]
  const boxes=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list||[]
  const routedFrom=safe(route.outbound_from).toLowerCase()
  const identity=ids.find((x:any)=>String(x.email||'').toLowerCase()===routedFrom)
  const drafts=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='drafts')
  const sent=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='sent')
  if(!identity?.id||!drafts?.id||!sent?.id)throw new Error('Stalwart identity or mailboxes unavailable')
  const bodyId='body'
  const sendRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[
      ['Email/set',{accountId,create:{draft:{
        from:[{email:routedFrom,name:String(route.display_name||doc.firm_name||'RomyLabs')}],
        to:[{email:to}],subject,mailboxIds:{[drafts.id]:true},keywords:{'$draft':true},
        bodyValues:{[bodyId]:{value:html,charset:'utf-8'}},htmlBody:[{partId:bodyId,type:'text/html'}]
      }}},'e0'],
      ['EmailSubmission/set',{accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}}},'s0']
    ]
  })})
  if(!sendRes.ok)throw new Error('Stalwart send failed ('+sendRes.status+')')
  const body=await sendRes.json()
  const sub=(body.methodResponses||[]).find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const submissionId=sub?.created?.sendIt?.id
  if(!submissionId)throw new Error('Stalwart did not confirm submission')

  const stamp=nowIso()
  await admin.from('emails').insert({
    tenant_id:route.tenant_id,recipient:to,recipients:[to],subject,
    body:html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),body_html:html,
    triage:'Sent',status:'Sent',direction:'outbound',is_read:true,
    sender:routedFrom,from_address:routedFrom,reply_from:routedFrom,
    mailbox_owner:String(route.inbox_owner||'info@romylabs.com'),
    received_at:stamp,created_at:stamp,product_id:doc.product_key,
    message_id:'stalwart:'+String(submissionId),received_mailbox:routedFrom,route_id:route.id
  })
  return {submissionId:String(submissionId),from:routedFrom}
}

async function appendEvent(admin:any,doc:any,eventType:string,metadata:any={}){
  await admin.from('romylabs_esign_events').insert({
    envelope_id:doc.id,event_type:eventType,actor_email:null,actor_name:'System',
    metadata,occurred_at:nowIso()
  })
}

async function rotateSigningToken(admin:any,doc:any){
  const {data:recipient}=await admin.from('romylabs_esign_recipients')
    .select('id,token_hash').eq('envelope_id',doc.id).eq('role','signer')
    .in('status',['pending','sent','viewed']).order('recipient_order',{ascending:true}).limit(1).maybeSingle()

  // Preserve the previous legitimate link before rotating to a fresh reminder token.
  if(doc.token_hash){
    const {error:aliasError}=await admin.from('romylabs_esign_token_aliases').upsert({
      token_hash:String(doc.token_hash),
      envelope_id:doc.id,
      recipient_id:recipient?.id||null,
      source:'scheduled_reminder',
      revoked_at:null,
    },{onConflict:'token_hash'})
    if(aliasError)throw aliasError
  }

  const bytes=crypto.getRandomValues(new Uint8Array(32))
  const token=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('')
  const tokenHash=await sha256(token)
  await admin.from('romylabs_office_signing_documents').update({token_hash:tokenHash,updated_at:nowIso()}).eq('id',doc.id)
  if(recipient?.id){
    await admin.from('romylabs_esign_recipients').update({token_hash:tokenHash,updated_at:nowIso()}).eq('id',recipient.id)
  }
  return token
}

serve(async(req)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  try{
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const token=req.headers.get('x-internal-cron-token')||''
    const {data:authorized,error:authErr}=token?await admin.rpc('verify_internal_cron_token',{provided:token}):{data:false,error:null}
    if(authErr||authorized!==true)return json({error:'Unauthorized'},401)

    const now=new Date()
    let reminders=0,warnings=0,expired=0,failed=0,skipped=0
    const {data:docs,error}=await admin.from('romylabs_office_signing_documents')
      .select('*').in('status',['sent','viewed']).order('created_at',{ascending:true})
    if(error)throw error

    for(const doc of docs||[]){
      try{
        const expiresAt=doc.expires_at?new Date(doc.expires_at):null
        if(expiresAt&&expiresAt.getTime()<=now.getTime()){
          const stamp=nowIso()
          const audit=[...(Array.isArray(doc.audit)?doc.audit:[]),{event:'expired',at:stamp,actor:'system'}]
          const {data:expiredRow}=await admin.from('romylabs_office_signing_documents')
            .update({status:'expired',updated_at:stamp,audit})
            .eq('id',doc.id).in('status',['sent','viewed']).select('id').maybeSingle()
          if(!expiredRow){skipped++;continue}
          await admin.from('romylabs_esign_recipients')
            .update({status:'skipped',updated_at:stamp})
            .eq('envelope_id',doc.id).in('status',['pending','sent','viewed'])
          await appendEvent(admin,doc,'expired')
          const {route}=await routeForProduct(admin,String(doc.product_key))
          await sendViaStalwart(admin,doc,String(route.outbound_from),'Expired: '+String(doc.title||'Signature request'),
            '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>Signature request expired</h2><p><strong>'+esc(doc.firm_name)+'</strong> - '+esc(doc.title)+'</p><p>'+esc(doc.signer_name||doc.signer_email)+' did not complete the document before the expiration time.</p><p>Envelope ID: '+esc(doc.id)+'</p></div>')
          expired++
          continue
        }

        const settings=(doc.envelope_settings&&typeof doc.envelope_settings==='object')?doc.envelope_settings:{}
        const msDay=86400000
        const sentAt=doc.sent_at?new Date(doc.sent_at):null
        const lastReminder=doc.last_reminder_at?new Date(doc.last_reminder_at):null
        const delayDays=Math.max(1,Number(doc.reminder_delay_days||2))
        const freqDays=Math.max(1,Number(doc.reminder_frequency_days||2))
        const reminderDue=doc.reminder_enabled===true&&sentAt&&(
          (!lastReminder&&now.getTime()>=sentAt.getTime()+delayDays*msDay)||
          (lastReminder&&now.getTime()>=lastReminder.getTime()+freqDays*msDay)
        )
        const warningDays=Math.max(1,Number(doc.expiration_warning_days||3))
        const daysLeft=expiresAt?Math.ceil((expiresAt.getTime()-now.getTime())/msDay):null
        const warningDue=Boolean(expiresAt&&daysLeft!==null&&daysLeft<=warningDays&&!settings.expiration_warning_sent_at)

        if(!reminderDue&&!warningDue){skipped++;continue}

        const freshToken=await rotateSigningToken(admin,doc)
        const signUrl='https://admin.romylabs.com/office-sign/'+freshToken
        const isWarning=warningDue
        const subject=isWarning
          ?'Expiring soon: '+String(doc.title||'Signature request')
          :'Reminder: Please sign '+String(doc.title||'your document')
        const html='<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033">'
          +'<h2>'+esc(doc.firm_name)+' - '+(isWarning?'Signature link expiring soon':'Signature reminder')+'</h2>'
          +'<p>Hi '+esc(doc.signer_name||'there')+',</p>'
          +'<p>'+(isWarning?('Your signing link expires in '+daysLeft+' day'+(daysLeft===1?'':'s')+'.'):'This document is still waiting for your signature.')+'</p>'
          +'<div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;margin:18px 0"><strong>'+esc(doc.title)+'</strong></div>'
          +'<p><a href="'+signUrl+'" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review &amp; Sign Document</a></p>'
          +'<p style="font-size:12px;color:#64748b">For security, this email contains a fresh signing link.</p>'
          +'<p>Best Regards,<br><strong>'+esc(doc.firm_name)+'</strong><br>RomyLabs</p></div>'
        const delivered=await sendViaStalwart(admin,doc,String(doc.signer_email),subject,html)
        const stamp=nowIso()
        const audit=[...(Array.isArray(doc.audit)?doc.audit:[]),{
          event:isWarning?'expiration_warning_sent':'reminder_sent',at:stamp,actor:'system',
          transport:'stalwart_jmap',from:delivered.from,submission_id:delivered.submissionId
        }]
        const nextSettings=isWarning?{...settings,expiration_warning_sent_at:stamp}:settings
        await admin.from('romylabs_office_signing_documents').update({
          last_reminder_at:isWarning?doc.last_reminder_at:stamp,
          envelope_settings:nextSettings,audit,updated_at:stamp
        }).eq('id',doc.id)
        await appendEvent(admin,doc,isWarning?'expiration_warning_sent':'reminder_sent',{submission_id:delivered.submissionId,from:delivered.from})
        if(isWarning)warnings++;else reminders++
      }catch(e){
        console.error('[esign-reminders] document failed',doc?.id,e)
        failed++
      }
    }

    return json({ok:true,reminders,warnings,expired,failed,skipped})
  }catch(err){
    console.error('[esign-reminders]',err)
    return json({error:'Universal e-sign reminder sweep failed'},500)
  }
})

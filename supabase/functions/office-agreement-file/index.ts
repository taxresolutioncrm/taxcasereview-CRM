import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const LEGACY_BUCKET='office-agreements'
const ESIGN_BUCKET='romylabs-esign'
const PLATFORM_ADMIN_EMAILS=new Set(['romy@taxcasereview.org','romy@romylabs.com','romy@taxrescrm.net','info@romylabs.com'])
const enc=new TextEncoder()
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
async function sha256(s:string){const b=await crypto.subtle.digest('SHA-256',enc.encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sha256Bytes(bytes:Uint8Array){const b=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function appendEvent(admin:any,envelopeId:string,eventType:string,opts:any={}){
  try{
    await admin.from('romylabs_esign_events').insert({
      envelope_id:envelopeId,
      recipient_id:opts.recipientId||null,
      event_type:eventType,
      actor_email:opts.actorEmail||null,
      actor_name:opts.actorName||null,
      ip_address:opts.ipAddress||null,
      user_agent:opts.userAgent||null,
      metadata:opts.metadata||{},
      occurred_at:opts.occurredAt||new Date().toISOString(),
    })
  }catch(e){console.error('[office-agreement-file] event log failed',e)}
}
function ip(req:Request){return req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null}
function safeFile(v:string){return String(v||'document.pdf').replace(/[^a-zA-Z0-9._-]/g,'_')}

async function resolveProductMailRoute(admin:any,productKey:string){
  const {data:routes,error:routeError}=await admin.from('romylabs_mailboxes')
    .select('id,product_id,outbound_from,inbox_owner,tenant_id,display_name,active')
    .eq('product_id',productKey).eq('active',true).order('created_at',{ascending:true})
  if(routeError)throw routeError
  const {data:t}=await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:productKey})
  if(!t?.ok||!t?.username||!t?.password)throw new Error('Product Stalwart credential unavailable')
  const resolvedFrom=String(t.from_address||t.username||'').toLowerCase()
  const route=(Array.isArray(routes)?routes:[]).find((r:any)=>String(r.outbound_from||'').toLowerCase()===resolvedFrom)
  if(!route?.outbound_from)throw new Error('No active mailbox route matches product Stalwart identity')
  return {route,transport:t}
}

async function sendSignedCopy(admin:any,doc:any,pdfBytes:Uint8Array,recipientOverride:string|null=null){
  const {route,transport:t}=await resolveProductMailRoute(admin,String(doc.product_key))

  const base='https://'+String(t.host||'mail.taxrescrm.net').replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(String(t.username)+':'+String(t.password))
  const sessionRes=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!sessionRes.ok) throw new Error('Stalwart session failed ('+sessionRes.status+')')
  const session=await sessionRes.json()
  const apiUrl=String(session.apiUrl||'').replace('{accountId}','')
  const uploadUrl=String(session.uploadUrl||'').replace('{accountId}',String(session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]||''))
  const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
  if(!apiUrl||!uploadUrl||!accountId) throw new Error('Stalwart session missing upload/mail endpoints')

  const metaRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[['Identity/get',{accountId},'i0'],['Mailbox/get',{accountId,properties:['id','name','role']},'m0']]
  })})
  if(!metaRes.ok) throw new Error('Stalwart metadata failed ('+metaRes.status+')')
  const meta=await metaRes.json()
  const ids=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list||[]
  const boxes=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list||[]
  const routedFrom=String(route.outbound_from||'').toLowerCase()
  const identity=ids.find((x:any)=>String(x.email||'').toLowerCase()===routedFrom)
  const drafts=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='drafts')
  const sent=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='sent')
  if(!identity?.id||!drafts?.id||!sent?.id) throw new Error('Stalwart identity or Sent/Drafts mailbox unavailable')

  const uploadRes=await fetch(uploadUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/pdf'},body:pdfBytes})
  if(!uploadRes.ok) throw new Error('Signed PDF upload to Stalwart failed ('+uploadRes.status+')')
  const uploaded=await uploadRes.json()
  if(!uploaded?.blobId) throw new Error('Stalwart did not return signed PDF blob id')

  const recipientAddress=String(recipientOverride||route.outbound_from)
  const isSignerCopy=recipientAddress.toLowerCase()===String(doc.signer_email||'').toLowerCase()
  const bodyId='body'
  const subject=(isSignerCopy?'Completed - ':'Signed Contract: ')+String(doc.title||'Agreement')
  const html=isSignerCopy
    ?'<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>Your signed document is complete</h2><p>Hi '+String(doc.signer_name||'there')+',</p><p>Your signed copy of <strong>'+String(doc.title||'Agreement')+'</strong> is attached for your records.</p><p>RomyLabs</p></div>'
    :'<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>'+String(doc.firm_name||'Office')+' signed '+String(doc.title||'Agreement')+'</h2><p><strong>'+String(doc.signer_name||doc.signer_email||'Signer')+'</strong> completed the agreement.</p><p>The signed PDF is attached for your records.</p><p>RomyLabs</p></div>'
  const sendRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[
      ['Email/set',{accountId,create:{draft:{
        from:[{email:String(identity.email||t.username),name:String(route.display_name||'RomyLabs')}],
        to:[{email:recipientAddress}],
        subject,
        mailboxIds:{[drafts.id]:true},
        keywords:{'$draft':true},
        bodyValues:{[bodyId]:{value:html,charset:'utf-8'}},
        htmlBody:[{partId:bodyId,type:'text/html'}],
        attachments:[{blobId:uploaded.blobId,type:'application/pdf',name:'Signed - '+safeFile(String(doc.source_filename||'contract.pdf')),disposition:'attachment'}]
      }}},'e0'],
      ['EmailSubmission/set',{accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}}},'s0']
    ]
  })})
  if(!sendRes.ok) throw new Error('Stalwart signed-copy send failed ('+sendRes.status+')')
  const sentBody=await sendRes.json()
  const sub=(sentBody.methodResponses||[]).find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  if(sub?.notCreated?.sendIt) throw new Error('Stalwart rejected signed-copy send')
  const submissionId=sub?.created?.sendIt?.id
  if(!submissionId) throw new Error('Stalwart did not confirm signed-copy submission')

  const now=new Date().toISOString()
  await admin.from('emails').insert({
    tenant_id:route.tenant_id,
    recipient:recipientAddress,
    recipients:[recipientAddress],
    subject,
    body:`${doc.signer_name||doc.signer_email||'Signer'} completed ${doc.title||'Agreement'}. Signed PDF attached.`,
    body_html:html,
    triage:'Sent',status:'Sent',direction:'outbound',is_read:true,
    sender:String(identity.email||t.username),
    from_address:String(identity.email||t.username),
    reply_from:String(route.outbound_from),
    mailbox_owner:String(route.inbox_owner||'info@romylabs.com'),
    received_at:now,created_at:now,product_id:doc.product_key,
    message_id:'stalwart:'+String(submissionId),
    received_mailbox:String(route.outbound_from),
    route_id:route.id
  })

  return {submissionId:String(submissionId),recipient:recipientAddress,from:String(identity.email||t.username)}
}


async function sendOwnerLifecycleNotice(admin:any,doc:any,eventType:string,detail:string=''){
  const {route,transport:t}=await resolveProductMailRoute(admin,String(doc.product_key))
  const base='https://'+String(t.host||'mail.taxrescrm.net').replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(String(t.username)+':'+String(t.password))
  const sessionRes=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!sessionRes.ok)throw new Error('Stalwart session failed ('+sessionRes.status+')')
  const session=await sessionRes.json()
  const apiUrl=String(session.apiUrl||'').replace('{accountId}','')
  const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
  if(!apiUrl||!accountId)throw new Error('Stalwart mail account unavailable')
  const metaRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[['Identity/get',{accountId},'i0'],['Mailbox/get',{accountId,properties:['id','name','role']},'m0']]
  })})
  if(!metaRes.ok)throw new Error('Stalwart metadata failed')
  const meta=await metaRes.json()
  const ids=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list||[]
  const boxes=(meta.methodResponses||[]).find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list||[]
  const routedFrom=String(route.outbound_from).toLowerCase()
  const identity=ids.find((x:any)=>String(x.email||'').toLowerCase()===routedFrom)
  const drafts=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='drafts')
  const sent=boxes.find((x:any)=>String(x.role||'').toLowerCase()==='sent')
  if(!identity?.id||!drafts?.id||!sent?.id)throw new Error('Stalwart identity or mailboxes unavailable')
  const label=eventType==='viewed'?'Viewed':eventType==='declined'?'Declined':'Updated'
  const subject=label+': '+String(doc.title||'Signature request')
  const html='<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>'+label+' signature request</h2><p><strong>'+String(doc.firm_name||'Office')+'</strong> - '+String(doc.title||'Agreement')+'</p><p>Signer: '+String(doc.signer_name||doc.signer_email||'Signer')+'</p>'+(detail?'<p>'+detail+'</p>':'')+'<p>Envelope ID: '+String(doc.id)+'</p></div>'
  const bodyId='body'
  const sendRes=await fetch(apiUrl,{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls:[
      ['Email/set',{accountId,create:{draft:{from:[{email:routedFrom,name:String(route.display_name||'RomyLabs')}],to:[{email:routedFrom}],subject,mailboxIds:{[drafts.id]:true},keywords:{'$draft':true},bodyValues:{[bodyId]:{value:html,charset:'utf-8'}},htmlBody:[{partId:bodyId,type:'text/html'}]}}},'e0'],
      ['EmailSubmission/set',{accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}}},'s0']
    ]
  })})
  if(!sendRes.ok)throw new Error('Stalwart lifecycle send failed')
  const sentBody=await sendRes.json()
  const sub=(sentBody.methodResponses||[]).find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const submissionId=sub?.created?.sendIt?.id
  if(!submissionId)throw new Error('Stalwart lifecycle submission not confirmed')
  const stamp=new Date().toISOString()
  await admin.from('emails').insert({
    tenant_id:route.tenant_id,recipient:routedFrom,recipients:[routedFrom],subject,
    body:html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),body_html:html,
    triage:'Sent',status:'Sent',direction:'outbound',is_read:true,sender:routedFrom,from_address:routedFrom,reply_from:routedFrom,
    mailbox_owner:String(route.inbox_owner||'info@romylabs.com'),received_at:stamp,created_at:stamp,product_id:doc.product_key,
    message_id:'stalwart:'+String(submissionId),received_mailbox:routedFrom,route_id:route.id
  })
  return {submissionId:String(submissionId),recipient:routedFrom,from:routedFrom}
}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({error:'POST only'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')!
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const b=await req.json().catch(()=>({}))
    const action=String(b.action||'')

    // Token-scoped public signing actions. No anonymous database/storage access is exposed.
    if(action==='esign_load'||action==='esign_sign'||action==='esign_decline'){
      const rawSigningToken=String(b.token||'').trim()
      const tokenMatch=rawSigningToken.match(/[A-Fa-f0-9]{64}/)
      const signingToken=tokenMatch?.[0]||''
      if(signingToken.length!==64)return json({error:'Invalid signing link'},400)
      const hash=await sha256(signingToken)

      let {data:doc,error:de}=await admin.from('romylabs_office_signing_documents').select('*').eq('token_hash',hash).maybeSingle()
      let aliasRecipientId:string|null=null

      // Resends/reminders rotate the current token, but every previously emailed
      // legitimate token remains valid for the same envelope until terminal state.
      if(!doc&&!de){
        const {data:alias,error:aliasError}=await admin.from('romylabs_esign_token_aliases')
          .select('envelope_id,recipient_id').eq('token_hash',hash).is('revoked_at',null).maybeSingle()
        if(aliasError)return json({error:'Could not validate signing link'},500)
        if(alias?.envelope_id){
          const resolved=await admin.from('romylabs_office_signing_documents').select('*').eq('id',alias.envelope_id).maybeSingle()
          doc=resolved.data
          de=resolved.error
          aliasRecipientId=alias.recipient_id||null
        }
      }

      if(de||!doc)return json({error:'Signing request not found'},404)

      let recipient:any=null
      if(aliasRecipientId){
        const rr=await admin.from('romylabs_esign_recipients').select('*').eq('id',aliasRecipientId).maybeSingle()
        recipient=rr.data
      }
      if(!recipient){
        const rr=await admin.from('romylabs_esign_recipients').select('*')
          .eq('envelope_id',doc.id).eq('role','signer').order('recipient_order',{ascending:true}).limit(1).maybeSingle()
        recipient=rr.data
      }
      if(doc.status==='void')return json({error:'This signing request was voided'},410)
      if(doc.expires_at&&new Date(doc.expires_at).getTime()<Date.now()&&doc.status!=='signed')return json({error:'This signing link has expired'},410)

      if(action==='esign_load'){
        if(doc.status==='sent'){
          const openedAt=new Date().toISOString()
          const audit=[...(Array.isArray(doc.audit)?doc.audit:[]),{event:'viewed',at:openedAt,ip:ip(req),user_agent:req.headers.get('user-agent')}]
          await admin.from('romylabs_office_signing_documents').update({status:'viewed',opened_at:openedAt,updated_at:openedAt,audit}).eq('id',doc.id).eq('status','sent')
          if(recipient?.id)await admin.from('romylabs_esign_recipients').update({status:'viewed',opened_at:openedAt,updated_at:openedAt}).eq('id',recipient.id)
          await appendEvent(admin,doc.id,'viewed',{recipientId:recipient?.id,actorEmail:doc.signer_email,ipAddress:ip(req),userAgent:req.headers.get('user-agent'),occurredAt:openedAt})
          try{
            const notice=await sendOwnerLifecycleNotice(admin,doc,'viewed')
            await appendEvent(admin,doc.id,'owner_viewed_notification_sent',{metadata:{submission_id:notice.submissionId,from:notice.from},occurredAt:new Date().toISOString()})
          }catch(notifyError){
            console.error('[office-agreement-file] viewed notification failed',notifyError)
            await appendEvent(admin,doc.id,'owner_viewed_notification_failed',{metadata:{error:String((notifyError as Error)?.message||notifyError).slice(0,240)}})
          }
        }
        const path=doc.status==='signed'&&doc.signed_path?doc.signed_path:doc.source_path
        const {data:u,error:ue}=await admin.storage.from(ESIGN_BUCKET).createSignedUrl(path,600)
        if(ue||!u?.signedUrl)return json({error:'Could not open document'},500)
        return json({ok:true,document:{id:doc.id,title:doc.title,firm_name:doc.firm_name,signer_name:doc.signer_name,signer_email:doc.signer_email,fields:doc.fields,status:doc.status,signed_at:doc.signed_at,expires_at:doc.expires_at,file_url:u.signedUrl}})
      }

      if(action==='esign_decline'){
        if(!['sent','viewed'].includes(doc.status))return json({error:'Document is not available to decline'},409)
        const reason=String(b.reason||'').trim()
        if(!reason)return json({error:'A decline reason is required'},400)
        const declinedAt=new Date().toISOString()
        const audit=[...(Array.isArray(doc.audit)?doc.audit:[]),{event:'declined',at:declinedAt,reason,email:doc.signer_email,ip:ip(req),user_agent:req.headers.get('user-agent')}]
        await admin.from('romylabs_office_signing_documents').update({status:'declined',declined_at:declinedAt,decline_reason:reason,updated_at:declinedAt,audit}).eq('id',doc.id).in('status',['sent','viewed'])
        if(recipient?.id)await admin.from('romylabs_esign_recipients').update({status:'declined',declined_at:declinedAt,decline_reason:reason,updated_at:declinedAt}).eq('id',recipient.id)
        await appendEvent(admin,doc.id,'declined',{recipientId:recipient?.id,actorEmail:doc.signer_email,ipAddress:ip(req),userAgent:req.headers.get('user-agent'),metadata:{reason},occurredAt:declinedAt})
        try{
          const notice=await sendOwnerLifecycleNotice(admin,doc,'declined','Reason: '+reason)
          await appendEvent(admin,doc.id,'owner_declined_notification_sent',{metadata:{submission_id:notice.submissionId,from:notice.from},occurredAt:new Date().toISOString()})
        }catch(notifyError){
          console.error('[office-agreement-file] declined notification failed',notifyError)
          await appendEvent(admin,doc.id,'owner_declined_notification_failed',{metadata:{error:String((notifyError as Error)?.message||notifyError).slice(0,240)}})
        }
        return json({ok:true,declined_at:declinedAt})
      }

      if(doc.status==='signed')return json({ok:true,already_signed:true,signed_at:doc.signed_at})
      if(!['sent','viewed'].includes(doc.status))return json({error:'Document is not available for signing'},409)
      const signatureName=String(b.signature_name||'').trim()
      const signatureMode=String(b.signature_mode||'type').toLowerCase()==='draw'?'draw':'type'
      const signatureDataUrl=String(b.signature_data_url||'')
      const values=b.values&&typeof b.values==='object'?b.values:{}
      if(!signatureName)return json({error:'Signature name is required'},400)
      if(signatureMode==='draw'&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureDataUrl))return json({error:'A drawn PNG signature is required'},400)
      if(signatureMode==='draw'&&signatureDataUrl.length>2_500_000)return json({error:'Drawn signature is too large'},413)
      if(b.consent!==true)return json({error:'Electronic signature consent is required'},400)
      const fields=Array.isArray(doc.fields)?doc.fields:[]
      for(const f of fields){
        const value=String(values[f.id]??'').trim()
        if(f.required!==false&&!value&&!['date','signature','name','initials'].includes(f.type))return json({error:`Complete required field: ${f.label||f.type}`},400)
      }
      const {data:file,error:fe}=await admin.storage.from(ESIGN_BUCKET).download(doc.source_path)
      if(fe||!file)return json({error:'Could not load source document'},500)
      const sourceBytes=new Uint8Array(await file.arrayBuffer())
      const sourceHash=await sha256Bytes(sourceBytes)
      const pdf=await PDFDocument.load(sourceBytes)
      const regular=await pdf.embedFont(StandardFonts.Helvetica)
      const oblique=await pdf.embedFont(StandardFonts.HelveticaOblique)
      let signatureImage:any=null
      if(signatureMode==='draw'){
        const b64=signatureDataUrl.split(',')[1]||''
        const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0))
        signatureImage=await pdf.embedPng(bytes)
      }
      const pages=pdf.getPages()
      for(const f of fields){
        const page=pages[Math.max(0,Math.min(pages.length-1,Number(f.page||1)-1))]
        if(!page)continue
        const {width,height}=page.getSize()
        const x=Math.max(0,Math.min(1,Number(f.x||0)))*width
        const boxW=Math.max(.03,Math.min(1,Number(f.w||.22)))*width
        const boxH=Math.max(.02,Math.min(1,Number(f.h||.055)))*height
        const top=Math.max(0,Math.min(1,Number(f.y||0)))*height
        const y=Math.max(3,height-top-boxH+Math.min(3,boxH*.1))
        let text=String(values[f.id]??'').trim()
        if(f.type==='signature'&&signatureMode==='draw'&&signatureImage){
          const scale=Math.min((boxW-6)/signatureImage.width,(boxH-4)/signatureImage.height)
          const drawW=Math.max(8,signatureImage.width*scale)
          const drawH=Math.max(6,signatureImage.height*scale)
          page.drawImage(signatureImage,{x:x+3,y:y+Math.max(0,(boxH-drawH)/2),width:drawW,height:drawH})
          continue
        }
        if(f.type==='signature')text=signatureName
        if(f.type==='initials'&&!text)text=signatureName.split(/\s+/).filter(Boolean).map((p:string)=>p[0]).join('').slice(0,4).toUpperCase()
        if(f.type==='date')text=new Date().toLocaleDateString('en-US',{timeZone:'America/New_York'})
        if(f.type==='name'&&!text)text=doc.signer_name||signatureName
        const size=Math.max(8,Math.min(f.type==='signature'?18:12,boxH*.55))
        page.drawText(text.slice(0,200),{x:x+3,y:y+Math.max(0,(boxH-size)/2),size,font:f.type==='signature'?oblique:regular,color:rgb(.05,.12,.22),maxWidth:Math.max(10,boxW-6)})
      }
      const finalBytes=await pdf.save()
      const signedHash=await sha256Bytes(new Uint8Array(finalBytes))
      const signedPath=`${doc.product_key}/${doc.external_office_id}/${doc.id}/signed-${crypto.randomUUID()}-${safeFile(doc.source_filename)}`
      const {error:up}=await admin.storage.from(ESIGN_BUCKET).upload(signedPath,finalBytes,{contentType:'application/pdf',upsert:false})
      if(up)return json({error:'Could not save signed document: '+up.message},500)
      const now=new Date().toISOString()
      const audit=[...(Array.isArray(doc.audit)?doc.audit:[]),{event:'signed',at:now,signer:signatureName,email:doc.signer_email,signature_mode:signatureMode,consent_to_esign:true,ip:ip(req),user_agent:req.headers.get('user-agent')}]
      const certificate=await PDFDocument.create()
      const cp=certificate.addPage([612,792])
      const cf=await certificate.embedFont(StandardFonts.Helvetica)
      const cb=await certificate.embedFont(StandardFonts.HelveticaBold)
      let cy=744
      const line=(text:string,bold=false,size=10)=>{cp.drawText(text,{x:54,y:cy,size,font:bold?cb:cf,color:rgb(.08,.12,.18),maxWidth:504});cy-=size+9}
      line('Certificate of Completion',true,18)
      cy-=6
      line('Envelope ID: '+doc.id,true,10)
      line('Document: '+String(doc.title||''),false,10)
      line('Office: '+String(doc.firm_name||''),false,10)
      line('Signer: '+signatureName,false,10)
      line('Signer Email: '+String(doc.signer_email||''),false,10)
      line('Signature Method: '+(signatureMode==='draw'?'Drawn signature':'Typed signature'),false,10)
      line('Completed At: '+now,false,10)
      line('IP Address: '+String(ip(req)||'Unavailable'),false,10)
      line('User Agent: '+String(req.headers.get('user-agent')||'Unavailable').slice(0,120),false,9)
      cy-=8
      line('Source SHA-256',true,10); line(sourceHash,false,8)
      line('Signed PDF SHA-256',true,10); line(signedHash,false,8)
      cy-=8
      line('Electronic Records & Signature Consent: Accepted',true,10)
      line('This certificate records the signing event and document integrity hashes.',false,9)
      const certificateBytes=await certificate.save()
      const certificateHash=await sha256Bytes(new Uint8Array(certificateBytes))
      const certificatePath=`${doc.product_key}/${doc.external_office_id}/${doc.id}/certificate-of-completion.pdf`
      const {error:certUp}=await admin.storage.from(ESIGN_BUCKET).upload(certificatePath,certificateBytes,{contentType:'application/pdf',upsert:true})
      if(certUp)return json({error:'Could not save completion certificate: '+certUp.message},500)

      const {data:updated,error:upd}=await admin.from('romylabs_office_signing_documents').update({
        status:'signed',signed_path:signedPath,signed_at:now,completed_at:now,
        signature_name:signatureName,signer_ip:ip(req),signer_user_agent:req.headers.get('user-agent'),
        source_sha256:sourceHash,signed_sha256:signedHash,certificate_path:certificatePath,certificate_sha256:certificateHash,
        envelope_settings:{...(doc.envelope_settings&&typeof doc.envelope_settings==='object'?doc.envelope_settings:{}),signature_method:signatureMode},
        audit,updated_at:now
      }).eq('id',doc.id).in('status',['sent','viewed']).select('id').maybeSingle()
      if(upd){await admin.storage.from(ESIGN_BUCKET).remove([signedPath]);return json({error:'Could not finalize signature'},500)}
      if(!updated){await admin.storage.from(ESIGN_BUCKET).remove([signedPath,certificatePath]);return json({error:'This document was already signed or is no longer signable'},409)}
      if(recipient?.id)await admin.from('romylabs_esign_recipients').update({status:'completed',completed_at:now,updated_at:now}).eq('id',recipient.id)
      await appendEvent(admin,doc.id,'completed',{recipientId:recipient?.id,actorEmail:doc.signer_email,actorName:signatureName,ipAddress:ip(req),userAgent:req.headers.get('user-agent'),metadata:{source_sha256:sourceHash,signed_sha256:signedHash,certificate_sha256:certificateHash,signature_mode:signatureMode},occurredAt:now})

      let ownerCopy:any=null,signerCopy:any=null
      try{
        ownerCopy=await sendSignedCopy(admin,doc,finalBytes)
        await appendEvent(admin,doc.id,'owner_signed_copy_sent',{metadata:{recipient:ownerCopy.recipient,submission_id:ownerCopy.submissionId,from:ownerCopy.from},occurredAt:new Date().toISOString()})
      }catch(notificationError){
        console.error('[office-agreement-file] signed owner copy failed',notificationError)
        await appendEvent(admin,doc.id,'owner_signed_copy_failed',{metadata:{error:String((notificationError as Error)?.message||notificationError).slice(0,240)}})
      }
      try{
        signerCopy=await sendSignedCopy(admin,doc,finalBytes,String(doc.signer_email))
        await appendEvent(admin,doc.id,'signer_signed_copy_sent',{metadata:{recipient:signerCopy.recipient,submission_id:signerCopy.submissionId,from:signerCopy.from},occurredAt:new Date().toISOString()})
      }catch(notificationError){
        console.error('[office-agreement-file] signed signer copy failed',notificationError)
        await appendEvent(admin,doc.id,'signer_signed_copy_failed',{metadata:{error:String((notificationError as Error)?.message||notificationError).slice(0,240)}})
      }
      const latestAudit=[...audit,
        {event:ownerCopy?'owner_signed_copy_sent':'owner_signed_copy_failed',at:new Date().toISOString(),recipient:ownerCopy?.recipient||null,from:ownerCopy?.from||null,submission_id:ownerCopy?.submissionId||null},
        {event:signerCopy?'signer_signed_copy_sent':'signer_signed_copy_failed',at:new Date().toISOString(),recipient:signerCopy?.recipient||String(doc.signer_email||''),from:signerCopy?.from||null,submission_id:signerCopy?.submissionId||null}
      ]
      await admin.from('romylabs_office_signing_documents').update({audit:latestAudit,updated_at:new Date().toISOString()}).eq('id',doc.id)

      return json({ok:true,signed_at:now,owner_copy_sent:!!ownerCopy,owner_copy_recipient:ownerCopy?.recipient||null,signer_copy_sent:!!signerCopy})
    }

    // All management actions below require a real authenticated platform-admin JWT.
    const token=(req.headers.get('Authorization')||'').replace('Bearer ','')
    if(!token)return json({error:'Missing authorization'},401)
    const asCaller=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}}})
    const {data:{user},error:userErr}=await asCaller.auth.getUser()
    if(userErr||!user?.email)return json({error:'Invalid session'},401)
    const email=user.email.toLowerCase()
    if(!PLATFORM_ADMIN_EMAILS.has(email))return json({error:'Not authorized'},403)

    if(action==='esign_geturl'){
      const path=String(b.file_path||'')
      if(!path)return json({error:'file_path is required'},400)
      const {data,error}=await admin.storage.from(ESIGN_BUCKET).createSignedUrl(path,300)
      if(error)return json({error:error.message},400)
      return json({url:data.signedUrl})
    }

    // Legacy office-agreement file actions retained.
    if(action==='upload'){
      const {tenant_id,file_name,file_base64,content_type,label}=b
      if(!tenant_id||!file_name||!file_base64)return json({error:'tenant_id, file_name, and file_base64 are required'},400)
      const bytes=Uint8Array.from(atob(file_base64),c=>c.charCodeAt(0))
      const path=`${tenant_id}/${Date.now()}-${safeFile(file_name)}`
      const {error:upErr}=await admin.storage.from(LEGACY_BUCKET).upload(path,bytes,{contentType:content_type||'application/octet-stream',upsert:false})
      if(upErr)return json({error:'Upload failed: '+upErr.message},400)
      const {data:rpcData,error:rpcErr}=await admin.rpc('add_office_agreement',{p_tenant_id:tenant_id,p_file_name:file_name,p_file_path:path,p_file_size:bytes.length,p_label:label||null,p_uploaded_by:user.email})
      if(rpcErr){await admin.storage.from(LEGACY_BUCKET).remove([path]);return json({error:rpcErr.message},400)}
      return json(rpcData)
    }
    if(action==='geturl'){
      const {file_path}=b
      if(!file_path)return json({error:'file_path is required'},400)
      const {data,error}=await admin.storage.from(LEGACY_BUCKET).createSignedUrl(file_path,300)
      if(error)return json({error:error.message},400)
      return json({url:data.signedUrl})
    }
    if(action==='delete'){
      const {agreement_id}=b
      if(!agreement_id)return json({error:'agreement_id is required'},400)
      const {data:rpcData,error:rpcErr}=await admin.rpc('delete_office_agreement',{p_id:agreement_id})
      if(rpcErr)return json({error:rpcErr.message},400)
      const path=(rpcData as any)?.file_path
      if(path)await admin.storage.from(LEGACY_BUCKET).remove([path])
      return json({ok:true})
    }
    return json({error:'Unknown action'},400)
  }catch(e){console.error('[office-agreement-file]',e);return json({error:String((e as Error)?.message||e)},500)}
})

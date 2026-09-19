import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})
const clean=(v:unknown)=>String(v??'').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'file'
const validId=(v:string)=>/^es_[0-9a-f-]{36}$/i.test(v)
const validToken=(v:string)=>/^[0-9a-f]{64}$/i.test(v)
const attachmentPath=(a:any)=>{
  const direct=String(a?.storage_path||a?.path||'').trim()
  if(direct)return direct
  const raw=String(a?.url||'')
  for(const marker of ['/storage/v1/object/sign/documents/','/storage/v1/object/public/documents/']){
    const idx=raw.indexOf(marker)
    if(idx>=0)return decodeURIComponent(raw.slice(idx+marker.length).split('?')[0]||'')
  }
  return ''
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'POST only'},405)
  try{
    const body=await req.json().catch(()=>({}))
    const id=String(body.esign_id||body.esignId||'')
    const token=String(body.signer_token||body.signerToken||'')
    const action=String(body.action||'')
    if(!validId(id)||!validToken(token))return json({error:'Invalid signing request'},400)

    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!service)return json({error:'Server configuration missing'},500)
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})

    const {data:e,error:eErr}=await db.from('esigns')
      .select('id,tenant_id,status,client_name,client_email,client_phone,doc_type,message,investigation_fee,tax_years,due_date,signed_name,signer_full_name,signer_ip,signed_at,signed_timestamp,pdf_attachments,signed_attachments,finalized_at,opened_at,rep_name,sent_by,client_id,lead_id')
      .eq('id',id).eq('signer_token',token).maybeSingle()
    if(eErr||!e)return json({error:'Signing request not found'},404)
    if(['Declined','Expired','Voided'].includes(String(e.status)))return json({error:'Signing request is no longer active'},410)

    if(action==='load'){
      if(e.status==='Awaiting'&&e.due_date&&/^\d{4}-\d{2}-\d{2}$/.test(String(e.due_date))){
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
        if(String(e.due_date)<today)return json({error:'Signing request expired'},410)
      }
      const out:any[]=[]
      for(const a of Array.isArray(e.pdf_attachments)?e.pdf_attachments:[]){
        const p=attachmentPath(a)
        if(!p)continue
        const {data,error}=await db.storage.from('documents').createSignedUrl(p,900)
        if(error||!data?.signedUrl)return json({error:`Could not open ${String(a?.label||'attachment')}`},500)
        out.push({...a,url:data.signedUrl,storage_path:p})
      }
      let openedAt=e.opened_at
      const firstOpen=!openedAt
      if(firstOpen&&e.status==='Awaiting'){
        openedAt=new Date().toISOString()
        await db.from('esigns').update({opened_at:openedAt}).eq('id',id).eq('signer_token',token).is('opened_at',null)
      }
      return json({success:true,document:{...e,opened_at:openedAt,pdf_attachments:out},first_open:firstOpen})
    }

    if(action==='sign'){
      if(!['Awaiting','Viewed'].includes(String(e.status)))return json({error:e.status==='Signed'?'Signing request already completed':'Signing request is not active'},409)
      const signedName=String(body.signed_name||'').trim()
      const fullName=String(body.signer_full_name||'').trim()
      if(signedName.length<2||fullName.length<2)return json({error:'Valid signer name is required'},400)
      if(e.due_date&&/^\d{4}-\d{2}-\d{2}$/.test(String(e.due_date))){
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
        if(String(e.due_date)<today)return json({error:'Signing request expired'},410)
      }
      const signedAt=new Date().toISOString()
      const forwarded=String(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,128)
      const ua=String(req.headers.get('user-agent')||'').slice(0,1000)
      const {data:signed,error:signErr}=await db.from('esigns').update({
        status:'Signed',signed_at:signedAt,signed_name:signedName,signer_full_name:fullName,
        signer_ip:forwarded||null,signed_timestamp:signedAt,signed_user_agent:ua||null
      }).eq('id',id).eq('signer_token',token).in('status',['Awaiting','Viewed'])
        .select('id,status,signed_at,signed_name,signer_full_name,signer_ip').maybeSingle()
      if(signErr)return json({error:'Could not save signature'},500)
      if(!signed)return json({error:'Signing request was already completed'},409)
      return json({success:true,document:signed})
    }

    if(action==='read'){
      const out:any[]=[]
      for(const a of Array.isArray(e.pdf_attachments)?e.pdf_attachments:[]){
        const p=attachmentPath(a)
        if(!p)continue
        const {data,error}=await db.storage.from('documents').createSignedUrl(p,900)
        if(error||!data?.signedUrl)return json({error:`Could not open ${String(a?.label||'attachment')}`},500)
        out.push({...a,url:data.signedUrl,storage_path:p})
      }
      return json({success:true,attachments:out})
    }

    if(action==='notify'){
      const event=String(body.event||'')
      if(!['opened','signed','partial'].includes(event))return json({error:'Invalid notification event'},400)
      return json({success:true,event})
    }

    if(e.status!=='Signed')return json({error:'Signing request is not signed'},409)
    const prefix=`docs/${clean(e.client_name||'client')}/signed/${id}`
    const expected=new Map<string,string>()
    for(const a of Array.isArray(e.pdf_attachments)?e.pdf_attachments:[]){
      const ft=String(a?.formType||'')
      if(ft)expected.set(ft,String(a?.label||ft))
    }

    if(action==='prepare'){
      if(e.finalized_at)return json({error:'Signing request already finalized'},409)
      const requested=Array.isArray(body.files)?body.files:[]
      if(requested.length>30)return json({error:'Too many files'},400)
      const out:any[]=[]
      for(const f of requested){
        const kind=String(f?.kind||'internal')
        const formType=String(f?.formType||'')
        if(kind!=='certificate'&&!expected.has(formType))return json({error:`Unexpected attachment: ${formType}`},400)
        if(!['internal','client','certificate'].includes(kind))return json({error:'Invalid archive file kind'},400)
        const basename=kind==='certificate'?'certificate':`${clean(formType)}_${kind}`
        const path=`${prefix}/${basename}.pdf`
        const {data,error}=await db.storage.from('documents').createSignedUploadUrl(path,{upsert:true})
        if(error||!data?.token)return json({error:error?.message||'Could not prepare secure upload'},500)
        out.push({kind,formType,path,token:data.token})
      }
      return json({success:true,uploads:out})
    }

    if(action==='finalize'){
      if(e.finalized_at)return json({success:true,already_finalized:true})
      const artifacts=Array.isArray(body.artifacts)?body.artifacts:[]
      if(artifacts.length>30)return json({error:'Too many archive files'},400)
      const cert=body.certificate||null
      const {data:listed,error:listErr}=await db.storage.from('documents').list(prefix,{limit:100})
      if(listErr)return json({error:'Could not verify signed archive'},500)
      const names=new Set((listed||[]).map((x:any)=>x.name))
      const exists=(p:string)=>{if(!p.startsWith(prefix+'/'))return false;const n=p.slice(prefix.length+1);return!n.includes('/')&&names.has(n)}
      const signedAttachments:any[]=[]
      for(const a of artifacts){
        const ft=String(a?.formType||'')
        if(!expected.has(ft))return json({error:`Unexpected finalized attachment: ${ft}`},400)
        const ip=String(a?.internalPath||''),cp=String(a?.clientPath||'')
        if(!exists(ip)||!exists(cp))return json({error:`Signed archive missing for ${ft}`},409)
        const [iu,cu]=await Promise.all([
          db.storage.from('documents').createSignedUrl(ip,900),
          db.storage.from('documents').createSignedUrl(cp,900),
        ])
        if(iu.error||cu.error||!iu.data?.signedUrl||!cu.data?.signedUrl)return json({error:'Could not create signed archive links'},500)
        signedAttachments.push({
          formType:ft,label:expected.get(ft),url:iu.data.signedUrl,clientUrl:cu.data.signedUrl,
          storage_path:ip,client_storage_path:cp,fileSize:Number(a?.fileSize||0)||null,folder:a?.folder||null
        })
      }
      let certUrl:string|null=null,certPath:string|null=null
      if(cert?.path){
        certPath=String(cert.path)
        if(!exists(certPath))return json({error:'Certificate archive missing'},409)
        const {data,error}=await db.storage.from('documents').createSignedUrl(certPath,900)
        if(error||!data?.signedUrl)return json({error:'Could not create certificate link'},500)
        certUrl=data.signedUrl
      }
      const saved=['Service Addendum','Fee Agreement Addendum'].includes(String(e.doc_type))?'Agreements':'E-Signatures'
      const signedAt=e.signed_at||e.signed_timestamp||new Date().toISOString()
      const signedBy=e.signer_full_name||e.signed_name||e.client_name||'Signer'
      const {data:finalized,error:finErr}=await db.rpc('esign_finalize',{
        p_id:id,p_client_name:e.client_name||'',p_doc_type:e.doc_type||'',p_signed_by:signedBy,
        p_signer_ip:e.signer_ip||'',p_signed_at:signedAt,p_saved_doc_type:saved,
        p_cert_url:certUrl,p_attachments:signedAttachments,p_cert_size:Number(cert?.fileSize||0)||null
      })
      if(finErr)return json({error:finErr.message},500)
      await db.from('esigns').update({signed_attachments:signedAttachments,finalized_at:new Date().toISOString()})
        .eq('id',id).eq('signer_token',token)

      let clientEmailSent=false,clientSmsSent=false
      if(e.client_email){
        const emailAttachments=signedAttachments.filter((a:any)=>a.clientUrl).map((a:any)=>({
          url:a.clientUrl,filename:`${clean(a.label||a.formType||'signed-document')}.pdf`
        }))
        const res=await fetch(url+'/functions/v1/send-email',{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:service,Authorization:'Bearer '+service},
          body:JSON.stringify({
            kind:'esign_signed_copy',esign_id:id,to:e.client_email,
            subject:`Signed Copy — ${e.doc_type||'Document'}`,
            html:`<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px"><h2>Signature Complete</h2><p>Thank you, ${String(e.client_name||'Client')}. Your <strong>${String(e.doc_type||'document')}</strong> has been signed and saved to your file.</p></div>`,
            attachments:emailAttachments
          })
        })
        const out=await res.json().catch(()=>({}))
        clientEmailSent=!!(res.ok&&out?.success)
      }
      if(e.client_phone){
        const res=await fetch(url+'/functions/v1/send-sms',{
          method:'POST',
          headers:{'Content-Type':'application/json',apikey:service,Authorization:'Bearer '+service},
          body:JSON.stringify({to:e.client_phone,body:`${String(e.client_name||'Client')}, your ${String(e.doc_type||'document')} has been signed and saved.`})
        })
        const out=await res.json().catch(()=>({}))
        clientSmsSent=!!(res.ok&&out?.success)
      }
      return json({success:true,finalized,signed_attachments:signedAttachments,certificate_url:certUrl,client_email_sent:clientEmailSent,client_sms_sent:clientSmsSent})
    }

    return json({error:'Unknown action'},400)
  }catch(e){
    console.error('[esign-archive-upload]',e)
    return json({error:e instanceof Error?e.message:String(e)},500)
  }
})

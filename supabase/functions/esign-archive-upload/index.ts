import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})
const clean=(v:string)=>String(v||'').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'file'
const attachmentPath=(a:any)=>{
  const direct=attachmentPath(a).trim()
  if(direct)return direct
  const raw=String(a?.url||'')
  const marker='/storage/v1/object/sign/documents/'
  const idx=raw.indexOf(marker)
  if(idx>=0)return decodeURIComponent(raw.slice(idx+marker.length).split('?')[0]||'')
  const marker2='/storage/v1/object/public/documents/'
  const idx2=raw.indexOf(marker2)
  if(idx2>=0)return decodeURIComponent(raw.slice(idx2+marker2.length).split('?')[0]||'')
  return ''
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'POST only'},405)
  try{
    const body=await req.json().catch(()=>({}))
    const id=String(body.esign_id||body.esignId||'')
    const token=String(body.signer_token||body.signerToken||'')
    const action=String(body.action||'')
    if(!/^es_[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/i.test(token))return json({error:'Invalid signing request'},400)
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const {data:e,error:eErr}=await db.from('esigns')
      .select('id,tenant_id,status,client_name,client_email,client_phone,doc_type,message,investigation_fee,tax_years,due_date,signed_name,signer_full_name,signer_ip,signed_at,signed_timestamp,pdf_attachments,finalized_at,opened_at,rep_name,sent_by,client_id,lead_id')
      .eq('id',id).eq('signer_token',token).eq('tenant_id',TENANT).maybeSingle()
    if(eErr||!e)return json({error:'Signing request not found'},404)
    if(['Declined','Expired','Voided'].includes(String(e.status)))return json({error:'Signing request is no longer active'},410)

    if(action==='load'){
      if(e.status==='Awaiting'&&e.due_date&&/^\\d{4}-\\d{2}-\\d{2}$/.test(String(e.due_date))){
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
        if(String(e.due_date)<today)return json({error:'Signing request expired'},410)
      }
      const out:any[]=[]
      for(const a of Array.isArray(e.pdf_attachments)?e.pdf_attachments:[]){
        const p=attachmentPath(a)
        if(!p)continue
        const {data,error}=await db.storage.from('documents').createSignedUrl(p,900)
        if(error||!data?.signedUrl)return json({error:`Could not open ${String(a?.label||'attachment')}`},500)
        out.push({formType:a?.formType||'',label:a?.label||'',url:data.signedUrl,storage_path:p})
      }
      let openedAt=e.opened_at
      if(!openedAt&&e.status==='Awaiting'){
        openedAt=new Date().toISOString()
        await db.from('esigns').update({opened_at:openedAt}).eq('id',id).eq('signer_token',token).eq('tenant_id',TENANT).is('opened_at',null)
      }
      return json({success:true,document:{
        id:e.id,tenant_id:e.tenant_id,status:e.status,client_name:e.client_name,client_email:e.client_email,
        client_phone:e.client_phone,doc_type:e.doc_type,message:e.message,investigation_fee:e.investigation_fee,
        tax_years:e.tax_years,due_date:e.due_date,signed_name:e.signed_name,signer_full_name:e.signer_full_name,
        signer_ip:e.signer_ip,signed_at:e.signed_at,signed_timestamp:e.signed_timestamp,opened_at:openedAt,
        finalized_at:e.finalized_at,pdf_attachments:out
      },first_open:!e.opened_at})
    }

    if(action==='sign'){
      if(e.status!=='Awaiting')return json({error:e.status==='Signed'?'Signing request already completed':'Signing request is not active'},409)
      const signedName=String(body.signed_name||'').trim(),fullName=String(body.signer_full_name||'').trim()
      if(signedName.length<2||fullName.length<2)return json({error:'Valid signer name is required'},400)
      if(e.due_date&&/^\\d{4}-\\d{2}-\\d{2}$/.test(String(e.due_date))){
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
        if(String(e.due_date)<today)return json({error:'Signing request expired'},410)
      }
      const signedAt=new Date().toISOString()
      const forwarded=String(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,100)
      const ua=String(req.headers.get('user-agent')||'').slice(0,200)
      const {data:signed,error:signErr}=await db.from('esigns').update({
        status:'Signed',signed_at:signedAt,signed_name:signedName,signer_full_name:fullName,
        signer_ip:forwarded||null,signed_timestamp:signedAt,signed_user_agent:ua||null
      }).eq('id',id).eq('signer_token',token).eq('tenant_id',TENANT).eq('status','Awaiting').select('id,status,signed_at,signed_name,signer_full_name,signer_ip').maybeSingle()
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
        out.push({formType:a?.formType||'',label:a?.label||'',url:data.signedUrl})
      }
      return json({success:true,attachments:out})
    }

    if(action==='notify'){
      const event=String(body.event||'')
      if(!['opened','signed','partial'].includes(event))return json({error:'Invalid notification event'},400)
      if(event==='opened'&&!e.opened_at)return json({error:'Document has not been opened'},409)
      if(event==='signed'&&(e.status!=='Signed'||!e.signed_at))return json({error:'Document is not signed'},409)
      if(event==='partial'&&e.status!=='Awaiting')return json({error:'Document is not awaiting signature'},409)
      const {data:claimed,error:claimErr}=await db.rpc('esign_claim_notification',{p_id:id,p_token:token,p_event:event})
      if(claimErr)return json({error:'Could not claim notification'},500)
      if(!claimed)return json({success:true,duplicate:true})
      const {data:settings}=await db.from('settings').select('esign_manager_email,name,firmname').eq('tenant_id',TENANT).maybeSingle()

      let assignedName=String(e.rep_name||'').trim()
      if(!assignedName){
        if(e.client_id){
          const {data:client}=await db.from('clients').select('assignedTo').eq('tenant_id',TENANT).eq('id',e.client_id).maybeSingle()
          assignedName=String(client?.assignedTo||'').trim()
        }
        if(!assignedName&&e.lead_id){
          const {data:lead}=await db.from('leads').select('assignedTo').eq('tenant_id',TENANT).eq('id',e.lead_id).maybeSingle()
          assignedName=String(lead?.assignedTo||'').trim()
        }
        if(!assignedName&&e.client_name){
          const {data:clientByName}=await db.from('clients').select('assignedTo').eq('tenant_id',TENANT).ilike('name',String(e.client_name)).limit(1).maybeSingle()
          assignedName=String(clientByName?.assignedTo||'').trim()
        }
        if(!assignedName&&e.client_name){
          const {data:leadByName}=await db.from('leads').select('assignedTo').eq('tenant_id',TENANT).ilike('name',String(e.client_name)).limit(1).maybeSingle()
          assignedName=String(leadByName?.assignedTo||'').trim()
        }
      }

      let notifyTo=''
      if(assignedName){
        if(assignedName.includes('@')) notifyTo=assignedName
        else {
          const {data:emp}=await db.from('employees').select('email').eq('tenant_id',TENANT).eq('status','Active').ilike('name',assignedName).limit(1).maybeSingle()
          notifyTo=String(emp?.email||'').trim()
        }
      }
      if(!notifyTo&&String(e.sent_by||'').includes('@')) notifyTo=String(e.sent_by).trim()
      if(!notifyTo) notifyTo=String(settings?.esign_manager_email||'').trim()
      if(!notifyTo)return json({success:true,reason:'no assigned rep email configured'})

      const firmName=String(settings?.name||settings?.firmname||'Nashville Tax Solutions')
      const clientName=String(e.client_name||'Client')
      const docType=String(e.doc_type||'Document')
      const labels:Record<string,string>={opened:'Document Opened',signed:'Document Signed',partial:'Partial Signature — Action Needed'}
      const detail=event==='opened'?`${esc(clientName)} opened the ${esc(docType)} for signing.`:event==='signed'?`${esc(clientName)} signed the ${esc(docType)}. The signed archive is being finalized to the client file.`:`${esc(clientName)} started but did not complete the ${esc(docType)}.`
      const subject=`[${firmName}] ${labels[event]} — ${clientName}`
      const html=`<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px"><h2>${esc(labels[event])}</h2><p>${detail}</p><hr style="margin-top:24px;border:none;border-top:1px solid #e2e8f0"><p style="font-size:12px;color:#64748b">${esc(firmName)} — E-Sign Notification</p></div>`
      const {error:mailErr}=await db.functions.invoke('send-email',{body:{tenant_id:TENANT,to:notifyTo,subject,html}})
      if(mailErr)return json({error:'Notification email failed'},502)
      return json({success:true,event,notified_assigned_rep:true})
    }

    if(e.status!=='Signed')return json({error:'Signing request is not signed'},409)
    const prefix=`docs/${clean(e.client_name||'client')}/signed/${id}`
    const expected=new Map<string,string>()
    for(const a of Array.isArray(e.pdf_attachments)?e.pdf_attachments:[]){const ft=String(a?.formType||'');if(ft)expected.set(ft,String(a?.label||ft))}
    if(action==='prepare'){
      if(e.finalized_at)return json({error:'Signing request already finalized'},409)
      const requested=Array.isArray(body.files)?body.files:[]
      if(requested.length>30)return json({error:'Too many files'},400)
      const out:any[]=[]
      for(const f of requested){
        const kind=String(f?.kind||'internal'),formType=String(f?.formType||'')
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
        const [iu,cu]=await Promise.all([db.storage.from('documents').createSignedUrl(ip,900),db.storage.from('documents').createSignedUrl(cp,900)])
        if(iu.error||cu.error||!iu.data?.signedUrl||!cu.data?.signedUrl)return json({error:'Could not create signed archive links'},500)
        signedAttachments.push({formType:ft,label:expected.get(ft),url:iu.data.signedUrl,clientUrl:cu.data.signedUrl,storage_path:ip,client_storage_path:cp,fileSize:Number(a?.fileSize||0)||null,folder:a?.folder||null})
      }
      let certUrl:string|null=null,certPath:string|null=null
      if(cert?.path){certPath=String(cert.path);if(!exists(certPath))return json({error:'Certificate archive missing'},409);const {data,error}=await db.storage.from('documents').createSignedUrl(certPath,900);if(error||!data?.signedUrl)return json({error:'Could not create certificate link'},500);certUrl=data.signedUrl}
      const {data:claimed,error:claimErr}=await db.rpc('esign_claim_finalize',{p_id:id})
      if(claimErr)return json({error:claimErr.message},500)
      if(!claimed)return json({success:true,already_finalized:true})
      const saved=e.doc_type==='Service Addendum'?'Agreements':'E-Signatures'
      const signedAt=e.signed_at||e.signed_timestamp||new Date().toISOString()
      const signedBy=e.signer_full_name||e.signed_name||e.client_name||'Signer'
      const {error:finErr}=await db.rpc('esign_finalize',{p_id:id,p_client_name:e.client_name||'',p_doc_type:e.doc_type||'',p_signed_by:signedBy,p_signer_ip:e.signer_ip||'',p_signed_at:signedAt,p_saved_doc_type:saved,p_cert_url:certUrl,p_attachments:signedAttachments,p_cert_size:Number(cert?.fileSize||0)||null})
      if(finErr){await db.from('esigns').update({finalized_at:null}).eq('id',id).eq('tenant_id',TENANT);return json({error:finErr.message},500)}
      for(const a of signedAttachments)await db.from('documents').update({storage_path:a.storage_path}).eq('tenant_id',TENANT).eq('client',e.client_name).eq('file_url',a.url)
      if(certUrl&&certPath)await db.from('documents').update({storage_path:certPath}).eq('tenant_id',TENANT).eq('client',e.client_name).eq('file_url',certUrl)
      await db.from('esigns').update({signed_attachments:signedAttachments}).eq('id',id).eq('tenant_id',TENANT)

      let clientEmailSent=false,clientSmsSent=false
      if(e.client_email){
        const emailAttachments=signedAttachments
          .filter((a:any)=>a.clientUrl)
          .map((a:any)=>({url:a.clientUrl,filename:`${clean(a.label||a.formType||'signed-document')}.pdf`}))
        const {error:receiptErr}=await db.functions.invoke('send-email',{body:{
          tenant_id:TENANT,
          to:e.client_email,
          subject:`Signed Copy — ${e.doc_type||'Document'}`,
          html:`<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px"><h2>Signature Complete</h2><p>Thank you, ${esc(e.client_name||'Client')}. Your <strong>${esc(e.doc_type||'document')}</strong> has been signed and saved to your file.</p><p>Attached are the signed client copies available for this request.</p></div>`,
          attachments:emailAttachments
        }})
        clientEmailSent=!receiptErr
      }
      if(e.client_phone){
        const {error:smsErr}=await db.functions.invoke('send-sms',{body:{
          to:e.client_phone,
          body:`${String(e.client_name||'Client')}, your ${String(e.doc_type||'document')} has been signed and saved by Nashville Tax Solutions.`
        }})
        clientSmsSent=!smsErr
      }
      return json({success:true,signed_attachments:signedAttachments,certificate_url:certUrl,client_email_sent:clientEmailSent,client_sms_sent:clientSmsSent})
    }
    return json({error:'Unknown action'},400)
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
})

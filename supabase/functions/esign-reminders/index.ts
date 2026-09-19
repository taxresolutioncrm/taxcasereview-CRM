import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const REMINDER_DAYS=[1,2,4]
const TENANT_CODE='TRC-002'

serve(async (_req)=>{
  try{
    const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const {data:tenant}=await sb.from('tenants').select('id').eq('tenant_code',TENANT_CODE).maybeSingle()
    if(!tenant?.id) return new Response(JSON.stringify({error:'Nashville tenant not found'}),{status:500,headers:{'Content-Type':'application/json'}})
    const {data:settings}=await sb.from('settings').select('name,firmname,email,firmemail,phone,firmphone').eq('tenant_id',tenant.id).maybeSingle()
    const firmName=settings?.name||settings?.firmname||'Nashville Tax Solutions'
    const phone=settings?.phone||settings?.firmphone||''
    const now=new Date()
    const {data:docs,error}=await sb.from('esigns')
      .select('id,signer_token,tenant_id,client_name,client_email,doc_type,sent_at,opened_at,reminder_count,reminder_1_sent_at,reminder_2_sent_at,reminder_3_sent_at')
      .eq('tenant_id',tenant.id).is('signed_at',null).not('sent_at','is',null).not('client_email','is',null).lt('reminder_count',3)
    if(error) throw new Error(error.message)
    let sent=0,skipped=0
    for(const doc of docs||[]){
      const count=doc.reminder_count||0
      const days=Math.floor((now.getTime()-new Date(doc.sent_at).getTime())/86400000)
      if(days<REMINDER_DAYS[count]||count>=3||!doc.signer_token){skipped++;continue}
      const num=count+1
      const docType=doc.doc_type||'document'
      const signingUrl=`https://nashville.taxrescrm.app/sign/${doc.id}?token=${encodeURIComponent(doc.signer_token)}`
      const signingUrlEs=`${signingUrl}&lang=es`
      const subject=num===1
        ?`Signature Required / Firma requerida — ${docType}`
        :num===2
          ?`Signature Reminder / Recordatorio de firma — ${docType}`
          :`Final Signature Reminder / Recordatorio final de firma — ${docType}`
      const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px">
        <h2>${firmName}</h2>
        <p>Dear ${doc.client_name||'Valued Client'},</p>
        <p>Your <strong>${docType}</strong> is still awaiting your signature.</p>
        <p style="text-align:center;margin:24px"><a href="${signingUrl}" style="background:#2563eb;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Sign Document Now</a></p>
        ${phone?`<p>Questions? Contact us at ${phone}.</p>`:''}
        <p style="font-size:11px;color:#64748b">Reminder ${num} of 3.</p>
        <hr style="border:0;border-top:1px solid #e2e8f0;margin:28px 0">
        <p>Estimado/a ${doc.client_name||'cliente'},</p>
        <p>Su <strong>${docType}</strong> todavía está pendiente de su firma.</p>
        <p style="text-align:center;margin:24px"><a href="${signingUrlEs}" style="background:#2563eb;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">Firmar documento ahora</a></p>
        ${phone?`<p>¿Tiene preguntas? Comuníquese con nosotros al ${phone}.</p>`:''}
        <p style="font-size:11px;color:#64748b">Recordatorio ${num} de 3.</p>
      </div>`
      const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
      const mailRes=await fetch((Deno.env.get('SUPABASE_URL')||'')+'/functions/v1/nashville-esign-mail',{
        method:'POST',
        headers:{'Content-Type':'application/json',apikey:service,Authorization:'Bearer '+service},
        body:JSON.stringify({kind:'esign_reminder',esign_id:doc.id,to:doc.client_email,subject,html})
      })
      const mailOut=await mailRes.json().catch(()=>({}))
      if(!mailRes.ok||!mailOut?.success){skipped++;continue}
      const field=num===1?'reminder_1_sent_at':num===2?'reminder_2_sent_at':'reminder_3_sent_at'
      await sb.from('esigns').update({[field]:now.toISOString(),reminder_count:num}).eq('id',doc.id).eq('tenant_id',tenant.id)
      sent++
    }
    return new Response(JSON.stringify({ok:true,sent,skipped}),{headers:{'Content-Type':'application/json'}})
  }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:String(e)}),{status:500,headers:{'Content-Type':'application/json'}})}
})

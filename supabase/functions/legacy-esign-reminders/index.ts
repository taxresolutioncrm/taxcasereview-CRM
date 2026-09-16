import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DAYS=[1,2,4]
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})
const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m))
const validEmail=(v:any)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim())

async function mail(url:string,key:string,body:any){
  const r=await fetch(url+'/functions/v1/send-email',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'apikey':key},body:JSON.stringify(body)})
  if(!r.ok) throw new Error('send-email failed '+r.status)
}

serve(async(req)=>{
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const token=req.headers.get('x-internal-cron-token')||''
    const {data:authorized}=token?await admin.rpc('verify_internal_cron_token',{provided:token}):{data:false}
    if(authorized!==true) return json({error:'Unauthorized'},401)

    const {data:docs,error}=await admin.from('esigns')
      .select('id,tenant_id,client_name,client_email,doc_type,status,sent_at,sent_by,reminder_count,signing_origin')
      .eq('status','Awaiting').is('signed_at',null).not('sent_at','is',null)
      .not('client_email','is',null).lt('reminder_count',3)
      .order('sent_at',{ascending:true})
    if(error) throw error

    let sent=0,skipped=0,failed=0
    const now=new Date()
    for(const doc of docs||[]){
      try{
        const count=Math.max(0,Number(doc.reminder_count||0))
        const age=Math.floor((now.getTime()-new Date(doc.sent_at).getTime())/86400000)
        if(count>=DAYS.length||age<DAYS[count]||!validEmail(doc.client_email)){skipped++;continue}
        const {data:s}=await admin.from('settings').select('name,firmname,email,firmemail,smtp_email,phone,firmphone').eq('tenant_id',doc.tenant_id).maybeSingle()
        const firm=s?.name||s?.firmname||'TaxRes CRM'
        const origin=/^https:\/\//.test(String(doc.signing_origin||''))?String(doc.signing_origin).replace(/\/$/,''):'https://crm.taxrescrm.app'
        const link=origin+'/sign/'+encodeURIComponent(doc.id)
        const num=count+1
        const subject=num===1?`Signature required — ${doc.doc_type||'Document'}`:num===2?`Reminder: signature still needed — ${doc.doc_type||'Document'}`:`Final reminder: signature needed — ${doc.doc_type||'Document'}`
        const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
          <h2>${esc(firm)}</h2><p>Hi ${esc(doc.client_name||'there')},</p>
          <p>Your <strong>${esc(doc.doc_type||'document')}</strong> is still waiting for your signature.</p>
          <p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:700">Review &amp; Sign</a></p>
          <p style="font-size:12px;color:#64748b">Reminder ${num} of ${DAYS.length}.</p></div>`
        await mail(url,key,{tenant_id:doc.tenant_id,to:doc.client_email,subject,html})

        const stamp=now.toISOString()
        const field=num===1?'reminder_1_sent_at':num===2?'reminder_2_sent_at':'reminder_3_sent_at'
        await admin.from('esigns').update({reminder_count:num,[field]:stamp}).eq('id',doc.id).eq('tenant_id',doc.tenant_id)
        await admin.from('esign_audit_events').insert({esign_id:doc.id,tenant_id:doc.tenant_id,event_type:'reminder_sent',progress:null,step:`reminder_${num}`,metadata:{reminder_number:num,days_pending:age},event_at:stamp})

        const staff=validEmail(doc.sent_by)?String(doc.sent_by).trim():[s?.email,s?.firmemail,s?.smtp_email].find(validEmail)
        if(staff){
          await mail(url,key,{tenant_id:doc.tenant_id,to:staff,subject:`Reminder sent: ${doc.client_name||'Client'} — ${doc.doc_type||'Document'}`,
            html:`<div style="font-family:Arial,sans-serif"><p>Automatic e-sign reminder #${num} was sent to <strong>${esc(doc.client_name||'Client')}</strong>.</p><p>${esc(doc.doc_type||'Document')} · ${age} day(s) pending.</p></div>`}).catch(()=>{})
        }
        sent++
      }catch(e){console.error('[legacy-esign-reminders] row',doc?.id,e);failed++}
    }
    return json({ok:true,sent,skipped,failed})
  }catch(e){console.error('[legacy-esign-reminders]',e);return json({error:'Legacy e-sign reminder sweep failed'},500)}
})
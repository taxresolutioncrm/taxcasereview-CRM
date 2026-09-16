import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})
const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m))
const validEmail=(v:any)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim())

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try{
    const {esign_id,event_type,session_id}=await req.json()
    if(!/^es_[0-9a-f-]{36}$/i.test(String(esign_id||''))) return json({ok:true})
    if(!['opened','reopened'].includes(String(event_type||''))) return json({ok:true})
    const session=String(session_id||'').slice(0,128)
    if(!session) return json({ok:true})

    const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const since=new Date(Date.now()-2*60*1000).toISOString()
    const {data:event}=await admin.from('esign_audit_events')
      .select('id,event_at').eq('esign_id',esign_id).eq('session_id',session)
      .eq('event_type',event_type).gte('event_at',since).order('event_at',{ascending:false}).limit(1).maybeSingle()
    if(!event) return json({ok:true})

    const {data:doc}=await admin.from('esigns')
      .select('id,tenant_id,client_name,client_email,doc_type,status,sent_by,opened_at,last_view_notification_at')
      .eq('id',esign_id).maybeSingle()
    if(!doc) return json({ok:true})

    const now=new Date()
    const last=doc.last_view_notification_at?new Date(doc.last_view_notification_at):null
    if(last && now.getTime()-last.getTime()<30*60*1000) return json({ok:true,rate_limited:true})

    const {data:settings}=await admin.from('settings')
      .select('name,firmname,email,firmemail,smtp_email').eq('tenant_id',doc.tenant_id).maybeSingle()
    const staff=validEmail(doc.sent_by)?String(doc.sent_by).trim()
      :[settings?.email,settings?.firmemail,settings?.smtp_email].find(validEmail)
    if(!staff) return json({ok:true,no_recipient:true})

    const firm=settings?.name||settings?.firmname||'TaxRes CRM'
    const first=!doc.opened_at
    const subject=first
      ? `Opened: ${doc.client_name||'Client'} — ${doc.doc_type||'E-Signature'}`
      : `Viewed again: ${doc.client_name||'Client'} — ${doc.doc_type||'E-Signature'}`
    const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033">
      <h2>${esc(first?'Signing request opened':'Signing request viewed again')}</h2>
      <p><strong>${esc(doc.client_name||'Client')}</strong> ${first?'opened':'returned to'} the document.</p>
      <div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;margin:18px 0">
        <div><strong>${esc(doc.doc_type||'Document')}</strong></div>
        <div style="font-size:12px;color:#64748b;margin-top:5px">Status: ${esc(doc.status||'Awaiting')} · ${esc(now.toLocaleString())}</div>
      </div>
      <p style="font-size:12px;color:#64748b">You can review opens, sessions and signing progress in ${esc(firm)} → E-Signatures → Signing Audit.</p>
    </div>`

    const resp=await fetch(url+'/functions/v1/send-email',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'apikey':key},
      body:JSON.stringify({tenant_id:doc.tenant_id,to:staff,subject,html})
    })
    if(!resp.ok) throw new Error('notification email failed')

    await admin.from('esigns').update({
      opened_at:doc.opened_at||now.toISOString(),
      last_view_notification_at:now.toISOString()
    }).eq('id',doc.id)
    return json({ok:true,notified:true})
  }catch(e){
    console.error('[legacy-esign-lifecycle]',e)
    return json({error:'Lifecycle notification failed'},500)
  }
})
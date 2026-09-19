import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const APP_URL='https://nashville.taxrescrm.app'
const SECRET_KEY='nashville_esign_reminders_cron'
const DAYS=[1,2,4]
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m))
const validEmail=(v:any)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim())
const validSignerToken=(v:any)=>/^[0-9a-f]{64}$/i.test(String(v||''))

async function sendMail(url:string,key:string,body:any){
  const r=await fetch(url+'/functions/v1/nashville-esign-mail',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key,'apikey':key},
    body:JSON.stringify(body)
  })
  const payload=await r.json().catch(()=>({}))
  if(!r.ok||!payload?.success) throw new Error(payload?.error||('send-email failed '+r.status))
}

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||''
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!key) return json({error:'Reminder service unavailable'},503)
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})

    const supplied=req.headers.get('x-internal-cron-token')||''
    const {data:secretRow,error:secretErr}=await admin.from('platform_internal_secrets')
      .select('secret').eq('key',SECRET_KEY).maybeSingle()
    if(secretErr||!secretRow?.secret||supplied!==String(secretRow.secret)) return json({error:'Unauthorized'},401)

    const body=await req.json().catch(()=>({}))
    const dryRun=body?.dry_run===true
    const now=new Date()

    const {data:docs,error}=await admin.from('esigns')
      .select('id,tenant_id,client_name,client_email,doc_type,status,sent_at,sent_by,reminder_count,signer_token,signed_at')
      .eq('tenant_id',TENANT).eq('status','Awaiting').is('signed_at',null)
      .not('sent_at','is',null).not('client_email','is',null)
      .order('sent_at',{ascending:true})
    if(error) throw error

    let due=0,sent=0,skipped=0,failed=0
    const failures:any[]=[]
    for(const doc of docs||[]){
      try{
        const count=Math.max(0,Number(doc.reminder_count||0))
        const sentAt=new Date(doc.sent_at)
        const age=Math.floor((now.getTime()-sentAt.getTime())/86400000)
        if(count>=DAYS.length||age<DAYS[count]||!validEmail(doc.client_email)||!validSignerToken(doc.signer_token)){
          skipped++; continue
        }
        due++
        const num=count+1
        const link=APP_URL+'/sign/'+encodeURIComponent(String(doc.id))+'?token='+encodeURIComponent(String(doc.signer_token))
        const subject=num===1
          ? `Signature required — ${doc.doc_type||'Document'}`
          : num===2
            ? `Reminder: signature still needed — ${doc.doc_type||'Document'}`
            : `Final reminder: signature needed — ${doc.doc_type||'Document'}`
        const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033">
          <h2>Nashville Tax Solutions</h2>
          <p>Hi ${esc(doc.client_name||'there')},</p>
          <p>Your <strong>${esc(doc.doc_type||'document')}</strong> is still waiting for your signature.</p>
          <p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:700">Review &amp; Sign</a></p>
          <p style="font-size:12px;color:#64748b">Reminder ${num} of ${DAYS.length}.</p>
        </div>`

        if(dryRun) continue

        await sendMail(url,key,{
          tenant_id:TENANT,
          to:String(doc.client_email).trim(),
          subject,
          html,
          from_name:'Nashville Tax Solutions'
        })

        const stamp=new Date().toISOString()
        const field=num===1?'reminder_1_sent_at':num===2?'reminder_2_sent_at':'reminder_3_sent_at'
        const {error:updateErr}=await admin.from('esigns')
          .update({reminder_count:num,[field]:stamp})
          .eq('id',doc.id).eq('tenant_id',TENANT).eq('status','Awaiting').is('signed_at',null)
        if(updateErr) throw updateErr

        await admin.from('esign_audit_events').insert({
          esign_id:doc.id,tenant_id:TENANT,event_type:'reminder_sent',
          progress:null,step:`reminder_${num}`,
          metadata:{reminder_number:num,days_pending:age,delivery:'email'},
          event_at:stamp
        })
        sent++
      }catch(e){
        failed++
        failures.push({id:doc?.id||null,error:e instanceof Error?e.message:String(e)})
      }
    }

    return json({ok:failed===0,dry_run:dryRun,due,sent,skipped,failed,failures})
  }catch(e){
    console.error('[nashville-esign-reminders]',e)
    return json({error:e instanceof Error?e.message:'Nashville e-sign reminder sweep failed'},500)
  }
})
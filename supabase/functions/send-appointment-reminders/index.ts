import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-internal-cron-token'}
const REMINDER_MINUTES_BEFORE=30,WINDOW_MINUTES=5
const DEMO_TENANT='a0000000-0000-0000-0000-000000000001'
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
function esc(v:unknown){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
function easternWallClockToUTC(dateStr:string,timeStr:string){const guess=new Date(`${dateStr}T${timeStr}:00Z`),parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(guess),get=(t:string)=>parts.find(p=>p.type===t)?.value,asIfUTC=new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);return new Date(guess.getTime()+(guess.getTime()-asIfUTC.getTime()))}
function fmtTime(t:string){if(!t)return'';const[h,m]=t.split(':').map(Number),period=h>=12?'PM':'AM';return`${h%12||12}:${String(m).padStart(2,'0')} ${period}`}
function fmtDate(d:string){if(!d)return'';const[y,mo,day]=d.split('-'),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return`${months[parseInt(mo)-1]} ${parseInt(day)}, ${y}`}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  try{
    const supabase=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'')
    const token=req.headers.get('x-internal-cron-token')||''
    const{data:authorized,error:authErr}=token?await supabase.rpc('verify_internal_cron_token',{provided:token}):{data:false,error:null}
    if(authErr||authorized!==true)return json({error:'Unauthorized'},401)

    const now=new Date(),targetStart=new Date(now.getTime()+(REMINDER_MINUTES_BEFORE-WINDOW_MINUTES)*60000),targetEnd=new Date(now.getTime()+(REMINDER_MINUTES_BEFORE+WINDOW_MINUTES)*60000)
    const{data:events,error}=await supabase.from('calevents').select('id,title,"clientName","assignedTo",date,time,"eventType",notes,status,reminder_sent,tenant_id').eq('status','scheduled').or('reminder_sent.is.null,reminder_sent.eq.false')
    if(error)throw error
    const{data:employees}=await supabase.from('employees').select('name,email,tenant_id'),{data:allSettings}=await supabase.from('settings').select('tenant_id,name,firmname,email,firmemail,phone,firmphone')
    const emailByName=Object.fromEntries((employees||[]).filter((e:any)=>e.name&&e.email).map((e:any)=>[e.name,{email:e.email,tenant_id:e.tenant_id}])),settingsByTenant=Object.fromEntries((allSettings||[]).map((s:any)=>[s.tenant_id,s]))
    let sent=0
    for(const ev of events||[]){
      if(!ev.date||!ev.time)continue;const evUTC=easternWallClockToUTC(ev.date,ev.time);if(evUTC<targetStart||evUTC>targetEnd)continue
      const empInfo=emailByName[ev.assignedTo]||null,recipientEmail=empInfo?.email||null;if(!recipientEmail)continue
      const tenantId=ev.tenant_id||empInfo?.tenant_id;if(!tenantId)continue
      const s=settingsByTenant[tenantId],firmName=s?.name||s?.firmname||'TaxRes CRM',firmEmail=s?.email||s?.firmemail||'',firmPhone=s?.phone||s?.firmphone||''
      const mailFn=String(tenantId)===DEMO_TENANT?'demo-send-email':'send-email'
      const emailRes=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${mailFn}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`},body:JSON.stringify({to:recipientEmail,tenant_id:tenantId,subject:`📅 Reminder: ${ev.title||'Appointment'} at ${fmtTime(ev.time)}`,html:`<div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto"><h2>Appointment in ${REMINDER_MINUTES_BEFORE} minutes</h2><p><strong>${esc(ev.clientName||ev.title||'—')}</strong></p><p>${esc(ev.eventType||'Appointment')} · ${esc(fmtDate(ev.date))} · ${esc(fmtTime(ev.time))} ET</p>${ev.notes?`<p>${esc(ev.notes)}</p>`:''}<p style="font-size:12px;color:#64748b">${esc(firmName)}${firmEmail?` · ${esc(firmEmail)}`:''}${firmPhone?` · ${esc(firmPhone)}`:''}</p></div>`})})
      if(!emailRes.ok){console.error('[send-appointment-reminders] mail failed',mailFn,emailRes.status);continue}
      await supabase.from('calevents').update({reminder_sent:true}).eq('id',ev.id).eq('tenant_id',tenantId);sent++
    }
    return json({success:true,sent})
  }catch(err){console.error('[send-appointment-reminders]',err);return json({error:'Reminder sweep failed'},500)}
})

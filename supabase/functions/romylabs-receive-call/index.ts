import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_TENANT='a0000000-0000-0000-0000-000000000001'
const xml=(s:string,status=200)=>new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${s}</Response>`,{status,headers:{'Content-Type':'text/xml'}})
const normalize=(v:string)=>{const d=String(v||'').replace(/\D/g,'');return d.length===10?`+1${d}`:(d.length===11&&d.startsWith('1')?`+${d}`:'')}
const escapeXml=(v:string)=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
function businessHours(d:Date,settings:any){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',hour12:false}).formatToParts(d)
  const day=p.find(x=>x.type==='weekday')?.value||''
  const dayIndex:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}
  const hour=Number(p.find(x=>x.type==='hour')?.value||0)%24
  const days=Array.isArray(settings?.weekdays)?settings.weekdays:[1,2,3,4,5]
  return days.includes(dayIndex[day])&&hour>=Number(settings?.opening_hour??9)&&hour<Number(settings?.closing_hour??18)
}
async function verify(secret:string,url:string,params:Record<string,string>,sig:string){if(!secret||!sig)return false;let s=url;for(const k of Object.keys(params).sort())s+=k+(params[k]??'');const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']),raw=await crypto.subtle.sign('HMAC',key,enc.encode(s)),expected=btoa(String.fromCharCode(...new Uint8Array(raw)));if(expected.length!==sig.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i);return diff===0}

serve(async req=>{
  if(req.method!=='POST')return xml('',405)
  const raw=await req.text(),form=new URLSearchParams(raw),params:Record<string,string>={};for(const[k,v]of form)params[k]=v
  const secret=Deno.env.get('SW_SIGNING_SECRET')||'',sig=req.headers.get('x-signalwire-signature')||''
  const internal=req.headers.get('x-romylabs-internal')||''
  const trustedInternal=!!internal&&internal===String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'')
  if(!trustedInternal&&secret&&!await verify(secret,req.url,params,sig))return xml('<Hangup/>',403)
  const callSid=form.get('CallSid')||'',from=form.get('From')||'',to=form.get('To')||''
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data:adminSettings}=await db.from('settings').select('sw_inbound_did').eq('tenant_id',ADMIN_TENANT).limit(1).maybeSingle()
  const romy=normalize(adminSettings?.sw_inbound_did||'')
  if(!callSid||!romy||normalize(to)!==romy)return xml('<Hangup/>',403)
  const base=`${Deno.env.get('SUPABASE_URL')}/functions/v1`
  const {data:ivr,error:ivrError}=await db.from('romylabs_ivr_settings')
    .select('menu_greeting,after_hours_greeting,opening_hour,closing_hour,weekdays,voicemail_max_seconds')
    .eq('tenant_id',ADMIN_TENANT).maybeSingle()
  // A temporary settings-store failure must not interrupt incoming calls.
  // Fall back to the last known safe phone menu defaults; never route to another tenant.
  if(ivrError||!ivr)console.error('[romylabs-receive-call] IVR settings unavailable; using safe defaults')
  const ivrConfig=ivr||{
    menu_greeting:'Thanks for calling RomyLabs. How can I help? For sales, press 1. For support, press 2. For billing, press 3. To speak with a representative, press 4. Or, to leave a voicemail, press 5.',
    after_hours_greeting:'Thanks for calling RomyLabs. We are closed right now. Our regular hours are Monday through Friday, nine A M to six P M Eastern. Leave your name, number, and a short message after the tone, and we will get back to you the next business day.',
    opening_hour:9,closing_hour:18,weekdays:[1,2,3,4,5],voicemail_max_seconds:180,
  }

  if(normalize(from)===romy){
    const cutoff=new Date(Date.now()-15*60*1000).toISOString()
    const {data:inc}=await db.from('incoming_calls').select('conference_name,callsid').eq('tenant_id',ADMIN_TENANT).eq('status','answered').gte('created_at',cutoff).not('conference_name','is',null).order('claimed_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle()
    if(inc?.conference_name){return xml(`<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false">${inc.conference_name}</Conference></Dial>`)}
    const {data:out}=await db.from('outbound_calls').select('id,conference_name').eq('tenant_id',ADMIN_TENANT).in('status',['pending','ringing','answered','connected']).not('conference_name','is',null).order('created_at',{ascending:false}).limit(1).maybeSingle()
    if(out?.conference_name){await db.from('outbound_calls').update({status:'connected'}).eq('id',out.id).eq('tenant_id',ADMIN_TENANT);return xml(`<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false">${out.conference_name}</Conference></Dial>`)}
    return xml('<Hangup/>')
  }

  const menuConf=`romylabs-menu-${callSid}`.replace(/[^A-Za-z0-9_-]/g,'').slice(0,160)
  const {error:historyErr}=await db.from('incoming_calls').insert({
    callsid:callSid,conference_name:menuConf,from_number:from.slice(0,32),
    department:'Auto Attendant',status:'menu',tenant_id:ADMIN_TENANT
  })
  if(historyErr&&historyErr.code!=='23505')console.error('[romylabs-receive-call] history insert',historyErr)

  if(!businessHours(new Date(),ivrConfig)){
    await db.from('incoming_calls').update({status:'missed',department:'After Hours'})
      .eq('tenant_id',ADMIN_TENANT).eq('callsid',callSid).eq('status','menu')
    return xml(`<Say voice="openai.alloy" language="en-US">${escapeXml(ivrConfig.after_hours_greeting)}</Say><Record action="${base}/romylabs-voicemail-recorded" maxLength="${Number(ivrConfig.voicemail_max_seconds)}" finishOnKey="#" playBeep="true"/>`)
  }

  return xml(`<Gather numDigits="1" timeout="8" action="${base}/romylabs-ivr-route" method="POST"><Say voice="openai.alloy" language="en-US">${escapeXml(ivrConfig.menu_greeting)}</Say></Gather><Redirect method="POST">${base}/romylabs-ivr-route</Redirect>`)
})

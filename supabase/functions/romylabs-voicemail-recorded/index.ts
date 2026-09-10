import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void}
const ADMIN_TENANT='a0000000-0000-0000-0000-000000000001'
const ACK='<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="openai.alloy" language="en-US">Got it. Your message has been recorded. Someone from RomyLabs will get back to you as soon as possible.</Say></Response>'
const resp=(status=200)=>new Response(ACK,{status,headers:{'Content-Type':'text/xml'}})
const normalize=(v:string)=>{const d=String(v||'').replace(/\D/g,'');return d.length===10?`+1${d}`:(d.length===11&&d.startsWith('1')?`+${d}`:'')}
function swUrl(raw:string){try{const u=new URL(raw);return u.protocol==='https:'&&(u.hostname==='signalwire.com'||u.hostname.endsWith('.signalwire.com'))}catch{return false}}
async function verify(secret:string,url:string,params:Record<string,string>,sig:string){if(!secret||!sig)return false;let s=url;for(const k of Object.keys(params).sort())s+=k+(params[k]??'');const enc=new TextEncoder(),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']),raw=await crypto.subtle.sign('HMAC',key,enc.encode(s)),expected=btoa(String.fromCharCode(...new Uint8Array(raw)));if(expected.length!==sig.length)return false;let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i);return diff===0}

function b64url(s:string){const u=new TextEncoder().encode(s);let b='';u.forEach(x=>b+=String.fromCharCode(x));return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function gmailToken(db:any,s:any){
  const exp=s.gmail_token_expiry?new Date(s.gmail_token_expiry).getTime():0
  if(s.gmail_access_token&&exp>Date.now()+60000)return s.gmail_access_token
  if(!s.gmail_refresh_token||!s.gmail_client_id||!s.gmail_client_secret)return null
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:s.gmail_refresh_token,client_id:s.gmail_client_id,client_secret:s.gmail_client_secret,grant_type:'refresh_token'})})
  const d=await r.json()
  if(!r.ok||!d?.access_token)return null
  await db.from('settings').update({gmail_access_token:d.access_token,gmail_token_expiry:new Date(Date.now()+(d.expires_in||3600)*1000).toISOString()}).eq('id',s.id)
  return d.access_token
}
async function notifyVoicemail(db:any,from:string,duration:string){
  try{
    const {data:gs}=await db.from('settings').select('id,email,gmail_refresh_token,gmail_client_id,gmail_client_secret,gmail_access_token,gmail_token_expiry').eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
    if(!gs)return
    const token=await gmailToken(db,gs)
    if(!token)return
    const dur=/^\d+$/.test(duration)?`${duration} seconds`:'unknown duration'
    const sender=String(gs.email||'info@taxcasereview.org').replace(/[\r\n]/g,'')
    const raw=[
      'To: info@romylabs.com',
      `From: RomyLabs Phone System <${sender}>`,
      'Reply-To: info@romylabs.com',
      'Subject: New RomyLabs voicemail',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      `New RomyLabs voicemail from ${from||'Unknown caller'} (${dur}).\n\nOpen the RomyLabs Admin Portal to listen and respond:\nhttps://admin.romylabs.com/crm-admin/dialer`
    ].join('\r\n')
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:b64url(raw)})})
    if(!r.ok)console.error('[romylabs-voicemail-recorded] notification email',r.status,await r.text())
  }catch(e){console.error('[romylabs-voicemail-recorded] notification',e)}
}
serve(async req=>{
  if(req.method!=='POST')return resp(405)
  try{
    const raw=await req.text(),form=new URLSearchParams(raw),params:Record<string,string>={};for(const[k,v]of form)params[k]=v
    const secret=Deno.env.get('SW_SIGNING_SECRET')||'',sig=req.headers.get('x-signalwire-signature')||''
    if(secret&&!await verify(secret,req.url,params,sig))return resp(403)
    const from=String(form.get('From')||''),to=String(form.get('To')||''),url=String(form.get('RecordingUrl')||''),sid=String(form.get('CallSid')||'').trim(),duration=String(form.get('RecordingDuration')||'')
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const {data:adminSettings}=await db.from('settings').select('sw_inbound_did').eq('tenant_id',ADMIN_TENANT).limit(1).maybeSingle()
    const romy=normalize(adminSettings?.sw_inbound_did||'')
    if(!sid||normalize(to)!==romy||!swUrl(url))return resp(400)
    const {data:existing}=await db.from('voicemails').select('id').eq('tenant_id',ADMIN_TENANT).eq('call_sid',sid).maybeSingle()
    if(existing)return resp()
    const {data:s}=await db.from('settings').select('sw_project_id,sw_api_token').eq('tenant_id','61a89aef-0e7e-4ea2-b222-44ab2024655a').limit(1).maybeSingle()
    let stored=url
    if(s?.sw_project_id&&s?.sw_api_token){
      try{
        const audio=await fetch(url.endsWith('.mp3')?url:`${url}.mp3`,{headers:{Authorization:'Basic '+btoa(`${s.sw_project_id}:${s.sw_api_token}`)}})
        if(audio.ok){const bytes=new Uint8Array(await audio.arrayBuffer()),path=`${ADMIN_TENANT}/romylabs_vm_${sid.replace(/[^A-Za-z0-9_-]/g,'')}_${crypto.randomUUID()}.mp3`;const{error:up}=await db.storage.from('voicemails').upload(path,bytes,{contentType:'audio/mpeg',upsert:false});if(!up)stored=`storage://voicemails/${path}`}
      }catch(e){console.error('[romylabs-voicemail-recorded] audio',e)}
    }
    const {data:inserted,error}=await db.from('voicemails').insert({from_number:from.slice(0,32),to_number:to.slice(0,32),recording_url:stored,duration_seconds:/^\d+$/.test(duration)?Math.min(Number(duration),3600):null,call_sid:sid,is_read:false,created_at:new Date().toISOString(),tenant_id:ADMIN_TENANT,transcription_status:stored.startsWith('storage://voicemails/')?'pending':'unavailable'}).select('id').single()
    if(error&&error.code!=='23505')throw error
    if(!error){
      const tasks:Promise<unknown>[]=[notifyVoicemail(db,from,duration)]
      const prefix='storage://voicemails/'
      if(inserted?.id&&stored.startsWith(prefix)){
        tasks.push(fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/romylabs-voicemail-transcribe`,{
          method:'POST',
          headers:{'Content-Type':'application/json','x-internal-call-secret':Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''},
          body:JSON.stringify({voicemail_id:inserted.id,storage_path:stored.slice(prefix.length)}),
        }).then(async r=>{if(!r.ok)console.error('[romylabs-voicemail-recorded] transcription',r.status,await r.text())})
          .catch(e=>console.error('[romylabs-voicemail-recorded] transcription trigger',e)))
      }
      const background=Promise.allSettled(tasks)
      try{EdgeRuntime.waitUntil(background)}catch{void background}
    }
    return resp()
  }catch(e){console.error('[romylabs-voicemail-recorded]',e);return resp(500)}
})

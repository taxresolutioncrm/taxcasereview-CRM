import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const xml='<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const respond=(status=200)=>new Response(xml,{status,headers:{'Content-Type':'text/xml'}})

async function verifySW(secret:string,url:string,params:Record<string,string>,sig:string){
  if(!secret||!sig)return false
  let s=url
  for(const k of Object.keys(params).sort())s+=k+(params[k]??'')
  const enc=new TextEncoder()
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign'])
  const raw=await crypto.subtle.sign('HMAC',key,enc.encode(s))
  const expected=btoa(String.fromCharCode(...new Uint8Array(raw)))
  if(expected.length!==sig.length)return false
  let d=0
  for(let i=0;i<expected.length;i++)d|=expected.charCodeAt(i)^sig.charCodeAt(i)
  return d===0
}

serve(async req=>{
  if(req.method!=='POST')return respond(405)
  try{
    const raw=await req.text()
    const form=new URLSearchParams(raw)
    const swSecret=Deno.env.get('SW_SIGNING_SECRET')??''
    const sig=req.headers.get('x-signalwire-signature')??''
    const internal=req.headers.get('x-romylabs-internal')||''
    const trustedInternal=!!internal&&internal===String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'')
    if(!trustedInternal&&swSecret){
      const params:Record<string,string>={}
      for(const[k,v]of form)params[k]=v
      if(!await verifySW(swSecret,req.url,params,sig))return respond(403)
    }else{
      console.warn('[receive-sms] SW_SIGNING_SECRET absent; structural callback validation only')
    }

    const from=String(form.get('From')||''),to=String(form.get('To')||''),body=String(form.get('Body')||''),sid=String(form.get('MessageSid')||form.get('SmsSid')||form.get('sid')||'').trim()
    const n=Math.min(Number(form.get('NumMedia')||0)||0,10),media:any[]=[]
    for(let i=0;i<n;i++){
      const u=String(form.get(`MediaUrl${i}`)||'').trim(),ct=String(form.get(`MediaContentType${i}`)||'').trim()||null
      if(u&&/^https:\/\//i.test(u))media.push({url:u,content_type:ct})
    }
    if(!from||!to||(!body&&media.length===0)||!sid)return respond(400)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const toDigits=to.replace(/\D/g,'').slice(-10)
    if(toDigits.length!==10)return respond(400)
    const {data:settings,error:settingsErr}=await admin.from('settings').select('tenant_id,sw_inbound_did,sw_outbound_did').not('tenant_id','is',null)
    if(settingsErr)throw settingsErr
    const matches=(settings||[]).filter((r:any)=>[r.sw_inbound_did,r.sw_outbound_did].some(v=>String(v||'').replace(/\D/g,'').slice(-10)===toDigits))
    if(matches.length!==1){console.error('[receive-sms] inbound DID did not resolve uniquely',{toDigits,matches:matches.length});return respond(403)}
    const tenantId=matches[0].tenant_id
    const last10=from.replace(/\D/g,'').slice(-10)
    let clientName=''
    if(last10.length===10){
      const {data:l}=await admin.from('leads').select('name').eq('tenant_id',tenantId).or(`phone.ilike.%${last10}%,phone2.ilike.%${last10}%`).limit(1).maybeSingle()
      clientName=l?.name||''
      if(!clientName){const {data:c}=await admin.from('clients').select('name').eq('tenant_id',tenantId).or(`phone.ilike.%${last10}%,phone2.ilike.%${last10}%`).limit(1).maybeSingle();clientName=c?.name||''}
    }
    const {error}=await admin.from('sms_messages').insert({tenant_id:tenantId,clientName:clientName||from,phone:from,body:body.slice(0,10000),media:media.length?media:null,status:'Received',direction:'inbound',signalwire_sms_id:sid,created_at:new Date().toISOString()})
    if(error&&error.code!=='23505')throw error
    return respond()
  }catch(e){console.error('[receive-sms]',e);return respond(500)}
})

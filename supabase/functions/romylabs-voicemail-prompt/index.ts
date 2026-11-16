import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Keep this SignalWire callback server-side; it never accepts a tenant ID
// or a voicemail destination from caller input.
const TENANT='a0000000-0000-0000-0000-000000000001'
const escapeXml=(v:string)=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
serve(async(req)=>{
  if(req.method!=='POST')return new Response('',{status:405})
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data:config,error}=await db.from('romylabs_ivr_settings')
    .select('voicemail_greeting,voicemail_max_seconds').eq('tenant_id',TENANT).maybeSingle()
  if(error||!config)console.error('[romylabs-voicemail-prompt] Config unavailable; using safe voicemail defaults')
  const active=config||{
    voicemail_greeting:'We cannot get to the phone right now. Please leave your name, number, and a short message after the tone. Press pound when you are finished.',
    voicemail_max_seconds:180,
  }
  const base=`${Deno.env.get('SUPABASE_URL')}/functions/v1`
  const body=`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="openai.alloy" language="en-US">${escapeXml(active.voicemail_greeting)}</Say><Record action="${base}/romylabs-voicemail-recorded" maxLength="${Number(active.voicemail_max_seconds)}" finishOnKey="#" playBeep="true"/></Response>`
  return new Response(body,{headers:{'Content-Type':'text/xml'}})
})

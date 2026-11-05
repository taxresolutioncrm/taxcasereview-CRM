import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const URL=Deno.env.get('SUPABASE_URL')!
const TENANT='a0000000-0000-0000-0000-000000000001'
const xml=(s:string,status=200)=>new Response('<?xml version="1.0" encoding="UTF-8"?><Response>'+s+'</Response>',{
  status,headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}
})
const safeEqual=(a:string,b:string)=>{if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
const sign=async(s:string)=>{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const data=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(s))
  return Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,'0')).join('')
}

serve(async req=>{
  if(!['GET','POST'].includes(req.method))return xml('<Hangup/>',405)
  try{
    const u=new URL(req.url)
    const id=u.searchParams.get('call')||''
    const invite=u.searchParams.get('invite')||''
    const exp=Number(u.searchParams.get('exp')||0)
    const sig=u.searchParams.get('sig')||''
    if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{32}$/i.test(invite)||
      !Number.isSafeInteger(exp)||exp<Date.now()||exp>Date.now()+15*60*1000||
      !/^[0-9a-f]{64}$/i.test(sig))return xml('<Hangup/>',403)
    if(!safeEqual(await sign(id+'.'+invite+'.'+exp),sig))return xml('<Hangup/>',403)
    const db=createClient(URL,SECRET)
    const {data:row}=await db.from('outbound_calls')
      .select('conference_name,status').eq('id',id).eq('tenant_id',TENANT)
      .eq('status','connected').limit(1).maybeSingle()
    if(!row||!String(row.conference_name||'').startsWith('outbound-merge-'))
      return xml('<Hangup/>',404)
    // This isolated waiting room never touches the original two-way call.
    // When the authenticated agent selects Merge Calls, the backend moves
    // THIS guest's provider SID into the live main room.
    return xml('<Dial><Conference startConferenceOnEnter="false" endConferenceOnExit="false">consult-'+invite+'</Conference></Dial>')
  }catch(e){console.error('[romylabs-conference-guest]',e);return xml('<Hangup/>',500)}
})

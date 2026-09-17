import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

async function verifySW(secret:string,url:string,params:Record<string,string>,sig:string){
  if(!secret||!sig)return false
  let payload=url
  for(const k of Object.keys(params).sort())payload+=k+(params[k]??'')
  const enc=new TextEncoder()
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign'])
  const raw=await crypto.subtle.sign('HMAC',key,enc.encode(payload))
  const expected=btoa(String.fromCharCode(...new Uint8Array(raw)))
  if(expected.length!==sig.length)return false
  let diff=0
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i)
  return diff===0
}

serve(async(req)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405})
  try{
    const url=new URL(req.url)
    const conf=(url.searchParams.get('conf')||'').trim()
    const tenant=(url.searchParams.get('tenant')||'').trim()
    if(!/^outbound-[A-Za-z0-9_-]{8,120}$/.test(conf))return new Response('Bad Request',{status:400})

    const body=await req.text()
    const form=new URLSearchParams(body)
    const callbackFields:Record<string,string>={}
    for(const[k,v]of form)callbackFields[k]=v

    const swSecret=Deno.env.get('SW_SIGNING_SECRET')??''
    if(swSecret){
      const sig=req.headers.get('x-signalwire-signature')??''
      if(!await verifySW(swSecret,req.url,callbackFields,sig))return new Response('Unauthorized',{status:403})
    }else console.warn('[outbound-call-status] SW_SIGNING_SECRET absent; restricted structural validation only')

    const rawStatus=(form.get('CallStatus')||form.get('CallState')||'').toLowerCase()
    let status=''
    if(rawStatus==='in-progress'||rawStatus==='answered')status='answered'
    else if(rawStatus==='queued'||rawStatus==='initiated')status='pending'
    else if(rawStatus==='ringing')status='ringing'
    else if(['completed','busy','failed','no-answer','canceled','cancelled'].includes(rawStatus))status='completed'
    else if(!rawStatus)status='completed'
    else return new Response('Bad Request',{status:400})

    const terminal=['completed','busy','failed','no-answer','canceled','cancelled'].includes(rawStatus)||!rawStatus
    const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const cutoff=new Date(Date.now()-24*60*60*1000).toISOString()
    let q=supabase.from('outbound_calls')
      .select('id,status,created_at,tenant_id,end_requested_at,end_requested_by,disconnect_source')
      .eq('conference_name',conf).gte('created_at',cutoff)
    if(tenant)q=q.eq('tenant_id',tenant)
    const {data:row,error:findErr}=await q.limit(1).maybeSingle()
    if(findErr)throw findErr
    if(!row)return new Response('Not Found',{status:404})

    const callSid=form.get('CallSid')||form.get('CallSid'.toLowerCase())||null
    const providerReason=form.get('HangupCause')||form.get('ErrorMessage')||form.get('ErrorCode')||form.get('SipResponseCode')||null
    const adminRequested=!!row.end_requested_at
    const disconnectSource=terminal
      ? (adminRequested?'admin_dialer':(['failed','busy','no-answer','canceled','cancelled'].includes(rawStatus)?'provider_failure':'remote_or_provider'))
      : row.disconnect_source

    const updatePayload:Record<string,unknown>={
      status,
      provider_status:rawStatus||'completed',
      disconnect_details:callbackFields,
    }
    if(callSid) updatePayload.provider_call_sid=callSid
    if(terminal){
      updatePayload.ended_at=new Date().toISOString()
      updatePayload.disconnect_source=disconnectSource
      updatePayload.disconnect_initiator=adminRequested?(row.end_requested_by||'admin_dialer'):null
      updatePayload.disconnect_reason=providerReason||(rawStatus||'completed')
    }

    let upd=supabase.from('outbound_calls').update(updatePayload).eq('id',row.id)
    if(tenant)upd=upd.eq('tenant_id',tenant)
    const {error}=await upd
    if(error)throw error
    return new Response('ok')
  }catch(err){
    console.error('[outbound-call-status]',err)
    return new Response('error',{status:500})
  }
})

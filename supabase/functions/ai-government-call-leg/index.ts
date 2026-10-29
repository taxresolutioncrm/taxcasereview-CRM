import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GROQ=Deno.env.get('GROQ_API_KEY')||''
const esc=(v:any)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
const xml=(body:string,status=200)=>new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,{status,headers:{'Content-Type':'text/xml','Cache-Control':'no-store'}})
const gather=(self:string)=>`<Gather input="speech" language="en-US" speechTimeout="auto" timeout="20" actionOnEmptyResult="true" method="POST" action="${esc(self)}"></Gather><Redirect method="POST">${esc(self)}</Redirect>`

async function decide(prompt:string,session:any){
  const lower=prompt.toLowerCase()
  if(!prompt.trim()) return {action:'wait',confidence:0.5,reason:'No speech result'}
  if(/(thank you for calling|your call is important|please continue to hold|estimated wait|next available|high call volume|please stay on the line|hold for the next)/i.test(prompt)) return {action:'wait',confidence:.94,reason:'Queue or recorded announcement'}
  if(/(we can call you back|would you like (us|a representative) to call you back|press .* for a callback|request a callback|receive a callback|callback option|call-back option)/i.test(prompt)) return {action:'callback_offer',confidence:.98,reason:'IRS callback option offered; manual confirmation required'}
  if(/(my name is|badge number|id number|how may i help|how can i help|who am i speaking|internal revenue service.*this is|department of revenue.*this is)/i.test(prompt)) return {action:'human',confidence:.98,reason:'Conversational representative greeting'}

  if(!GROQ) return {action:'unknown',confidence:0,reason:'AI classifier unavailable'}
  const hints=Array.isArray(session.route_hints)?session.route_hints:[]
  const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+GROQ},
    body:JSON.stringify({
      model:'openai/gpt-oss-120b',temperature:0,max_tokens:260,
      messages:[
        {role:'system',content:[
          'You route outbound calls through US government auto attendants for an authorized tax professional.',
          'You NEVER discuss taxpayer facts, authenticate a taxpayer, claim to be the practitioner, or speak substantively to a live representative.',
          'Your only jobs are: identify an IVR menu choice that advances the stated objective; recognize queue/hold announcements; recognize a live human representative; otherwise wait.',
          'Return ONLY strict JSON: {"action":"press"|"wait"|"human"|"callback_offer"|"unknown","digit":null|"0"-"9"|"*"|"#","confidence":0-1,"reason":"short"}',
          'Only return press when the prompt itself clearly states an option matching the objective or a known route hint. Never guess a digit.',
          'Return human only for conversational language indicating an actual representative is speaking, not a recorded menu.'
        ].join('\n')},
        {role:'user',content:JSON.stringify({agency:session.agency,objective:session.objective,known_route_hints:hints,current_route_step:session.route_step||0,prompt})}
      ]
    })
  })
  if(!response.ok) return {action:'unknown',confidence:0,reason:'Classifier request failed'}
  const data=await response.json()
  const raw=String(data?.choices?.[0]?.message?.content||'')
  try{
    const m=raw.match(/\{[\s\S]*\}/)
    const parsed=JSON.parse(m?m[0]:raw)
    const action=['press','wait','human','callback_offer','unknown'].includes(parsed.action)?parsed.action:'unknown'
    const digit=/^[0-9*#]$/.test(String(parsed.digit||''))?String(parsed.digit):null
    const confidence=Math.max(0,Math.min(1,Number(parsed.confidence)||0))
    if(action==='press'&&(!digit||confidence<.82)) return {action:'unknown',confidence,reason:'Press confidence below threshold'}
    if(action==='human'&&confidence<.9) return {action:'unknown',confidence,reason:'Human confidence below threshold'}
    return {action,digit,confidence,reason:String(parsed.reason||'').slice(0,240)}
  }catch{return {action:'unknown',confidence:0,reason:'Classifier returned invalid JSON'}}
}

serve(async req=>{
  if(!['GET','POST'].includes(req.method)) return xml('<Hangup/>',405)
  const u=new globalThis.URL(req.url),id=u.searchParams.get('session')||'',token=u.searchParams.get('token')||''
  const db=createClient(SUPABASE_URL,SERVICE)
  const {data:session}=await db.from('ai_government_call_sessions').select('*').eq('id',id).eq('callback_token',token).limit(1).maybeSingle()
  if(!session) return xml('<Hangup/>',403)
  if(['completed','failed','cancelled'].includes(session.status)) return xml('<Hangup/>')

  let prompt=''
  if(req.method==='POST'){
    const ct=req.headers.get('content-type')||''
    if(ct.includes('application/x-www-form-urlencoded')||ct.includes('multipart/form-data')){
      const form=await req.formData().catch(()=>null)
      prompt=String(form?.get('SpeechResult')||form?.get('speech_result')||'').trim()
    }else{
      const body=await req.json().catch(()=>({}))
      prompt=String(body?.SpeechResult||body?.speech_result||'').trim()
    }
  }

  const self=`${SUPABASE_URL}/functions/v1/ai-government-call-leg?session=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`
  if(!prompt){
    await db.from('ai_government_call_sessions').update({status:session.status==='dialing'?'navigating':session.status,updated_at:new Date().toISOString()}).eq('id',id)
    return xml(gather(self))
  }

  const choice=await decide(prompt,session)
  const now=new Date().toISOString()
  const baseUpdate:any={last_prompt:prompt.slice(0,4000),last_action:choice.action,confidence:Number(choice.confidence||0)*100,updated_at:now}
  let event:any={tenant_id:session.tenant_id,session_id:id,event_type:choice.action,prompt_text:prompt.slice(0,4000),action:choice.action,confidence:Number(choice.confidence||0)*100,meta:{reason:choice.reason}}

  if(choice.action==='callback_offer'){
    // A callback is not yet registered: the IRS may require a number,
    // verification, or explicit confirmation. Never assume a return is booked.
    baseUpdate.status='holding'
    baseUpdate.last_action='callback_offered'
    await db.from('ai_government_call_sessions').update(baseUpdate).eq('id',id)
    await db.from('ai_government_call_events').insert({...event,event_type:'callback_offered',action:'needs_staff_confirmation'})
    return xml(gather(self))
  }

  if(choice.action==='human'){
    baseUpdate.status='human_detected';baseUpdate.human_detected_at=now
    await db.from('ai_government_call_sessions').update(baseUpdate).eq('id',id)
    await db.from('ai_government_call_events').insert(event)
    if(session.outbound_call_id) await db.from('outbound_calls').update({status:'connected'}).eq('id',session.outbound_call_id)
    const cb=`${SUPABASE_URL}/functions/v1/call-recorded?tenant=${encodeURIComponent(session.tenant_id)}&amp;conf=${encodeURIComponent(session.conference_name)}`
    return xml(`<Say voice="Polly.Ruth-Neural" language="en-US">Thank you. One moment while I connect you to the tax professional.</Say><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" record="record-from-start" recordingStatusCallback="${cb}">${esc(session.conference_name)}</Conference></Dial>`)
  }

  if(choice.action==='press'&&choice.digit){
    baseUpdate.status='navigating';baseUpdate.route_step=Number(session.route_step||0)+1
    event.digit=choice.digit
    await db.from('ai_government_call_sessions').update(baseUpdate).eq('id',id)
    await db.from('ai_government_call_events').insert(event)
    return xml(`<Play digits="w${esc(choice.digit)}"/><Pause length="1"/>${gather(self)}`)
  }

  baseUpdate.status=choice.action==='wait'?'holding':'navigating'
  await db.from('ai_government_call_sessions').update(baseUpdate).eq('id',id)
  await db.from('ai_government_call_events').insert(event)
  return xml(gather(self))
})

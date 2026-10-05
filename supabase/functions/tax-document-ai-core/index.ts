import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS})
const MODEL='qwen/qwen3.8-27b'
const CHAT_MODEL='openai/gpt-oss-120b'
const MAX_TEXT=180000
const MAX_IMAGES=12
const PROJECTS:Record<string,{url:string,anon:string}>={
  mpxgxfqdbquzkrvvejkh:{
    url:'https://mpxgxfqdbquzkrvvejkh.supabase.co',
    anon:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoibXB4Z3hmcWRicXV6a3J2dmVqa2giLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc3OTI5OTkzOSwiZXhwIjoyMDk0ODc1OTM5fQ.puvhU1MV5nGOykizeTkwCpRR7NKKaGsVpA8oqjVjmu4',
  },
  ydrvncdedgjtcprczwpu:{
    url:'https://ydrvncdedgjtcprczwpu.supabase.co',
    anon:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlIiwicmVmIjoieWRydm5jZGVkZ2p0Y3ByY3p3cHUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc4NjgwOTM1NCwiZXhwIjoyMTAyMzg1MzU0fQ.k6_dSA6HREDufH_dxGH9KFrdmwx4EnfV1v3pA1VsGag',
  },
}

const SYSTEM=`You are the document intelligence engine for a tax resolution CRM.
Return ONLY valid JSON. Never invent values. Never expose full SSNs, EINs, TINs, routing numbers, or account numbers; keep only last four digits.
Classify and extract useful facts from tax returns, IRS/state notices, W-2s, 1099s, transcripts, bank statements, pay stubs, financial statements, business records, spreadsheets, images, and Profit & Loss statements.

For Profit & Loss / P&L / income statements, extract when present: statement period, business/entity name, total revenue/income, COGS, gross profit, payroll/labor, rent, taxes/licenses, insurance, interest, depreciation/amortization, major expense categories, total expenses, other income/expense, net income/loss, and comparative/monthly/quarterly/YTD columns.

JSON shape:
{
  "document_type":"string",
  "tax_year":2025,
  "summary":"short operational summary",
  "confidence":0.95,
  "facts":[{"category":"identity|income|balance|penalty|deadline|filing|property|payment|notice|account|spreadsheet|pnl|expense|asset|other","field_key":"snake_case","field_label":"label","value":null,"normalized_text":"safe display","source_page":1,"source_locator":"Sheet1!B7","source_excerpt":"brief masked excerpt","confidence":0.95}],
  "entities":[{"entity_type":"taxpayer|spouse|dependent|business|trust|estate|employer|property|agency|asset|other","display_name":"name","relationship":"relationship","identifiers":{"last4":"1234"},"attributes":{},"source_page":1,"source_locator":"locator","confidence":0.95}],
  "questions":[{"question":"specific unresolved question","reason":"why unresolved","priority":"low|normal|high|urgent"}]
}`

function cleanJson(raw:string){
  const t=String(raw||'').replace(/^\`\`\`json\s*/i,'').replace(/\`\`\`$/,'').trim()
  return JSON.parse(t||'{}')
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS})
  if(req.method!=='POST') return json({error:'method_not_allowed'},405)
  try{
    const auth=req.headers.get('Authorization')||''
    if(!auth.startsWith('Bearer ')) return json({error:'unauthorized'},401)
    const body=await req.json().catch(()=>null)
    const sourceProject=String(body?.sourceProject||'')
    const cfg=PROJECTS[sourceProject]
    if(!cfg) return json({error:'unsupported_source_project'},403)

    const caller=createClient(cfg.url,cfg.anon,{global:{headers:{Authorization:auth}}})
    const {data:{user},error:userErr}=await caller.auth.getUser()
    if(userErr||!user) return json({error:'invalid_source_session'},401)

    if(body?.mode==='chat'){
      const message=String(body?.message||'').trim().slice(0,8000)
      if(!message)return json({error:'message_required'},400)
      const context=String(body?.context||'').slice(0,12000)
      const history=Array.isArray(body?.history)?body.history.slice(-12).map((m:any)=>({role:m?.role==='assistant'?'assistant':'user',content:String(m?.content||'').slice(0,4000)})):[]
      const groq=Deno.env.get('GROQ_API_KEY')||''
      if(!groq)return json({error:'AI provider not configured'},503)
      const messages:any[]=[{role:'system',content:'You are a practical AI assistant for a tax resolution CRM. Help with tax resolution, IRS/state notices, case strategy, client communications, document findings, and CRM workflow. Never reveal full SSNs, EINs, TINs, bank or card numbers, credentials, or cross-tenant data. Do not silently change CRM data.'}]
      if(context)messages.push({role:'user',content:'Client/file context:\n'+context},{role:'assistant',content:'Context received.'})
      messages.push(...history,{role:'user',content:message})
      const upstream=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+groq},body:JSON.stringify({model:CHAT_MODEL,messages,max_tokens:1400,temperature:0.2})})
      const payload=await upstream.json().catch(()=>({}))
      if(!upstream.ok)return json({error:'AI provider request failed',provider_status:upstream.status},502)
      const reply=String(payload?.choices?.[0]?.message?.content||'').trim()
      if(!reply)return json({error:'empty_ai_response'},502)
      return json({ok:true,reply,model:CHAT_MODEL})
    }

    const text=String(body?.text||'').slice(0,MAX_TEXT)
    const images=Array.isArray(body?.images)?body.images.slice(0,MAX_IMAGES):[]
    if(!text.trim()&&!images.length) return json({error:'no_readable_content'},400)

    const groq=Deno.env.get('GROQ_API_KEY')||''
    if(!groq) return json({error:'AI provider not configured'},503)

    const userParts:any[]=[{type:'text',text:SYSTEM+'\n\nCRM context:\n'+String(body?.context||'').slice(0,4000)+(text?'\n\nDOCUMENT TEXT:\n'+text:'')}]
    for(const img of images){
      const media=String(img?.mediaType||'image/jpeg')
      const data=String(img?.data||'')
      if(!/^image\/(jpeg|png|webp)$/.test(media)||!data) continue
      userParts.push({type:'text',text:'Image source page '+String(img?.page||'unknown')})
      userParts.push({type:'image_url',image_url:{url:'data:'+media+';base64,'+data}})
    }

    const upstream=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+groq},
      body:JSON.stringify({
        model:MODEL,
        temperature:0,
        max_completion_tokens:7000,
        response_format:{type:'json_object'},
        messages:[
          {role:'system',content:'Return valid JSON only.'},
          {role:'user',content:userParts},
        ],
      }),
    })
    const raw=await upstream.text()
    if(!upstream.ok) return json({error:'AI provider request failed',provider_status:upstream.status},502)
    const payload=JSON.parse(raw)
    const answer=String(payload?.choices?.[0]?.message?.content||'{}')
    let parsed
    try{ parsed=cleanJson(answer) }catch{ return json({error:'AI returned invalid JSON'},502) }
    return json({ok:true,model:MODEL,result:parsed})
  }catch(err){
    console.error('tax-document-ai-core',err)
    return json({error:'AI core unavailable'},500)
  }
})

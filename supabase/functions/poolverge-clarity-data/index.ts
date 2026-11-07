// PoolVerge-only, authenticated Microsoft Clarity data export.
// Tracking ID identifies the public website; it is NOT an API credential.
// Set the separate POOLVERGE_CLARITY_API_TOKEN in Supabase Edge Function secrets.
// Cache aggregated data, no session recordings or visitor identifiers.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const projectId = 'z31rnrvbns'
const productId = 'pool_crm'
const cors = {
  'Access-Control-Allow-Origin': 'https://admin.romylabs.com',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}
function reply(body: Record<string,unknown>,status=200) {
  return new Response(JSON.stringify(body),{status,headers:cors})
}
const safeNumber=(value:unknown):number|null => {
  if(value===null||value===undefined||String(value).trim()==='')return null
  const n=Number(value)
  return Number.isFinite(n)&&n>=0?n:null
}
function parseMetrics(raw:unknown) {
  if(!Array.isArray(raw)) throw new Error('Unexpected Clarity report format')
  const result:Record<string,number|null>={sessions:null,botSessions:null,users:null,deadClicks:null,rageClicks:null,scriptErrors:null}
  const metrics:Record<string,string> = {
    'Dead Click Count':'deadClicks','Rage Click Count':'rageClicks',
    'Script Error Count':'scriptErrors',
  }
  for(const item of raw) {
    if(!item||typeof item!=='object')continue
    const name=String((item as any).metricName||'')
    const rows=Array.isArray((item as any).information)?(item as any).information:[]
    if(name==='Traffic') {
      const vals=rows.map((x:any)=>safeNumber(x?.totalSessionCount)).filter((x:number|null)=>x!==null) as number[]
      const bots=rows.map((x:any)=>safeNumber(x?.totalBotSessionCount)).filter((x:number|null)=>x!==null) as number[]
      const users=rows.map((x:any)=>safeNumber(x?.distinctUserCount??x?.distantUserCount)).filter((x:number|null)=>x!==null) as number[]
      if(vals.length)result.sessions=vals.reduce((a,b)=>a+b,0)
      if(bots.length)result.botSessions=bots.reduce((a,b)=>a+b,0)
      if(users.length)result.users=users.reduce((a,b)=>a+b,0)
    }
    if(metrics[name]) {
      const values=rows.map((x:any)=>safeNumber(x?.count??x?.totalCount??x?.value)).filter((x:number|null)=>x!==null) as number[]
      if(values.length)result[metrics[name]]=values.reduce((a,b)=>a+b,0)
    }
  }
  return result
}
serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST')return reply({error:'Method not allowed'},405)
  if(!url||!serviceKey||!anonKey) return reply({error:'Reporting configuration incomplete'},503)
  const auth=req.headers.get('authorization')||''
  if(!/^Bearer \S+$/.test(auth))return reply({error:'Authentication required'},401)
  const caller=createClient(url,anonKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const {data:admin,error:authError}=await caller.rpc('_is_platform_admin')
  if(authError||admin!==true)return reply({error:'Platform administrator required'},403)

  const supabase=createClient(url,serviceKey,{auth:{persistSession:false}})
  const {data:row,error:readError}=await supabase.from('romylabs_poolverge_clarity_cache')
    .select('metrics,fetched_at,attempted_at,last_error').eq('product_id',productId).maybeSingle()
  if(readError)return reply({error:'Clarity metrics cache unavailable'},503)
  const token=Deno.env.get('POOLVERGE_CLARITY_API_TOKEN')||''
  const base={project_id:projectId,product_id:productId,
    dashboard_url:'https://clarity.microsoft.com/projects/view/z31rnrvbns/dashboard',
    range_days:3, tracking_configured:true}
  const current=row?.metrics&&row?.fetched_at?{...base,connected:true,cached:true,
    metrics:row.metrics,synced_at:row.fetched_at}:null
  if(!token)return reply({...base,connected:false,api_status:'token_required',
    message:'Clarity tracking is installed. Data Export API token must be configured to show session metrics.',
    ...(current?{last_snapshot:current}: {})})
  // Clarity limits data exports to 10 requests/project/day. This atomic claim
  // permits at most one request per 12 hours even across concurrent page loads.
  const twelveHoursAgo=new Date(Date.now()-12*60*60*1000).toISOString()
  const {data:claim,error:claimError}=await supabase.from('romylabs_poolverge_clarity_cache')
    .update({attempted_at:new Date().toISOString()})
    .eq('product_id',productId).lt('attempted_at',twelveHoursAgo)
    .select('product_id').maybeSingle()
  if(claimError)return reply({error:'Clarity refresh throttle unavailable'},503)
  if(!claim) {
    return reply({...base,connected:!!current,cached:!!current,
      api_status:current?'cached':'pending',
      ...(current?{metrics:row!.metrics,synced_at:row!.fetched_at}:{}),
      ...(!current?{message:'Clarity sync in progress or next refresh pending'}:{})})
  }
  try {
    const response=await fetch('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3',{
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},
      signal:AbortSignal.timeout(14000),
    })
    if(!response.ok) throw new Error(response.status===401||response.status===403?
      'Clarity API token rejected or lacks project permission':
      response.status===429?'Clarity daily export quota exceeded':
      `Clarity export returned HTTP ${response.status}`)
    const raw=await response.json()
    const metrics=parseMetrics(raw)
    const syncedAt=new Date().toISOString()
    const {error:writeError}=await supabase.from('romylabs_poolverge_clarity_cache')
      .update({metrics,fetched_at:syncedAt,last_error:null}).eq('product_id',productId)
    if(writeError)throw new Error('Cannot persist verified Clarity analytics')
    // Mark "live" only after the provider actually returns recorded sessions.
    if(metrics.sessions!==null && metrics.sessions>0) {
      await supabase.from('product_traffic_channels')
        .update({status:'live',last_verified_at:syncedAt,updated_at:syncedAt,
          notes:'PoolVerge Clarity project verified through successful authenticated Data Export API session metrics.'})
        .eq('product_id',productId).eq('channel_key','clarity').eq('tracking_id',projectId)
    }
    return reply({...base,connected:true,cached:false,api_status:'live',
      metrics,synced_at:syncedAt})
  } catch(error) {
    const message=error instanceof Error?error.message:'Clarity export unavailable'
    await supabase.from('romylabs_poolverge_clarity_cache')
      .update({last_error:message.slice(0,240)}).eq('product_id',productId)
    return reply({...base,connected:!!current,cached:!!current,api_status:'error',
      message,...(current?{metrics:row!.metrics,synced_at:row!.fetched_at}:{})})
  }
})

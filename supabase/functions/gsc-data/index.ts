import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GSC_BASE = 'https://searchconsole.googleapis.com'
const ADMIN_TENANT = 'a0000000-0000-0000-0000-000000000001'
const CANONICAL_REDIRECT = 'https://admin.romylabs.com/crm-admin/command-center'
const LIVE_PRODUCTS = ['taxres_crm','romylabs','camvella','arcvena','bocasync','groundivo','oculivo','restore_relay']
const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}

const GSC_SITE_CANDIDATES: Record<string,string[]> = {
  romylabs:['sc-domain:romylabs.com','https://romylabs.com/','https://www.romylabs.com/'],
  taxres_crm:['sc-domain:taxrescrm.net','https://taxrescrm.net/','https://www.taxrescrm.net/'],
  camvella:['sc-domain:camvella.com','https://camvella.com/','https://www.camvella.com/'],
  arcvena:['sc-domain:arcvena.com','https://arcvena.com/','https://www.arcvena.com/'],
  bocasync:['sc-domain:bocasync.com','https://bocasync.com/','https://www.bocasync.com/'],
  groundivo:['sc-domain:groundivo.com','https://groundivo.com/','https://www.groundivo.com/'],
  oculivo:['sc-domain:oculivo.com','https://oculivo.com/','https://www.oculivo.com/'],
  restore_relay:['sc-domain:restorerelay.com','https://restorerelay.com/','https://www.restorerelay.com/'],
}

function hostOf(site:string){
  if(site.startsWith('sc-domain:')) return site.slice('sc-domain:'.length).toLowerCase()
  try{return new URL(site).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}
}

async function resolveSiteUrl(token:string, productKey:string){
  const candidates=GSC_SITE_CANDIDATES[productKey]
  if(!candidates) throw new Error('Unsupported reporting product')
  const r=await fetch(`${GSC_BASE}/webmasters/v3/sites`,{headers:{Authorization:`Bearer ${token}`}})
  const d=await r.json()
  if(!r.ok) throw new Error(d?.error?.message||'Could not list Search Console properties')
  const sites=d.siteEntry||[]
  const exact=candidates.find(c=>sites.some((s:any)=>s.siteUrl===c))
  if(exact) return exact
  const target=hostOf(candidates[0])
  const same=sites.find((s:any)=>hostOf(s.siteUrl||'')===target)
  if(same?.siteUrl) return same.siteUrl
  throw new Error(`Google account does not have Search Console access to ${target}`)
}

async function getOAuthToken(supabase:any,settings:any){
  const expiry=settings.gsc_token_expiry?new Date(settings.gsc_token_expiry).getTime():0
  if(settings.gsc_access_token && expiry>Date.now()+60000) return settings.gsc_access_token as string
  if(!settings.gsc_refresh_token) throw new Error('REAUTH_REQUIRED:NO_REFRESH_TOKEN')
  const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
    refresh_token:settings.gsc_refresh_token,
    client_id:settings.gmail_client_id,
    client_secret:settings.gmail_client_secret,
    grant_type:'refresh_token'
  })})
  const d=await r.json()
  if(!r.ok) throw new Error(`REAUTH_REQUIRED:${d?.error||'refresh_failed'}:${d?.error_description||''}`)
  const expiresAt=new Date(Date.now()+(d.expires_in||3600)*1000).toISOString()
  const {error}=await supabase.from('settings').update({
    gsc_access_token:d.access_token,
    gsc_token_expiry:expiresAt,
    gmail_redirect_uri:CANONICAL_REDIRECT
  }).eq('tenant_id',ADMIN_TENANT)
  if(error) throw error
  return d.access_token as string
}

async function fetchLive(token:string,siteUrl:string,productKey:string){
  const end=new Date()
  const start=new Date(end); start.setDate(start.getDate()-28)
  const prevEnd=new Date(start); prevEnd.setDate(prevEnd.getDate()-1)
  const prevStart=new Date(prevEnd); prevStart.setDate(prevStart.getDate()-28)
  const fmt=(d:Date)=>d.toISOString().slice(0,10)
  const post=async(body:any)=>{
    const r=await fetch(`${GSC_BASE}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)
    })
    const d=await r.json()
    if(!r.ok) throw new Error(d?.error?.message||`GSC query failed for ${siteUrl}`)
    return d
  }
  const [cur,prev,queries]=await Promise.all([
    post({startDate:fmt(start),endDate:fmt(end),dimensions:[]}),
    post({startDate:fmt(prevStart),endDate:fmt(prevEnd),dimensions:[]}),
    post({startDate:fmt(start),endDate:fmt(end),dimensions:['query'],rowLimit:10}),
  ])
  const c=cur.rows?.[0]||{}, p=prev.rows?.[0]||{}
  const pct=(a:number,b:number)=>b?Math.round(((a-b)/b)*100):0
  return {
    mock:false,connected:true,degraded:false,cached:false,dataAvailable:true,product_key:productKey,siteUrl,
    impressions:Math.round(c.impressions||0),impressionsChange:pct(c.impressions||0,p.impressions||0),
    clicks:Math.round(c.clicks||0),clicksChange:pct(c.clicks||0,p.clicks||0),
    ctr:Math.round((c.ctr||0)*1000)/10,ctrChange:Math.round(((c.ctr||0)-(p.ctr||0))*1000)/10,
    avgPosition:Math.round((c.position||0)*10)/10,posChange:Math.round(((p.position||0)-(c.position||0))*10)/10,
    topQueries:(queries.rows||[]).map((r:any)=>({query:r.keys?.[0]||'',pos:Math.round((r.position||0)*10)/10,clicks:Math.round(r.clicks||0),impressions:Math.round(r.impressions||0)})),
    dataThrough:fmt(end),syncedAt:new Date().toISOString(),authMode:'oauth'
  }
}

async function saveSnapshot(supabase:any,x:any){
  const {error}=await supabase.from('marketing_gsc_snapshots').upsert({
    product_id:x.product_key,site_url:x.siteUrl,impressions:x.impressions,clicks:x.clicks,ctr:x.ctr,
    avg_position:x.avgPosition,top_queries:x.topQueries,data_through:x.dataThrough,synced_at:x.syncedAt,
    source:'google_search_console'
  },{onConflict:'product_id'})
  if(error) throw error
  await supabase.from('product_traffic_channels').update({status:'live',last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq('product_id',x.product_key).eq('channel_key','search_console')
}

async function readSnapshot(supabase:any,productKey:string,reason:string){
  const {data}=await supabase.from('marketing_gsc_snapshots').select('*').eq('product_id',productKey).maybeSingle()
  if(!data) return {
    mock:true,connected:false,reauth_required:true,degraded:true,cached:false,dataAvailable:false,reason,
    product_key:productKey,siteUrl:GSC_SITE_CANDIDATES[productKey]?.[0]||'',
    impressions:null,clicks:null,ctr:null,avgPosition:null,topQueries:[]
  }
  return {
    mock:false,connected:true,reauth_required:true,degraded:true,cached:true,dataAvailable:true,reason,
    product_key:productKey,siteUrl:data.site_url,impressions:Number(data.impressions),impressionsChange:0,
    clicks:Number(data.clicks),clicksChange:0,ctr:Number(data.ctr),ctrChange:0,avgPosition:Number(data.avg_position),
    posChange:0,topQueries:data.top_queries||[],dataThrough:data.data_through,cachedAt:data.synced_at
  }
}

async function syncAll(supabase:any,token:string){
  const results:Record<string,any>={}
  for(const key of LIVE_PRODUCTS){
    try{
      const siteUrl=await resolveSiteUrl(token,key)
      const live=await fetchLive(token,siteUrl,key)
      await saveSnapshot(supabase,live)
      results[key]=live
    }catch(e:any){
      results[key]={error:String(e?.message||e)}
    }
  }
  return results
}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})
  const supabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY)
  try{
    const body=await req.json().catch(()=>({}))
    const {action,code,product_key='taxres_crm'}=body
    if(!GSC_SITE_CANDIDATES[product_key]) return json({error:'Unsupported reporting product'},400)
    const {data:settings,error}=await supabase.from('settings').select('*').eq('tenant_id',ADMIN_TENANT).maybeSingle()
    if(error||!settings) return json({error:'Could not load Search Console settings'},500)
    if(settings.gmail_redirect_uri!==CANONICAL_REDIRECT){
      await supabase.from('settings').update({gmail_redirect_uri:CANONICAL_REDIRECT}).eq('tenant_id',ADMIN_TENANT)
    }

    if(action==='connect'){
      if(!code) return json({error:'Missing OAuth authorization code'},400)
      const r=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
        code,client_id:settings.gmail_client_id,client_secret:settings.gmail_client_secret,
        redirect_uri:CANONICAL_REDIRECT,grant_type:'authorization_code'
      })})
      const d=await r.json()
      if(!r.ok) return json({error:d.error_description||d.error||'OAuth exchange failed'},400)
      const refreshToken=d.refresh_token||settings.gsc_refresh_token
      if(!refreshToken) return json({error:'Google did not return a refresh token'},400)
      const expiresAt=new Date(Date.now()+(d.expires_in||3600)*1000).toISOString()
      const {error:updateError}=await supabase.from('settings').update({
        gsc_refresh_token:refreshToken,gsc_access_token:d.access_token,gsc_token_expiry:expiresAt,
        gmail_redirect_uri:CANONICAL_REDIRECT
      }).eq('tenant_id',ADMIN_TENANT)
      if(updateError) return json({error:updateError.message},500)
      const all=await syncAll(supabase,d.access_token)
      const selected=all[product_key]
      if(selected?.error) return json({error:selected.error,connected:false},400)
      return json({...selected,all_synced:Object.keys(all).filter(k=>!all[k]?.error)})
    }

    try{
      const token=await getOAuthToken(supabase,settings)
      const siteUrl=await resolveSiteUrl(token,product_key)
      const live=await fetchLive(token,siteUrl,product_key)
      await saveSnapshot(supabase,live)
      return json(live)
    }catch(e:any){
      const reason=String(e?.message||e)
      console.error('[gsc-data] live fetch unavailable',product_key,reason)
      return json(await readSnapshot(supabase,product_key,reason))
    }
  }catch(e:any){
    console.error('[gsc-data] fatal',e)
    return json({error:String(e?.message||e)},500)
  }
})

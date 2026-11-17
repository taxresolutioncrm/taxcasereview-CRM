{"id":"1e86132c-1018-47c4-8eb4-f0f4b57cd64e","slug":"gsc-sync","name":"gsc-sync","status":"ACTIVE","version":17,"created_at":1787095775978,"updated_at":1787946627068,"verify_jwt":false,"import_map":false,"entrypoint_path":"/tmp/user_fn_mpxgxfqdbquzkrvvejkh_1e86132c-1018-47c4-8eb4-f0f4b57cd64e_12/source/index.ts","ezbr_sha256":"d4d7a61faa01207fceb0a93d3bc489c7811b10a3cb96cb64f746a683cdf85353","files":[{"name":"index.ts","content":"import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n\nconst cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-internal-cron-token' }\nconst TOKEN_URL='https://oauth2.googleapis.com/token'\nconst GSC_BASE='https://searchconsole.googleapis.com'\nconst ADMIN_TENANT='a0000000-0000-0000-0000-000000000001'\n
const LIVE_PRODUCTS=['taxres_crm','romylabs','camvella','arcvena','bocasync','groundivo','oculivo','restore_relay','pool_crm','settlelift','barbers_salons']
const GSC_SITE_CANDIDATES:Record<string,string[]>={
 romylabs:['sc-domain:romylabs.com','https://romylabs.com/','https://www.romylabs.com/'],
 taxres_crm:['sc-domain:taxrescrm.net','https://taxrescrm.net/','https://www.taxrescrm.net/'],
 camvella:['sc-domain:camvella.com','https://camvella.com/','https://www.camvella.com/'],
 arcvena:['sc-domain:arcvena.com','https://arcvena.com/','https://www.arcvena.com/'],
 bocasync:['sc-domain:bocasync.com','https://bocasync.com/','https://www.bocasync.com/'],
 groundivo:['sc-domain:groundivo.com','https://groundivo.com/','https://www.groundivo.com/'],
 oculivo:['sc-domain:oculivo.com','https://oculivo.com/','https://www.oculivo.com/'],
 restore_relay:['sc-domain:restorerelay.com','https://restorerelay.com/','https://www.restorerelay.com/'],
 pool_crm:['sc-domain:poolverge.com','https://poolverge.com/','https://www.poolverge.com/'],
 settlelift:['sc-domain:settlelift.com','https://settlelift.com/','https://www.settlelift.com/'],
 barbers_salons:['sc-domain:chairstyle.net','https://chairstyle.net/','https://www.chairstyle.net/'],
}
function hostOf(site:string){if(site.startsWith('sc-domain:'))return site.slice(10).toLowerCase();try{return new URL(site).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}}
async function resolveSiteUrl(token:string,productKey:string){
 const candidates=GSC_SITE_CANDIDATES[productKey];if(!candidates)throw new Error('Unsupported reporting product')
 const r=await fetch(`${GSC_BASE}/webmasters/v3/sites`,{headers:{Authorization:`Bearer ${token}`}});const d=await r.json()
 if(!r.ok)throw new Error(d?.error?.message||'Could not list Search Console properties')
 const sites=d.siteEntry||[];const exact=candidates.find(c=>sites.some((s:any)=>s.siteUrl===c));if(exact)return exact
 const target=hostOf(candidates[0]);const same=sites.find((s:any)=>hostOf(s.siteUrl||'')===target);if(same?.siteUrl)return same.siteUrl
 throw new Error(`Google account does not have Search Console access to ${target}`)
}
async function fetchSnapshot(token:string,siteUrl:string,productKey:string){
 const end=new Date();end.setUTCHours(12,0,0,0);end.setUTCDate(end.getUTCDate()-2)
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-89)
 const post=async(body:any)=>gscQuery(token,siteUrl,body)
 const [cur,queries]=await Promise.all([
  post({startDate:fmt(start),endDate:fmt(end),dimensions:[]}),
  post({startDate:fmt(start),endDate:fmt(end),dimensions:['query'],rowLimit:250})
 ])
 const c=cur.rows?.[0]||{}
 return {product_key:productKey,siteUrl,impressions:Math.round(c.impressions||0),clicks:Math.round(c.clicks||0),
  ctr:Math.round((c.ctr||0)*1000)/10,avgPosition:Math.round((c.position||0)*10)/10,
  topQueries:(queries.rows||[]).map((r:any)=>({query:r.keys?.[0]||'',pos:Math.round((r.position||0)*10)/10,clicks:Math.round(r.clicks||0),impressions:Math.round(r.impressions||0)})).filter((r:any)=>r.query).sort((a:any,b:any)=>b.impressions-a.impressions||b.clicks-a.clicks||a.pos-b.pos).slice(0,10),
  dataThrough:fmt(end),syncedAt:new Date().toISOString()}
}
async function saveSnapshot(supabase:any,x:any){
 const {error}=await supabase.from('marketing_gsc_snapshots').upsert({product_id:x.product_key,site_url:x.siteUrl,impressions:x.impressions,clicks:x.clicks,ctr:x.ctr,avg_position:x.avgPosition,top_queries:x.topQueries,data_through:x.dataThrough,synced_at:x.syncedAt,source:'google_search_console'},{onConflict:'product_id'})
 if(error)throw error
 await supabase.from('product_traffic_channels').update({status:'live',last_verified_at:x.syncedAt,updated_at:x.syncedAt,notes:`Verified live by scheduled Google Search Console sync through ${x.dataThrough}: ${x.impressions} impressions, ${x.clicks} clicks.`}).eq('product_id',x.product_key).eq('channel_key','search_console')
}

const COMMERCIAL_PAGES=['/tax-resolution-crm','/tax-resolution-software','/crm-for-enrolled-agents','/tax-resolution-case-management-software','/canopy-alternative','/taxdome-alternative','/demo','/resources']\nconst fmt=(d:Date)=>d.toISOString().slice(0,10)\nconst json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}})\n\nasync function getValidToken(supabase:any,settings:any){\n const expiry=settings.gsc_token_expiry?new Date(settings.gsc_token_expiry).getTime():0\n if(settings.gsc_access_token&&expiry>Date.now()+60000)return settings.gsc_access_token\n const res=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:settings.gsc_refresh_token,client_id:settings.gmail_client_id,client_secret:settings.gmail_client_secret,grant_type:'refresh_token'})})\n const data=await res.json();if(!res.ok)throw new Error(`GSC token refresh failed: ${data.error_description||data.error}`)\n const expiresAt=new Date(Date.now()+(data.expires_in||3600)*1000).toISOString()\n await supabase.from('settings').update({gsc_access_token:data.access_token,gsc_token_expiry:expiresAt}).eq('tenant_id',ADMIN_TENANT)\n return data.access_token\n}\nasync function gscQuery(token:string,siteUrl:string,body:Record<string,unknown>){const res=await fetch(`${GSC_BASE}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data?.error?.message||`GSC query failed (${res.status})`);return data}\n\nDeno.serve(async req=>{\n if(req.method==='OPTIONS')return new Response('ok',{headers:cors})\n if(req.method!=='POST')return json({error:'Method not allowed'},405)\n const URL=Deno.env.get('SUPABASE_URL')!,SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,supabase=createClient(URL,SERVICE)\n const internal=req.headers.get('authorization')===`Bearer ${SERVICE}`\n let allowed=internal\n if(!allowed){const token=req.headers.get('x-internal-cron-token')||'';if(token){const{data}=await supabase.rpc('verify_internal_cron_token',{provided:token});allowed=data===true}}\n if(!allowed)return json({error:'Unauthorized'},401)\n let body:Record<string,unknown>={};try{body=await req.json()}catch{}\n const days=Math.min(Math.max(Number(body.days)||90,1),365),testMode=body.test===true,now=new Date()\n try{\n  const{data:settings,error:settErr}=await supabase.from('settings').select('gsc_refresh_token,gsc_access_token,gsc_token_expiry,gsc_site_url,gmail_client_id,gmail_client_secret').eq('tenant_id',ADMIN_TENANT).single()\n  if(settErr||!settings)throw new Error('Could not read admin settings row')\n  if(!settings.gsc_refresh_token)throw new Error('No GSC refresh token — OAuth not connected')\n  if(!settings.gsc_site_url)throw new Error('No GSC site URL configured')\n  const token=await getValidToken(supabase,settings),siteUrl=settings.gsc_site_url\n  const endDate=new Date(now);endDate.setDate(endDate.getDate()-3);const startDate=new Date(endDate);startDate.setDate(startDate.getDate()-days)\n  const queryData=await gscQuery(token,siteUrl,{startDate:fmt(startDate),endDate:fmt(endDate),dimensions:['date','query'],rowLimit:5000})\n  const queryRows=(queryData.rows||[]).map((row:any)=>({date:row.keys[0],query:row.keys[1],clicks:Math.round(row.clicks||0),impressions:Math.round(row.impressions||0),ctr:Number((row.ctr||0).toFixed(4)),position:Number((row.position||0).toFixed(2)),page:null,synced_at:now.toISOString()}))\n  const pageData=await gscQuery(token,siteUrl,{startDate:fmt(startDate),endDate:fmt(endDate),dimensions:['date','page'],rowLimit:2000})\n  const pageRows:any[]=[];for(const row of pageData.rows||[]){let page=row.keys[1];try{page=new URL(page).pathname}catch{}if(!COMMERCIAL_PAGES.some(p=>page.startsWith(p))&&page!=='/')continue;pageRows.push({date:row.keys[0],query:`[page] ${page}`,clicks:Math.round(row.clicks||0),impressions:Math.round(row.impressions||0),ctr:Number((row.ctr||0).toFixed(4)),position:Number((row.position||0).toFixed(2)),page,synced_at:now.toISOString()})}\n  if(testMode)return json({ok:true,test:true,total_query:queryRows.length,total_page:pageRows.length,site_url:siteUrl,date_range:{start:fmt(startDate),end:fmt(endDate)}})\n  const allRows=[...queryRows,...pageRows];let inserted=0;for(let i=0;i<allRows.length;i+=500){const batch=allRows.slice(i,i+500);const{error}=await supabase.from('marketing_gsc_performance').upsert(batch,{onConflict:'date,query'});if(error)console.error('[gsc-sync] upsert',error.message);else inserted+=batch.length}\n  const product_snapshots:Record<string,any>={}
  for(const productKey of LIVE_PRODUCTS){
   try{
    const productSite=await resolveSiteUrl(token,productKey)
    const snap=await fetchSnapshot(token,productSite,productKey)
    await saveSnapshot(supabase,snap)
    product_snapshots[productKey]={ok:true,site_url:productSite,impressions:snap.impressions,clicks:snap.clicks,data_through:snap.dataThrough}
   }catch(e:any){
    const reason=String(e?.message||e)
    product_snapshots[productKey]={ok:false,error:reason}
    await supabase.from('product_traffic_channels').update({status:'degraded',updated_at:new Date().toISOString(),notes:`Scheduled Search Console sync failed: ${reason}`}).eq('product_id',productKey).eq('channel_key','search_console')
   }
  }
  return json({ok:true,site_url:siteUrl,date_range:{start:fmt(startDate),end:fmt(endDate)},query_rows:queryRows.length,page_rows:pageRows.length,upserted:inserted,synced_at:now.toISOString(),product_snapshots})\n }catch(err:any){console.error('[gsc-sync]',err.message);return json({ok:false,error:err.message},500)}\n})"}]}
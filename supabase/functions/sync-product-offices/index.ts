import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'https://admin.romylabs.com',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-internal-cron-token',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})

const ENDPOINTS:Record<string,string>={
  camvella:'https://fjqywulzsyfyzitneazb.supabase.co/functions/v1/platform-metrics',
  arcvena:'https://wzalqfxovxxszojfbnis.supabase.co/functions/v1/platform-metrics',
  bocasync:'https://zmejbkttzvaqzzbmjclz.supabase.co/functions/v1/platform-metrics',
  groundivo:'https://ydhmlphyvjgryefuwzyq.supabase.co/functions/v1/platform-metrics',
  oculivo:'https://czejdbdwaumbdepiswcu.supabase.co/functions/v1/platform-metrics',
  restore_relay:'https://yuwxzuybzuqnnldvdenx.supabase.co/functions/v1/platform-metrics',
}
const SUPPORT_SECRET_ENV:Record<string,string>={
  arcvena:'ARCVENA_SUPPORT_SECRET',
  groundivo:'GROUNDIVO_SUPPORT_SECRET',
  oculivo:'OCULIVO_SUPPORT_SECRET',
  restore_relay:'RESTORE_RELAY_SUPPORT_SECRET',
}
const allowedProducts=new Set(Object.keys(ENDPOINTS))
const badName=(name:string)=>/lifecycle closeout|acceptance test|^qa\b|\bqa\b|platform-stage-test/i.test(name)

async function authorize(req:Request,admin:any,url:string,anon:string){
  const internal=req.headers.get('x-internal-cron-token')||''
  if(internal){
    const {data,error}=await admin.rpc('verify_internal_cron_token',{provided:internal})
    if(!error&&data===true)return {ok:true,userJwt:null,mode:'cron'}
  }
  const auth=req.headers.get('authorization')||''
  if(!auth.startsWith('Bearer '))return {ok:false,userJwt:null,mode:'none'}
  const jwt=auth.slice(7)
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:{user},error}=await caller.auth.getUser(jwt)
  if(error||!user)return {ok:false,userJwt:null,mode:'none'}
  const {data:isAdmin}=await caller.rpc('_is_platform_admin')
  if(isAdmin!==true)return {ok:false,userJwt:null,mode:'none'}
  return {ok:true,userJwt:jwt,mode:'user'}
}

async function fetchProduct(product:string,userJwt:string|null){
  const headers:Record<string,string>={'Content-Type':'application/json'}
  if(product==='camvella'){
    if(!userJwt)return {ok:false,error:'Camvella requires an authenticated platform-admin sync'}
    headers.Authorization='Bearer '+userJwt
  }else if(product==='bocasync'){
    const s=Deno.env.get('HUB_METRICS_SECRET')||''
    if(!s)return {ok:false,error:'HUB_METRICS_SECRET missing'}
    headers['x-hub-secret']=s
  }else{
    const envKey=SUPPORT_SECRET_ENV[product]
    const productSecret=envKey?Deno.env.get(envKey)||'':''
    const hubSecret=Deno.env.get('HUB_METRICS_SECRET')||''
    if(product==='arcvena'){
      const s=productSecret||hubSecret
      if(!s)return {ok:false,error:'Arcvena metrics credential missing'}
      if(productSecret)headers['x-arcvena-support-secret']=productSecret
      else headers['x-hub-secret']=hubSecret
    }else{
      const s=productSecret||hubSecret
      if(!s)return {ok:false,error:(envKey||'metrics credential')+' missing'}
      if(productSecret)headers['x-romylabs-support-secret']=productSecret
      else headers['x-hub-secret']=hubSecret
    }
  }
  try{
    const res=await fetch(ENDPOINTS[product],{method:'GET',headers})
    const body=await res.json().catch(()=>({}))
    if(!res.ok||body?.ok===false)return {ok:false,error:String(body?.error||('HTTP '+res.status))}
    return {ok:true,body}
  }catch(e){
    return {ok:false,error:String((e as Error)?.message||e)}
  }
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const url=Deno.env.get('SUPABASE_URL')||''
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
  if(!url||!service||!anon)return json({error:'Server configuration missing'},500)
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const auth=await authorize(req,admin,url,anon)
  if(!auth.ok)return json({error:'Platform admin or internal cron authorization required'},401)

  const body=await req.json().catch(()=>({}))
  const requested=Array.isArray(body.products)?body.products.map((x:any)=>String(x).toLowerCase()):[]
  const products=(requested.length?requested:Object.keys(ENDPOINTS)).filter((x:string)=>allowedProducts.has(x))
  const results:any[]=[]

  for(const product of products){
    const remote=await fetchProduct(product,auth.userJwt)
    if(!remote.ok){results.push({product,ok:false,error:remote.error});continue}
    const offices=Array.isArray(remote.body?.offices)?remote.body.offices:[]
    let upserted=0,skipped=0
    for(const office of offices){
      const id=String(office?.id||'').trim()
      const name=String(office?.name||'').trim()
      if(!id||!name||badName(name)){skipped++;continue}
      const active=office?.is_active!==false
      const status=active?'active':'inactive'
      const metadata={
        source:'platform_metrics_sync',
        subscription_status:office?.subscription_status??null,
        since:office?.since??null,
        mrr:office?.mrr??null,
        synced_at:new Date().toISOString(),
      }
      const {error}=await admin.from('romylabs_office_registry').upsert({
        product_key:product,
        external_office_id:id,
        firm_name:name,
        monthly_amount:office?.mrr==null?null:Number(office.mrr),
        status,
        metadata,
        updated_at:new Date().toISOString(),
      },{onConflict:'product_key,external_office_id'})
      if(error){results.push({product,ok:false,error:'Registry upsert failed: '+error.message,office_id:id});continue}
      upserted++
    }
    results.push({product,ok:true,discovered:offices.length,upserted,skipped})
  }

  return json({ok:results.every(x=>x.ok!==false),mode:auth.mode,results})
})

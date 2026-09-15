import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})

serve(async(req)=>{
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!service) return json({error:'Server config missing'},500)
    const auth=req.headers.get('authorization')||''
    if(auth!==`Bearer ${service}`) return json({error:'Unauthorized'},401)
    const db=createClient(url,service)

    const candidates=['taxres_crm','arcvena','bocasync']
    const target='info@romylabs.com'
    const results:any[]=[]

    for(const product of candidates){
      const {data:t}=await db.rpc('romylabs_stalwart_transport_for_product',{p_product_key:product})
      if(!t?.ok){results.push({product,available:false,target_authorized:false,error:t?.error||'transport_unavailable'});continue}
      const base='https://'+String(t.host||'mail.taxrescrm.net').replace(/^https?:\/\//,'').replace(/\/$/,'')
      const basic='Basic '+btoa(String(t.username)+':'+String(t.password))
      const sres=await fetch(base+'/.well-known/jmap',{headers:{Authorization:basic,Accept:'application/json'}})
      if(!sres.ok){results.push({product,available:true,target_authorized:false,error:`session_${sres.status}`});continue}
      const session=await sres.json()
      const apiUrl=String(session?.apiUrl||'').replace('{accountId}','')
      const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
      if(!apiUrl||!accountId){results.push({product,available:true,target_authorized:false,error:'session_missing_account'});continue}
      const mres=await fetch(apiUrl,{method:'POST',headers:{Authorization:basic,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
        using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
        methodCalls:[['Identity/get',{accountId},'i0']]
      })})
      if(!mres.ok){results.push({product,available:true,target_authorized:false,error:`identity_${mres.status}`});continue}
      const meta=await mres.json()
      const ids=meta?.methodResponses?.find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list||[]
      results.push({product,available:true,target_authorized:ids.some((x:any)=>String(x?.email||'').toLowerCase()===target),identities:ids.map((x:any)=>String(x?.email||'').toLowerCase()).filter(Boolean)})
    }

    return json({ok:true,target,results})
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
})

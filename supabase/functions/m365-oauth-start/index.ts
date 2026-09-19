import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const APP_URL='https://nashville.taxrescrm.app'
const cors={'Access-Control-Allow-Origin':APP_URL,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}

function b64url(input:Uint8Array|string){
  const bytes=typeof input==='string'?new TextEncoder().encode(input):input
  let s=''; for(const b of bytes)s+=String.fromCharCode(b)
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
async function sign(secret:string,payload:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)))
  return b64url(sig)
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})
  if(req.method!=='POST')return json({error:'POST only'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const auth=req.headers.get('Authorization')||''
    if(!url||!anon||!service||!auth.startsWith('Bearer '))return json({error:'Microsoft 365 connection is unavailable.'},503)

    const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}})
    const {data:{user},error:uErr}=await caller.auth.getUser()
    if(uErr||!user?.email)return json({error:'Invalid session'},401)

    const admin=createClient(url,service)
    const {data:emp}=await admin.from('employees')
      .select('email,status,tenant_id,perm_comms')
      .eq('tenant_id',TENANT).eq('status','Active').ilike('email',user.email).maybeSingle()
    if(!emp)return json({error:'No active Nashville employee profile found.'},403)
    if(Number(emp.perm_comms||0)<1)return json({error:'Email access is not enabled for this employee.'},403)

    const {data:s}=await admin.from('settings').select('m365_client_id,m365_tenant_id')
      .eq('tenant_id',TENANT).maybeSingle()
    if(!s?.m365_client_id)return json({error:'Microsoft 365 Client ID is not configured yet.'},409)

    const payload=b64url(JSON.stringify({
      employeeEmail:String(user.email).toLowerCase(),
      tenantId:TENANT,
      exp:Date.now()+10*60_000,
      nonce:crypto.randomUUID()
    }))
    const signature=await sign(service,payload)
    const state=payload+'.'+signature
    const redirectUri=`${url}/functions/v1/m365-oauth-callback`
    const tenant=String(s.m365_tenant_id||'common')
    const qs=new URLSearchParams({
      client_id:s.m365_client_id,
      response_type:'code',
      redirect_uri:redirectUri,
      response_mode:'query',
      scope:'openid profile offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite',
      state,
      prompt:'select_account'
    })
    return json({authorize_url:`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${qs.toString()}`})
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
})
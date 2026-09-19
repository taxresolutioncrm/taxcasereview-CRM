import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const SECRET_KEY='nashville_system_mail_relay_v1'
const CENTRAL='https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/nashville-system-mail-relay'
const ALLOWED=new Set(['esign_request','esign_reminder','esign_signed_copy','esign_internal_notification'])
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type'}})
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type'}})
 if(req.method!=='POST')return json({error:'POST only'},405)
 try{
   const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
   const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
   const auth=req.headers.get('authorization')||''
   let serviceCaller=auth.replace(/^Bearer\s+/i,'')===service
   let userEmail=''
   if(!serviceCaller){
     if(!auth.toLowerCase().startsWith('bearer '))return json({error:'Authentication required'},401)
     const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}})
     const {data:{user},error}=await caller.auth.getUser()
     if(error||!user?.email)return json({error:'Invalid session'},401)
     userEmail=user.email.toLowerCase()
     const {data:emp}=await admin.from('employees').select('id,status,perm_documents,role,access').eq('tenant_id',TENANT).eq('status','Active').ilike('email',userEmail).maybeSingle()
     if(!emp||Number(emp.perm_documents||0)<2)return json({error:'Document/e-sign edit access required'},403)
   }
   const body=await req.json().catch(()=>({}))
   const kind=String(body.kind||'')
   if(!ALLOWED.has(kind))return json({error:'Unsupported E-sign mail kind'},400)
   const id=String(body.esign_id||'')
   const {data:e}=await admin.from('esigns').select('id,tenant_id,status,client_email,signed_at').eq('tenant_id',TENANT).eq('id',id).maybeSingle()
   if(!e)return json({error:'E-sign request not found'},404)
   const to=String(body.to||'').trim().toLowerCase()
   if(kind!=='esign_internal_notification'){
     if(!e.client_email||to!==String(e.client_email).trim().toLowerCase())return json({error:'Recipient does not match E-sign request'},403)
     if((kind==='esign_request'||kind==='esign_reminder')&&e.status!=='Awaiting')return json({error:'E-sign request is not awaiting signature'},409)
     if(kind==='esign_signed_copy'&&(e.status!=='Signed'||!e.signed_at))return json({error:'E-sign request is not signed'},409)
   } else if(!serviceCaller && !userEmail) return json({error:'Unauthorized'},401)
   const {data:secretRow}=await admin.from('platform_internal_secrets').select('secret').eq('key',SECRET_KEY).maybeSingle()
   if(!secretRow?.secret)return json({error:'Nashville mail relay secret unavailable'},503)
   const rr=await fetch(CENTRAL,{method:'POST',headers:{'content-type':'application/json','x-nashville-relay-secret':secretRow.secret},body:JSON.stringify({
     kind,to,subject:String(body.subject||''),html:String(body.html||''),attachments:Array.isArray(body.attachments)?body.attachments:[]
   })})
   const out=await rr.json().catch(()=>({}))
   if(!rr.ok||!out?.success)return json({error:out?.error||'Nashville mail relay failed'},rr.status||502)
   return json(out)
 }catch(e){console.error('[nashville-esign-mail]',e);return json({error:e instanceof Error?e.message:String(e)},500)}
})
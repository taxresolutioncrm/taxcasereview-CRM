import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const APP_URL='https://nashville.taxrescrm.app'

function unb64url(v:string){
  const s=v.replace(/-/g,'+').replace(/_/g,'/')
  const pad=s+'='.repeat((4-s.length%4)%4)
  return Uint8Array.from(atob(pad),c=>c.charCodeAt(0))
}
async function verify(secret:string,payload:string,sigText:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
  return crypto.subtle.verify('HMAC',key,unb64url(sigText),new TextEncoder().encode(payload))
}
function finish(ok:boolean,message:string){
  const data=JSON.stringify({type:'nashville-m365-oauth',ok,message})
  const safe=message.replace(/[<>&'"]/g,'')
  return new Response(`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#071524;color:#fff;padding:32px;text-align:center"><h2>${ok?'Microsoft 365 connected':'Microsoft 365 connection failed'}</h2><p>${safe}</p><script>try{window.opener&&window.opener.postMessage(${data},'${APP_URL}')}catch(e){};setTimeout(()=>window.close(),900)</script></body></html>`,{status:ok?200:400,headers:{'content-type':'text/html; charset=utf-8'}})
}

Deno.serve(async req=>{
  if(req.method!=='GET')return new Response('GET only',{status:405})
  try{
    const reqUrl=new URL(req.url)
    const code=reqUrl.searchParams.get('code')||''
    const state=reqUrl.searchParams.get('state')||''
    const oauthError=reqUrl.searchParams.get('error_description')||reqUrl.searchParams.get('error')||''
    if(oauthError)return finish(false,'Microsoft authorization was cancelled or denied.')
    if(!code||!state)return finish(false,'Microsoft authorization response was incomplete.')

    const supaUrl=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!supaUrl||!service)return finish(false,'Microsoft 365 connection is unavailable.')

    const [payload,sig]=state.split('.')
    if(!payload||!sig||!(await verify(service,payload,sig)))return finish(false,'The Microsoft connection request is invalid or expired.')
    const decoded=JSON.parse(new TextDecoder().decode(unb64url(payload)))
    if(decoded.tenantId!==TENANT||Date.now()>Number(decoded.exp||0))return finish(false,'The Microsoft connection request expired.')
    const employeeEmail=String(decoded.employeeEmail||'').toLowerCase()
    if(!employeeEmail)return finish(false,'Employee identity was missing from the connection request.')

    const admin=createClient(supaUrl,service)
    const {data:emp}=await admin.from('employees').select('email,status,tenant_id')
      .eq('tenant_id',TENANT).eq('status','Active').ilike('email',employeeEmail).maybeSingle()
    if(!emp)return finish(false,'The Nashville employee account is no longer active.')

    const {data:s}=await admin.from('settings').select('m365_client_id,m365_client_secret,m365_tenant_id')
      .eq('tenant_id',TENANT).maybeSingle()
    if(!s?.m365_client_id||!s?.m365_client_secret)return finish(false,'Microsoft 365 app credentials are not configured yet.')

    const redirectUri=`${supaUrl}/functions/v1/m365-oauth-callback`
    const tenant=String(s.m365_tenant_id||'common')
    const tokenRes=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        client_id:s.m365_client_id,
        client_secret:s.m365_client_secret,
        grant_type:'authorization_code',
        code,
        redirect_uri:redirectUri,
        scope:'openid profile offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite'
      })
    })
    const tokens=await tokenRes.json().catch(()=>({}))
    if(!tokenRes.ok||!tokens.access_token||!tokens.refresh_token)return finish(false,tokens.error_description||'Microsoft token exchange failed.')

    const meRes=await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',{headers:{Authorization:`Bearer ${tokens.access_token}`}})
    const me=await meRes.json().catch(()=>({}))
    if(!meRes.ok||!me.id)return finish(false,me?.error?.message||'Could not read the Microsoft mailbox profile.')
    const mailbox=String(me.mail||me.userPrincipalName||'').toLowerCase()
    if(!mailbox)return finish(false,'Microsoft did not return a mailbox address.')

    const expiry=new Date(Date.now()+Number(tokens.expires_in||3600)*1000).toISOString()
    const {error:saveErr}=await admin.from('employee_m365_accounts').upsert({
      employee_email:employeeEmail,
      tenant_id:TENANT,
      m365_user_id:String(me.id),
      m365_email:mailbox,
      m365_access_token:tokens.access_token,
      m365_refresh_token:tokens.refresh_token,
      m365_token_expiry:expiry,
      m365_last_error:null,
      m365_email_sync:true,
      m365_calendar_sync:true
    },{onConflict:'employee_email'})
    if(saveErr)return finish(false,'The Microsoft mailbox connection could not be saved.')

    return finish(true,`Connected ${mailbox} to the Nashville CRM.`)
  }catch(e){return finish(false,e instanceof Error?e.message:String(e))}
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const APP_URL='https://nashville.taxrescrm.app'
const cors={'Access-Control-Allow-Origin':APP_URL,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}

async function validToken(admin:any,acct:any,settings:any){
  if(acct.m365_access_token && new Date(acct.m365_token_expiry||0).getTime()>Date.now()+5*60_000)return acct.m365_access_token
  if(!acct.m365_refresh_token)throw new Error('Microsoft 365 refresh token is missing. Reconnect Microsoft 365.')
  const res=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(settings.m365_tenant_id||'common')}/oauth2/v2.0/token`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:settings.m365_client_id,
      client_secret:settings.m365_client_secret,
      refresh_token:acct.m365_refresh_token,
      grant_type:'refresh_token',
      scope:'openid profile offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite'
    })
  })
  const t=await res.json().catch(()=>({}))
  if(!res.ok||!t.access_token)throw new Error(t.error_description||'Microsoft token refresh failed')
  const expiry=new Date(Date.now()+Number(t.expires_in||3600)*1000).toISOString()
  await admin.from('employee_m365_accounts').update({
    m365_access_token:t.access_token,
    m365_refresh_token:t.refresh_token||acct.m365_refresh_token,
    m365_token_expiry:expiry,
    m365_last_error:null
  }).eq('tenant_id',TENANT).ilike('employee_email',acct.employee_email)
  return t.access_token
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})
  if(req.method!=='POST')return json({error:'POST only'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||'', anon=Deno.env.get('SUPABASE_ANON_KEY')||'', service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const auth=req.headers.get('Authorization')||''
    if(!auth.startsWith('Bearer '))return json({error:'Authentication required'},401)
    const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}})
    const {data:{user},error:uErr}=await caller.auth.getUser()
    if(uErr||!user?.email)return json({error:'Invalid session'},401)

    const admin=createClient(url,service)
    const {data:emp}=await admin.from('employees').select('email,status,tenant_id,perm_comms')
      .eq('tenant_id',TENANT).eq('status','Active').ilike('email',user.email).maybeSingle()
    if(!emp||Number(emp.perm_comms||0)<2)return json({error:'Communications edit access required'},403)

    const {data:acct}=await admin.from('employee_m365_accounts').select('*')
      .eq('tenant_id',TENANT).ilike('employee_email',user.email).maybeSingle()
    if(!acct?.m365_refresh_token)return json({error:'Microsoft 365 is not connected for this employee.'},409)
    const {data:s}=await admin.from('settings').select('m365_client_id,m365_client_secret,m365_tenant_id')
      .eq('tenant_id',TENANT).maybeSingle()
    if(!s?.m365_client_id||!s?.m365_client_secret)return json({error:'Microsoft 365 app credentials are not configured.'},409)

    const token=await validToken(admin,acct,s)
    const body=await req.json().catch(()=>({}))
    const action=String(body?.action||'send')

    if(action==='send'){
      const to=String(body?.to||'').trim()
      const subject=String(body?.subject||'').trim()
      const content=String(body?.body||'')
      if(!/^\S+@\S+\.\S+$/.test(to)||!subject||!content)return json({error:'Recipient, subject, and body are required.'},400)
      const res=await fetch('https://graph.microsoft.com/v1.0/me/sendMail',{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({message:{subject,body:{contentType:'Text',content},toRecipients:[{emailAddress:{address:to}}]},saveToSentItems:true})
      })
      if(!res.ok){
        const out=await res.json().catch(()=>({}))
        throw new Error(out?.error?.message||`Microsoft send failed (${res.status})`)
      }
      return json({success:true,provider:'m365',from:acct.m365_email||acct.employee_email})
    }

    if(action==='message_action'){
      const ids=Array.isArray(body?.email_ids)?body.email_ids.map((x:any)=>String(x)).filter(Boolean).slice(0,25):[]
      const requested=String(body?.message_action||body?.mailbox_action||'').toLowerCase()
      if(!ids.length||!['read','unread','archive','inbox','spam','trash'].includes(requested))return json({error:'Valid email_ids and message_action are required.'},400)
      const {data:rows,error:rowsErr}=await admin.from('emails')
        .select('id,m365_message_id,mailbox_owner,triage,is_read')
        .eq('tenant_id',TENANT).ilike('mailbox_owner',user.email).in('id',ids)
      if(rowsErr)return json({error:'Could not load mailbox messages.'},500)
      const succeeded:string[]=[]
      const failures:any[]=[]
      for(const row of rows||[]){
        try{
          const messageId=String(row.m365_message_id||'')
          if(!messageId)throw new Error('Microsoft message ID is missing')
          if(requested==='read'||requested==='unread'){
            const r=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}`,{
              method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
              body:JSON.stringify({isRead:requested==='read'})
            })
            if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d?.error?.message||`Microsoft message update failed (${r.status})`)}
            await admin.from('emails').update({is_read:requested==='read'}).eq('id',row.id).eq('tenant_id',TENANT)
          }else{
            const destination=requested==='archive'?'archive':requested==='inbox'?'inbox':requested==='spam'?'junkemail':'deleteditems'
            const r=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/move`,{
              method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
              body:JSON.stringify({destinationId:destination})
            })
            const d=await r.json().catch(()=>({}))
            if(!r.ok)throw new Error(d?.error?.message||`Microsoft message move failed (${r.status})`)
            const patch:any={m365_message_id:String(d?.id||messageId)}
            if(requested==='archive')patch.triage='Archive'
            if(requested==='inbox')patch.triage='Inbox'
            if(requested==='spam')patch.triage='Spam'
            if(requested==='trash')patch.deleted_at=new Date().toISOString()
            await admin.from('emails').update(patch).eq('id',row.id).eq('tenant_id',TENANT)
          }
          succeeded.push(String(row.id))
        }catch(e){failures.push({id:row.id,error:e instanceof Error?e.message:String(e)})}
      }
      return json({ok:failures.length===0,action:requested,succeeded,failures},failures.length?207:200)
    }

    if(action==='reply'){
      const messageId=String(body?.m365_message_id||'').trim()
      const comment=String(body?.body||'')
      if(!messageId||!comment)return json({error:'Reply message is required.'},400)
      const res=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/reply`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({comment})
      })
      if(!res.ok){
        const out=await res.json().catch(()=>({}))
        throw new Error(out?.error?.message||`Microsoft reply failed (${res.status})`)
      }
      return json({success:true,provider:'m365',reply:true,from:acct.m365_email||acct.employee_email})
    }

    return json({error:'Unsupported action'},400)
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
})
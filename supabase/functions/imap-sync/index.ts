// imap-sync — tenant-safe mailbox synchronization.
// Authenticated staff may sync only their own active mailbox rows inside their
// resolved tenant. A verified service-role JWT may run the scheduled all-account sync.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ENCRYPT_KEY = Deno.env.get('EMAIL_ENCRYPT_KEY')
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})

function jwtRole(token:string){
  try{
    const payload=token.split('.')[1]
    if(!payload)return ''
    const padded=payload.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-payload.length%4)%4)
    return String(JSON.parse(atob(padded))?.role||'')
  }catch{return ''}
}

async function imapCommand(conn: Deno.TlsConn, tag: string, command: string): Promise<string> {
  const encoder = new TextEncoder(), decoder = new TextDecoder()
  await conn.write(encoder.encode(`${tag} ${command}\r\n`))
  let response = ''; const buf = new Uint8Array(65536)
  while (true) {
    const n = await conn.read(buf); if (n === null) break
    response += decoder.decode(buf.subarray(0, n))
    if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) break
    if (response.includes(`) \r\n${tag}`) || response.match(new RegExp(`\\)\\s*\\r\\n${tag}`))) break
  }
  return response
}

function parseEnvelope(fetchResponse:string){
  const subjectMatch=fetchResponse.match(/Subject:\s*(.+?)(?:\r\n|\n)(?:\s|\S)/i)
  const fromMatch=fetchResponse.match(/From:\s*(.+?)(?:\r\n|\n)/i)
  const dateMatch=fetchResponse.match(/Date:\s*(.+?)(?:\r\n|\n)/i)
  const msgIdMatch=fetchResponse.match(/Message-ID:\s*<([^>]+)>/i)
  return {subject:subjectMatch?.[1]?.trim()||'(no subject)',from:fromMatch?.[1]?.trim()||'',date:dateMatch?.[1]?.trim()||new Date().toISOString(),messageId:msgIdMatch?.[1]?.trim()||`${Date.now()}@taxrescrm.net`}
}
function extractEmailAddress(headerValue:string){const value=String(headerValue||'');const m=value.match(/<([^>]+)>/)||value.match(/([^\s,]+@[^\s,]+)/);return m?.[1]?.toLowerCase().trim()||value.toLowerCase().trim()}
function extractBody(fetchResponse:string){
  const hm=fetchResponse.match(/Content-Type: text\/html[^]*?\r\n\r\n([^]*?)(?:\r\n--|\r\n\r\n[A-Z0-9]+\s)/i)
  const tm=fetchResponse.match(/Content-Type: text\/plain[^]*?\r\n\r\n([^]*?)(?:\r\n--|\r\n\r\n[A-Z0-9]+\s)/i)
  return {html:hm?.[1]?.trim()||'',text:tm?.[1]?.trim()||fetchResponse.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,5000)}
}

async function matchToClient(db:any,senderEmail:string,tenantId:string){
  const {data:c}=await db.from('clients').select('id,name').eq('email',senderEmail).eq('tenant_id',tenantId).maybeSingle();if(c)return{clientId:c.id,clientName:c.name}
  const {data:l}=await db.from('leads').select('id,name').eq('email',senderEmail).eq('tenant_id',tenantId).maybeSingle();return{clientId:l?.id||null,clientName:l?.name||null}
}

async function syncAccount(db:any,account:any){
  const errors:string[]=[];let synced=0
  const {data:decrypted,error:decErr}=await db.rpc('decrypt_email_password',{p_encrypted:account.encrypted_password,p_key:ENCRYPT_KEY})
  if(decErr||!decrypted)return{synced:0,errors:[`Password decrypt failed: ${decErr?.message||'empty'}`]}
  let conn:Deno.TlsConn|null=null
  try{
    conn=await Deno.connectTls({hostname:String(account.imap_host||''),port:Number(account.imap_port)||993})
    await conn.read(new Uint8Array(1024))
    const user=String(account.email_address||'').replace(/["\\]/g,''),pass=String(decrypted).replace(/["\\]/g,'')
    const login=await imapCommand(conn,'A1',`LOGIN "${user}" "${pass}"`);if(!login.includes('A1 OK'))throw new Error(`IMAP LOGIN failed: ${login.slice(0,200)}`)
    let tag=10
    async function syncFolder(folderName:string,triage:'Inbox'|'Spam'){
      const safeFolder=folderName.replace(/["\\]/g,'')
      const select=await imapCommand(conn!,`S${tag++}`,`SELECT "${safeFolder}"`)
      if(!/ OK/i.test(select))return
      const sr=await imapCommand(conn!,`S${tag++}`,'SEARCH UNSEEN')
      const seqs=(sr.match(/\* SEARCH (.+?)\r\n/)?.[1]||'').trim().split(' ').filter(Boolean)
      for(const seq of seqs.slice(0,50)){
        try{
          const fr=await imapCommand(conn!,`B${tag++}`,`FETCH ${seq} (BODY[])`),{subject,from,date,messageId}=parseEnvelope(fr),senderEmail=extractEmailAddress(from),{text,html}=extractBody(fr)
          const {data:existing}=await db.from('emails').select('id,triage').eq('message_id',messageId).eq('tenant_id',account.tenant_id).maybeSingle()
          if(existing){
            if(triage==='Spam'&&existing.triage!=='Spam')await db.from('emails').update({triage:'Spam',status:'Spam'}).eq('id',existing.id).eq('tenant_id',account.tenant_id)
            continue
          }
          const {clientId,clientName}=await matchToClient(db,senderEmail,String(account.tenant_id)),parsed=new Date(date)
          const {error:insertErr}=await db.from('emails').insert([{tenant_id:account.tenant_id,email_account_id:account.id,message_id:messageId,thread_id:String(messageId).split('@')[0]||String(messageId),mailbox_owner:account.employee_email,sender:senderEmail,from_address:senderEmail,recipients:[{email:String(account.email_address||'')}],subject,body:text,body_html:html,direction:'inbound',triage,status:triage==='Spam'?'Spam':'Received',is_read:false,received_at:Number.isNaN(parsed.getTime())?new Date().toISOString():parsed.toISOString(),client_id:clientId,clientName,created_at:new Date().toISOString()}])
          if(insertErr)throw insertErr;synced++
        }catch(e){errors.push(`${triage} seq ${seq}: ${(e as Error).message}`)}
      }
    }

    await syncFolder('INBOX','Inbox')
    const list=await imapCommand(conn,`L${tag++}`,'LIST "" "*"')
    const junkLine=list.split(/\r?\n/).find(line=>/\\Junk/i.test(line)||/(?:^|[\s"\/])(Junk Email|Junk|Spam)(?:"|$)/i.test(line))
    const mailboxMatch=junkLine?.match(/"([^"]+)"\s*$/)||junkLine?.match(/\s([^\s]+)\s*$/)
    const spamFolder=mailboxMatch?.[1]||mailboxMatch?.[0]?.trim()||''
    if(spamFolder&&spamFolder.toUpperCase()!=='INBOX')await syncFolder(spamFolder,'Spam')
    await imapCommand(conn,'A99','LOGOUT')
  }catch(e){errors.push((e as Error).message)}finally{try{conn?.close()}catch{}}
  return{synced,errors}
}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed'},405)
  if(!SUPABASE_URL||!SERVICE_KEY||!ANON_KEY||!ENCRYPT_KEY)return json({ok:false,error:'Server email encryption is not configured'},500)
  try{
    const auth=req.headers.get('authorization')||'';if(!auth.toLowerCase().startsWith('bearer '))return json({ok:false,error:'Unauthorized'},401)
    const token=auth.slice(7).trim(),role=jwtRole(token),db=createClient(SUPABASE_URL,SERVICE_KEY)
    let accountId:string|null=null;try{const payload=await req.json();accountId=payload?.account_id?String(payload.account_id):null}catch{}
    let query=db.from('email_accounts').select('*').eq('is_active',true)
    if(role!=='service_role'){
      const userClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}}),{data:{user},error:userErr}=await userClient.auth.getUser(token)
      if(userErr||!user?.email)return json({ok:false,error:'Unauthorized'},401)
      const {data:tenantId}=await userClient.rpc('current_tenant_id');if(!tenantId)return json({ok:false,error:'No active office context'},403)
      const {data:employee}=await db.from('employees').select('status,perm_comms').eq('tenant_id',tenantId).ilike('email',user.email).limit(1).maybeSingle(),active=employee&&String(employee.status||'Active').toLowerCase()==='active'
      if(!active||Number(employee?.perm_comms||0)<2)return json({ok:false,error:'Email permission denied'},403)
      query=query.eq('tenant_id',tenantId).ilike('employee_email',user.email)
      if(accountId)query=query.eq('id',accountId)
    }else if(accountId){query=query.eq('id',accountId)}
    const {data:accounts,error}=await query;if(error)throw error
    const results:any[]=[]
    for(const account of accounts||[]){
      const {synced,errors}=await syncAccount(db,account)
      await db.from('email_sync_log').insert([{account_id:account.id,tenant_id:account.tenant_id,messages_new:synced,status:errors.length?'error':'ok',error_message:errors.length?errors.join('; '):null}])
      await db.from('email_accounts').update({last_sync_at:new Date().toISOString(),sync_status:errors.length?'error':'ok',sync_error:errors.length?errors[0]:null}).eq('id',account.id).eq('tenant_id',account.tenant_id)
      results.push({account:account.email_address,synced,errors})
    }
    return json({ok:true,results})
  }catch(e){console.error('imap-sync error:',e);return json({ok:false,error:(e as Error).message},500)}
})

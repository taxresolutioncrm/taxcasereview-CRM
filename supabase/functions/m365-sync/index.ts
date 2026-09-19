import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const NASHVILLE_TENANT = '489ace07-1a6b-4864-833a-4f8420568b40'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-m365-sync-secret',
  'Content-Type': 'application/json',
}

function secretsMatch(expected:string,supplied:string){
  if(!expected||expected.length!==supplied.length) return false
  let diff=0
  for(let i=0;i<expected.length;i++) diff|=expected.charCodeAt(i)^supplied.charCodeAt(i)
  return diff===0
}

function digits(v:unknown){ return String(v||'').replace(/\D/g,'').slice(-10) }

function looksLikeNextivaFax(msg:any){
  const from=String(msg?.from?.emailAddress?.address||'').toLowerCase()
  const subject=String(msg?.subject||'').toLowerCase()
  const body=String(msg?.bodyPreview||'').toLowerCase()
  const nextivaSender=from.endsWith('@nextiva.com')||from.endsWith('@nextivafax.com')||from.includes('nextiva')
  return nextivaSender && (subject.includes('fax')||body.includes('fax'))
}

function extractLikelyFaxNumber(text:string){
  const hits=(text.match(/(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}/g)||[])
    .map(digits)
    .filter((n:string)=>n.length===10 && n!=='7726464046')
  return hits[0]||''
}

function decodeBase64(s:string){
  const bin=atob(s)
  const out=new Uint8Array(bin.length)
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i)
  return out
}

async function ingestNextivaFax(admin:any,token:string,acct:any,msg:any){
  if(String(acct?.employee_email||'').toLowerCase()!=='chris@nashvilletaxsolutions.com') return false
  if(!looksLikeNextivaFax(msg)) return false

  const providerId=String(msg.id||'')
  if(!providerId) return false
  const {data:existing}=await admin.from('fax_logs')
    .select('id').eq('tenant_id',NASHVILLE_TENANT).eq('provider','nextiva').eq('provider_fax_id',providerId).maybeSingle()
  if(existing?.id) return true

  const attRes=await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerId)}/attachments?$select=id,name,contentType,size,isInline,contentBytes`,{
    headers:{Authorization:`Bearer ${token}`}
  })
  const attData=await attRes.json().catch(()=>({}))
  if(!attRes.ok) throw new Error(attData?.error?.message||'Could not read Nextiva fax attachments')

  const pdf=(attData.value||[]).find((a:any)=>
    !a?.isInline && (
      String(a?.contentType||'').toLowerCase()==='application/pdf' ||
      String(a?.name||'').toLowerCase().endsWith('.pdf')
    ) && a?.contentBytes
  )

  const combined=[msg.subject,msg.bodyPreview].filter(Boolean).join(' ')
  const fromNumber=extractLikelyFaxNumber(combined)
  let client:any=null
  if(fromNumber){
    const {data:matches}=await admin.from('clients')
      .select('id,name,phone,phone2')
      .eq('tenant_id',NASHVILLE_TENANT)
      .or(`phone.ilike.%${fromNumber.slice(-7)}%,phone2.ilike.%${fromNumber.slice(-7)}%`)
      .limit(2)
    if(Array.isArray(matches)&&matches.length===1) client=matches[0]
  }

  let storagePath:string|null=null
  let fileUrl:string|null=null
  let errorMsg:string|null=null

  if(pdf){
    const bytes=decodeBase64(String(pdf.contentBytes))
    storagePath=`fax/inbound/nextiva-${providerId.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`
    const {error:uploadErr}=await admin.storage.from('documents').upload(storagePath,bytes,{
      contentType:'application/pdf',upsert:true
    })
    if(uploadErr) errorMsg='Storage upload failed: '+uploadErr.message
    else fileUrl='storage://documents/'+storagePath
  }else{
    // Nextiva HIPAA vFAX and accounts with PDF notifications disabled send a
    // notification only. Keep the fax visible in CRM instead of silently losing it.
    errorMsg='Nextiva received the fax, but the notification had no PDF attachment. Enable PDF attachments in Nextiva vFAX notifications; HIPAA vFAX requires portal retrieval.'
  }

  const {error:insertErr}=await admin.from('fax_logs').insert({
    tenant_id:NASHVILLE_TENANT,
    from_number:fromNumber?'+1'+fromNumber:'',
    to_number:'+17726464046',
    client_id:client?.id||null,
    client_name:client?.name||null,
    subject:msg.subject||'Incoming Nextiva fax',
    notes:msg.bodyPreview||null,
    file_name:pdf?.name||null,
    file_url:fileUrl,
    storage_path:storagePath,
    status:pdf?'Received':'Received - attachment unavailable',
    direction:'inbound',
    provider:'nextiva',
    provider_fax_id:providerId,
    sent_by:'chris@nashvilletaxsolutions.com',
    created_at:msg.receivedDateTime||new Date().toISOString(),
    is_read:false,
    read:false,
    error_msg:errorMsg
  })
  if(insertErr) throw insertErr
  return true
}

async function refreshIfNeeded(supabase: any, acct: any, settings: any) {
  if (acct.m365_access_token && new Date(acct.m365_token_expiry).getTime() > Date.now() + 5 * 60000) {
    return acct.m365_access_token
  }
  const res = await fetch(`https://login.microsoftonline.com/${settings.m365_tenant_id || 'common'}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.m365_client_id,
      client_secret: settings.m365_client_secret,
      refresh_token: acct.m365_refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const tokens = await res.json()
  if (!res.ok || tokens.error) throw new Error(tokens.error_description || tokens.error || 'Microsoft token refresh failed')
  const expiry = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString()
  await supabase.from('employee_m365_accounts').update({
    m365_access_token: tokens.access_token,
    m365_refresh_token: tokens.refresh_token || acct.m365_refresh_token,
    m365_token_expiry: expiry,
  }).eq('tenant_id', NASHVILLE_TENANT).ilike('employee_email', acct.employee_email)
  return tokens.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authorization = req.headers.get('Authorization') || ''
  const admin = createClient(url, serviceKey)

  try {
    // Browser calls authenticate with the employee JWT. The database scheduler
    // uses a separate random secret stored in scheduler_credentials so inbound
    // Nextiva faxes still import even when nobody is logged into the CRM.
    const suppliedSchedulerSecret=req.headers.get('x-m365-sync-secret')||''
    const {data:schedulerRow}=await admin.from('scheduler_credentials')
      .select('secret').eq('name','nashville-m365-sync').maybeSingle()
    const isScheduler=!!schedulerRow?.secret && secretsMatch(String(schedulerRow.secret),suppliedSchedulerSecret)

    let targetEmail = ''
    if (!isScheduler) {
      if (!authorization.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: cors })
      }
      const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
      const { data: { user }, error: userError } = await caller.auth.getUser()
      if (userError || !user?.email) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: cors })
      const { data: employee } = await admin.from('employees')
        .select('email,status,tenant_id,perm_comms')
        .eq('tenant_id', NASHVILLE_TENANT)
        .ilike('email', user.email)
        .eq('status', 'Active')
        .maybeSingle()
      if (!employee || Number(employee.perm_comms || 0) < 2) {
        return new Response(JSON.stringify({ error: 'Communications Edit access required' }), { status: 403, headers: cors })
      }
      targetEmail = user.email
    }

    let query = admin.from('employee_m365_accounts')
      .select('*')
      .eq('tenant_id', NASHVILLE_TENANT)
      .not('m365_refresh_token', 'is', null)
    if (targetEmail) query = query.ilike('employee_email', targetEmail)
    const { data: accounts, error: accountError } = await query
    if (accountError) throw accountError
    if (!accounts?.length) return new Response(JSON.stringify({ synced: 0 }), { headers: cors })

    const { data: settings, error: settingsError } = await admin.from('settings')
      .select('m365_client_id,m365_client_secret,m365_tenant_id')
      .eq('tenant_id', NASHVILLE_TENANT)
      .maybeSingle()
    if (settingsError) throw settingsError
    if (!settings?.m365_client_id || !settings?.m365_client_secret) {
      throw new Error('Microsoft 365 OAuth is not configured')
    }

    let synced = 0

    async function syncAccount(acct:any) {
      try {
        const token = await refreshIfNeeded(admin, acct, settings)

        if (acct.m365_email_sync) {
          const folderDefs = [
            { id:'inbox', triage:'Inbox' },
            { id:'junkemail', triage:'Spam' },
          ]
          const folderMessages:any[] = []
          for (const folder of folderDefs) {
            const emailRes = await fetch(
              `https://graph.microsoft.com/v1.0/me/mailFolders/${folder.id}/messages?$top=100&$select=id,conversationId,internetMessageId,subject,from,toRecipients,body,bodyPreview,receivedDateTime,isRead,hasAttachments&$orderby=receivedDateTime desc`,
              { headers: { Authorization: `Bearer ${token}` } },
            )
            const emailData = await emailRes.json()
            if (!emailRes.ok) throw new Error(emailData?.error?.message || `Microsoft ${folder.id} email sync failed`)
            for (const msg of (Array.isArray(emailData.value) ? emailData.value : [])) {
              if (msg?.id) folderMessages.push({ ...msg, _crmTriage: folder.triage })
            }
          }

          const inboxMessages = folderMessages
          const ids = inboxMessages.map((m:any)=>String(m.id))
          const existingIds = new Set<string>()
          if (ids.length) {
            const { data: existingRows, error: existingErr } = await admin.from('emails')
              .select('m365_message_id')
              .eq('tenant_id', NASHVILLE_TENANT)
              .ilike('mailbox_owner', String(acct.employee_email || ''))
              .in('m365_message_id', ids)
            if (existingErr) throw existingErr
            for (const row of existingRows || []) if (row.m365_message_id) existingIds.add(String(row.m365_message_id))
          }

          const newRows:any[] = []
          const newMessages:any[] = []

          for (const msg of inboxMessages) {
            if (existingIds.has(String(msg.id))) continue

            if (msg._crmTriage === 'Inbox' && String(acct.employee_email||'').toLowerCase()==='chris@nashvilletaxsolutions.com') {
              const ingestedFax=await ingestNextivaFax(admin,token,acct,msg)
              if(ingestedFax) continue
            }

            const fromEmail = String(msg.from?.emailAddress?.address || '').trim().toLowerCase()
            if (!fromEmail) continue

            const htmlBody = String(msg.body?.contentType || '').toLowerCase() === 'html'
              ? String(msg.body?.content || '')
              : null
            const plainBody = String(msg.bodyPreview || msg.body?.content || '')
            const senderName = String(msg.from?.emailAddress?.name || '').trim()
            const recipients = (msg.toRecipients || [])
              .map((r:any)=>String(r?.emailAddress?.address || '').trim().toLowerCase())
              .filter(Boolean)

            newRows.push({
              tenant_id: NASHVILLE_TENANT,
              mailbox_owner: String(acct.employee_email || '').toLowerCase(),
              m365_message_id: String(msg.id || ''),
              m365_conversation_id: String(msg.conversationId || ''),
              message_id: String(msg.internetMessageId || ''),
              thread_id: String(msg.conversationId || ''),
              sender: senderName || fromEmail,
              from_address: fromEmail,
              recipient: fromEmail,
              recipients,
              subject: msg.subject || '(no subject)',
              body: plainBody,
              body_html: htmlBody,
              triage: msg._crmTriage === 'Spam' ? 'Spam' : 'Inbox',
              status: msg._crmTriage === 'Spam' ? 'Spam' : 'Received',
              direction: 'inbound',
              received_at: msg.receivedDateTime || new Date().toISOString(),
              created_at: msg.receivedDateTime || new Date().toISOString(),
              is_read: !!msg.isRead,
              received_mailbox: acct.m365_email || acct.employee_email,
            })
            if (msg._crmTriage !== 'Spam') newMessages.push({msg,fromEmail})
          }

          if (newRows.length) {
            const { error: mailUpsertErr } = await admin.from('emails').upsert(newRows, {
              onConflict: 'tenant_id,mailbox_owner,m365_message_id'
            })
            if (mailUpsertErr) throw mailUpsertErr
          }

          for (const item of newMessages) {
            const {msg,fromEmail}=item
            for (const table of ['leads', 'clients']) {
              const noteTable = table === 'leads' ? 'lead_notes' : 'client_notes'
              const idField = table === 'leads' ? 'lead_id' : 'client_id'
              const { data: match } = await admin.from(table)
                .select('id').eq('tenant_id', NASHVILLE_TENANT).ilike('email', fromEmail).maybeSingle()
              if (match) {
                await admin.from(noteTable).upsert({
                  [idField]: match.id,
                  tenant_id: NASHVILLE_TENANT,
                  note: `📧 Email received: **${msg.subject || '(no subject)'}**\n\n${msg.bodyPreview || ''}`,
                  author: acct.employee_email,
                  created_at: msg.receivedDateTime || new Date().toISOString(),
                  source: 'm365',
                  external_id: msg.id,
                }, { onConflict: 'external_id', ignoreDuplicates: true })
              }
            }
          }
        }

        if (acct.m365_calendar_sync) {
          const now = new Date().toISOString()
          const future = new Date(Date.now() + 30 * 86400000).toISOString()
          const calRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(now)}&endDateTime=${encodeURIComponent(future)}&$select=id,subject,start,end,bodyPreview,attendees,onlineMeeting&$top=50&$orderby=start/dateTime`,
            { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } },
          )
          const calData = await calRes.json()
          if (!calRes.ok) throw new Error(calData?.error?.message || 'Microsoft calendar sync failed')
          for (const ev of calData.value || []) {
            const start = ev.start?.dateTime
            const end = ev.end?.dateTime
            if (!start) continue
            await admin.from('calevents').upsert({
              tenant_id: NASHVILLE_TENANT,
              title: ev.subject || 'Meeting',
              date: start.slice(0, 10),
              time: start.slice(11, 16),
              end_time: end?.slice(11, 16),
              assignedTo: acct.employee_email,
              eventType: 'Meeting',
              source: 'm365',
              external_id: ev.id,
              notes: ev.bodyPreview || '',
              meeting_link: ev.onlineMeeting?.joinUrl || '',
            }, { onConflict: 'external_id', ignoreDuplicates: true })
          }
        }

        await admin.from('employee_m365_accounts').update({
          m365_last_sync_at: new Date().toISOString(),
          m365_last_error: null,
        }).eq('tenant_id', NASHVILLE_TENANT).ilike('employee_email', acct.employee_email)
        synced++
      } catch (e) {
        await admin.from('employee_m365_accounts').update({
          m365_last_error: e instanceof Error ? e.message : String(e),
        }).eq('tenant_id', NASHVILLE_TENANT).ilike('employee_email', acct.employee_email)
      }
    }

    // Small concurrency batches keep a 50–60 person office responsive without
    // hammering Microsoft Graph or running every mailbox strictly one-by-one.
    const BATCH_SIZE=5
    for(let i=0;i<accounts.length;i+=BATCH_SIZE){
      await Promise.all(accounts.slice(i,i+BATCH_SIZE).map((acct:any)=>syncAccount(acct)))
    }

    return new Response(JSON.stringify({ synced }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: cors })
  }
})

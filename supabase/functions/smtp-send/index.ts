// smtp-send — authenticated SMTP sender with mailbox-safe RomyLabs reply routing.
// Normal staff may only use their own email_accounts rows. Routed Stalwart mailboxes
// may be used by the exact mailbox owner inside the same tenant, while RomyLabs
// platform admins retain access to central multi-brand routes.

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
const svc = createClient(SUPABASE_URL, SERVICE_KEY)
const ROMYLABS_ADMINS = new Set(['info@romylabs.com', 'romy@romylabs.com'])

const safeHeader = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()
const stripAngles = (v: unknown) => String(v ?? '').trim().replace(/^<|>$/g, '')
const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

function buildRawEmail(opts: {
  from: string, fromName: string,
  to: string | string[], subject: string,
  textBody: string, htmlBody?: string,
  messageId?: string, inReplyTo?: string, references?: string,
}): string {
  const boundary = `---boundary-${Date.now()}`
  const toList = (Array.isArray(opts.to) ? opts.to : [opts.to]).map(safeHeader).join(', ')
  const msgId = opts.messageId || `<${Date.now()}.${Math.random().toString(36).slice(2)}@romylabs.com>`
  const inReplyTo = stripAngles(opts.inReplyTo)
  const refs = safeHeader(opts.references)
  let raw = [
    `From: ${safeHeader(opts.fromName)} <${safeHeader(opts.from)}>`,
    `To: ${toList}`,
    `Subject: ${safeHeader(opts.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${msgId}`,
    inReplyTo ? `In-Reply-To: <${inReplyTo}>` : '',
    refs ? `References: ${refs}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean).join('\r\n')

  if (opts.htmlBody) {
    raw += `\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n`
    raw += `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${opts.textBody}\r\n`
    raw += `\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${opts.htmlBody}\r\n`
    raw += `\r\n--${boundary}--\r\n`
  } else {
    raw += `\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${opts.textBody}\r\n`
  }
  return raw
}

async function sendViaSMTP(opts: {
  smtpHost: string, smtpPort: number, useSsl: boolean,
  username: string, password: string,
  rawEmail: string, from: string, to: string[],
}) {
  const encoder = new TextEncoder(), decoder = new TextDecoder()
  let conn: Deno.TcpConn | Deno.TlsConn
  if (opts.smtpPort === 465 || opts.useSsl) conn = await Deno.connectTls({ hostname: opts.smtpHost, port: opts.smtpPort })
  else conn = await Deno.connect({ hostname: opts.smtpHost, port: opts.smtpPort })

  const read = async () => { const buf = new Uint8Array(8192); const n = await conn.read(buf); return decoder.decode(buf.subarray(0, n || 0)) }
  const write = async (s: string) => { await conn.write(encoder.encode(s + '\r\n')) }

  await read()
  await write('EHLO romylabs.com')
  await read()
  if (opts.smtpPort === 587 && !opts.useSsl) {
    await write('STARTTLS'); const tlsResp = await read()
    if (!tlsResp.startsWith('220')) throw new Error('SMTP STARTTLS rejected')
    conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: opts.smtpHost })
    await write('EHLO romylabs.com'); await read()
  }

  await write('AUTH LOGIN'); await read()
  await write(btoa(opts.username)); await read()
  await write(btoa(opts.password)); const authResp = await read()
  if (!authResp.startsWith('235')) throw new Error(`SMTP AUTH failed: ${authResp.slice(0, 100)}`)

  await write(`MAIL FROM:<${opts.from}>`); const mailResp = await read()
  if (!mailResp.startsWith('250')) throw new Error(`SMTP MAIL FROM rejected: ${mailResp.slice(0, 100)}`)
  for (const recipient of opts.to) {
    await write(`RCPT TO:<${recipient}>`); const rcptResp = await read()
    if (!rcptResp.startsWith('250') && !rcptResp.startsWith('251')) throw new Error(`SMTP recipient rejected: ${rcptResp.slice(0, 100)}`)
  }
  await write('DATA'); const dataReady = await read()
  if (!dataReady.startsWith('354')) throw new Error(`SMTP DATA rejected: ${dataReady.slice(0, 100)}`)
  await write(opts.rawEmail.replace(/\r?\n\./g, '\r\n..') + '\r\n.'); const dataResp = await read()
  if (!dataResp.startsWith('250')) throw new Error(`SMTP DATA rejected: ${dataResp.slice(0, 100)}`)
  await write('QUIT'); conn.close()
}

async function sendViaStalwartJmap(opts: {
  host: string, username: string, password: string, fromAddress: string, fromName: string,
  to: string[], subject: string, textBody: string, htmlBody?: string,
  messageId: string, inReplyTo?: string, references?: string, replyTo?: string,
}) {
  const base = `https://${String(opts.host || '').replace(/^https?:\/\//,'').replace(/\/$/,'')}`
  const auth = 'Basic ' + btoa(`${opts.username}:${opts.password}`)
  const sessionRes = await fetch(`${base}/.well-known/jmap`, { headers:{ Authorization:auth, Accept:'application/json' } })
  if (!sessionRes.ok) throw new Error(`Stalwart JMAP session failed (${sessionRes.status})`)
  const session = await sessionRes.json()
  const apiUrl = String(session?.apiUrl || '').replace('{accountId}','')
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || Object.keys(session?.accounts || {})[0]
  if (!apiUrl || !accountId) throw new Error('Stalwart JMAP session missing mail account')

  const metaRes = await fetch(apiUrl, {
    method:'POST',
    headers:{ Authorization:auth, 'Content-Type':'application/json', Accept:'application/json' },
    body:JSON.stringify({
      using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
      methodCalls:[
        ['Identity/get',{accountId},'i0'],
        ['Mailbox/get',{accountId,properties:['id','name','role']},'m0'],
      ],
    }),
  })
  if (!metaRes.ok) throw new Error(`Stalwart JMAP metadata failed (${metaRes.status})`)
  const meta = await metaRes.json()
  const identities = meta?.methodResponses?.find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list || []
  const mailboxes = meta?.methodResponses?.find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list || []
  const exactFrom = normalizeEmail(opts.fromAddress)
  const identity = identities.find((x:any)=>normalizeEmail(x?.email)===exactFrom)
  if (!identity?.id) throw new Error(`Stalwart does not authorize sender identity ${exactFrom}`)
  const drafts = mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='drafts')
  const sent = mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='sent')
  if (!drafts?.id || !sent?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')

  const partId = 'body'
  const replyTo = normalizeEmail(opts.replyTo)
  const createEmail:any = {
    from:[{email:exactFrom,name:opts.fromName||undefined}],
    to:opts.to.map(email=>({email})),
    ...(validEmail(replyTo) ? { replyTo:[{email:replyTo}] } : {}),
    subject:opts.subject,
    mailboxIds:{[drafts.id]:true},
    keywords:{'$draft':true},
    bodyValues:{[partId]:{value:opts.htmlBody || opts.textBody || '',charset:'utf-8'}},
    'header:Message-ID:asMessageIds':[stripAngles(opts.messageId)],
  }
  if (opts.inReplyTo) createEmail['header:In-Reply-To:asMessageIds']=[stripAngles(opts.inReplyTo)]
  const refs = String(opts.references || '').match(/<([^>]+)>|([^\s]+)/g)?.map((v:string)=>stripAngles(v)) || []
  if (refs.length) createEmail['header:References:asMessageIds']=refs
  if (opts.htmlBody) createEmail.htmlBody=[{partId,type:'text/html'}]
  else createEmail.textBody=[{partId,type:'text/plain'}]

  const sendRes = await fetch(apiUrl, {
    method:'POST',
    headers:{ Authorization:auth, 'Content-Type':'application/json', Accept:'application/json' },
    body:JSON.stringify({
      using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
      methodCalls:[
        ['Email/set',{accountId,create:{draft:createEmail}},'e0'],
        ['EmailSubmission/set',{
          accountId,
          create:{sendIt:{emailId:'#draft',identityId:identity.id}},
          onSuccessUpdateEmail:{'#sendIt':{
            [`mailboxIds/${drafts.id}`]:null,
            [`mailboxIds/${sent.id}`]:true,
            'keywords/$draft':null,
          }},
        },'s0'],
      ],
    }),
  })
  if (!sendRes.ok) throw new Error(`Stalwart JMAP send failed (${sendRes.status})`)
  const result = await sendRes.json()
  const emailSet = result?.methodResponses?.find((x:any)=>x?.[0]==='Email/set')?.[1]
  const emailError = emailSet?.notCreated?.draft
  if (emailError) throw new Error(`Stalwart JMAP draft rejected: ${emailError.description || emailError.type || 'unknown error'}`)
  const submission = result?.methodResponses?.find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const submissionError = submission?.notCreated?.sendIt
  if (submissionError) throw new Error(`Stalwart JMAP rejected send: ${submissionError.description || submissionError.type || 'unknown error'}`)
  if (!submission?.created?.sendIt?.id) throw new Error('Stalwart JMAP did not confirm message submission')
  return {
    submissionId:String(submission.created.sendIt.id),
    emailId:String(emailSet?.created?.draft?.id || ''),
    threadId:String(emailSet?.created?.draft?.threadId || ''),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY || !ENCRYPT_KEY) return new Response(JSON.stringify({ error:'Server email encryption is not configured' }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'} })
    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    const callerEmail = String(user?.email || '').toLowerCase()
    if (!callerEmail) return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const {data:tenantId}=await userClient.rpc('current_tenant_id')
    const {data:isPlatformAdmin}=await userClient.rpc('_is_platform_admin')

    const {
      account_id, route_id, to, subject, text_body, html_body, from_name,
      in_reply_to, references, client_id, case_id, thread_id,
    } = await req.json()

    const toList = (Array.isArray(to) ? to : [to]).map((x: unknown) => safeHeader(x)).filter(validEmail).slice(0, 25)
    if (!toList.length || !safeHeader(subject)) throw new Error('Recipient and subject are required')

    if (route_id) {
      const { data: route, error: routeError } = await svc.from('romylabs_mailboxes')
        .select('id,email_address,outbound_from,display_name,product_id,tenant_id,inbox_owner,active')
        .eq('id', route_id).eq('active', true).maybeSingle()
      if (routeError || !route) throw new Error('Mailbox route not found')

      const platformRouteAccess = !!isPlatformAdmin && ROMYLABS_ADMINS.has(callerEmail)
      const routeOwner = normalizeEmail(route.inbox_owner)
      const tenantRouteAccess = !!tenantId && route.tenant_id === tenantId && routeOwner === callerEmail

      if (!platformRouteAccess && !tenantRouteAccess) {
        return new Response(JSON.stringify({ error:'Not authorized for routed email' }), { status:403, headers:{...corsHeaders,'Content-Type':'application/json'} })
      }

      if (!platformRouteAccess) {
        const { data: employee } = await svc.from('employees')
          .select('status,perm_comms,tenant_id')
          .eq('tenant_id', tenantId)
          .ilike('email', callerEmail)
          .limit(1)
          .maybeSingle()
        const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
        if (!active || Number(employee?.perm_comms || 0) < 2) {
          return new Response(JSON.stringify({ error:'Email permission denied' }), { status:403, headers:{...corsHeaders,'Content-Type':'application/json'} })
        }
      }

      const exactFrom = normalizeEmail(route.outbound_from || route.email_address)
      const replyToAddress = normalizeEmail(route.email_address || exactFrom)
      if (!validEmail(exactFrom)) throw new Error('Mailbox route has no valid outbound identity')
      if (!validEmail(replyToAddress)) throw new Error('Mailbox route has no valid reply identity')

      const { data: transport, error: transportError } = await svc.rpc('romylabs_stalwart_transport_for_product', { p_product_key: route.product_id })
      if (transportError) throw transportError
      if (!transport?.ok || !transport?.host || !transport?.username || !transport?.password) {
        throw new Error(`Stalwart transport unavailable for ${route.product_id}: ${transport?.error || 'credential missing'}`)
      }

      const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${exactFrom.split('@')[1] || 'romylabs.com'}>`
      const sent = await sendViaStalwartJmap({
        host:String(transport.host),
        username:String(transport.username),
        password:String(transport.password),
        fromAddress:exactFrom,
        fromName:from_name || route.display_name || exactFrom,
        to:toList,
        subject:safeHeader(subject),
        textBody:String(text_body || ''),
        htmlBody:html_body ? String(html_body) : undefined,
        messageId:msgId,
        inReplyTo:stripAngles(in_reply_to),
        references:safeHeader(references),
        replyTo:replyToAddress,
      })

      const storedThreadId = thread_id || stripAngles(in_reply_to) || sent.threadId || msgId
      const { error: logError } = await svc.from('emails').insert([{
        tenant_id: route.tenant_id,
        message_id: msgId,
        thread_id: storedThreadId,
        mailbox_owner: route.inbox_owner || callerEmail,
        sender: exactFrom,
        from_address: exactFrom,
        recipients: toList,
        recipient: toList[0],
        subject: safeHeader(subject),
        body: String(text_body || ''),
        body_html: html_body ? String(html_body) : '',
        direction: 'outbound',
        triage: 'Sent',
        status: 'Sent',
        is_read: true,
        client_id,
        case_id,
        received_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        received_mailbox: route.email_address,
        reply_from: replyToAddress,
        product_id: route.product_id,
        in_reply_to: cleanNullable(in_reply_to),
        references_header: cleanNullable(references),
        route_id: route.id,
      }])
      if (logError) throw logError

      return new Response(JSON.stringify({
        ok:true,
        message_id:msgId,
        from:exactFrom,
        reply_to:replyToAddress,
        mailbox_owner:route.inbox_owner || callerEmail,
        route_id:route.id,
        submission_id:sent.submissionId,
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    if(!tenantId) return new Response(JSON.stringify({error:'No active office context'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}})
    const {data:employee}=await svc.from('employees').select('status,perm_comms,tenant_id').eq('tenant_id',tenantId).ilike('email',callerEmail).limit(1).maybeSingle()
    const active=employee&&String(employee.status||'Active').toLowerCase()==='active'
    if(!isPlatformAdmin&&(!active||Number(employee?.perm_comms||0)<2)) return new Response(JSON.stringify({error:'Email permission denied'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}})

    let accountQuery = svc.from('email_accounts').select('*').eq('is_active', true).eq('tenant_id',tenantId)
    if (account_id) accountQuery = accountQuery.eq('id', account_id).ilike('employee_email', callerEmail)
    else accountQuery = accountQuery.ilike('employee_email', callerEmail)

    const { data: account, error: accountError } = await accountQuery.limit(1).maybeSingle()
    if (accountError) throw accountError
    if (!account) return new Response(JSON.stringify({ error: `No active SMTP account configured for ${callerEmail}` }), { status:409, headers:{...corsHeaders,'Content-Type':'application/json'} })

    const { data: password, error: decryptError } = await svc.rpc('decrypt_email_password', { p_encrypted: account.encrypted_password, p_key: ENCRYPT_KEY })
    if (decryptError || !password) throw new Error('Could not decrypt email password')

    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${String(account.email_address).split('@')[1] || 'romylabs.com'}>`
    const rawEmail = buildRawEmail({
      from: account.email_address,
      fromName: from_name || account.display_name || account.email_address,
      to: toList,
      subject: safeHeader(subject),
      textBody: String(text_body || ''),
      htmlBody: html_body ? String(html_body) : undefined,
      messageId: msgId,
      inReplyTo: stripAngles(in_reply_to),
      references: safeHeader(references),
    })

    await sendViaSMTP({
      smtpHost: account.smtp_host, smtpPort: account.smtp_port, useSsl: account.use_ssl,
      username: account.email_address, password, rawEmail, from: account.email_address, to: toList,
    })

    await svc.from('emails').insert([{
      tenant_id: account.tenant_id,
      email_account_id: account.id,
      message_id: msgId,
      thread_id: thread_id || stripAngles(in_reply_to) || msgId,
      mailbox_owner: account.employee_email,
      sender: account.email_address,
      from_address: account.email_address,
      recipients: toList,
      recipient: toList[0],
      subject: safeHeader(subject),
      body: String(text_body || ''),
      body_html: html_body ? String(html_body) : '',
      direction: 'outbound',
      triage: 'Sent',
      status: 'Sent',
      is_read: true,
      client_id,
      case_id,
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }])

    return new Response(JSON.stringify({ ok: true, message_id: msgId, from: account.email_address }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('smtp-send error:', err)
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function normalizeEmail(v: unknown) { return String(v ?? '').trim().toLowerCase() }
function cleanNullable(v: unknown) { const s = safeHeader(v); return s || null }
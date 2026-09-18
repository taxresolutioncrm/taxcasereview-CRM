import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-qa-certification',
}
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const BOOKING_KINDS = new Set([
  'booking_confirmation', 'booking_firm_notification',
  'booking_cancel_confirmation', 'booking_cancel_firm_notification',
  'booking_reschedule_firm_notification',
])
const PRODUCT_BRANDS: any = {
  romylabs: { name: 'RomyLabs', email: 'romy@romylabs.com' },
  camvella: { name: 'Camvella', email: 'romy@camvella.com' },
  arcvena: { name: 'Arcvena', email: 'romy@arcvena.com' },
  bocasync: { name: 'BocaSync', email: 'romy@bocasync.com' },
}
const safe = (v: any) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
function b64url(s: string) { const u = new TextEncoder().encode(s); let b = ''; u.forEach(x => b += String.fromCharCode(x)); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function enc(s: string) { if (!s || /^[\x00-\x7F]*$/.test(s)) return s; const u = new TextEncoder().encode(s); let b = ''; u.forEach(x => b += String.fromCharCode(x)); return `=?UTF-8?B?${btoa(b)}?=` }
function fmt12(t: string) { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
function whenLong(d: string, t: string) { return `${new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${fmt12(t)} (Eastern)` }
function whenShort(d: string, t: string) { return `${new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${fmt12(t)}` }

async function gmailToken(sb: any, s: any) {
  const exp = s.gmail_token_expiry ? new Date(s.gmail_token_expiry).getTime() : 0
  if (s.gmail_access_token && exp > Date.now() + 60000) return s.gmail_access_token
  const body = new URLSearchParams({ refresh_token: s.gmail_refresh_token, client_id: s.gmail_client_id, client_secret: s.gmail_client_secret, grant_type: 'refresh_token' })
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error_description || d.error || 'Gmail token refresh failed')
  await sb.from('settings').update({ gmail_access_token: d.access_token, gmail_token_expiry: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString() }).eq('id', s.id)
  return d.access_token
}

function raw(o: any) {
  const atts = o.atts || []
  const from = `${enc(safe(o.fromName))} <${safe(o.from)}>`
  if (atts.length) {
    const bd = `tcr_${crypto.randomUUID()}`
    const h = [`To: ${safe(o.to)}`, `From: ${from}`, ...(o.replyTo ? [`Reply-To: ${safe(o.replyTo)}`] : []), `Subject: ${enc(safe(o.subject))}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${bd}"`].join('\r\n')
    const body = `--${bd}\r\nContent-Type: ${o.isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"\r\n\r\n${o.body}\r\n`
    const ap = atts.map((a: any) => `--${bd}\r\nContent-Type: ${a.contentType || 'application/octet-stream'}\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${safe(a.filename) || 'attachment'}"\r\n\r\n${a.b64.match(/.{1,76}/g)?.join('\r\n') || a.b64}\r\n`).join('')
    return `${h}\r\n\r\n${body}${ap}--${bd}--`
  }
  const h = [`To: ${safe(o.to)}`, `From: ${from}`, ...(o.replyTo ? [`Reply-To: ${safe(o.replyTo)}`] : []), `Subject: ${enc(safe(o.subject))}`, `Date: ${new Date().toUTCString()}`, `Content-Type: ${o.isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"`, 'MIME-Version: 1.0'].join('\r\n')
  return `${h}\r\n\r\n${o.body}`
}

async function sendViaStalwartJmap(opts: { host:string, username:string, password:string, fromAddress?:string, replyTo?:string, fromName:string, to:string, subject:string, html?:string, text?:string }) {
  const base = `https://${opts.host.replace(/^https?:\/\//,'').replace(/\/$/,'')}`
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
  const identityList = meta?.methodResponses?.find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list || []
  const mailboxes = meta?.methodResponses?.find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list || []
  const fromAddress = safe(opts.fromAddress || opts.username).toLowerCase()
  const identity = identityList.find((x:any)=>String(x?.email||'').toLowerCase()===fromAddress)
  const drafts = mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='drafts')
  const sentBox = mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='sent')
  if (!identity?.id) throw new Error(`Stalwart does not authorize sender identity ${fromAddress}`)
  if (!drafts?.id || !sentBox?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')

  const bodyPartId='body'
  const createEmail:any = {
    from:[{email:fromAddress,name:opts.fromName||undefined}],
    to:[{email:opts.to}],
    ...(opts.replyTo ? {replyTo:[{email:opts.replyTo}]} : {}),
    subject:opts.subject,
    mailboxIds:{[drafts.id]:true},
    keywords:{'$draft':true},
    bodyValues:{[bodyPartId]:{value:opts.html || opts.text || '',charset:'utf-8'}},
  }
  if (opts.html) createEmail.htmlBody=[{partId:bodyPartId,type:'text/html'}]
  else createEmail.textBody=[{partId:bodyPartId,type:'text/plain'}]

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
          onSuccessUpdateEmail:{
            '#sendIt':{
              [`mailboxIds/${drafts.id}`]:null,
              [`mailboxIds/${sentBox.id}`]:true,
              'keywords/$draft':null,
            },
          },
        },'s0'],
      ],
    }),
  })
  if (!sendRes.ok) throw new Error(`Stalwart JMAP send failed (${sendRes.status})`)
  const sent = await sendRes.json()
  const submission = sent?.methodResponses?.find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const notCreated = submission?.notCreated?.sendIt
  if (notCreated) throw new Error(`Stalwart JMAP rejected send: ${notCreated.description || notCreated.type || 'unknown error'}`)
  if (!submission?.created?.sendIt?.id) throw new Error('Stalwart JMAP did not confirm message submission')
  return { submissionId:String(submission.created.sendIt.id), accountId:String(accountId) }
}

async function sendSmtpRaw(opts: { host:string, port:number, ssl:boolean, username:string, password:string, fromAddress?:string, fromName:string, to:string, subject:string, html?:string, text?:string }) {
  const encoder=new TextEncoder(), decoder=new TextDecoder()
  let conn:Deno.TcpConn|Deno.TlsConn
  if(opts.port===465||opts.ssl) conn=await Deno.connectTls({hostname:opts.host,port:opts.port})
  else conn=await Deno.connect({hostname:opts.host,port:opts.port})
  const read=async()=>{const buf=new Uint8Array(16384);const n=await conn.read(buf);return decoder.decode(buf.subarray(0,n||0))}
  const write=async(s:string)=>{await conn.write(encoder.encode(s+'\r\n'))}
  const expect=(resp:string,codes:string[],step:string)=>{if(!codes.some(c=>resp.startsWith(c))) throw new Error(`${step} failed: ${resp.slice(0,160)}`)}

  let resp=await read(); expect(resp,['220'],'SMTP connect')
  await write('EHLO romylabs.com'); resp=await read(); expect(resp,['250'],'SMTP EHLO')
  if(opts.port===587&&!opts.ssl){
    await write('STARTTLS'); resp=await read(); expect(resp,['220'],'SMTP STARTTLS')
    conn=await Deno.startTls(conn as Deno.TcpConn,{hostname:opts.host})
    await write('EHLO romylabs.com'); resp=await read(); expect(resp,['250'],'SMTP EHLO after TLS')
  }
  await write('AUTH LOGIN'); await read()
  await write(btoa(opts.username)); await read()
  await write(btoa(opts.password)); resp=await read(); expect(resp,['235'],'SMTP authentication')
  const envelopeFrom=safe(opts.fromAddress||opts.username)
  await write(`MAIL FROM:<${envelopeFrom}>`); resp=await read(); expect(resp,['250'],'SMTP MAIL FROM')
  await write(`RCPT TO:<${opts.to}>`); resp=await read(); expect(resp,['250','251'],'SMTP recipient')
  await write('DATA'); resp=await read(); expect(resp,['354'],'SMTP DATA')

  const body=opts.html||opts.text||''
  const contentType=opts.html?'text/html':'text/plain'
  const headers=[
    `From: ${enc(safe(opts.fromName))} <${envelopeFrom}>`,
    `To: ${safe(opts.to)}`,
    `Subject: ${enc(safe(opts.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}; charset="UTF-8"`,
  ].join('\r\n')
  const payload=(headers+'\r\n\r\n'+body).replace(/\r?\n\./g,'\r\n..')
  await write(payload+'\r\n.'); resp=await read(); expect(resp,['250'],'SMTP message acceptance')
  await write('QUIT')
  conn.close()
}

async function normalizeDocUrl(admin: any, baseUrl: string, input: string) {
  try {
    const u = new URL(input), host = new URL(baseUrl).hostname
    if (u.protocol !== 'https:' || u.hostname !== host) return null
    const pub = '/storage/v1/object/public/documents/', sign = '/storage/v1/object/sign/documents/'
    let path = ''
    if (u.pathname.includes(pub)) path = decodeURIComponent(u.pathname.split(pub)[1] || '')
    else if (u.pathname.includes(sign)) { path = decodeURIComponent(u.pathname.split(sign)[1] || ''); if (path) return input }
    else return null
    if (!path) return null
    const { data, error } = await admin.storage.from('documents').createSignedUrl(path, 604800)
    return error ? null : data?.signedUrl || null
  } catch { return null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  try {
    const body = await req.json()
    const url = Deno.env.get('SUPABASE_URL') ?? '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    if (!url || !service || !anon) return new Response(JSON.stringify({ error: 'Server configuration missing' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    const admin = createClient(url, service)
    let authenticated = false, authenticatedUser: any = null, authClient: any = null, resolvedTenantId: string | null = null, esignIdToMark: string | null = null
    const auth = req.headers.get('authorization') || ''
    if (auth.startsWith('Bearer ')) {
      const jwt = auth.slice(7)
      authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
      const { data } = await authClient.auth.getUser(jwt)
      authenticatedUser = data?.user || null
      authenticated = !!authenticatedUser
      if (authenticated) {
        const { data: tenant } = await authClient.rpc('current_tenant_id')
        resolvedTenantId = tenant || null
      }
    }

    let { to, subject, html, text, attachments, tenant_id, from_email, from_name } = body
    const requestOrigin = safe(req.headers.get('origin')).toLowerCase()
    const isAdminPortalOrigin = requestOrigin === 'https://admin.romylabs.com'

    // Booking invitations sent from the RomyLabs Admin Portal are a RomyLabs
    // communication. Never allow them to inherit TaxRes branding or transport.
    const looksLikeBookingInvite =
      authenticated &&
      isAdminPortalOrigin &&
      /^Schedule Your Appointment/i.test(safe(subject)) &&
      String(html || '').includes('Choose a Time')

    if (looksLikeBookingInvite) {
      const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
      if (!isPlatformAdmin) {
        return new Response(JSON.stringify({ error:'Platform admin required for RomyLabs booking email' }), {
          status:403, headers:{...corsHeaders,'Content-Type':'application/json'}
        })
      }

      const recipient = safe(Array.isArray(to) ? to[0] : to).toLowerCase()
      if (!recipient) {
        return new Response(JSON.stringify({ error:'Booking recipient missing' }), {
          status:422, headers:{...corsHeaders,'Content-Type':'application/json'}
        })
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || /@(gamil|gmial|gmai|gmail\.co)$/i.test(recipient)) {
        return new Response(JSON.stringify({ error:'Booking recipient email looks mistyped' }), {
          status:422, headers:{...corsHeaders,'Content-Type':'application/json'}
        })
      }

      const firstMatch = String(html || '').match(/Hi\s*<strong>([^<]+)<\/strong>/i)
      const firstName = safe(firstMatch?.[1] || 'there')
      const linkMatch = String(html || '').match(/href="([^"]+)"[^>]*>📅\s*Choose a Time/i)
      let bookingLink = safe(linkMatch?.[1] || 'https://admin.romylabs.com/book')
      try {
        const bookingUrl = new URL(bookingLink, 'https://admin.romylabs.com')
        bookingUrl.searchParams.delete('t')
        bookingUrl.searchParams.set('product','romylabs')
        bookingLink = bookingUrl.toString()
      } catch {
        bookingLink = 'https://admin.romylabs.com/book?product=romylabs'
      }

      const romylabsLogo = 'https://admin.romylabs.com/romylabs-logo.png'
      const romylabsFrom = 'info@romylabs.com'
      from_name = 'RomyLabs'
      from_email = romylabsFrom
      subject = 'Schedule Your Appointment — RomyLabs'
      html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
<tr><td style="background:#090816;padding:28px 40px;text-align:center">
<img src="${romylabsLogo}" alt="RomyLabs" style="max-height:64px;max-width:220px;object-fit:contain;display:block;margin:0 auto 10px"/>
<div style="font-size:13px;font-weight:800;color:#C6FF00;letter-spacing:.12em;text-transform:uppercase">ROMYLABS</div>
</td></tr>
<tr><td style="padding:36px 40px;color:#111827;font-size:14px;line-height:1.7">
<p>Hi <strong>${esc(firstName)}</strong>,</p>
<p>Pick whichever time works best for you — it takes less than a minute:</p>
<p style="text-align:center;margin:24px 0"><a href="${esc(bookingLink)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p>
<p>You'll see our live availability and get an instant confirmation. If nothing there works, just reply to this email.</p>
<p style="margin-top:20px">Talk soon,<br><strong>RomyLabs</strong></p>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center">
<p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">RomyLabs<br>✉️ info@romylabs.com</p>
</td></tr></table></td></tr></table></body></html>`

      const { data: routes } = await admin.from('romylabs_mailboxes')
        .select('id,product_id,email_address,outbound_from,inbox_owner,tenant_id,display_name,active')
        .eq('product_id','romylabs')
        .eq('active',true)
        .order('created_at',{ascending:true})

      const routeList = Array.isArray(routes) ? routes : []
      const route = routeList.find((r:any)=>safe(r.outbound_from).toLowerCase()===romylabsFrom)
      if (!route) {
        return new Response(JSON.stringify({ error:'RomyLabs outbound mailbox route is not configured' }), {
          status:409, headers:{...corsHeaders,'Content-Type':'application/json'}
        })
      }

      // Use the proven TaxRes Stalwart transport for delivery while keeping
      // RomyLabs branding and Reply-To. This avoids the broken RomyLabs-domain
      // outbound-auth path without falling back to Gmail.
      let transport:any = null
      const { data: vaultTransport } = await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:'taxres_crm'})
      if (vaultTransport?.ok) {
        transport = {
          host:safe(vaultTransport.host||'mail.taxrescrm.net'),
          port:Number(vaultTransport.port||465),
          ssl:true,
          username:safe(vaultTransport.username),
          password:String(vaultTransport.password||''),
          fromAddress:safe(vaultTransport.from_address||vaultTransport.username).toLowerCase(),
        }
      } else {
        const { data: account } = await admin.from('email_accounts')
          .select('smtp_host,smtp_port,email_address,encrypted_password,use_ssl')
          .eq('tenant_id',route.tenant_id)
          .ilike('email_address',romylabsFrom)
          .eq('is_active',true)
          .limit(1)
          .maybeSingle()
        if (account?.encrypted_password) {
          const encryptKey = Deno.env.get('EMAIL_ENCRYPT_KEY')
          if (encryptKey) {
            const { data: password } = await admin.rpc('decrypt_email_password',{
              p_encrypted:account.encrypted_password,
              p_key:encryptKey,
            })
            if (password) {
              transport = {
                host:safe(account.smtp_host),
                port:Number(account.smtp_port||465),
                ssl:Boolean(account.use_ssl),
                username:safe(account.email_address),
                password:String(password),
              }
            }
          }
        }
      }

      if (!transport?.username || !transport?.password) {
        return new Response(JSON.stringify({
          error:'RomyLabs outbound email credential is not configured. TaxRes fallback is blocked.'
        }), {
          status:409, headers:{...corsHeaders,'Content-Type':'application/json'}
        })
      }

      const sendResult = await sendViaStalwartJmap({
        host:transport.host,
        username:transport.username,
        password:transport.password,
        fromAddress:safe(transport.fromAddress||transport.username).toLowerCase(),
        replyTo:romylabsFrom,
        fromName:'RomyLabs',
        to:recipient,
        subject:safe(subject),
        html:String(html),
      })

      await admin.from('emails').insert([{
        tenant_id:route.tenant_id||resolvedTenantId,
        recipient,
        recipients:[recipient],
        subject:safe(subject),
        body:String(html).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
        body_html:String(html),
        triage:'Sent',status:'Sent',direction:'outbound',is_read:true,
        sender:safe(transport.fromAddress||transport.username).toLowerCase(),from_address:safe(transport.fromAddress||transport.username).toLowerCase(),reply_from:romylabsFrom,
        mailbox_owner:safe(route.inbox_owner||'info@romylabs.com'),
        received_at:new Date().toISOString(),created_at:new Date().toISOString(),
        product_id:'romylabs',
        message_id:`stalwart:${sendResult.submissionId}`,
        received_mailbox:safe(transport.fromAddress||transport.username).toLowerCase(),
        route_id:route.id,
      }])

      return new Response(JSON.stringify({
        success:true, via:'stalwart_proven_route', from:safe(transport.fromAddress||transport.username).toLowerCase(), reply_to:romylabsFrom, product:'romylabs'
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    if (authenticated) {
      if (!resolvedTenantId) return new Response(JSON.stringify({ error: 'No active office context' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
      const { data: employee } = await admin.from('employees').select('id,status,perm_comms,tenant_id').eq('tenant_id', resolvedTenantId).ilike('email', authenticatedUser?.email || '').limit(1).maybeSingle()
      const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
      if (!isPlatformAdmin && (!active || Number(employee?.perm_comms || 0) < 2)) return new Response(JSON.stringify({ error: 'Email permission denied' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      // Never trust a tenant supplied by the browser. The authenticated session
      // decides which office may send this message.
      tenant_id = resolvedTenantId
    } else {
      if (body.kind === 'esign_signed_copy') {
        if (!body.esign_id) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        const { data: e, error } = await admin.from('esigns').select('id,status,client_email,client_name,doc_type,tenant_id,signed_attachments,signed_at,signed_copy_sent_at').eq('id', String(body.esign_id)).maybeSingle()
        if (error || !e || e.status !== 'Signed') return new Response(JSON.stringify({ error: 'Invalid signing request' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        if (e.signed_copy_sent_at) return new Response(JSON.stringify({ success: true, already_sent: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        if (!e.client_email) return new Response(JSON.stringify({ error: 'Signing request has no email' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        tenant_id = e.tenant_id; to = e.client_email; esignIdToMark = e.id
        const { data: ts } = await admin.from('settings').select('name,firmname,email,firmemail,smtp_email,tenant_id').eq('tenant_id', tenant_id).maybeSingle()
        const brandName = ts?.name || ts?.firmname || 'TaxRes CRM', reply = ts?.email || ts?.firmemail || ts?.smtp_email || 'romy@taxrescrm.net'
        from_name = brandName; from_email = reply
        subject = `Signed Copy: ${safe(e.doc_type || 'Document')} — ${safe(brandName)}`
        const signedDate = e.signed_at ? new Date(e.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : new Date().toLocaleDateString('en-US')
        const normalized: any[] = []
        for (const a of (Array.isArray(e.signed_attachments) ? e.signed_attachments : []).slice(0, 10)) {
          const source = a?.clientUrl || a?.url
          if (!source) continue
          const su = await normalizeDocUrl(admin, url, source)
          if (su) normalized.push({ url: su, filename: `${String(a.label || a.formType || 'Document').replace(/[\\/:*?"<>|]+/g, '')} - Signed.pdf`, label: a.label || a.formType || 'Signed Document' })
        }
        attachments = normalized.map(a => ({ url: a.url, filename: a.filename }))
        const links = normalized.map(a => `<li><a href="${esc(a.url)}">${esc(a.label)} — Your Signed Copy</a></li>`).join('')
        html = `<p>Dear <strong>${esc(e.client_name || 'Client')}</strong>,</p><p>Thank you — your signed <strong>${esc(e.doc_type || 'document')}</strong> was received on ${esc(signedDate)} and saved to your file.</p>${links ? `<p><strong>Your signed copies:</strong></p><ul>${links}</ul>` : ''}<p>If anything looks wrong, reply to this email and we will correct it.</p><p>Sincerely,<br><strong>${esc(brandName)}</strong></p>`
      } else if (body.kind === 'employee_timeoff_notification') {
        const token = safe(body.employee_portal_token)
        if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        const { data: session } = await admin.from('employee_portal_sessions').select('employee_id,employee_name,tenant_id,expires_at').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
        if (!session?.tenant_id || !session?.employee_id) return new Response(JSON.stringify({ error: 'Invalid or expired employee session' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        const typ = safe(body.request_type).toLowerCase(), start = safe(body.start_date), end = safe(body.end_date), days = Number(body.days)
        if (!['pto', 'sick', 'vacation'].includes(typ) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(days) || days <= 0 || days > 366) return new Response(JSON.stringify({ error: 'Invalid time-off request' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        const { data: reqRow } = await admin.from('time_off_requests').select('id,employee_id,employee_name,tenant_id,type,start_date,end_date,days,status').eq('tenant_id', session.tenant_id).eq('employee_id', session.employee_id).eq('type', typ).eq('start_date', start).eq('end_date', end).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!reqRow) return new Response(JSON.stringify({ error: 'Matching time-off request not found' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        const { data: admins } = await admin.from('employees').select('email').eq('tenant_id', session.tenant_id).in('access', ['Super Admin', 'Admin']).not('email', 'is', null)
        const recipients = [...new Set((admins || []).map((x: any) => safe(x.email)).filter(Boolean))]
        if (!recipients.length) return new Response(JSON.stringify({ success: true, skipped: 'no_admin_recipient' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        tenant_id = session.tenant_id; to = recipients; attachments = []
        const { data: ts } = await admin.from('settings').select('name,firmname,email,firmemail,smtp_email,tenant_id').eq('tenant_id', tenant_id).maybeSingle()
        const brandName = ts?.name || ts?.firmname || 'TaxRes CRM', reply = ts?.email || ts?.firmemail || ts?.smtp_email || 'romy@taxrescrm.net'
        from_name = brandName; from_email = reply
        subject = `Time off request — ${safe(session.employee_name || reqRow.employee_name || 'Employee')}`
        html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px"><div style="font-size:18px;font-weight:800;color:#1d4ed8;margin-bottom:16px">${esc(brandName)}</div><p><strong>${esc(session.employee_name || reqRow.employee_name || 'Employee')}</strong> requested ${esc(typ.toUpperCase())} time off.</p><p>${esc(start)} to ${esc(end)} (${esc(reqRow.days ?? days)} day${Number(reqRow.days ?? days) === 1 ? '' : 's'})</p><p style="font-size:12px;color:#64748b">Review and approve or deny it in the CRM under Time Off.</p></div>`
      } else {
        if (!BOOKING_KINDS.has(body.kind) || !body.booking_token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        const { data: ev, error: evErr } = await admin.from('calevents').select('booking_token,clientName,eventType,date,time,contact_email,tenant_id,product_id,status').eq('booking_token', String(body.booking_token)).maybeSingle()
        if (evErr || !ev) return new Response(JSON.stringify({ error: 'Invalid booking token' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        tenant_id = ev.tenant_id; attachments = []
        const { data: ts } = await admin.from('settings').select('name,firmname,email,firmemail,smtp_email,tenant_id').eq('tenant_id', tenant_id).maybeSingle()
        const product = String(ev.product_id || 'taxres_crm'), pb = PRODUCT_BRANDS[product]
        const brandName = pb?.name || ts?.name || ts?.firmname || 'TaxRes CRM', reply = pb?.email || ts?.email || ts?.firmemail || ts?.smtp_email || 'romy@taxrescrm.net'
        from_name = brandName; from_email = reply
        const n = esc(ev.clientName || 'there'), typ = esc(ev.eventType || 'Appointment'), d = String(ev.date), t = String(ev.time).slice(0, 5), when = esc(whenLong(d, t))
        if (body.kind === 'booking_confirmation') {
          if (!ev.contact_email) return new Response(JSON.stringify({ error: 'Booking has no email' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          to = ev.contact_email; subject = `Appointment Confirmed — ${safe(ev.eventType || 'Appointment')}, ${whenShort(d, t)}`; html = `<p>Hi <strong>${n}</strong>,</p><p>Your appointment is confirmed:</p><p><strong>${typ}</strong><br>${when}</p><p>Need to make a change? Reply to this email and we’ll take care of it.</p><p>Talk soon,<br><strong>${esc(brandName)}</strong></p>`
        } else if (body.kind === 'booking_cancel_confirmation') {
          if (!ev.contact_email) return new Response(JSON.stringify({ error: 'Booking has no email' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          to = ev.contact_email; subject = `Appointment Canceled — ${safe(ev.eventType || 'Appointment')}, ${whenShort(d, t)}`; html = `<p>Hi <strong>${n}</strong>,</p><p>Your <strong>${typ}</strong> on ${when} has been canceled.</p><p>If you need a new time, reply to this email and we’ll help.</p><p><strong>${esc(brandName)}</strong></p>`
        } else if (body.kind === 'booking_cancel_firm_notification') {
          to = reply; subject = `Booking canceled: ${safe(ev.clientName || 'Client')} — ${whenShort(d, t)}`; html = `<p><strong>${n}</strong> canceled their <strong>${typ}</strong> on ${when}. The slot is open again.</p>`
        } else if (body.kind === 'booking_reschedule_firm_notification') {
          to = reply; subject = `Booking rescheduled: ${safe(ev.clientName || 'Client')} — ${whenShort(d, t)}`; html = `<p><strong>${n}</strong> rescheduled their <strong>${typ}</strong> to ${when}. The calendar is already updated.</p>`
        } else {
          to = reply; subject = `New booking: ${safe(ev.clientName || 'Client')} — ${whenShort(d, t)}`; html = `<p><strong>${n}</strong> just booked online:</p><p><strong>${typ}</strong><br>${when}<br>Email: ${esc(ev.contact_email || '—')}</p><p>The appointment is on the CRM calendar.</p>`
        }
      }
    }

    if (!to || !subject || (!html && !text)) return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    let q = admin.from('settings').select('*'); if (tenant_id) q = q.eq('tenant_id', tenant_id); else q = q.limit(1)
    const { data: ts } = await q.maybeSingle()

    // Admin Portal office e-sign requests must use the exact product SMTP identity.
    // Never fall back to the first Gmail OAuth mailbox for contracts.
    const looksLikeOfficeEsign =
      authenticated &&
      (
        body.kind === 'office_esign_request' ||
        (
          /^Signature Requested:/i.test(safe(subject)) &&
          String(html || '').includes('/office-sign/') &&
          safe(from_email).includes('@')
        )
      )

    if (looksLikeOfficeEsign) {
      const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
      if (!isPlatformAdmin) return new Response(JSON.stringify({ error:'Platform admin required for office contract email' }), { status:403, headers:{...corsHeaders,'Content-Type':'application/json'} })

      const requestedProduct=safe(body.product_key).toLowerCase()
      const externalOfficeId=safe(body.external_office_id)
      if (!requestedProduct || !externalOfficeId) {
        return new Response(JSON.stringify({ error:'Selected office identity is required for contract delivery' }), { status:422, headers:{...corsHeaders,'Content-Type':'application/json'} })
      }

      // The selected office is the authority. Never trust a browser-supplied From address.
      const { data: registeredOffice, error: officeError } = await admin.from('romylabs_office_registry')
        .select('product_key,external_office_id,firm_name,status')
        .eq('product_key',requestedProduct)
        .eq('external_office_id',externalOfficeId)
        .maybeSingle()
      if (officeError || !registeredOffice) {
        return new Response(JSON.stringify({ error:'Selected office is not registered with RomyLabs' }), { status:409, headers:{...corsHeaders,'Content-Type':'application/json'} })
      }

      const { data: routes, error: routeError } = await admin.from('romylabs_mailboxes')
        .select('id,product_id,email_address,outbound_from,inbox_owner,tenant_id,display_name,active')
        .eq('product_id',requestedProduct)
        .eq('active',true)
        .order('created_at',{ascending:true})
      if (routeError) return new Response(JSON.stringify({ error:'Contract mailbox route lookup failed' }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'} })

      const routeList=Array.isArray(routes)?routes:[]
      let route=routeList.find((r:any)=>safe(r.outbound_from).toLowerCase().startsWith('romy@'))||routeList[0]
      if (!route) {
        return new Response(JSON.stringify({ error:`No active RomyLabs sender is registered for ${requestedProduct}` }), { status:409, headers:{...corsHeaders,'Content-Type':'application/json'} })
      }
      let routedFrom=safe(route.outbound_from).toLowerCase()

      // Prefer the encrypted product Stalwart credential in Vault. The credential
      // resolver also identifies which active mailbox route belongs to that login.
      // This allows products whose real Stalwart identity is info@ or support@
      // without weakening same-domain routing.
      let transport:any=null
      const { data: vaultTransport } = await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:requestedProduct})
      if (vaultTransport?.ok) {
        transport={
          host:safe(vaultTransport.host||'mail.taxrescrm.net'),
          port:Number(vaultTransport.port||465),
          ssl:true,
          username:safe(vaultTransport.username),
          password:String(vaultTransport.password||''),
        }
        const resolvedFrom=safe(vaultTransport.from_address||vaultTransport.username).toLowerCase()
        const credentialRoute=routeList.find((r:any)=>safe(r.outbound_from).toLowerCase()===resolvedFrom)
        if (!credentialRoute) {
          return new Response(JSON.stringify({ error:`No active mailbox route matches the Stalwart credential for ${requestedProduct}` }), { status:409, headers:{...corsHeaders,'Content-Type':'application/json'} })
        }
        route=credentialRoute
        routedFrom=safe(route.outbound_from).toLowerCase()
      } else {
        const { data: smtpSettings } = await admin.from('settings')
          .select('smtp_host,smtp_port,smtp_email,smtp_password,smtp_encryption')
          .ilike('smtp_email',routedFrom).limit(1).maybeSingle()
        if (smtpSettings?.smtp_host && smtpSettings?.smtp_email && smtpSettings?.smtp_password) {
          transport={
            host:safe(smtpSettings.smtp_host),
            port:Number(smtpSettings.smtp_port||465),
            ssl:String(smtpSettings.smtp_encryption||'').toLowerCase()==='ssl'||Number(smtpSettings.smtp_port||465)===465,
            username:safe(smtpSettings.smtp_email),
            password:String(smtpSettings.smtp_password),
          }
        }
      }
      if (!transport?.username || !transport?.password) {
        return new Response(JSON.stringify({ error:`Stalwart credential is not available to the Admin Portal for ${requestedProduct}` }), { status:409, headers:{...corsHeaders,'Content-Type':'application/json'} })
      }

      const recipients=(Array.isArray(to)?to:[to]).map((x:any)=>safe(x)).filter(Boolean).slice(0,25)
      if (!recipients.length) return new Response(JSON.stringify({ error:'Contract recipient missing' }), { status:422, headers:{...corsHeaders,'Content-Type':'application/json'} })

      const deliveries:any[]=[]
      for (const recipient of recipients) {
        const result=await sendViaStalwartJmap({
          host:transport.host,
          username:transport.username,
          password:transport.password,
          fromAddress:routedFrom,
          fromName:safe(route.display_name||from_name||registeredOffice.firm_name||'RomyLabs'),
          to:recipient,
          subject:safe(subject),
          html:html?String(html):undefined,
          text:text?String(text):undefined,
        })
        deliveries.push({recipient,submissionId:result.submissionId})
      }

      await admin.from('emails').insert(deliveries.map((delivery:any)=>({
        tenant_id:route.tenant_id||tenant_id,
        recipient:delivery.recipient,
        recipients:[delivery.recipient],
        subject:safe(subject),
        body:text?String(text):String(html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
        body_html:html?String(html):'',
        triage:'Sent',status:'Sent',direction:'outbound',is_read:true,
        sender:routedFrom,from_address:routedFrom,reply_from:routedFrom,
        mailbox_owner:safe(route.inbox_owner||authenticatedUser?.email||'info@romylabs.com'),
        received_at:new Date().toISOString(),created_at:new Date().toISOString(),
        product_id:requestedProduct,
        message_id:`stalwart:${delivery.submissionId}`,
        received_mailbox:routedFrom,
        route_id:route.id,
      })))

      let esignStateSync:any=null
      const signMatch=String(html||'').match(/\/office-sign\/([a-f0-9]{64})/i)
      if (signMatch?.[1]) {
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signMatch[1]))
        const tokenHash=Array.from(new Uint8Array(digest)).map((b:number)=>b.toString(16).padStart(2,'0')).join('')
        const { data: signDoc }=await admin.from('romylabs_office_signing_documents').select('id,status').eq('token_hash',tokenHash).maybeSingle()
        if (signDoc) {
          const requestedEvent=safe(body.esign_event).toLowerCase()==='resent'?'resent':'sent'
          const syncOnce=()=>admin.rpc('admin_romylabs_mark_office_signing_sent',{
            p_document_id:signDoc.id,
            p_event:requestedEvent,
          })
          let sync=await syncOnce()
          if(sync.error||!sync.data?.ok) sync=await syncOnce()
          if(sync.error||!sync.data?.ok){
            esignStateSync={
              ok:false,
              error:safe(sync.error?.message||sync.data?.error||'delivery_state_sync_failed'),
              envelope_id:signDoc.id,
            }
          }else{
            esignStateSync={ok:true,envelope_id:signDoc.id,event:requestedEvent}
            await admin.from('romylabs_esign_events').insert({
              envelope_id:signDoc.id,
              event_type:'delivery_confirmed',
              actor_email:safe(authenticatedUser?.email||'platform-admin'),
              actor_name:safe(authenticatedUser?.email||'platform-admin'),
              metadata:{
                transport:'stalwart_jmap',
                from:routedFrom,
                event:requestedEvent,
                submission_ids:deliveries.map((x:any)=>x.submissionId),
              },
              occurred_at:new Date().toISOString(),
            })
          }
        }
      }

      return new Response(JSON.stringify({
        success:true,via:'stalwart_jmap',from:routedFrom,product_key:requestedProduct,
        external_office_id:externalOfficeId,submissions:deliveries.map((x:any)=>x.submissionId),
        esign_state_sync:esignStateSync,
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    // RomyLabs appointment / booking mail must use the RomyLabs Stalwart identity.
    // Do not route these messages through the generic Gmail transport.
    const normalizedFrom = safe(from_email).toLowerCase()
    const isRomyLabsMail =
      normalizedFrom.endsWith('@romylabs.com') ||
      (BOOKING_KINDS.has(body.kind) && normalizedFrom === 'romy@romylabs.com')

    if (isRomyLabsMail) {
      const { data: vaultTransport } = await admin.rpc('romylabs_stalwart_transport_for_product', {
        p_product_key: 'taxres_crm',
      })
      if (!vaultTransport?.ok) {
        return new Response(JSON.stringify({ error:'RomyLabs Stalwart transport unavailable' }), {
          status: 409,
          headers:{...corsHeaders,'Content-Type':'application/json'},
        })
      }

      const transport = {
        host: safe(vaultTransport.host || 'mail.taxrescrm.net'),
        username: safe(vaultTransport.username),
        password: String(vaultTransport.password || ''),
        fromAddress: safe(vaultTransport.from_address || vaultTransport.username).toLowerCase(),
      }
      if (!transport.username || !transport.password || !transport.fromAddress) {
        return new Response(JSON.stringify({ error:'RomyLabs Stalwart credential incomplete' }), {
          status:409,
          headers:{...corsHeaders,'Content-Type':'application/json'},
        })
      }

      const recipients=(Array.isArray(to)?to:[to]).map((x:any)=>safe(x)).filter(Boolean).slice(0,25)
      if (!recipients.length) {
        return new Response(JSON.stringify({ error:'Recipient missing' }), {
          status:422,
          headers:{...corsHeaders,'Content-Type':'application/json'},
        })
      }

      const submissions:any[]=[]
      for (const recipient of recipients) {
        const result=await sendViaStalwartJmap({
          host: transport.host,
          username: transport.username,
          password: transport.password,
          fromAddress: transport.fromAddress,
          replyTo: 'info@romylabs.com',
          fromName: safe(from_name || 'RomyLabs'),
          to: recipient,
          subject: safe(subject),
          html: html ? String(html) : undefined,
          text: text ? String(text) : undefined,
        })
        submissions.push({recipient,submissionId:result.submissionId})
      }

      return new Response(JSON.stringify({
        success:true,
        via:'stalwart_jmap',
        from:transport.fromAddress,
        product_key:'romylabs',
        submissions:submissions.map((x:any)=>x.submissionId),
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    // CloudCPA prospect fallback: until Tony connects the office's own mailbox,
    // system and staff mail can still be demonstrated without impersonating a
    // different tenant's Gmail account. Physical delivery uses the proven
    // TaxRes platform Stalwart transport, while Reply-To remains CloudCPA.
    // This is intentionally scoped to TRC-003 and is removed from the path
    // automatically once CloudCPA has its own Gmail OAuth credentials.
    if (tenant_id) {
      const { data: cloudTenant } = await admin.from('tenants')
        .select('id,tenant_code,firm_name')
        .eq('id', tenant_id)
        .maybeSingle()
      if (cloudTenant?.tenant_code === 'TRC-003') {
        const { data: cloudSettings } = await admin.from('settings')
          .select('name,firmname,email,firmemail,gmail_refresh_token')
          .eq('tenant_id', tenant_id)
          .maybeSingle()
        if (!cloudSettings?.gmail_refresh_token) {
          const { data: vaultTransport } = await admin.rpc('romylabs_stalwart_transport_for_product', {
            p_product_key: 'taxres_crm',
          })
          if (!vaultTransport?.ok) {
            return new Response(JSON.stringify({ error:'CloudCPA platform mail transport unavailable' }), {
              status:409, headers:{...corsHeaders,'Content-Type':'application/json'},
            })
          }
          const transport = {
            host: safe(vaultTransport.host || 'mail.taxrescrm.net'),
            username: safe(vaultTransport.username),
            password: String(vaultTransport.password || ''),
            fromAddress: safe(vaultTransport.from_address || vaultTransport.username).toLowerCase(),
          }
          if (!transport.username || !transport.password || !transport.fromAddress) {
            return new Response(JSON.stringify({ error:'CloudCPA platform mail credential incomplete' }), {
              status:409, headers:{...corsHeaders,'Content-Type':'application/json'},
            })
          }
          const recipients=(Array.isArray(to)?to:[to]).map((x:any)=>safe(x)).filter(Boolean).slice(0,25)
          if (!recipients.length) {
            return new Response(JSON.stringify({ error:'Recipient missing' }), {
              status:422, headers:{...corsHeaders,'Content-Type':'application/json'},
            })
          }
          const cloudName=safe(cloudSettings?.name || cloudSettings?.firmname || cloudTenant?.firm_name || 'CloudCPA Inc')
          const cloudReply=safe(cloudSettings?.email || cloudSettings?.firmemail || 'tony@thecloudcpa.net').toLowerCase()
          const submissions:any[]=[]
          for (const recipient of recipients) {
            const result=await sendViaStalwartJmap({
              host:transport.host,
              username:transport.username,
              password:transport.password,
              fromAddress:transport.fromAddress,
              replyTo:cloudReply,
              fromName:`${cloudName} via TaxRes CRM`,
              to:recipient,
              subject:safe(subject),
              html:html ? String(html) : undefined,
              text:text ? String(text) : undefined,
            })
            submissions.push({recipient,submissionId:result.submissionId})
          }

          // Log authenticated staff sends into the CloudCPA tenant mailbox so
          // the demo has a truthful communication history even before mailbox
          // cutover. System booking/e-sign sends are already represented by
          // their workflow records and do not need duplicate email rows.
          if (authenticated) {
            for (const sent of submissions) {
              await admin.from('emails').insert([{
                tenant_id,
                recipient:sent.recipient,
                recipients:[sent.recipient],
                subject:safe(subject),
                body:safe(text || String(html || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')),
                body_html:html ? String(html) : null,
                triage:'Sent',status:'Sent',direction:'outbound',is_read:true,
                sender:transport.fromAddress,
                from_address:transport.fromAddress,
                reply_from:cloudReply,
                mailbox_owner:safe(authenticatedUser?.email || cloudReply).toLowerCase(),
                received_at:new Date().toISOString(),
                created_at:new Date().toISOString(),
                message_id:`stalwart:${sent.submissionId}`,
                received_mailbox:transport.fromAddress,
              }])
            }
          }

          if (esignIdToMark) {
            await admin.from('esigns').update({ signed_copy_sent_at:new Date().toISOString() }).eq('id',esignIdToMark)
          }
          return new Response(JSON.stringify({
            success:true,
            via:'taxres_platform_relay',
            from:transport.fromAddress,
            reply_to:cloudReply,
            brand:cloudName,
            submissions:submissions.map((x:any)=>x.submissionId),
          }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
        }
      }
    }

    const { data: gs } = await admin.from('settings').select('*').not('gmail_refresh_token', 'is', null).limit(1).maybeSingle()
    if (!gs?.gmail_refresh_token) return new Response(JSON.stringify({ error: 'No Gmail OAuth configured' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // Controlled certification path. It reaches real authentication, tenant,
    // permission, payload and provider-configuration checks, but never refreshes
    // OAuth and never calls Gmail.
    if (authenticated && body.qa_certification === true && body.dry_run === true) {
      return new Response(JSON.stringify({ success: true, dry_run: true, delivery: false, provider: 'gmail', tenant_id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const atts: any[] = []
    if ((authenticated || body.kind === 'esign_signed_copy') && Array.isArray(attachments)) {
      const allowedHost = new URL(url).hostname
      for (const a of attachments.slice(0, 10)) {
        if (!a?.url) continue
        try {
          const u = new URL(a.url)
          if (u.protocol !== 'https:' || u.hostname !== allowedHost) { console.warn('[send-email] blocked attachment host', u.hostname); continue }
          const r = await fetch(u.toString()); if (!r.ok) continue
          const buf = new Uint8Array(await r.arrayBuffer()); if (buf.byteLength > 15 * 1024 * 1024) continue
          let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
          atts.push({ filename: a.filename || 'attachment', contentType: r.headers.get('content-type') || 'application/octet-stream', b64: btoa(bin) })
        } catch { }
      }
    }
    const fromDisplay = safe(from_name || ts?.name || ts?.firmname || 'TaxRes CRM'), fromAddr = safe(from_email || ts?.smtp_email || ts?.email || ts?.firmemail || 'romy@taxrescrm.net')
    const finalBody = html || `${text}${ts?.email_signature ? '\n\n' + ts.email_signature : ''}`
    const access = await gmailToken(admin, gs)
    for (const recipient of (Array.isArray(to) ? to : [to]).slice(0, 25)) {
      const msg = raw({ from: gs.email || 'info@taxcasereview.org', fromName: fromDisplay, to: recipient, subject, body: finalBody, isHtml: !!html, replyTo: fromAddr, atts })
      let sr: any, sd: any
      for (let a = 0; a < 4; a++) {
        if (a) await new Promise(r => setTimeout(r, 2 ** (a - 1) * 1000))
        sr = await fetch(SEND_URL, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(msg) }) })
        sd = await sr.json()
        if (sr.ok || (sr.status !== 429 && sr.status < 500)) break
      }
      if (!sr.ok) return new Response(JSON.stringify({ error: sd?.error?.message || 'Gmail send failed', retryable: sr.status === 429 }), { status: sr.status === 429 ? 429 : 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (esignIdToMark) await admin.from('esigns').update({ signed_copy_sent_at: new Date().toISOString() }).eq('id', esignIdToMark)
    return new Response(JSON.stringify({ success: true, via: 'gmail' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('[send-email]', e)
    return new Response(JSON.stringify({ error: e?.message || 'Send failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
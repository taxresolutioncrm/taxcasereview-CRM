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

async function sendSmtpRaw(opts: { host:string, port:number, ssl:boolean, username:string, password:string, fromName:string, to:string, subject:string, html?:string, text?:string }) {
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
  await write(`MAIL FROM:<${opts.username}>`); resp=await read(); expect(resp,['250'],'SMTP MAIL FROM')
  await write(`RCPT TO:<${opts.to}>`); resp=await read(); expect(resp,['250','251'],'SMTP recipient')
  await write('DATA'); resp=await read(); expect(resp,['354'],'SMTP DATA')

  const body=opts.html||opts.text||''
  const contentType=opts.html?'text/html':'text/plain'
  const headers=[
    `From: ${enc(safe(opts.fromName))} <${safe(opts.username)}>`,
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
    if (authenticated && body.kind === 'office_esign_request') {
      const { data: isPlatformAdmin } = await authClient.rpc('_is_platform_admin')
      if (!isPlatformAdmin) return new Response(JSON.stringify({ error:'Platform admin required for office contract email' }), { status:403, headers:{...corsHeaders,'Content-Type':'application/json'} })
      const requestedFrom=safe(from_email).toLowerCase()
      if (!requestedFrom) return new Response(JSON.stringify({ error:'Contract sender identity missing' }), { status:422, headers:{...corsHeaders,'Content-Type':'application/json'} })
      const { data: smtpSettings, error: smtpSettingsError } = await admin.from('settings')
        .select('tenant_id,name,firmname,smtp_host,smtp_port,smtp_email,smtp_password,smtp_name,smtp_encryption')
        .ilike('smtp_email', requestedFrom).limit(1).maybeSingle()
      if (smtpSettingsError || !smtpSettings?.smtp_host || !smtpSettings?.smtp_email || !smtpSettings?.smtp_password) {
        return new Response(JSON.stringify({ error:`No configured SMTP transport for ${requestedFrom}` }), { status:409, headers:{...corsHeaders,'Content-Type':'application/json'} })
      }
      const recipients=(Array.isArray(to)?to:[to]).map((x:any)=>safe(x)).filter(Boolean).slice(0,25)
      if (!recipients.length) return new Response(JSON.stringify({ error:'Contract recipient missing' }), { status:422, headers:{...corsHeaders,'Content-Type':'application/json'} })
      for (const recipient of recipients) {
        await sendSmtpRaw({
          host:safe(smtpSettings.smtp_host),
          port:Number(smtpSettings.smtp_port||465),
          ssl:String(smtpSettings.smtp_encryption||'').toLowerCase()==='ssl'||Number(smtpSettings.smtp_port||465)===465,
          username:safe(smtpSettings.smtp_email),
          password:String(smtpSettings.smtp_password),
          fromName:safe(from_name||smtpSettings.smtp_name||smtpSettings.name||smtpSettings.firmname||'RomyLabs'),
          to:recipient,
          subject:safe(subject),
          html:html?String(html):undefined,
          text:text?String(text):undefined,
        })
      }
      await admin.from('emails').insert(recipients.map((recipient:string)=>({
        tenant_id:smtpSettings.tenant_id,
        recipient,
        recipients:[recipient],
        subject:safe(subject),
        body:text?String(text):String(html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
        body_html:html?String(html):'',
        triage:'Sent',
        status:'Sent',
        direction:'outbound',
        is_read:true,
        sender:safe(smtpSettings.smtp_email),
        from_address:safe(smtpSettings.smtp_email),
        reply_from:safe(smtpSettings.smtp_email),
        mailbox_owner:safe(authenticatedUser?.email||'info@romylabs.com'),
        received_at:new Date().toISOString(),
        created_at:new Date().toISOString(),
        product_id:safe(body.product_key||'')||null,
      })))
      return new Response(JSON.stringify({ success:true, via:'smtp', from:safe(smtpSettings.smtp_email) }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
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
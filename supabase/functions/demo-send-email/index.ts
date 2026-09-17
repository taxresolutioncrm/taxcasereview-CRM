import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000001'
const DEMO_MAILBOX = 'demo@taxrescrm.net'
const PHYSICAL_FROM = 'romy@taxrescrm.net'
const BRAND_NAME = 'TaxRes CRM'
const BRAND_LOGO = 'https://taxrescrm.app/taxrescrm-logo.png'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const safe = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()
const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

function bodyHtml(text: string) {
  const message = esc(text).replace(/\n/g, '<br>')
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="padding:22px 32px;text-align:center;background:#fff;border-bottom:1px solid #e2e8f0"><img src="${BRAND_LOGO}" alt="${BRAND_NAME}" style="max-height:58px;max-width:220px;display:block;margin:0 auto"><div style="margin-top:8px;font-size:18px;font-weight:800;color:#0f172a">${BRAND_NAME}</div></td></tr>
<tr><td style="padding:30px 34px;color:#111827;font-size:14px;line-height:1.7">${message}</td></tr>
<tr><td style="padding:16px 34px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;text-align:center">${BRAND_NAME} · ${DEMO_MAILBOX}</td></tr>
</table></td></tr></table></body></html>`
}

async function sendViaStalwartJmap(opts: {
  host: string
  username: string
  password: string
  fromAddress: string
  replyTo: string
  to: string
  subject: string
  html: string
}) {
  const base = `https://${opts.host.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  const auth = 'Basic ' + btoa(`${opts.username}:${opts.password}`)
  const sessionRes = await fetch(`${base}/.well-known/jmap`, { headers: { Authorization: auth, Accept: 'application/json' } })
  if (!sessionRes.ok) throw new Error(`Stalwart JMAP session failed (${sessionRes.status})`)
  const session = await sessionRes.json()
  const apiUrl = String(session?.apiUrl || '').replace('{accountId}', '')
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || Object.keys(session?.accounts || {})[0]
  if (!apiUrl || !accountId) throw new Error('Stalwart JMAP session missing mail account')

  const metaRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'],
      methodCalls: [
        ['Identity/get', { accountId }, 'i0'],
        ['Mailbox/get', { accountId, properties: ['id', 'name', 'role'] }, 'm0'],
      ],
    }),
  })
  if (!metaRes.ok) throw new Error(`Stalwart JMAP metadata failed (${metaRes.status})`)
  const meta = await metaRes.json()
  const identities = meta?.methodResponses?.find((x: any) => x?.[0] === 'Identity/get')?.[1]?.list || []
  const mailboxes = meta?.methodResponses?.find((x: any) => x?.[0] === 'Mailbox/get')?.[1]?.list || []
  const identity = identities.find((x: any) => String(x?.email || '').toLowerCase() === opts.fromAddress.toLowerCase())
  const drafts = mailboxes.find((x: any) => String(x?.role || '').toLowerCase() === 'drafts')
  const sent = mailboxes.find((x: any) => String(x?.role || '').toLowerCase() === 'sent')
  if (!identity?.id) throw new Error(`Stalwart does not authorize sender identity ${opts.fromAddress}`)
  if (!drafts?.id || !sent?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')

  const bodyPartId = 'body'
  const sendRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'],
      methodCalls: [
        ['Email/set', {
          accountId,
          create: {
            draft: {
              from: [{ email: opts.fromAddress, name: BRAND_NAME }],
              to: [{ email: opts.to }],
              replyTo: [{ email: opts.replyTo }],
              subject: opts.subject,
              mailboxIds: { [drafts.id]: true },
              keywords: { '$draft': true },
              bodyValues: { [bodyPartId]: { value: opts.html, charset: 'utf-8' } },
              htmlBody: [{ partId: bodyPartId, type: 'text/html' }],
            },
          },
        }, 'e0'],
        ['EmailSubmission/set', {
          accountId,
          create: { sendIt: { emailId: '#draft', identityId: identity.id } },
          onSuccessUpdateEmail: {
            '#sendIt': {
              [`mailboxIds/${drafts.id}`]: null,
              [`mailboxIds/${sent.id}`]: true,
              'keywords/$draft': null,
            },
          },
        }, 's0'],
      ],
    }),
  })
  if (!sendRes.ok) throw new Error(`Stalwart JMAP send failed (${sendRes.status})`)
  const sentPayload = await sendRes.json()
  const submission = sentPayload?.methodResponses?.find((x: any) => x?.[0] === 'EmailSubmission/set')?.[1]
  const rejected = submission?.notCreated?.sendIt
  if (rejected) throw new Error(`Stalwart JMAP rejected send: ${rejected.description || rejected.type || 'unknown error'}`)
  const submissionId = submission?.created?.sendIt?.id
  if (!submissionId) throw new Error('Stalwart JMAP did not confirm message submission')
  return String(submissionId)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anon || !service) throw new Error('Server configuration missing')

    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const jwt = authHeader.slice(7)
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: userData } = await authClient.auth.getUser(jwt)
    const userEmail = safe(userData?.user?.email).toLowerCase()
    if (userEmail !== DEMO_MAILBOX) return new Response(JSON.stringify({ error: 'Demo mailbox only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const admin = createClient(url, service)
    const { data: tenant } = await admin.from('tenants').select('id').eq('id', DEMO_TENANT_ID).maybeSingle()
    if (!tenant) throw new Error('Canonical Demo tenant missing')

    const { data: settings } = await admin.from('settings')
      .select('tenant_id,name,firmname,email,firmemail,smtp_host,smtp_port,smtp_email,smtp_encryption')
      .eq('tenant_id', DEMO_TENANT_ID)
      .maybeSingle()
    if (!settings) throw new Error('Canonical Demo settings missing')
    if (safe(settings.name || settings.firmname) !== BRAND_NAME || safe(settings.email).toLowerCase() !== DEMO_MAILBOX || safe(settings.firmemail).toLowerCase() !== DEMO_MAILBOX || safe(settings.smtp_email).toLowerCase() !== PHYSICAL_FROM) {
      throw new Error('Canonical Demo mail identity guard failed')
    }

    const body = await req.json()
    const to = safe(body.to).toLowerCase()
    const subject = safe(body.subject)
    const text = String(body.text || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return new Response(JSON.stringify({ error: 'Valid recipient required' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    if (!subject || !text) return new Response(JSON.stringify({ error: 'Subject and body required' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { data: transport } = await admin.rpc('romylabs_stalwart_transport_for_product', { p_product_key: 'taxres_crm' })
    if (!transport?.ok) throw new Error('TaxRes Stalwart transport unavailable')
    const fromAddress = safe(transport.from_address || transport.username).toLowerCase()
    if (fromAddress !== PHYSICAL_FROM) throw new Error(`Unexpected TaxRes sender identity: ${fromAddress || 'missing'}`)

    const html = bodyHtml(text)
    const submissionId = await sendViaStalwartJmap({
      host: safe(transport.host || settings.smtp_host || 'mail.taxrescrm.net'),
      username: safe(transport.username),
      password: String(transport.password || ''),
      fromAddress: PHYSICAL_FROM,
      replyTo: DEMO_MAILBOX,
      to,
      subject,
      html,
    })

    const now = new Date().toISOString()
    const { error: logError } = await admin.from('emails').insert([{
      tenant_id: DEMO_TENANT_ID,
      recipient: to,
      recipients: [to],
      clientName: safe(body.clientName) || to,
      subject,
      body: text,
      body_html: html,
      triage: 'Sent',
      status: 'Sent',
      direction: 'outbound',
      is_read: true,
      sender: PHYSICAL_FROM,
      from_address: PHYSICAL_FROM,
      reply_from: DEMO_MAILBOX,
      mailbox_owner: DEMO_MAILBOX,
      received_at: now,
      created_at: now,
      product_id: 'taxres_crm',
      message_id: `stalwart:${submissionId}`,
      received_mailbox: DEMO_MAILBOX,
    }])
    if (logError) throw new Error(`Delivery confirmed but CRM Sent log failed: ${logError.message}`)

    return new Response(JSON.stringify({ success: true, via: 'stalwart_jmap', from: PHYSICAL_FROM, mailbox_owner: DEMO_MAILBOX, submission_id: submissionId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    console.error('[demo-send-email]', e)
    return new Response(JSON.stringify({ error: e?.message || 'Demo email send failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

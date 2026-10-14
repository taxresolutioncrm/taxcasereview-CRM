import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-arcvena-support-secret',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json' },
})

const safe = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

async function sendViaStalwartJmap(opts: {
  host: string
  username: string
  password: string
  fromAddress: string
  fromName: string
  to: string
  subject: string
  html: string
}) {
  const base = 'https://' + opts.host.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const auth = 'Basic ' + btoa(opts.username + ':' + opts.password)

  const sessionRes = await fetch(base + '/.well-known/jmap', {
    headers: { Authorization: auth, Accept: 'application/json' },
  })
  if (!sessionRes.ok) throw new Error('Stalwart JMAP session failed (' + sessionRes.status + ')')

  const session = await sessionRes.json()
  const apiUrl = String(session?.apiUrl || '').replace('{accountId}', '')
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || Object.keys(session?.accounts || {})[0]
  if (!apiUrl || !accountId) throw new Error('Stalwart JMAP session missing mail account')

  const metaRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:ietf:params:jmap:mail',
        'urn:ietf:params:jmap:submission',
      ],
      methodCalls: [
        ['Identity/get', { accountId }, 'i0'],
        ['Mailbox/get', { accountId, properties: ['id', 'name', 'role'] }, 'm0'],
      ],
    }),
  })
  if (!metaRes.ok) throw new Error('Stalwart JMAP metadata failed (' + metaRes.status + ')')

  const meta = await metaRes.json()
  const identityList = meta?.methodResponses?.find((x: any) => x?.[0] === 'Identity/get')?.[1]?.list || []
  const mailboxes = meta?.methodResponses?.find((x: any) => x?.[0] === 'Mailbox/get')?.[1]?.list || []
  const fromAddress = opts.fromAddress.toLowerCase()
  const identity = identityList.find((x: any) => String(x?.email || '').toLowerCase() === fromAddress)
  const drafts = mailboxes.find((x: any) => String(x?.role || '').toLowerCase() === 'drafts')
  const sentBox = mailboxes.find((x: any) => String(x?.role || '').toLowerCase() === 'sent')

  if (!identity?.id) throw new Error('Stalwart does not authorize sender identity ' + fromAddress)
  if (!drafts?.id || !sentBox?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')

  const bodyPartId = 'body'
  const createEmail = {
    from: [{ email: fromAddress, name: opts.fromName }],
    to: [{ email: opts.to }],
    subject: opts.subject,
    mailboxIds: { [drafts.id]: true },
    keywords: { '$draft': true },
    bodyValues: { [bodyPartId]: { value: opts.html, charset: 'utf-8' } },
    htmlBody: [{ partId: bodyPartId, type: 'text/html' }],
  }

  const sendRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:ietf:params:jmap:mail',
        'urn:ietf:params:jmap:submission',
      ],
      methodCalls: [
        ['Email/set', { accountId, create: { draft: createEmail } }, 'e0'],
        ['EmailSubmission/set', {
          accountId,
          create: { sendIt: { emailId: '#draft', identityId: identity.id } },
          onSuccessUpdateEmail: {
            '#sendIt': {
              ['mailboxIds/' + drafts.id]: null,
              ['mailboxIds/' + sentBox.id]: true,
              'keywords/$draft': null,
            },
          },
        }, 's0'],
      ],
    }),
  })
  if (!sendRes.ok) throw new Error('Stalwart JMAP send failed (' + sendRes.status + ')')

  const sent = await sendRes.json()
  const submission = sent?.methodResponses?.find((x: any) => x?.[0] === 'EmailSubmission/set')?.[1]
  const notCreated = submission?.notCreated?.sendIt
  if (notCreated) {
    throw new Error('Stalwart JMAP rejected send: ' + (notCreated.description || notCreated.type || 'unknown error'))
  }
  const submissionId = submission?.created?.sendIt?.id
  if (!submissionId) throw new Error('Stalwart JMAP did not confirm message submission')

  return String(submissionId)
}

function renderEmail(input: {
  actionUrl: string
  recipientName?: string | null
  officeName?: string | null
  mode: 'invite' | 'access'
}) {
  const firstLine = input.recipientName ? 'Hi ' + esc(input.recipientName) + ',' : 'Hello,'
  const office = input.officeName ? '<strong>' + esc(input.officeName) + '</strong>' : 'your Arcvena office'
  const heading = input.mode === 'invite' ? 'Set up your Arcvena access' : 'Continue to Arcvena'
  const body = input.mode === 'invite'
    ? 'You’ve been invited to ' + office + '. Use the secure button below to finish setting up your CRM access.'
    : 'Your Arcvena access is ready for ' + office + '. Use the secure button below to choose or reset your password.'

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#071525;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#071525;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#081a2d;padding:24px 32px;text-align:center;">
<img src="https://arcvena.com/brand/arcvena-logo-horizontal.png" width="217" alt="Arcvena" style="display:inline-block;max-width:217px;width:100%;height:auto;border:0;">
</td></tr>
<tr><td style="padding:34px 32px 12px;font-size:24px;font-weight:700;color:#0b1b2b;">${heading}</td></tr>
<tr><td style="padding:0 32px 8px;font-size:16px;line-height:1.6;color:#334155;">${firstLine}</td></tr>
<tr><td style="padding:0 32px 24px;font-size:16px;line-height:1.6;color:#334155;">${body}</td></tr>
<tr><td align="center" style="padding:4px 32px 30px;">
<a href="${esc(input.actionUrl)}" style="display:inline-block;background:#09b9ee;color:#062033;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:9px;">${input.mode === 'invite' ? 'Set Up Arcvena Access' : 'Continue to Arcvena'}</a>
</td></tr>
<tr><td style="padding:0 32px 24px;font-size:13px;line-height:1.6;color:#64748b;">
If the button does not open, copy and paste this secure link into your browser:<br>
<span style="word-break:break-all;color:#2563eb;">${esc(input.actionUrl)}</span>
</td></tr>
<tr><td style="border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;font-size:12px;color:#64748b;">
Arcvena by RomyLabs &nbsp;•&nbsp; info@arcvena.com
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const configuredSecret = Deno.env.get('ARCVENA_SUPPORT_SECRET') || ''
  const suppliedSecret = req.headers.get('x-arcvena-support-secret') || ''
  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const body = await req.json().catch(() => null)
  if (!body) return json({ error: 'Invalid JSON' }, 400)

  const to = safe(body.to).toLowerCase()
  const actionUrl = safe(body.action_url)
  const mode = body.mode === 'invite' ? 'invite' : body.mode === 'access' ? 'access' : null
  const officeName = safe(body.office_name) || null
  const recipientName = safe(body.display_name) || null

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'Valid recipient email required' }, 422)
  if (!/^https:\/\//i.test(actionUrl)) return json({ error: 'Secure action URL required' }, 422)
  if (!mode) return json({ error: 'Valid mail mode required' }, 422)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: transport, error: transportError } = await admin.rpc(
    'romylabs_stalwart_transport_for_product',
    { p_product_key: 'arcvena' },
  )

  if (transportError || !transport?.ok) {
    return json({
      error: 'Arcvena Stalwart transport unavailable',
      detail: transportError?.message || transport?.error || null,
    }, 503)
  }

  const fromAddress = safe(transport.from_address || transport.username).toLowerCase()
  if (fromAddress !== 'info@arcvena.com') {
    return json({ error: 'Arcvena sender route mismatch' }, 409)
  }

  const subject = mode === 'invite'
    ? 'Set up your Arcvena access' + (officeName ? ' — ' + officeName : '')
    : 'Arcvena access' + (officeName ? ' — ' + officeName : '')

  const html = renderEmail({ actionUrl, recipientName, officeName, mode })

  try {
    const submissionId = await sendViaStalwartJmap({
      host: safe(transport.host || 'mail.taxrescrm.net'),
      username: safe(transport.username),
      password: String(transport.password || ''),
      fromAddress,
      fromName: 'Arcvena',
      to,
      subject,
      html,
    })

    return json({
      ok: true,
      via: 'stalwart_jmap',
      from: fromAddress,
      to,
      mode,
      submission_id: submissionId,
    })
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
    }, 502)
  }
})

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !anon || !service) throw new Error('Server configuration missing')

    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const jwt = authHeader.slice(7)
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: userData } = await authClient.auth.getUser(jwt)
    const userEmail = safe(userData?.user?.email).toLowerCase()
    if (userEmail !== DEMO_MAILBOX) {
      return new Response(JSON.stringify({ error: 'Demo mailbox only' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: currentTenant } = await authClient.rpc('current_tenant_id')
    if (currentTenant !== DEMO_TENANT_ID) throw new Error('Demo tenant context mismatch')

    const admin = createClient(url, service)
    const { data: settings } = await admin.from('settings')
      .select('tenant_id,name,firmname,email,firmemail,smtp_email')
      .eq('tenant_id', DEMO_TENANT_ID)
      .maybeSingle()
    if (!settings) throw new Error('Canonical Demo settings missing')
    if (
      safe(settings.name || settings.firmname) !== BRAND_NAME ||
      safe(settings.email).toLowerCase() !== DEMO_MAILBOX ||
      safe(settings.firmemail).toLowerCase() !== DEMO_MAILBOX ||
      safe(settings.smtp_email).toLowerCase() !== PHYSICAL_FROM
    ) {
      throw new Error('Canonical Demo mail identity guard failed')
    }

    const { data: route, error: routeError } = await admin.from('romylabs_mailboxes')
      .select('id,email_address,outbound_from,inbox_owner,tenant_id,product_id,active')
      .eq('tenant_id', DEMO_TENANT_ID)
      .ilike('email_address', DEMO_MAILBOX)
      .eq('active', true)
      .maybeSingle()
    if (routeError || !route) throw new Error('Demo TaxRes mailbox route missing')
    if (
      safe(route.outbound_from).toLowerCase() !== PHYSICAL_FROM ||
      safe(route.inbox_owner).toLowerCase() !== DEMO_MAILBOX ||
      safe(route.product_id).toLowerCase() !== 'taxres_crm'
    ) {
      throw new Error('Demo TaxRes mailbox route is not canonical')
    }

    const body = await req.json()
    const to = safe(body.to).toLowerCase()
    const subject = safe(body.subject)
    const text = String(body.text || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return new Response(JSON.stringify({ error: 'Valid recipient required' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (!subject || !text) {
      return new Response(JSON.stringify({ error: 'Subject and body required' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const routedRes = await fetch(`${url}/functions/v1/smtp-send`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        route_id: route.id,
        to,
        subject,
        text_body: text,
        html_body: bodyHtml(text),
        from_name: BRAND_NAME,
      }),
    })
    const routed = await routedRes.json().catch(() => ({}))
    if (!routedRes.ok || !routed?.ok) throw new Error(routed?.error || `Shared mailbox send failed (${routedRes.status})`)
    if (
      safe(routed.from).toLowerCase() !== PHYSICAL_FROM ||
      safe(routed.reply_to).toLowerCase() !== DEMO_MAILBOX ||
      safe(routed.mailbox_owner).toLowerCase() !== DEMO_MAILBOX
    ) {
      throw new Error('Shared mailbox sender returned a non-canonical Demo identity')
    }

    return new Response(JSON.stringify({
      success: true,
      // Preserve the existing Email.jsx response contract while transport is now shared.
      via: 'stalwart_jmap',
      transport: 'shared_routed_mailbox',
      from: PHYSICAL_FROM,
      reply_to: DEMO_MAILBOX,
      mailbox_owner: DEMO_MAILBOX,
      route_id: route.id,
      submission_id: routed.submission_id,
      message_id: routed.message_id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e: any) {
    console.error('[demo-send-email]', e)
    return new Response(JSON.stringify({ error: e?.message || 'Demo email send failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

// weekly-growth-report — Monday morning owner report
// Runs via cron (Monday 8am ET). Pulls live data, sends one concise email
// to romy@taxrescrm.net covering SEO, traffic, content, sales, automation.
// verify_jwt = false (cron-called)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_TENANT = 'a0000000-0000-0000-0000-000000000001'
const ADMIN_EMAIL  = 'romy@taxrescrm.net'
const FROM_NAME    = 'TaxRes CRM Automation'
const FROM_EMAIL   = 'romy@taxrescrm.net'
const TIMEZONE     = 'America/New_York'

function getETDate(d: Date) {
  return new Date(d.toLocaleString('en-US', { timeZone: TIMEZONE }))
}
function fmt(n: number | null | undefined) { return n != null ? n.toLocaleString() : 'N/A' }
function pct(a: number, b: number) {
  if (!b) return 'N/A'
  const p = Math.round(((a - b) / b) * 100)
  return (p >= 0 ? '+' : '') + p + '%'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const now    = new Date()
  const etNow  = getETDate(now)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch (_) {}
  const force = body.force === true

  // Only run on Monday or when forced
  if (!force && etNow.getDay() !== 1) {
    return new Response(JSON.stringify({ ok: true, skipped: 'not_monday' }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Idempotency — one report per Monday
  const mondayStart = new Date(etNow)
  mondayStart.setHours(0, 0, 0, 0)
  if (!force) {
    const { data: already } = await supabase
      .from('marketing_weekly_reports')
      .select('id')
      .gte('sent_at', mondayStart.toISOString())
      .eq('tenant_id', ADMIN_TENANT)
      .limit(1)
    if (already?.length) {
      return new Response(JSON.stringify({ ok: true, skipped: 'already_sent' }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
  }

  const weekAgo     = new Date(now.getTime() - 7  * 86400000)
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000)

  const [gscRes, ga4Res, ga4PrevRes, liPubRes, liNextRes, prospectsRes, liConnRes] =
    await Promise.allSettled([
      supabase.from('marketing_gsc_performance')
        .select('impressions,clicks,position,query')
        .gte('date', weekAgo.toISOString().slice(0, 10))
        .order('clicks', { ascending: false }).limit(5),

      supabase.from('marketing_ga4_traffic')
        .select('sessions,users,channel')
        .eq('product_id', 'taxres_crm')
        .gte('date', weekAgo.toISOString().slice(0, 10)),

      supabase.from('marketing_ga4_traffic')
        .select('sessions,users,channel')
        .eq('product_id', 'taxres_crm')
        .gte('date', twoWeeksAgo.toISOString().slice(0, 10))
        .lt('date', weekAgo.toISOString().slice(0, 10)),

      supabase.from('linkedin_posts')
        .select('id,title,body,category,published_at,linkedin_url')
        .eq('tenant_id', ADMIN_TENANT).eq('status', 'published')
        .gte('published_at', weekAgo.toISOString()),

      supabase.from('linkedin_posts')
        .select('id,title,category,scheduled_at,status')
        .eq('tenant_id', ADMIN_TENANT)
        .in('status', ['approved', 'draft'])
        .gte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true }).limit(4),

      supabase.from('prospects')
        .select('id,stage,source,created_at')
        .gte('created_at', weekAgo.toISOString()),

      supabase.from('linkedin_connections')
        .select('display_name,expires_at')
        .eq('tenant_id', ADMIN_TENANT).single(),
    ])

  const gsc      = gscRes.status      === 'fulfilled' ? (gscRes.value.data || [])      : []
  const ga4      = ga4Res.status      === 'fulfilled' ? (ga4Res.value.data || [])      : []
  const ga4prev  = ga4PrevRes.status  === 'fulfilled' ? (ga4PrevRes.value.data || [])  : []
  const liPub    = liPubRes.status    === 'fulfilled' ? (liPubRes.value.data || [])    : []
  const liNext   = liNextRes.status   === 'fulfilled' ? (liNextRes.value.data || [])   : []
  const prx      = prospectsRes.status === 'fulfilled' ? (prospectsRes.value.data || []) : []
  const liConn   = liConnRes.status   === 'fulfilled' ? liConnRes.value.data            : null

  const impressions  = gsc.reduce((s: number, r: any) => s + (r.impressions || 0), 0)
  const clicks       = gsc.reduce((s: number, r: any) => s + (r.clicks || 0), 0)
  const topQueries   = gsc.slice(0, 5).map((r: any) =>
    `${r.query} (${r.clicks} clicks, pos ${Math.round(r.position || 0)})`
  )

  // The __TOTAL__ row is the canonical daily count. Never sum it with channel rows.
  const dailyTotals = ga4.filter((r: any) => r.channel === '__TOTAL__')
  const priorTotals = ga4prev.filter((r: any) => r.channel === '__TOTAL__')
  const sessions = dailyTotals.reduce((s: number, r: any) => s + (r.sessions || 0), 0)
  const sessPrev = priorTotals.reduce((s: number, r: any) => s + (r.sessions || 0), 0)
  // GA4 users are not additive across days. This is an approximate sum of daily users,
  // never a distinct weekly-user count.
  const users = dailyTotals.reduce((s: number, r: any) => s + (r.users || 0), 0)
  const organic  = ga4.filter((r: any) => (r.channel || '').toLowerCase().includes('organic'))
                      .reduce((s: number, r: any) => s + (r.sessions || 0), 0)
  const social   = ga4.filter((r: any) => /linkedin|social/i.test(r.channel || ''))
                      .reduce((s: number, r: any) => s + (r.sessions || 0), 0)

  const daysLeft = liConn
    ? Math.floor((new Date(liConn.expires_at).getTime() - now.getTime()) / 86400000)
    : null

  const needsApproval = liNext.filter((p: any) => p.status === 'draft').length
  const demos    = prx.filter((p: any) => ['Demo Booked','Demo Completed','Won'].includes(p.stage)).length
  const won      = prx.filter((p: any) => p.stage === 'Won').length

  // Owner actions
  const actions: string[] = []
  if (needsApproval > 0) actions.push(`Approve ${needsApproval} LinkedIn draft(s): Admin Portal → Command Center → LinkedIn`)
  if (daysLeft !== null && daysLeft <= 14) actions.push(`LinkedIn token expires in ${daysLeft} days — reconnect now`)
  if (ga4.length === 0)  actions.push('GA4 data unavailable — check Settings → Analytics')
  if (gsc.length === 0)  actions.push('GSC data unavailable — check Settings → SEO')

  const tokenBadge = daysLeft !== null
    ? (daysLeft > 14 ? `✅ ${daysLeft}d remaining` : `⚠️ ${daysLeft}d — reconnect`)
    : '❓ Unknown'

  const weekStr = now.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: TIMEZONE
  })

  const actionBox = actions.length
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:14px;margin:16px 0;">
        <strong>⚠️ OWNER ACTION REQUIRED:</strong><br>${actions.map(a => `• ${a}`).join('<br>')}
       </div>`
    : `<div style="background:#d1fae5;border:1px solid #10b981;border-radius:8px;padding:10px;margin:16px 0;">
        <strong>✅ OWNER ACTION REQUIRED: NONE</strong>
       </div>`

  const html = `<!DOCTYPE html><html><body style="background:#f8fafc;font-family:system-ui,Arial,sans-serif;margin:0;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
<img src="https://taxrescrm.app/assets/taxrescrm-logo.png" style="height:28px;margin-bottom:18px;" />
<h1 style="font-size:19px;font-weight:800;color:#0f172a;margin:0 0 4px;">TaxRes CRM — Weekly Growth Report</h1>
<p style="color:#64748b;font-size:12px;margin:0 0 20px;">Week ending ${weekStr}</p>
${actionBox}

<h2 style="font-size:14px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin:20px 0 10px;">📊 SEO</h2>
${gsc.length ? `<p style="margin:0;font-size:13px;line-height:1.8;">
  Impressions: <strong>${fmt(impressions)}</strong> | Clicks: <strong>${fmt(clicks)}</strong><br>
  Top queries: ${topQueries.length ? topQueries.join(' · ') : 'N/A'}
</p>` : '<p style="color:#94a3b8;font-size:13px;margin:0;">GSC: UNAVAILABLE</p>'}

<h2 style="font-size:14px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin:20px 0 10px;">📈 Traffic</h2>
${ga4.length ? `<p style="margin:0;font-size:13px;line-height:1.8;">
  Sessions: <strong>${fmt(sessions)}</strong> (${pct(sessions, sessPrev)} vs prior week) | Users: <strong>${fmt(users)}</strong><br>
  Organic: <strong>${fmt(organic)}</strong> | LinkedIn/Social: <strong>${fmt(social)}</strong>
</p>` : '<p style="color:#94a3b8;font-size:13px;margin:0;">GA4: UNAVAILABLE</p>'}

<h2 style="font-size:14px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin:20px 0 10px;">💼 LinkedIn</h2>
<p style="margin:0;font-size:13px;line-height:1.8;">
  <strong>Published last week:</strong><br>
  ${liPub.length ? liPub.map((p: any) => `• [${p.category || 'post'}] ${(p.title || p.body || '').slice(0,70)}... ${p.linkedin_url ? `<a href="${p.linkedin_url}" style="color:#0ea5e9;">view</a>` : ''}`).join('<br>') : 'None'}<br><br>
  <strong>Coming up:</strong><br>
  ${liNext.length ? liNext.map((p: any) => `• ${new Date(p.scheduled_at).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:TIMEZONE})} — ${p.category || 'post'} [${p.status}]`).join('<br>') : 'None scheduled'}<br><br>
  Token: ${tokenBadge}
</p>

<h2 style="font-size:14px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin:20px 0 10px;">🎯 Sales</h2>
<p style="margin:0;font-size:13px;line-height:1.8;">
  New prospects: <strong>${prx.length}</strong> | Demos: <strong>${demos}</strong> | Won: <strong>${won}</strong>
</p>

<h2 style="font-size:14px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:6px;margin:20px 0 10px;">⚙️ Automation Health</h2>
<p style="margin:0;font-size:13px;line-height:1.8;">
  LinkedIn scheduler: ✅ cron/15min<br>
  Demo follow-up: ✅ cron/30min<br>
  LinkedIn OAuth: ${tokenBadge}<br>
  GA4: ${ga4.length ? '✅' : '⚠️ No data'} | GSC: ${gsc.length ? '✅' : '⚠️ No data'}
</p>

<p style="color:#94a3b8;font-size:11px;margin-top:24px;border-top:1px solid #f1f5f9;padding-top:12px;">
TaxRes CRM Autonomous Growth Engine · ${now.toISOString()}
</p>
</div></body></html>`

  await supabase.functions.invoke('send-email', {
    body: {
      to: ADMIN_EMAIL,
      subject: `TaxRes CRM — Weekly Growth Report (${weekStr})`,
      html,
      from_name: FROM_NAME,
      from_email: FROM_EMAIL,
      tenant_id: ADMIN_TENANT,
    }
  })

  await supabase.from('marketing_weekly_reports').insert({
    tenant_id:      ADMIN_TENANT,
    week_ending:    now.toISOString().slice(0, 10),
    sent_at:        now.toISOString(),
    impressions:    impressions || null,
    clicks:         clicks || null,
    sessions:       sessions || null,
    prospects_new:  prx.length,
    demos:          demos,
    li_published:   liPub.length,
    owner_actions:  actions.length,
  }).catch(e => console.error('[weekly-growth-report] Log insert failed:', e))

  console.log(`[weekly-growth-report] Sent to ${ADMIN_EMAIL}, actions=${actions.length}`)
  return new Response(JSON.stringify({ ok: true, sent_to: ADMIN_EMAIL, owner_actions: actions }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})

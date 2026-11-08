import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Daily at 7 AM America/New_York. The database runs the job at both possible
// UTC hours; this function checks Eastern local time and rejects duplicates.
const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const response = (value: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: jsonHeaders })
const tenantId = 'a0000000-0000-0000-0000-000000000001'
const destination = 'romy@taxrescrm.net'
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
function easternClock(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]))
  return { day: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) }
}

const safe = (value: unknown) => String(value ?? '').replace(/[\\r\\n]+/g,' ').trim()

// Shared, provider-confirmed mail path already used by RomyLabs booking alerts.
// JMAP submission must return a real submission id; no Gmail or optimistic fallback.
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

serve(async req => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!supabaseUrl || !serviceKey || !anonKey) return response({ error: 'Briefing service configuration incomplete' }, 503)

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const internalToken = req.headers.get('x-internal-cron-token') || ''
  const authorization = req.headers.get('authorization') || ''
  let scheduled = false

  if (internalToken) {
    const { data, error } = await service.rpc('verify_internal_cron_token', { provided: internalToken })
    if (error || data !== true) return response({ error: 'Invalid scheduler authentication' }, 401)
    scheduled = true
  } else if (/^Bearer \S+$/.test(authorization)) {
    // A button click is permitted only for authenticated platform admins.
    // Service-role privileges must never be inferred from the request body.
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const { data, error } = await caller.rpc('_is_platform_admin')
    if (error || data !== true) return response({ error: 'Platform admin required' }, 403)
  } else {
    return response({ error: 'Authentication required' }, 401)
  }

  const clock = easternClock()
  if (scheduled && clock.hour !== 7) {
    return response({ ok: true, skipped: true, reason: 'outside_7am_eastern', eastern_date: clock.day })
  }

  const mode = scheduled ? 'scheduled' : 'test'
  const { data: run, error: runError } = await service.from('romylabs_daily_briefing_runs')
    .insert({ report_date: clock.day, mode, status: 'attempting', recipient: destination })
    .select('id').single()
  if (runError?.code === '23505' && scheduled) {
    return response({ ok: true, skipped: true, reason: 'already_attempted', eastern_date: clock.day })
  }
  if (runError || !run) {
    console.error('daily-briefing: cannot create delivery audit', runError?.message)
    return response({ error: 'Could not record briefing attempt' }, 503)
  }

  const fail = async (reason: string, code = 502) => {
    await service.from('romylabs_daily_briefing_runs')
      .update({ status: 'failed', error: reason.slice(0, 500) }).eq('id', run.id)
    console.error('daily-briefing: failed', reason)
    return response({ ok: false, sent: false, error: reason }, code)
  }

  try {
    const until = new Date(Date.now() + 7 * 86400000)
    const endDate = easternClock(until).day
    const [tenantsRes, calendarRes] = await Promise.all([
      service.rpc('admin_tenant_overview'),
      service.from('calevents').select('title,date,time,eventType')
        .eq('tenant_id', tenantId).gte('date', clock.day).lte('date', endDate)
        .order('date', { ascending: true }).limit(8),
    ])
    if (tenantsRes.error || !Array.isArray(tenantsRes.data)) {
      return await fail('Platform stats unavailable: ' + (tenantsRes.error?.message || 'invalid response'))
    }
    if (calendarRes.error) return await fail('Calendar stats unavailable: ' + calendarRes.error.message)

    const tenants = tenantsRes.data
    const activeOffices = tenants.filter((t: any) => t.status === 'active').length
    const mrr = tenants.reduce((sum: number, t: any) => sum + Number(t.effective_monthly || 0), 0)
    const clients = tenants.reduce((sum: number, t: any) => sum + Number(t.client_count || 0), 0)
    const leads = tenants.reduce((sum: number, t: any) => sum + Number(t.lead_count || 0), 0)
    const readableDate = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
    const rows = (calendarRes.data || []).map((event: any) => `
      <tr><td style="padding:8px;color:#cbd5e1">${escapeHtml(event.date)}</td>
      <td style="padding:8px;color:#e2e8f0">${escapeHtml(event.title)}</td>
      <td style="padding:8px;color:#c6ff00">${escapeHtml(event.time)}</td></tr>`).join('')
    const html = `<!doctype html><html><body style="margin:0;padding:28px;background:#17112d;font-family:Arial,sans-serif;color:#f8fafc">
      <div style="max-width:640px;margin:auto"><h1 style="color:#c6ff00">RomyLabs Daily Executive Brief</h1>
      <p>${escapeHtml(readableDate)} · 7:00 AM Eastern</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #41326d">
      <tr><td style="padding:14px">Active offices: <b>${activeOffices}</b></td>
      <td style="padding:14px">Platform MRR: <b>$${mrr.toLocaleString('en-US')}</b></td></tr>
      <tr><td style="padding:14px">Clients: <b>${clients}</b></td>
      <td style="padding:14px">Leads: <b>${leads}</b></td></tr></table>
      <h2 style="margin-top:25px">Upcoming calendar</h2><table style="width:100%;border-collapse:collapse">
      ${rows || '<tr><td style="padding:12px;color:#cbd5e1">No upcoming TaxRes calendar events</td></tr>'}
      </table><p style="color:#cbd5e1;font-size:12px">RomyLabs · Automated executive report</p></div></body></html>`

    const { data: romylabsTransport } = await service.rpc('romylabs_stalwart_transport_for_product', {
      p_product_key: 'romylabs',
    })
    let transport = romylabsTransport
    if (!transport?.ok || !transport.username || !transport.password) {
      // Existing TaxRes Stalwart identity is the controlled secondary route;
      // never choose a random settings row or silently use Gmail.
      const {data: taxresTransport} = await service.rpc('romylabs_stalwart_transport_for_product', {
        p_product_key: 'taxres_crm',
      })
      transport = taxresTransport
    }
    if (!transport?.ok || !transport.username || !transport.password) {
      return await fail('No authenticated RomyLabs or TaxRes Stalwart delivery route is configured')
    }
    const submission = await sendViaStalwartJmap({
      host: safe(transport.host || 'mail.taxrescrm.net'),
      username: safe(transport.username),
      password: String(transport.password),
      fromAddress: safe(transport.from_address || transport.username).toLowerCase(),
      fromName: 'RomyLabs Executive Brief',
      to: destination,
      subject: `RomyLabs Executive Brief — ${readableDate}`,
      html,
      replyTo: 'romy@romylabs.com',
    })
    if (!submission?.submissionId) return await fail('Stalwart did not confirm the executive message submission')
    const submittedAt = new Date().toISOString()
    const { error: statusError } = await service.from('romylabs_daily_briefing_runs')
      .update({ status: 'submitted', submitted_at: submittedAt, provider: 'Stalwart JMAP / ' + submission.submissionId, error: null })
      .eq('id', run.id)
    if (statusError) return await fail('Provider accepted email but tracking update failed: ' + statusError.message, 500)
    return response({ ok: true, sent: true, submitted: true, submitted_at: submittedAt, recipient: destination })
  } catch (error) {
    return await fail(error instanceof Error ? error.message : 'Unexpected briefing failure', 500)
  }
})

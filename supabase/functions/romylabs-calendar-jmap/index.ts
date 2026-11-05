import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * RomyLabs Stalwart JMAP Calendar bridge.
 * Unlike the earlier CalDAV XML prototype, this uses the same authenticated
 * JMAP protocol as RomyLabs Mail. No shared client-side mailbox credentials.
 * CRM calevents is never silently mutated by this bridge.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CAP = 'urn:ietf:params:jmap:calendars'
const CORE = 'urn:ietf:params:jmap:core'
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors })
function fail(code: string, status = 400) { return respond({ ok: false, error: code }, status) }

async function requirePlatformAdmin(req: Request) {
  const authorization = req.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw new Error('unauthenticated')
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user?.id) throw new Error('unauthenticated')
  const { data: allowed, error: permissionError } = await client.rpc('_is_platform_admin')
  if (permissionError || allowed !== true) throw new Error('forbidden')
}

type Session = { auth: string; apiUrl: string; accountId: string }

async function getSession(): Promise<Session> {
  const { data: transport, error } = await svc.rpc(
    'romylabs_stalwart_transport_for_product', { p_product_key: 'romylabs' },
  )
  if (error || !transport?.ok || !transport?.username || !transport?.password || !transport?.host)
    throw new Error('stalwart_transport_missing')
  const hostname = String(transport.host).replace(/^https?:\/\//i, '').replace(/\/$/, '')
  // Prevent a mutable transport record from turning into an arbitrary outbound URL.
  if (hostname !== 'mail.taxrescrm.net') throw new Error('stalwart_host_not_verified')
  const auth = 'Basic ' + btoa(String(transport.username) + ':' + String(transport.password))
  const response = await fetch('https://mail.taxrescrm.net/.well-known/jmap', {
    headers: { Authorization: auth, Accept: 'application/json' },
    redirect: 'manual', signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('stalwart_session_http_' + response.status)
  const session = await response.json()
  const accounts = session?.accounts || {}
  const accountId = session?.primaryAccounts?.[CAP] ||
    Object.keys(accounts).find(id => !!accounts[id]?.accountCapabilities?.[CAP])
  if (!accountId || !accounts[accountId]?.accountCapabilities?.[CAP])
    throw new Error('stalwart_calendar_capability_unavailable')
  const apiUrl = new URL(String(session.apiUrl || ''), 'https://mail.taxrescrm.net')
  if (apiUrl.origin !== 'https://mail.taxrescrm.net' || apiUrl.pathname !== '/jmap/')
    throw new Error('stalwart_jmap_endpoint_invalid')
  return { auth, apiUrl: apiUrl.toString(), accountId }
}

async function jmap(session: Session, calls: unknown[]) {
  const response = await fetch(session.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: session.auth,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ using: [CORE, CAP], methodCalls: calls }),
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('stalwart_jmap_http_' + response.status)
  return await response.json()
}
function result(payload: any, name: string, tag: string) {
  const row = payload?.methodResponses?.find((item: any) => item?.[2] === tag)
  if (!row || row[0] !== name) throw new Error('stalwart_jmap_' + String(row?.[1]?.type || 'method_error'))
  return row[1]
}
function inRange(start: string, end: string) {
  const valid = /^\d{4}-\d{2}-\d{2}$/
  if (!valid.test(start) || !valid.test(end)) return false
  const a = Date.parse(start + 'T00:00:00Z')
  const b = Date.parse(end + 'T00:00:00Z')
  return Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 94 * 86400000
}
function validLocal(value: unknown) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00$/.test(value) &&
    !Number.isNaN(Date.parse(value.slice(0, 10) + 'T00:00:00Z'))
}
function minutesOf(duration: unknown) {
  if (typeof duration !== 'number' || !Number.isInteger(duration) ||
      duration < 5 || duration > 1440) return null
  return duration
}
function cleanTitle(value: unknown) {
  if (typeof value !== 'string') return null
  const title = value.trim()
  return title && title.length <= 240 ? title : null
}
function safeEvent(ev: any) {
  return {
    id: ev.id, uid: ev.uid, title: ev.title || 'Untitled',
    start: ev.start, duration: ev.duration, timeZone: ev.timeZone || 'America/New_York',
    calendarIds: ev.calendarIds || {}, recurrenceRules: ev.recurrenceRules || null,
    locations: ev.locations || null, status: ev.status || 'confirmed',
    isOrigin: ev.isOrigin !== false, recurrenceId: ev.recurrenceId || null,
    baseEventId: ev.baseEventId || null,
    recurrenceOverrides: ev.recurrenceOverrides || null,
    description: typeof ev.description === 'string' ? ev.description.slice(0, 2000) : '',
  }
}
async function calendars(session: Session) {
  const data = result(await jmap(session, [
    ['Calendar/get', { accountId: session.accountId }, 'cal'],
  ]), 'Calendar/get', 'cal')
  return (data.list || []).map((cal: any) => ({
    id: cal.id, name: cal.name || 'Calendar',
    color: cal.color || null, isDefault: !!cal.isDefault,
    myRights: cal.myRights || null,
  }))
}
async function eventState(session: Session, id: string) {
  const data = result(await jmap(session, [
    ['CalendarEvent/get', { accountId: session.accountId, ids: [id] }, 'get'],
  ]), 'CalendarEvent/get', 'get')
  return { event: data.list?.[0], state: data.state }
}
function errorStatus(message: string) {
  if (message === 'unauthenticated') return 401
  if (message === 'forbidden') return 403
  if (message.startsWith('stalwart_')) return 502
  return 400
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 405)
  try { await requirePlatformAdmin(req) }
  catch (e) { const message = String((e as Error).message); return fail(message, errorStatus(message)) }
  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'discover')
    if (!['discover', 'events', 'create', 'update', 'delete'].includes(action))
      return fail('unsupported_action')
    const session = await getSession()
    const list = await calendars(session)
    if (action === 'discover') {
      return respond({ ok: true, provider: 'stalwart-jmap', accountScope: 'romylabs',
        calendars: list.map(({ id, name, color, isDefault }) => ({ id, name, color, isDefault })),
        mode: 'jmap_discovery' })
    }

    if (action === 'events') {
      const start = String(body.start || '')
      const end = String(body.end || '')
      if (!inRange(start, end)) return fail('invalid_range')
      const query = result(await jmap(session, [[
        'CalendarEvent/query',
        { accountId: session.accountId, timeZone: 'America/New_York',
          filter: { after: start + 'T00:00:00', before: end + 'T00:00:00' },
          expandRecurrences: true, limit: 200 },
        'query',
      ]]), 'CalendarEvent/query', 'query')
      const ids = (query.ids || []).slice(0, 200)
      if (query.total > 200 || query.position > 0 || ids.length >= 200)
        return fail('calendar_result_too_large', 422)
      if (!ids.length) return respond({ ok: true, events: [], state: query.queryState, mode: 'jmap_events' })
      const data = result(await jmap(session, [[
        'CalendarEvent/get', { accountId: session.accountId, ids },
        'get',
      ]]), 'CalendarEvent/get', 'get')
      return respond({ ok: true, events: (data.list || []).map(safeEvent),
        state: data.state, mode: 'jmap_events' })
    }

    const calendarId = String(body.calendarId || '')
    const validCalendar = list.find((cal: any) => cal.id === calendarId)
    if (action === 'create') {
      if (!validCalendar) return fail('invalid_calendar')
      if (validCalendar.myRights?.mayWriteAll !== true && validCalendar.myRights?.mayWriteOwn !== true)
        return fail('calendar_write_denied', 403)
      const title = cleanTitle(body.title)
      const start = body.start
      const minutes = minutesOf(body.durationMinutes)
      if (!title || !validLocal(start) || minutes === null) return fail('invalid_event')
      const data = result(await jmap(session, [[
        'CalendarEvent/set', { accountId: session.accountId, create: {
          newEvent: {
            '@type': 'Event', uid: crypto.randomUUID(),
            calendarIds: { [calendarId]: true }, title, start,
            duration: 'PT' + minutes + 'M',
            timeZone: 'America/New_York', showWithoutTime: false,
          },
        } }, 'set',
      ]]), 'CalendarEvent/set', 'set')
      if (!data.created?.newEvent?.id)
        return fail('stalwart_create_rejected', 409)
      return respond({ ok: true, id: data.created.newEvent.id, state: data.newState, operation: 'created' })
    }

    const eventId = String(body.id || '')
    if (!/^[a-z0-9_-]{1,256}$/i.test(eventId)) return fail('invalid_event_id')
    if (!body.ifInState || typeof body.ifInState !== 'string') return fail('missing_event_state', 409)
    const before = await eventState(session, eventId)
    if (!before.event) return fail('event_not_found', 404)
    const eventCalendars = Object.keys(before.event.calendarIds || {})
    if (!eventCalendars.length || !eventCalendars.every(id => list.some((cal: any) =>
      cal.id === id && cal.myRights?.mayWriteAll === true)))
      return fail('calendar_access_denied', 403)
    if (before.event.isOrigin === false) return fail('external_event_read_only', 403)
    // Do not silently rewrite/delete an entire recurring series.
    if (before.event.baseEventId || before.event.recurrenceId || before.event.recurrenceRules?.length || Object.keys(before.event.recurrenceOverrides || {}).length)
      return fail('recurring_event_requires_series_editor', 409)

    if (action === 'update') {
      const title = cleanTitle(body.title)
      const start = body.start
      const minutes = minutesOf(body.durationMinutes)
      if (!title || !validLocal(start) || minutes === null) return fail('invalid_event')
      const data = result(await jmap(session, [[
        'CalendarEvent/set', {
          accountId: session.accountId,
          ifInState: body.ifInState,
          update: { [eventId]: {
            title, start, duration: 'PT' + minutes + 'M', timeZone: 'America/New_York',
          } },
        }, 'set',
      ]]), 'CalendarEvent/set', 'set')
      if (!Object.prototype.hasOwnProperty.call(data.updated || {}, eventId)) return fail('stalwart_update_conflict', 409)
      return respond({ ok: true, id: eventId, state: data.newState, operation: 'updated' })
    }
    if (body.confirmDelete !== true) return fail('delete_confirmation_required')
    const data = result(await jmap(session, [[
      'CalendarEvent/set', {
        accountId: session.accountId, ifInState: body.ifInState,
        destroy: [eventId],
      }, 'set',
    ]]), 'CalendarEvent/set', 'set')
    if (!data.destroyed?.includes(eventId)) return fail('stalwart_delete_conflict', 409)
    return respond({ ok: true, id: eventId, state: data.newState, operation: 'deleted' })
  } catch (e) {
    const message = String((e as Error).message || 'unexpected_error')
    return fail(message.startsWith('stalwart_') ? message : 'calendar_service_error',
      message.startsWith('stalwart_') ? 502 : 500)
  }
})

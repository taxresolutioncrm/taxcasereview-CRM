import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const CAP = 'urn:ietf:params:jmap:calendars'
const SRC = fs.readFileSync('supabase/functions/romylabs-calendar-jmap/index.ts', 'utf8')
const compiled = transformSync(SRC.replace(
  "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'",
  'const createClient = globalThis.__testCreateClient'
), { loader: 'ts', format: 'cjs', target: 'es2022' }).code

async function fixture({
  admin = true, sessionCapability = true, mayWrite = true,
  event = null, updated = { e1: null }, destroyed = ['e1'],
  transportHost = 'mail.taxrescrm.net',
} = {}) {
  let handler
  const calls = []
  const fetches = []
  const calendar = {
    id: 'cal1', name: 'RomyLabs', isDefault: true,
    myRights: { mayWriteAll: mayWrite, mayWriteOwn: mayWrite },
  }
  const storedEvent = event === null ? {
    id: 'e1', uid: 'uid1', title: 'Planning',
    start: '2026-11-04T09:00:00', duration: 'PT60M',
    calendarIds: { cal1: true }, isOrigin: true,
  } : event
  const rpc = async name => name === '_is_platform_admin'
    ? { data: admin, error: null }
    : { data: { ok: true, host: transportHost,
        username: 'service@romylabs.com', password: 'private-test-value' }, error: null }
  const fakeCreateClient = () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'platform-admin' } }, error: null }) },
    rpc,
  })
  async function fakeFetch(url, opts = {}) {
    fetches.push({ url: String(url), method: opts.method || 'GET' })
    if (String(url).endsWith('/jmap/session')) {
      return new Response(JSON.stringify({
        apiUrl: 'https://mail.taxrescrm.net/jmap/',
        primaryAccounts: sessionCapability ? { [CAP]: 'b' } : {},
        accounts: { b: { accountCapabilities: sessionCapability ? { [CAP]: {} } : {} } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    assert.equal(String(url), 'https://mail.taxrescrm.net/jmap/')
    const request = JSON.parse(opts.body)
    assert.ok(request.using.includes(CAP))
    const [method, args, tag] = request.methodCalls[0]
    calls.push({ method, args })
    let data
    switch (method) {
      case 'Calendar/get': data = { list: [calendar], state: 'state1' }; break
      case 'CalendarEvent/query': data = { ids: ['e1'], total: 1, position: 0, queryState: 'q1' }; break
      case 'CalendarEvent/get': data = { list: storedEvent ? [storedEvent] : [], state: 'state1' }; break
      case 'CalendarEvent/set':
        data = args.create ? { created: { newEvent: { id: 'e2' } }, newState: 'state2' }
          : args.update ? { updated, newState: 'state2' }
          : { destroyed, newState: 'state2' }
        break
      default: throw new Error('Unexpected JMAP method ' + method)
    }
    return new Response(JSON.stringify({ methodResponses: [[method, data, tag]] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const ctx = {
    __testCreateClient: fakeCreateClient,
    Deno: { env: { get: () => 'test' }, serve: cb => { handler = cb } },
    Response, Request, URL, Date, Math, JSON, Object, Array, String, Number,
    Set, Map, RegExp, Error, TypeError, AbortSignal, crypto, btoa,
    fetch: fakeFetch,
  }
  vm.runInNewContext(compiled, ctx, { filename: 'romylabs-calendar-jmap.bundle.js' })
  assert.equal(typeof handler, 'function', 'Deno handler not registered')
  async function invoke(body, token = 'test') {
    const req = new Request('https://example.com/calendar', {
      method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {},
      body: JSON.stringify(body),
    })
    const response = await handler(req)
    return { status: response.status, body: await response.json() }
  }
  return { invoke, calls, fetches }
}

async function run() {
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'discover' }, '')
    assert.equal(r.status, 401, 'Anonymous call must be rejected')
    assert.equal(env.fetches.length, 0, 'Unauthorized call must never access Stalwart')
  }
  {
    const env = await fixture({ admin: false })
    const r = await env.invoke({ action: 'discover' })
    assert.equal(r.status, 403, 'Non-admin call must be rejected')
    assert.equal(env.fetches.length, 0)
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'discover' })
    assert.equal(r.status, 200)
    assert.equal(r.body.calendars[0].name, 'RomyLabs')
    assert.equal(env.fetches[0].url, 'https://mail.taxrescrm.net/jmap/session',
      'Must call the JMAP session resource directly; well-known is a 307 redirect')
    assert.ok(!JSON.stringify(r.body).includes('private-test-value'))
  }
  {
    const env = await fixture({ sessionCapability: false })
    const r = await env.invoke({ action: 'discover' })
    assert.equal(r.status, 502, 'Do not claim calendar support when capability missing')
  }
  {
    const env = await fixture({ transportHost: 'redirect.example.net' })
    const r = await env.invoke({ action: 'discover' })
    assert.equal(r.status, 502, 'Reject unexpected Stalwart transport hosts')
    assert.equal(env.fetches.length, 0)
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'events',
      start: '2026-11-01', end: '2026-12-01' })
    assert.equal(r.status, 200)
    assert.equal(r.body.events.length, 1)
    assert.equal(r.body.events[0].title, 'Planning')
    assert.ok(env.calls.some(x => x.method === 'CalendarEvent/query'))
    assert.ok(env.calls.some(x => x.method === 'CalendarEvent/get'))
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'events',
      start: '2026-01-01', end: '2026-12-01' })
    assert.equal(r.status, 400, 'Overly broad date windows must fail')
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'create',
      calendarId: 'cal1', title: 'New meeting',
      start: '2026-11-05T10:00:00', durationMinutes: 60 })
    assert.equal(r.status, 200)
    assert.equal(r.body.id, 'e2')
    assert.equal(env.calls.find(x => x.method === 'CalendarEvent/set').args.create.newEvent.title, 'New meeting')
  }
  {
    const env = await fixture({ mayWrite: false })
    const r = await env.invoke({ action: 'create', calendarId: 'cal1',
      title: 'Not permitted', start: '2026-11-05T10:00:00', durationMinutes: 60 })
    assert.equal(r.status, 403, 'Calendar write permissions must be respected')
    assert.ok(!env.calls.some(x => x.method === 'CalendarEvent/set'))
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'update', id: 'e1', ifInState: 'state1',
      title: 'Updated meeting', start: '2026-11-05T11:00:00', durationMinutes: 45 })
    assert.equal(r.status, 200, 'JMAP updated entries may be null on success')
    assert.equal(r.body.operation, 'updated')
  }
  {
    const env = await fixture({ updated: {} })
    const r = await env.invoke({ action: 'update', id: 'e1', ifInState: 'state1',
      title: 'Updated meeting', start: '2026-11-05T11:00:00', durationMinutes: 45 })
    assert.equal(r.status, 409, 'Missing updated entry must fail')
  }
  {
    const env = await fixture({ mayWrite: false })
    const r = await env.invoke({ action: 'delete', id: 'e1',
      ifInState: 'state1', confirmDelete: true })
    assert.equal(r.status, 403, 'Cannot delete event from a read-only calendar')
  }
  {
    const env = await fixture({ event: {
      id: 'e1', calendarIds: { cal1: true },
      recurrenceRules: [{ frequency: 'weekly' }],
      isOrigin: true,
    } })
    const r = await env.invoke({ action: 'update', id: 'e1', ifInState: 'state1',
      title: 'Risky edit', start: '2026-11-05T11:00:00', durationMinutes: 45 })
    assert.equal(r.status, 409, 'Recurring series must not be silently edited')
  }
  {
    const env = await fixture({ event: {
      id: 'e1', calendarIds: { cal1: true }, isOrigin: false,
    } })
    const r = await env.invoke({ action: 'delete', id: 'e1',
      ifInState: 'state1', confirmDelete: true })
    assert.equal(r.status, 403, 'External invitation must remain read-only')
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'delete', id: 'e1',
      ifInState: 'state1', confirmDelete: false })
    assert.equal(r.status, 400, 'Deletion must require confirmation')
  }
  {
    const env = await fixture()
    const r = await env.invoke({ action: 'delete', id: 'e1',
      ifInState: 'state1', confirmDelete: true })
    assert.equal(r.status, 200)
    assert.equal(r.body.operation, 'deleted')
  }
  console.log('PASS: 15 authenticated and guarded JMAP calendar contract scenarios')
}

await run()

import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync('supabase/functions/romylabs-calendar-jmap/index.ts', 'utf8')
const ui = fs.readFileSync('src/components/StalwartCalendarWorkspace.jsx', 'utf8')
const calendar = fs.readFileSync('src/pages/Calendar.jsx', 'utf8')
for (const token of [
  "await requirePlatformAdmin(req)",
  "client.rpc('_is_platform_admin')",
  "romylabs_stalwart_transport_for_product",
  "p_product_key: 'romylabs'",
  "hostname !== 'mail.taxrescrm.net'",
  "'urn:ietf:params:jmap:calendars'",
  "'CalendarEvent/query'",
  "'CalendarEvent/get'",
  "'CalendarEvent/set'",
  "ifInState: body.ifInState",
  "recurring_event_requires_series_editor",
  "delete_confirmation_required",
  "calendar_result_too_large",
  "accountScope: 'romylabs'",
]) assert.ok(edge.includes(token), 'Missing Stalwart JMAP security invariant: ' + token)
for (const forbidden of [
  "from('calevents').update",
  "from('calevents').insert",
  "from('calevents').delete",
  "Access-Control-Allow-Credentials': 'true'",
  "transport.password });",
  "return respond({ password:",
]) assert.ok(!edge.includes(forbidden), 'Unsafe JMAP integration: ' + forbidden)
assert.ok(ui.includes("supabase.functions.invoke('romylabs-calendar-jmap'"), 'UI must call Edge Function, not the Stalwart host')
assert.ok(!ui.includes("transport.password"), 'Mail credentials must not reach browser')
assert.ok(calendar.includes("VITE_STALWART_CALENDAR_PREVIEW === 'true'"), 'Admin-only feature gate required')
assert.ok(calendar.includes("isRomyLabsAdmin"), 'New feature must only render on RomyLabs Admin')
assert.ok(calendar.includes("<StalwartCalendarWorkspace"), 'Calendar workspace hook missing')
console.log('PASS: Stalwart JMAP calendar authorization, isolation, read/write safeguards and hidden preview gate')

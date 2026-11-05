const fs = require('fs')
const assert = require('assert')
const page = fs.readFileSync('src/pages/Calendar.jsx', 'utf8')
const preview = fs.readFileSync('src/components/AdminCalendarPreview.jsx', 'utf8')
assert(page.includes('isRomyLabsAdmin && adminCalendarPreviewOpen'),
  'Admin calendar preview must remain limited to RomyLabs Admin Portal')
assert(page.includes('onOpenEvent={event => { setAdminCalendarPreviewOpen(false); setSelectedEvent(event) }}'),
  'Preview event details must reuse the existing CRM detail view')
assert(page.includes('setShowForm(true)') && page.includes('onCreate={date =>'),
  'Preview Add Event must reuse existing CRM event form')
assert(page.includes('onBooking={() => { setAdminCalendarPreviewOpen(false); setShowBooking(true) }}'),
  'Preview booking action must retain existing booking component')
assert(preview.includes('onOpenEvent(ev)') && preview.includes('onCreate(activeDay)'),
  'Existing CRM event actions must be available')
assert(!preview.includes("from '../lib/supabase'") &&
  !preview.includes('supabase.functions.invoke') &&
  !preview.includes('CalendarEvent/set') &&
  !preview.includes('CalendarEvent/get'),
  'Visual preview must not create any independent persistence or JMAP path')
assert(!page.includes('VITE_STALWART_CALENDAR_PREVIEW') && !page.includes('StalwartCalendarWorkspace'),
  'Unverified Stalwart workspace must not be accidentally activated')
console.log('PASS Admin Calendar visual preview uses existing CRM events and workflows only')

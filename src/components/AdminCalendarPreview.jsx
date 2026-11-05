import { useMemo, useState } from 'react'

const pad = n => String(n).padStart(2, '0')
const iso = d => [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-')
const dateOf = value => new Date(value + 'T12:00:00')
const monthOf = d => new Date(d.getFullYear(), d.getMonth(), 1)
const shiftMonth = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BUTTON = {
  border: '1px solid var(--br)', background: 'var(--sf)', color: 'var(--tx)',
  borderRadius: 8, padding: '8px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
}
const eventDate = ev => {
  const value = String(ev.date || '')
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}
function calendarDays(month) {
  const offset = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return Array.from({ length: Math.ceil((offset + total) / 7) * 7 }, (_, i) =>
    new Date(month.getFullYear(), month.getMonth(), 1 + i - offset))
}
function eventLabel(ev) {
  return ev.title || ev.clientName || ev.client || ev.eventType || 'Appointment'
}
const timeLabel = ev => String(ev.timedisplay || ev.time || '').slice(0, 12)
const safeColor = status => {
  const key = String(status || '').toLowerCase()
  return key === 'cancelled' ? '#ef4444' : key === 'completed' ? '#16a34a' :
    key === 'pending' ? '#f59e0b' : '#3b82f6'
}

/**
 * Display-only UI over the existing Calendar page's filtered event list.
 * All create/edit/booking actions are delegated to the existing CRM handlers.
 * No Stalwart request, duplicate save, or new Supabase authorization path.
 */
export default function AdminCalendarPreview({ events = [], onClose, onCreate, onOpenEvent, onBooking }) {
  const [month, setMonth] = useState(monthOf(new Date()))
  const [activeDay, setActiveDay] = useState(iso(new Date()))
  const [view, setView] = useState('month')
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => events.filter(ev => {
    if (!eventDate(ev)) return false
    const q = search.trim().toLowerCase()
    return !q || [eventLabel(ev), ev.clientName, ev.client, ev.product_id, ev.eventType]
      .some(x => String(x || '').toLowerCase().includes(q))
  }), [events, search])
  const groups = useMemo(() => {
    const next = new Map()
    for (const ev of filtered) {
      const date = eventDate(ev)
      if (!next.has(date)) next.set(date, [])
      next.get(date).push(ev)
    }
    for (const list of next.values()) list.sort((a, b) =>
      String(a.time || '').localeCompare(String(b.time || '')))
    return next
  }, [filtered])
  const selected = dateOf(activeDay)
  const days = view === 'month' ? calendarDays(month) : view === 'day' ? [selected] :
    Array.from({ length: 7 }, (_, i) => {
      const date = new Date(selected)
      date.setDate(selected.getDate() - selected.getDay() + i)
      return date
    })
  function go(n) {
    if (view === 'month') setMonth(current => shiftMonth(current, n))
    else {
      const date = dateOf(activeDay)
      date.setDate(date.getDate() + (view === 'week' ? n * 7 : n))
      setActiveDay(iso(date))
      setMonth(monthOf(date))
    }
  }
  function today() {
    const date = new Date()
    setMonth(monthOf(date)); setActiveDay(iso(date))
  }
  const btn = (label, cb, selectedState = false) =>
    <button type="button" onClick={cb} style={{
      ...BUTTON, background: selectedState ? '#166534' : 'var(--sf)',
      color: selectedState ? '#fff' : 'var(--tx)',
    }}>{label}</button>
  return (
    <section aria-label="New CRM calendar preview" style={{
      minHeight: '100%', background: 'var(--bg)', color: 'var(--tx)', padding: 16,
    }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap',
        alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          {btn('← Classic calendar', onClose)}
          <h2 style={{ fontSize: 24, margin: '10px 0 4px' }}>New Calendar</h2>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>
            Live CRM appointments · Existing booking and reminder workflows · Stalwart sync pending
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {btn('Today', today)}
          {btn('‹', () => go(-1))}
          <strong style={{ padding: 6, fontSize: 14 }}>
            {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </strong>
          {btn('›', () => go(1))}
          {['month', 'week', 'day'].map(mode =>
            <span key={mode}>{btn(mode[0].toUpperCase() + mode.slice(1),
              () => setView(mode), view === mode)}</span>)}
          {btn('Booking link', onBooking)}
          <button type="button" onClick={() => onCreate(activeDay)}
            style={{ ...BUTTON, background: '#16a34a', color: '#fff' }}>+ Add event</button>
        </div>
      </div>
      <div style={{ border: '1px solid var(--br)', borderRadius: 10,
        background: 'var(--sf)', padding: 12, marginBottom: 12,
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>{filtered.length} CRM events</strong>
        <input aria-label="Search calendar appointments" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search client, event or product…"
          style={{ flex: '1 1 200px', marginLeft: 'auto', maxWidth: 340,
            padding: '9px 11px', border: '1px solid var(--br)', borderRadius: 8,
            color: 'var(--tx)', background: 'var(--bg)', fontSize: 12 }} />
      </div>
      <div style={{ display: 'grid',
        gridTemplateColumns: view === 'day' ? '1fr' : 'repeat(7,minmax(0,1fr))',
        gap: 3, marginBottom: 3 }}>
        {(view === 'day' ? [DAYS[selected.getDay()]] : DAYS).map(day =>
          <div key={day} style={{ textAlign: 'center', fontWeight: 800, color: 'var(--t3)',
            fontSize: 11, padding: 7 }}>{day}</div>)}
      </div>
      <div role="grid" aria-label="Calendar appointments" style={{
        display: 'grid',
        gridTemplateColumns: view === 'day' ? '1fr' : 'repeat(7,minmax(0,1fr))',
        gap: 3 }}>
        {days.map(date => {
          const key = iso(date)
          const matching = groups.get(key) || []
          const currentMonth = date.getMonth() === month.getMonth()
          return (
            <div key={key} role="gridcell" aria-label={key} style={{
              minHeight: view === 'month' ? 105 : 185, background: 'var(--sf)',
              opacity: currentMonth || view !== 'month' ? 1 : 0.5,
              border: '1px solid ' + (key === activeDay ? '#16a34a' : 'var(--br)'),
              borderRadius: 8, padding: 6, minWidth: 0 }}>
              <button type="button" onClick={() => {
                setActiveDay(key); setMonth(monthOf(date))
                if (view === 'week') setView('day')
              }} style={{ border: 'none', cursor: 'pointer', fontWeight: 800,
                background: key === iso(new Date()) ? '#166534' : 'transparent',
                color: key === iso(new Date()) ? '#fff' : 'var(--tx)',
                borderRadius: 5, padding: '3px 5px', marginBottom: 5 }}>
                {date.getDate()}
              </button>
              {matching.slice(0, view === 'month' ? 3 : 60).map((ev, i) =>
                <button type="button" key={(ev.id || 'event') + '-' + i}
                  onClick={() => onOpenEvent(ev)}
                  title={eventLabel(ev)} style={{
                    display: 'block', width: '100%', borderRadius: 5, minWidth: 0,
                    border: '1px solid var(--br)', borderLeft: '3px solid ' + safeColor(ev.status),
                    background: 'var(--nav)', color: 'var(--tx)', fontSize: 11,
                    padding: '5px 6px', marginBottom: 4, cursor: 'pointer',
                    textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' }}>
                  {timeLabel(ev) ? timeLabel(ev) + ' · ' : ''}{eventLabel(ev)}
                </button>)}
              {view === 'month' && matching.length > 3 &&
                <button type="button" onClick={() => {
                  setActiveDay(key); setView('day')
                }} style={{ ...BUTTON, border: 0, background: 'transparent', padding: 3 }}>
                  +{matching.length - 3} more
                </button>}
              {view !== 'month' &&
                <button type="button" onClick={() => onCreate(key)}
                  style={{ ...BUTTON, marginTop: 8, padding: 5 }}>+ Add</button>}
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 12 }}>
        Event details, appointment creation and booking links use the existing CRM.
        No appointments are transferred or duplicated.
      </p>
    </section>
  )
}

import { useMemo, useState } from 'react'
import { PRODUCT_BOOKING_CONFIGS } from '../lib/productBookingConfig'

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
export default function AdminCalendarPreview({ events = [], products = [], deadlines = [], loading = false, onClose, onCreate, onOpenEvent, onBooking }) {
  const [month, setMonth] = useState(monthOf(new Date()))
  const [activeDay, setActiveDay] = useState(iso(new Date()))
  const [view, setView] = useState('month')
  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [showDeadlines, setShowDeadlines] = useState(true)
  const todayKey = iso(new Date())
  const availableProducts = useMemo(() => {
    const options = new Map(
      products.filter(p => p?.key).map(p => [p.key, { key: p.key, name: p.name || p.key }])
    )
    // Preserve discoverability for newly arriving calendar events even before
    // an asynchronous registry refresh.
    for (const ev of events) {
      const key = ev.product_id || 'romylabs'
      if (!options.has(key)) options.set(key, { key, name: PRODUCT_BOOKING_CONFIGS[key]?.name || key })
    }
    return [...options.values()]
  }, [products, events])
  const eventCountByProduct = useMemo(() => {
    const counts = new Map()
    for (const ev of events) {
      const key = ev.product_id || 'romylabs'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [events])
  const filtered = useMemo(() => events.filter(ev => {
    if (!eventDate(ev)) return false
    if (productFilter !== 'all' && (ev.product_id || 'romylabs') !== productFilter) return false
    const q = search.trim().toLowerCase()
    return !q || [eventLabel(ev), ev.clientName, ev.client, ev.product_id, ev.eventType]
      .some(x => String(x || '').toLowerCase().includes(q))
  }), [events, search, productFilter])
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
  const selectedAgenda = groups.get(activeDay) || []
  const soon = filtered.filter(ev => eventDate(ev) >= todayKey && String(ev.status || '').toLowerCase() !== 'cancelled').slice()
    .sort((a, b) => eventDate(a).localeCompare(eventDate(b)) || String(a.time || '').localeCompare(String(b.time || ''))).slice(0, 8)
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
  function openDay(date) {
    setActiveDay(date)
    setMonth(monthOf(dateOf(date)))
    setView('day')
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
          {btn('Switch to classic', onClose)}
          <h2 style={{ fontSize: 24, margin: '10px 0 4px' }}>Unified Calendar</h2>
          <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>
            New layout + classic functionality · Existing appointments and reminders
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
          <button type="button" onClick={() => onCreate(activeDay, productFilter)}
            style={{ ...BUTTON, background: '#16a34a', color: '#fff' }}>+ Add event</button>
        </div>
      </div>
      <div style={{ border: '1px solid var(--br)', borderRadius: 10,
        background: 'var(--sf)', padding: 12, marginBottom: 12,
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>{filtered.length} CRM events</strong>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          Select a date to view it, or use + to add an appointment
        </span>
        <span style={{ fontSize: 12, color: 'var(--t3)' }}>{filtered.filter(ev => eventDate(ev) === todayKey).length} today</span>
        <label style={{ fontSize: 12, color: 'var(--t3)' }} htmlFor="calendar-product-filter">CRM</label>
        <select id="calendar-product-filter" aria-label="Filter by CRM" value={productFilter}
          onChange={e => setProductFilter(e.target.value)}
          style={{ minHeight: 36, maxWidth: 210, background: 'var(--bg)', color: 'var(--tx)', border: '1px solid var(--br)', borderRadius: 8, padding: '7px 9px' }}>
          <option value="all">All products</option>
          {availableProducts.map(product =>
            <option key={product.key} value={product.key}>
              {product.name} ({eventCountByProduct.get(product.key) || 0})
            </option>)}
        </select>
        <input aria-label="Search calendar appointments" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search client, event or product…"
          style={{ flex: '1 1 200px', marginLeft: 'auto', maxWidth: 340,
            padding: '9px 11px', border: '1px solid var(--br)', borderRadius: 8,
            color: 'var(--tx)', background: 'var(--bg)', fontSize: 12 }} />
      </div>
      {loading && <p role="status" style={{ fontSize: 12, color: 'var(--t3)' }}>Refreshing appointments…</p>}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 560px', minWidth: 0, overflowX: 'auto' }}>
      <div style={{ display: 'grid', minWidth: view === 'day' ? 0 : 630,
        gridTemplateColumns: view === 'day' ? '1fr' : 'repeat(7,minmax(0,1fr))',
        gap: 3, marginBottom: 3 }}>
        {(view === 'day' ? [DAYS[selected.getDay()]] : DAYS).map(day =>
          <div key={day} style={{ textAlign: 'center', fontWeight: 800, color: 'var(--t3)',
            fontSize: 11, padding: 7 }}>{day}</div>)}
      </div>
      <div role="grid" aria-label="Calendar appointments" style={{
        display: 'grid', minWidth: view === 'day' ? 0 : 630,
        gridTemplateColumns: view === 'day' ? '1fr' : 'repeat(7,minmax(0,1fr))',
        gap: 3 }}>
        {days.map(date => {
          const key = iso(date)
          const matching = groups.get(key) || []
          const currentMonth = date.getMonth() === month.getMonth()
          return (
            <div key={key} role="gridcell" aria-label={key}
              tabIndex={0}
              onClick={() => openDay(key)}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openDay(key)
                }
              }}
              title="Click to view this day. Use + to add an appointment."
              style={{
              cursor: 'pointer',
              minHeight: view === 'month' ? 105 : 185, background: 'var(--sf)',
              opacity: currentMonth || view !== 'month' ? 1 : 0.5,
              border: '1px solid ' + (key === activeDay ? '#16a34a' : 'var(--br)'),
              borderRadius: 8, padding: 6, minWidth: 0 }}>
              <button type="button" onClick={e => {
                e.stopPropagation()
                openDay(key)
              }} style={{ border: 'none', cursor: 'pointer', fontWeight: 800,
                background: key === iso(new Date()) ? '#166534' : 'transparent',
                color: key === iso(new Date()) ? '#fff' : 'var(--tx)',
                borderRadius: 5, padding: '3px 5px', marginBottom: 5 }}>
                {date.getDate()}
              </button>
              <button type="button" aria-label={'Add appointment on ' + key}
                onClick={e => { e.stopPropagation(); onCreate(key, productFilter) }}
                style={{ float: 'right', background: 'transparent', color: 'var(--t2)',
                  border: '1px solid var(--br)', borderRadius: 5, cursor: 'pointer',
                  fontSize: 12, lineHeight: 1.2, padding: '2px 6px' }}>+</button>
              {matching.slice(0, view === 'month' ? 3 : 60).map((ev, i) =>
                <button type="button" key={(ev.id || 'event') + '-' + i}
                  onClick={e => { e.stopPropagation(); onOpenEvent(ev) }}
                  title={eventLabel(ev)} style={{
                    display: 'block', width: '100%', borderRadius: 5, minWidth: 0,
                    border: '1px solid var(--br)', borderLeft: '3px solid ' + safeColor(ev.status),
                    background: 'var(--nav)', color: 'var(--tx)', fontSize: 11,
                    padding: '5px 6px', marginBottom: 4, cursor: 'pointer',
                    textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    {PRODUCT_BOOKING_CONFIGS[ev.product_id]?.logo && <img src={PRODUCT_BOOKING_CONFIGS[ev.product_id].logo} alt="" aria-hidden="true" style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0 }} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {timeLabel(ev) ? timeLabel(ev) + ' · ' : ''}{eventLabel(ev)}
                    </span>
                  </span>
                </button>)}
              {view === 'month' && matching.length > 3 &&
                <button type="button" onClick={e => {
                  e.stopPropagation()
                  openDay(key)
                }} style={{ ...BUTTON, border: 0, background: 'transparent', padding: 3 }}>
                  +{matching.length - 3} more
                </button>}
              {view !== 'month' &&
                <button type="button" onClick={e => { e.stopPropagation(); onCreate(key, productFilter) }}
                  style={{ ...BUTTON, marginTop: 8, padding: 5 }}>+ Add</button>}
            </div>
          )
        })}
      </div>
      </div>
      <aside aria-label="Calendar agenda and deadlines" style={{ flex: '1 1 250px', minWidth: 230, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Selected day · {activeDay}</h3>
          {selectedAgenda.length === 0 ? <p style={{ color: 'var(--t3)', fontSize: 12, margin: 0 }}>No appointments on this day.</p> :
            selectedAgenda.map((ev, i) => (
              <button key={(ev.id || 'day') + i} type="button" onClick={() => onOpenEvent(ev)}
                style={{ ...BUTTON, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, borderLeft: '3px solid ' + safeColor(ev.status), fontWeight: 500 }}>
                <strong>{timeLabel(ev) || 'All day'}</strong> · {eventLabel(ev)}
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
                  {PRODUCT_BOOKING_CONFIGS[ev.product_id]?.name || ev.product_id || 'RomyLabs'}
                </div>
              </button>
            ))}
          <button type="button" onClick={() => onCreate(activeDay, productFilter)} style={{ ...BUTTON, width: '100%', marginTop: 7 }}>+ New appointment this day</button>
        </div>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 10, padding: 12 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Upcoming appointments</h3>
          {soon.length === 0 ? <p style={{ fontSize: 12, color: 'var(--t3)' }}>Nothing upcoming.</p> :
            soon.map((ev, i) => <button key={(ev.id || 'soon') + i} type="button" onClick={() => onOpenEvent(ev)}
              style={{ ...BUTTON, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, fontWeight: 500 }}>
              <strong>{eventDate(ev)}</strong> · {timeLabel(ev) || 'All day'} · {eventLabel(ev)}
            </button>)}
        </div>
        <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 10, padding: 12 }}>
          <button type="button" aria-expanded={showDeadlines} onClick={() => setShowDeadlines(v => !v)}
            style={{ ...BUTTON, display: 'block', width: '100%', textAlign: 'left', fontSize: 14 }}>
            {showDeadlines ? '▾' : '▸'} Upcoming deadlines ({deadlines.length})
          </button>
          {showDeadlines && (deadlines.length ? deadlines.slice().sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))).slice(0, 15).map((d, i) => (
            <div key={d.id || i} style={{ padding: '8px 4px', borderBottom: '1px solid var(--br)', fontSize: 12 }}>
              <strong>{d.title}</strong>
              <div style={{ color: 'var(--t3)' }}>{d.clientName || ''} · {d.dueDate || ''}</div>
            </div>
          )) : <p style={{ color: 'var(--t3)', fontSize: 12 }}>No active deadlines.</p>)}
        </div>
      </aside>
      </div>
      <p style={{ fontSize: 11, color: 'var(--t3)', marginTop: 12 }}>
        The unified design uses your existing CRM appointment editor, booking links, reminders and event actions.
        Switch to classic anytime. Stalwart synchronization is not yet enabled.
      </p>
    </section>
  )
}

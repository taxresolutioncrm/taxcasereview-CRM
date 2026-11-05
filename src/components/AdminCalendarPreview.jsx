import { useMemo, useState } from 'react'
import { PRODUCT_BOOKING_CONFIGS } from '../lib/productBookingConfig'
import './AdminCalendarPreview.css'

const VERSION = 'v3.2.57'
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = value => String(value).padStart(2, '0')
const iso = date => [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-')
const parseDate = date => new Date(date + 'T12:00:00')
const firstMonth = date => new Date(date.getFullYear(), date.getMonth(), 1)
const moveMonth = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, 1)
const dateOf = event => {
  const text = String(event.date || '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''
}
const timeOf = event => String(event.time || event.timedisplay || '').slice(0, 12)
const nameOf = event => event.title || event.clientName || event.client || event.eventType || 'Appointment'
const colors = {
  scheduled: '#368ff4', confirmed: '#21b778', pending: '#eeb04c',
  in_progress: '#8b79f6', completed: '#20b777', cancelled: '#ef6670',
}
const colorOf = event => colors[String(event.status || '').toLowerCase()] || '#368ff4'
const longDate = date => parseDate(date).toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
})
const daysOfMonth = month => {
  const start = firstMonth(month)
  const offset = start.getDay()
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, index) =>
    new Date(month.getFullYear(), month.getMonth(), 1 + index - offset))
}
const button = (label, action, className = '') =>
  <button type="button" className={'uc-btn ' + className} onClick={action}>{label}</button>

/**
 * Redesigned view over the EXISTING CRM events. Never writes to a second store.
 * Booking, editing, and notifications continue through the classic Calendar
 * handlers passed in by the parent page.
 */
export default function AdminCalendarPreview({
  events = [], products = [], deadlines = [], loading = false,
  onClose, onCreate, onOpenEvent, onBooking,
}) {
  const [month, setMonth] = useState(firstMonth(new Date()))
  const [selectedDay, setSelectedDay] = useState(iso(new Date()))
  const [view, setView] = useState('month')
  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [upcomingOpen, setUpcomingOpen] = useState(true)
  const [deadlinesOpen, setDeadlinesOpen] = useState(true)
  const today = iso(new Date())

  const availableProducts = useMemo(() => {
    const all = new Map(products.filter(p => p?.key).map(p => [
      p.key, { key: p.key, name: p.name || p.key },
    ]))
    for (const event of events) {
      const key = event.product_id || 'romylabs'
      if (!all.has(key)) all.set(key, {
        key, name: PRODUCT_BOOKING_CONFIGS[key]?.name || key,
      })
    }
    return [...all.values()]
  }, [products, events])

  const productCounts = useMemo(() => {
    const result = new Map()
    for (const event of events) {
      const key = event.product_id || 'romylabs'
      result.set(key, (result.get(key) || 0) + 1)
    }
    return result
  }, [events])

  const visibleEvents = useMemo(() => events.filter(event => {
    if (!dateOf(event)) return false
    if (productFilter !== 'all' && (event.product_id || 'romylabs') !== productFilter) return false
    const q = search.trim().toLowerCase()
    return !q || [nameOf(event), event.clientName, event.client, event.eventType, event.product_id]
      .some(value => String(value || '').toLowerCase().includes(q))
  }), [events, search, productFilter])

  const byDate = useMemo(() => {
    const grouped = new Map()
    for (const event of visibleEvents) {
      const key = dateOf(event)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(event)
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => timeOf(a).localeCompare(timeOf(b)))
    }
    return grouped
  }, [visibleEvents])

  const todayCount = (byDate.get(today) || []).length
  const monthCount = visibleEvents.filter(e => dateOf(e).startsWith(iso(month).slice(0, 7))).length
  const upcoming = useMemo(() => visibleEvents
    .filter(event => dateOf(event) >= today && String(event.status || '') !== 'cancelled')
    .slice().sort((a, b) => dateOf(a).localeCompare(dateOf(b)) ||
      timeOf(a).localeCompare(timeOf(b))).slice(0, 8), [visibleEvents, today])
  const selectedEvents = byDate.get(selectedDay) || []
  const selected = parseDate(selectedDay)
  const days = view === 'month' ? daysOfMonth(month) : view === 'day' ? [selected] :
    Array.from({ length: 7 }, (_, i) => {
      const day = parseDate(selectedDay)
      day.setDate(day.getDate() - day.getDay() + i)
      return day
    })

  const activePeriod = view === 'month'
    ? month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? 'Week of ' + days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : selected.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  function changePeriod(direction) {
    if (view === 'month') return setMonth(previous => moveMonth(previous, direction))
    const next = parseDate(selectedDay)
    next.setDate(next.getDate() + direction * (view === 'week' ? 7 : 1))
    setSelectedDay(iso(next))
    setMonth(firstMonth(next))
  }
  function selectDay(date, open = false) {
    setSelectedDay(date)
    setMonth(firstMonth(parseDate(date)))
    if (open) setView('day')
  }
  function jumpToToday() {
    selectDay(iso(new Date()))
    setView('month')
  }
  function create(date = selectedDay) {
    onCreate(date, productFilter)
  }
  function eventRow(event, key) {
    const product = PRODUCT_BOOKING_CONFIGS[event.product_id]
    return (
      <button type="button" key={key} className="uc-aside-event" onClick={() => onOpenEvent(event)}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800 }}>
          <span style={{ height: 9, width: 9, borderRadius: 99, background: colorOf(event), flexShrink: 0 }} />
          {timeOf(event) || 'All day'} · {nameOf(event)}
        </span>
        <span style={{ display: 'block', fontSize: 10, marginTop: 5, color: 'var(--uc-muted)' }}>
          {dateOf(event)} · {product?.name || event.product_id || 'RomyLabs'}
        </span>
      </button>
    )
  }

  return (
    <section className="uc-shell" aria-label="Unified CRM Calendar" data-calendar-version={VERSION}>
      <header className="uc-hero">
        <div>
          <div className="uc-eyebrow">RomyLabs workspace · Planning & scheduling</div>
          <h2>Calendar Command Center <span className="uc-version">{VERSION}</span></h2>
          <p>One place for appointments, meeting details, deadlines and booking links.
            Your existing CRM events and reminders remain connected.</p>
        </div>
        <div className="uc-hero-actions">
          {button('Send booking link', onBooking, 'uc-btn-blue')}
          {button('+ New appointment', () => create(), 'uc-btn-primary')}
          {button('Classic layout', onClose)}
        </div>
      </header>

      <div className="uc-metrics" aria-label="Calendar summary">
        <div className="uc-metric"><strong>{visibleEvents.length}</strong><small>Total matching appointments</small></div>
        <div className="uc-metric"><strong>{todayCount}</strong><small>Scheduled today</small></div>
        <div className="uc-metric"><strong>{monthCount}</strong><small>Appointments this month</small></div>
      </div>

      <div className="uc-toolbar">
        <nav className="uc-navigator" aria-label="Calendar navigation">
          {button('Today', jumpToToday)}
          {button('‹', () => changePeriod(-1))}
          <span className="uc-period">{activePeriod}</span>
          {button('›', () => changePeriod(1))}
          <div className="uc-views" aria-label="Calendar view">
            {['month', 'week', 'day'].map(mode =>
              <button key={mode} type="button" className={'uc-btn' + (view === mode ? ' uc-active' : '')}
                aria-pressed={view === mode} onClick={() => setView(mode)}>
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>)}
          </div>
        </nav>
        <div className="uc-filters">
          <label htmlFor="calendar-product-filter" style={{ fontSize: 11, fontWeight: 750 }}>CRM</label>
          <select id="calendar-product-filter" className="uc-select" value={productFilter}
            aria-label="Filter by CRM" onChange={e => setProductFilter(e.target.value)}>
            <option value="all">All products</option>
            {availableProducts.map(product =>
              <option key={product.key} value={product.key}>
                {product.name} ({productCounts.get(product.key) || 0})
              </option>)}
          </select>
          <input className="uc-search" type="search" aria-label="Search calendar appointments"
            placeholder="Search appointments or clients…" value={search}
            onChange={e => setSearch(e.target.value)} />
          {search && button('Clear', () => setSearch(''))}
        </div>
      </div>

      {loading && <p role="status" style={{ color: 'var(--uc-muted)', fontSize: 12 }}>Refreshing appointments…</p>}
      <div className="uc-workspace">
        <div className="uc-calendar-panel">
          <div className="uc-calendar-scroll">
            <div className={'uc-weekdays' + (view === 'day' ? ' uc-one' : '')}>
              {(view === 'day' ? [DAYS[selected.getDay()]] : DAYS).map(day =>
                <div className="uc-weekday" key={day}>{day.slice(0, 3)}</div>)}
            </div>
            <div className={'uc-grid' + (view === 'day' ? ' uc-one' : '')}
              style={{ '--uc-month-rows': Math.ceil(days.length / 7) }}
              role="grid" aria-label="Appointment dates">
              {days.map(day => {
                const date = iso(day)
                const daily = byDate.get(date) || []
                return (
                  <div key={date} role="gridcell" tabIndex={0} aria-label={longDate(date) +
                    ', ' + daily.length + ' appointments'}
                    className={'uc-day' + (date === selectedDay ? ' uc-selected' : '') +
                      (day.getMonth() !== month.getMonth() && view === 'month' ? ' uc-outside' : '') +
                      (view !== 'month' ? ' uc-large' : '')}
                    onClick={() => selectDay(date, true)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectDay(date, true)
                      }
                    }}>
                    <div className="uc-day-head">
                      <button type="button" className={'uc-day-date' + (date === today ? ' uc-today' : '')}
                        onClick={e => { e.stopPropagation(); selectDay(date, true) }}>
                        {day.getDate()}
                      </button>
                      <div className="uc-day-right">
                        {daily.length > 0 && <span className="uc-count">{daily.length}</span>}
                        <button type="button" className="uc-add" title={'Add appointment on ' + date}
                          aria-label={'Add appointment on ' + date}
                          onClick={e => { e.stopPropagation(); create(date) }}>+</button>
                      </div>
                    </div>
                    {daily.slice(0, view === 'month' ? 3 : 30).map((event, index) => (
                      <button key={(event.id || date) + index} type="button" className="uc-event"
                        title={nameOf(event)} onClick={e => { e.stopPropagation(); onOpenEvent(event) }}
                        style={{ borderLeftColor: colorOf(event) }}>
                        <time>{timeOf(event) || 'All day'}</time> · {nameOf(event)}
                      </button>
                    ))}
                    {daily.length > (view === 'month' ? 3 : 30) &&
                      <button type="button" className="uc-more"
                        onClick={e => { e.stopPropagation(); selectDay(date, true) }}>
                        +{daily.length - (view === 'month' ? 3 : 30)} more
                      </button>}
                    {view !== 'month' && daily.length === 0 &&
                      <p className="uc-empty">No appointments. Select + to add one.</p>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <aside className="uc-aside" aria-label="Calendar agenda and deadlines">
          <div className="uc-card">
            <div className="uc-eyebrow">Selected date</div>
            <h3>{selected.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
            <div className="uc-card-date">{selectedEvents.length} appointments scheduled</div>
            <div className="uc-card-actions" aria-label="Day actions">
              {button('+ New event', () => create(), 'uc-btn-primary')}
              {button('Booking link', onBooking, 'uc-btn-blue')}
              {button('View day', () => setView('day'))}
              {button('View week', () => setView('week'))}
            </div>
            {selectedEvents.length
              ? selectedEvents.map((event, i) => eventRow(event, (event.id || 'selected') + i))
              : <p className="uc-empty">Nothing planned yet. Use New event to schedule this day.</p>}
          </div>
          <div className="uc-card">
            <button type="button" className="uc-collapse" aria-expanded={upcomingOpen}
              onClick={() => setUpcomingOpen(value => !value)}>
              <span>Upcoming appointments</span><span>{upcomingOpen ? '▾' : '▸'}</span>
            </button>
            {upcomingOpen && (upcoming.length
              ? upcoming.map((event, i) => eventRow(event, (event.id || 'upcoming') + i))
              : <p className="uc-empty">No upcoming appointments.</p>)}
          </div>
          <div className="uc-card">
            <button type="button" className="uc-collapse" aria-expanded={deadlinesOpen}
              onClick={() => setDeadlinesOpen(value => !value)}>
              <span>Deadlines ({deadlines.length})</span><span>{deadlinesOpen ? '▾' : '▸'}</span>
            </button>
            {deadlinesOpen && (deadlines.length
              ? deadlines.slice().sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
                .slice(0, 12).map((item, i) => <div key={item.id || i} className="uc-aside-event"
                  style={{ cursor: 'default', borderLeft: '3px solid #eeb04c' }}>
                  <strong>{item.title || 'Deadline'}</strong>
                  <div style={{ color: 'var(--uc-muted)', marginTop: 4 }}>
                    {item.dueDate || 'No date'} · {item.clientName || ''}
                  </div>
                </div>)
              : <p className="uc-empty">No active deadlines.</p>)}
          </div>
        </aside>
      </div>
      <div className="uc-footer">
        <span className="uc-connection">● CRM appointments connected</span>
        <span>·</span>
        <span>Classic booking, event editing and reminder workflows remain active.</span>
        <span>·</span>
        <span>Stalwart synchronization pending verification.</span>
      </div>
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const pad = n => String(n).padStart(2, '0')
const ymd = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
const firstOf = date => new Date(date.getFullYear(), date.getMonth(), 1)
const shiftMonth = (date, delta) => new Date(date.getFullYear(), date.getMonth() + delta, 1)
const durationMinutes = iso => {
  const m = String(iso || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?/)
  return m ? (Number(m[1] || 0) * 60 + Number(m[2] || 0)) || 60 : 60
}
const eventDate = event => String(event?.start || '').slice(0, 10)
const eventTime = event => String(event?.start || '').slice(11, 16)
const newForm = date => ({
  title: '', date: ymd(date || new Date()), time: '09:00',
  durationMinutes: 60, calendarId: '',
})
const input = {
  display: 'block', width: '100%', minHeight: 38, border: '1px solid var(--br)',
  borderRadius: 8, background: 'var(--sf)', color: 'var(--tx)',
  padding: '8px 10px', font: 'inherit', boxSizing: 'border-box',
}
const button = {
  border: '1px solid var(--br)', background: 'var(--sf)',
  color: 'var(--tx)', fontWeight: 650, borderRadius: 8,
  cursor: 'pointer', padding: '8px 12px', fontSize: 12,
}
function displayDate(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function dayCells(month) {
  const first = firstOf(month)
  const offset = first.getDay()
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const size = Math.ceil((offset + length) / 7) * 7
  return Array.from({ length: size }, (_, i) => {
    const date = new Date(month.getFullYear(), month.getMonth(), 1 - offset + i)
    return date
  })
}

/**
 * Dedicated Stalwart JMAP calendar workspace; CRM calendar is preserved
 * independently until booking/lead/notification parity is certified.
 */
export default function StalwartCalendarWorkspace({ onBack }) {
  const [month, setMonth] = useState(firstOf(new Date()))
  const [view, setView] = useState('month')
  const [activeDay, setActiveDay] = useState(ymd(new Date()))
  const [calendars, setCalendars] = useState([])
  const [events, setEvents] = useState([])
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(null)
  const [editId, setEditId] = useState(null)

  async function request(body) {
    const { data, error: functionError } = await supabase.functions.invoke('romylabs-calendar-jmap', { body })
    if (functionError) throw new Error(functionError.message || 'Stalwart calendar service unavailable')
    if (!data?.ok) throw new Error(data?.error || 'Stalwart calendar request failed')
    return data
  }

  async function load(targetMonth = month) {
    setLoading(true); setError('')
    try {
      const begin = shiftMonth(targetMonth, -1)
      const end = shiftMonth(targetMonth, 2)
      const [discovery, result] = await Promise.all([
        request({ action: 'discover' }),
        request({ action: 'events', start: ymd(begin), end: ymd(end) }),
      ])
      setCalendars(discovery.calendars || [])
      setEvents(result.events || [])
      setState(result.state || '')
    } catch (cause) {
      setError(cause?.message || 'Unable to load Stalwart calendar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(month) }, [month.getFullYear(), month.getMonth()])
  const grouped = useMemo(() => {
    const days = new Map()
    for (const ev of events) {
      const date = eventDate(ev)
      if (!days.has(date)) days.set(date, [])
      days.get(date).push(ev)
    }
    for (const entries of days.values()) entries.sort((a, b) => eventTime(a).localeCompare(eventTime(b)))
    return days
  }, [events])
  const calendarName = ids => calendars.filter(c => ids?.[c.id]).map(c => c.name).join(', ') || 'Stalwart'
  const colorOf = ev => {
    const selected = calendars.find(c => ev.calendarIds?.[c.id])
    return selected?.color && /^#[0-9a-f]{6}$/i.test(selected.color) ? selected.color : '#3b82f6'
  }

  function openNew(date) {
    setEditId(null)
    setForm({ ...newForm(date), calendarId: calendars.find(c => c.isDefault)?.id || calendars[0]?.id || '' })
  }
  function openEdit(ev) {
    if (ev.recurrenceRules?.length) {
      setError('Recurring series are read-only until safe occurrence editing is certified.')
      return
    }
    setError('')
    setEditId(ev.id)
    setForm({
      title: ev.title, date: eventDate(ev), time: eventTime(ev) || '09:00',
      durationMinutes: durationMinutes(ev.duration),
      calendarId: Object.keys(ev.calendarIds || {})[0] || '',
    })
  }
  async function save(event) {
    event.preventDefault()
    if (!form?.title?.trim() || !form.date || !form.time) return
    if (!form.calendarId) { setError('Choose a calendar.'); return }
    setSaving(true); setError('')
    try {
      await request({
        action: editId ? 'update' : 'create',
        ...(editId ? { id: editId, ifInState: state } : { calendarId: form.calendarId }),
        title: form.title, start: form.date + 'T' + form.time + ':00',
        durationMinutes: Number(form.durationMinutes),
      })
      setNotice(editId ? 'Stalwart event updated' : 'Stalwart event created')
      setForm(null); setEditId(null)
      await load(month)
    } catch (cause) {
      setError(cause?.message || 'Could not save Stalwart event')
    } finally { setSaving(false) }
  }
  async function remove(ev) {
    if (ev.recurrenceRules?.length) {
      setError('Deleting recurring series is disabled until series editing is certified.')
      return
    }
    if (!window.confirm('Delete this event from Stalwart Calendar? This cannot be undone.')) return
    setSaving(true); setError('')
    try {
      await request({ action: 'delete', id: ev.id, ifInState: state, confirmDelete: true })
      setNotice('Stalwart event deleted')
      await load(month)
    } catch (cause) { setError(cause?.message || 'Delete failed') }
    finally { setSaving(false) }
  }

  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const monthDays = dayCells(month)
  const selectedDate = new Date(activeDay + 'T12:00:00')
  const visibleDays = view === 'month' ? monthDays :
    view === 'day' ? [selectedDate] :
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(selectedDate)
      d.setDate(selectedDate.getDate() - selectedDate.getDay() + i)
      return d
    })

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--tx)', minHeight: '100%', padding: 16, overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div>
          <button type="button" onClick={onBack} style={button}>← CRM Calendar</button>
          <h2 style={{ margin: '12px 0 2px', fontSize: 23 }}>Stalwart Calendar</h2>
          <p style={{ margin: 0, color: 'var(--t3)', fontSize: 12 }}>
            Private JMAP connection · CRM appointments and automated booking workflows stay unchanged
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" style={button} onClick={() => { setMonth(firstOf(new Date())); setActiveDay(ymd(new Date())) }}>Today</button>
          <button type="button" style={button} onClick={() => setMonth(d => shiftMonth(d, -1))}>‹</button>
          <span style={{ padding: '8px 6px', minWidth: 130, textAlign: 'center', fontWeight: 750, fontSize: 13 }}>{displayDate(month)}</span>
          <button type="button" style={button} onClick={() => setMonth(d => shiftMonth(d, 1))}>›</button>
          {['month', 'week', 'day'].map(option => (
            <button type="button" key={option} style={{
              ...button, background: view === option ? '#166534' : 'var(--sf)',
              color: view === option ? '#fff' : 'var(--tx)',
            }} onClick={() => setView(option)}>
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
          <button type="button" disabled={loading} style={button} onClick={() => load(month)}>Refresh</button>
          <button type="button" disabled={!calendars.length} style={{ ...button, background: '#16a34a', color: '#fff' }} onClick={() => openNew(selectedDate)}>+ Event</button>
        </div>
      </div>
      {error && <p role="alert" style={{ color: '#fca5a5', border: '1px solid #ef4444', borderRadius: 8, padding: 10 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#4ade80' }}>{notice}</p>}
      {loading && <p style={{ color: 'var(--t3)' }}>Synchronizing Stalwart calendar…</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {calendars.map(cal => (
          <div key={cal.id} style={{ fontSize: 12, color: 'var(--t2)', border: '1px solid var(--br)', borderRadius: 20, padding: '5px 10px' }}>
            <span style={{ color: cal.color || '#3b82f6' }}>● </span>{cal.name}{cal.isDefault ? ' · Default' : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 2, marginBottom: 3 }}>
        {(view === 'month' ? weekday : visibleDays.map(d => weekday[d.getDay()])).map((label, i) => (
          <div key={i} style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 11, fontWeight: 750, padding: 6 }}>{label}</div>
        ))}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 2,
      }}>
        {visibleDays.map((day, i) => {
          const date = ymd(day)
          const isCurrent = day.getMonth() === month.getMonth()
          const isSelected = activeDay === date
          const entries = grouped.get(date) || []
          return (
            <div key={date + '-' + i} onClick={() => { setActiveDay(date); if (view !== 'month') setView('day') }}
              style={{ minHeight: view === 'month' ? 100 : 170,
                border: '1px solid ' + (isSelected ? '#16a34a' : 'var(--br)'),
                background: 'var(--sf)', borderRadius: 7, padding: 7,
                opacity: isCurrent || view !== 'month' ? 1 : .55,
                gridColumn: view === 'day' ? 'span 7' : undefined, cursor: 'pointer' }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
                {day.getDate()} {view === 'day' ? day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''}
              </div>
              {entries.slice(0, view === 'month' ? 3 : 12).map(ev => (
                <div key={ev.id} style={{ borderLeft: '3px solid ' + colorOf(ev),
                  borderRadius: 4, background: 'var(--nav)', marginBottom: 3, padding: '3px 5px' }}>
                  <button type="button" onClick={e => { e.stopPropagation(); openEdit(ev) }}
                    style={{ border: 0, background: 'transparent', color: 'var(--tx)',
                      cursor: 'pointer', textAlign: 'left', width: '100%', fontSize: 11 }}>
                    <strong>{eventTime(ev)}</strong> {ev.title}
                  </button>
                  {view !== 'month' && <div style={{ fontSize: 10, color: 'var(--t3)' }}>{calendarName(ev.calendarIds)}</div>}
                  {view !== 'month' && (
                    <button type="button" onClick={e => { e.stopPropagation(); remove(ev) }}
                      disabled={saving} style={{ ...button, padding: '2px 5px', fontSize: 10 }}>Delete</button>
                  )}
                </div>
              ))}
              {entries.length > (view === 'month' ? 3 : 12) && <div style={{ fontSize: 11, color: 'var(--t3)' }}>+{entries.length - (view === 'month' ? 3 : 12)} more</div>}
              {view !== 'month' && <button type="button" style={{ ...button, marginTop: 8 }} onClick={e => { e.stopPropagation(); openNew(day) }}>+ Add</button>}
            </div>
          )
        })}
      </div>
      {form && (
        <div role="dialog" aria-modal="true" aria-label={editId ? 'Edit Stalwart event' : 'Create Stalwart event'}
          style={{ position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(0,0,0,.78)', display: 'grid', placeItems: 'center', padding: 14 }}>
          <form onSubmit={save} style={{ width: '100%', maxWidth: 460,
            border: '1px solid var(--br)', background: 'var(--bg)',
            borderRadius: 14, padding: 22, display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>{editId ? 'Edit Stalwart event' : 'New Stalwart event'}</h3>
            <label style={{ fontSize: 12 }}>Title<input style={input} required value={form.title} maxLength={240}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}/></label>
            <label style={{ fontSize: 12 }}>Date<input style={input} type="date" required value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}/></label>
            <label style={{ fontSize: 12 }}>Start time<input style={input} type="time" required value={form.time}
              onChange={e => setForm(f => ({ ...f, time: e.target.value }))}/></label>
            <label style={{ fontSize: 12 }}>Duration (minutes)<input style={input} type="number" min="5" max="1440"
              required value={form.durationMinutes} onChange={e => setForm(f => ({ ...f, durationMinutes: Number(e.target.value) }))}/></label>
            <label style={{ fontSize: 12 }}>Calendar<select style={input} value={form.calendarId} disabled={!!editId}
              onChange={e => setForm(f => ({ ...f, calendarId: e.target.value }))}>
              {calendars.map(cal => <option key={cal.id} value={cal.id}>{cal.name}</option>)}
            </select></label>
            <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>
              Times are America/New_York. Existing CRM bookings stay in the CRM calendar until integration certification.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={button} disabled={saving} onClick={() => { setForm(null); setEditId(null) }}>Cancel</button>
              <button type="submit" style={{ ...button, background: '#16a34a', color: '#fff' }} disabled={saving}>
                {saving ? 'Saving…' : editId ? 'Save changes' : 'Create event'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

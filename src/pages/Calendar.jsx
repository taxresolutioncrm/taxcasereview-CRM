import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { advanceLeadStatus } from '../lib/leadStatus'
import { FIRM } from '../lib/firmBranding'
import { sendGmailEmail } from '../lib/gmailUtils'
import InternalBooking from '../components/InternalBooking'

const STATUS_COLORS = {
  scheduled:   { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  in_progress: { bg: '#1a3a2a', border: '#16a34a', text: '#4ade80' },
  completed:   { bg: 'var(--s2)', border: 'var(--t3)', text: 'var(--t2)' },
  cancelled:   { bg: '#3b1a1a', border: '#ef4444', text: '#fca5a5' },
  reminder:    { bg: '#2a1f3d', border: '#7c3aed', text: '#c4b5fd' },
  draft:       { bg: 'var(--s2)', border: 'var(--t3)', text: 'var(--t2)' },
  Pending:     { bg: '#2a1f10', border: '#f59e0b', text: '#fcd34d' },
}

// Map calevents color keys to status colors
const COLOR_MAP = {
  bb: 'scheduled', bg: 'completed', ba: 'reminder', br: 'cancelled', bv: 'reminder', bw: 'draft'
}

const DAYS  = ['SUN','MON','TUE','WED','THU','FRI','SAT']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PRODUCT_IDENTITIES = {
  taxres_crm: { label: 'TaxRes CRM', logo: '/taxrescrm-favicon.png' },
  romylabs:   { label: 'RomyLabs',   logo: '/romylabs-favicon-32.png' },
  camvella:   { label: 'Camvella',   logo: '/camvella-logo.svg' },
  arcvena:    { label: 'Arcvena',    logo: '/arcvena-favicon-64.png' },
  bocasync:   { label: 'BocaSync',   logo: '/bocasync-logo.svg' },
}

function productIdentity(ev) {
  if (ev?.product_id && PRODUCT_IDENTITIES[ev.product_id]) return PRODUCT_IDENTITIES[ev.product_id]
  const label = (ev?.title || '').match(/^\[([^\]]+)\]/)?.[1]
  return Object.values(PRODUCT_IDENTITIES).find(product => product.label === label) || null
}

function fmtTime(d) {
  if (!d) return ''
  // Handle HH:MM format
  if (d.includes('T') || d.includes('-')) {
    return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  // Handle plain time string like "09:00"
  const [h, m] = d.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
}

function scOf(ev) {
  // Use status if present, else map from color key
  const statusKey = ev.status || COLOR_MAP[ev.color] || 'scheduled'
  return STATUS_COLORS[statusKey] || STATUS_COLORS.scheduled
}

export default function Calendar() {
  const { user } = useApp()
  const isRomyLabsAdmin = window.location.hostname.toLowerCase() === 'admin.romylabs.com'
  const adminCalendarOwner = 'Romy Cruz'
  const [events,        setEvents]        = useState([])
  const [clients,       setClients]       = useState([])
  const [employees,     setEmployees]     = useState([])
  const [deadlines,     setDeadlines]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [currentDate,   setCurrentDate]   = useState(new Date())
  const [view,          setView]          = useState('month')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showForm,      setShowForm]      = useState(false)
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') setShowForm(true) }, [searchParams])
  const [dayMenuPos,    setDayMenuPos]    = useState(null)
  const [dayMenuDate,   setDayMenuDate]   = useState(null)
  const [showUnscheduled, setShowUnscheduled] = useState(true)
  const [toast,         setToast]         = useState('')
  const [saving,        setSaving]        = useState(false)
  const [confirmDel,    setConfirmDel]    = useState(null)

  const [form, setForm] = useState({
    title: '', clientName: '', client_id: '', assignedTo: isRomyLabsAdmin ? adminCalendarOwner : '', date: '', time: '',
    endTime: '', eventType: 'Consultation Call', color: 'bb',
    notes: '', recurring: 'none', status: 'scheduled'
  })

  // Escape .page-content padding
  useEffect(() => {
    const el = document.querySelector('.page-content')
    if (!el) return
    const op = el.style.padding, oo = el.style.overflow, oh = el.style.height
    el.style.padding = '0'; el.style.overflow = 'hidden'; el.style.height = '100%'
    return () => { el.style.padding = op; el.style.overflow = oo; el.style.height = oh }
  }, [])

  useEffect(() => { load() }, [])

  // Realtime sync: when a new appointment is booked via the external Tax Case Review
  // booking widget (cfoservicesnow), it gets inserted into calevents with source='booking_widget'.
  // Pick it up live, show a toast + browser notification, and post to team chat.
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    const ch = supabase.channel('calevents-booking-sync')
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calevents' }, ({ new: row }) => {
      setEvents(prev => prev.some(e => e.id === row.id) ? prev : [...prev, row])
      if (row.source === 'booking_widget' || row.source === 'online') {
        const who = row.clientName || row.title || 'New appointment'
        showToast(`📅 New appointment booked: ${who} — ${row.date} ${row.time || ''}`)
        if ('Notification' in window && Notification.permission === 'granted') {
          const cn = new Notification('📅 New Appointment Booked', {
            body: `${who} — ${row.date} ${fmtTime(row.time||'')}`,
            icon: FIRM.logoUrl || '/icon-192.png',
            requireInteraction: false
          })
          cn.onclick = () => { window.focus(); cn.close() }
        }
        supabase.from('chat_messages').insert([{
          channel: 'general', sender: '🔔 System',
          text: `📅 New appointment booked online: **${who}** on ${row.date}${row.time?` at ${fmtTime(row.time)}`:''}${row.eventType?` (${row.eventType})`:''}.`,
          created_at: new Date().toISOString()
        }]).then(()=>{})
      }
    })
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  async function load() {
    setLoading(true)
    const [{ data: ev }, { data: cl }, { data: em }, { data: dl }] = await Promise.all([
      supabase.from('calevents').select('*').order('date', { ascending: true }),
      supabase.from('clients').select('id,name,email,address'),
      isRomyLabsAdmin
        ? Promise.resolve({ data:[{ id:'romy-admin-calendar-owner', name:adminCalendarOwner }] })
        : supabase.from('employees').select('id,name').order('name'),
      supabase.from('deadlines').select('id,title,dueDate,clientName,client_id,status').neq('status', 'Completed'),
    ])
    setEvents(ev || [])
    setClients(cl || [])
    setEmployees(em || [])
    setDeadlines(dl || [])
    setLoading(false)
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Free video meeting link, one per appointment -- same browser-to-
  // browser WebRTC room the team Huddle uses, just a public unauthenticated
  // entry point. No Google/Zoom account or paid service involved; the
  // link itself (tied to this event's id) is the only access control,
  // same pattern as the e-sign and client portal links.
  function meetingLinkFor(ev) {
    // window.location.origin alone is missing the GitHub Pages project
    // path (this app deploys under /, not the bare
    // domain root) -- import.meta.env.BASE_URL is Vite's own resolved
    // base path, so this stays correct even if that ever changes.
    // Carry the sender tenant's uuid so the join page shows the firm's
    // logo/name instead of the primary tenant's (TCR). Absent → legacy
    // first-row branding, same as before this change.
    const base = `${window.location.origin}${import.meta.env.BASE_URL}meet/${ev.id}`
    return FIRM.tenantId ? `${base}?t=${FIRM.tenantId}` : base
  }

  async function copyMeetingLink(ev) {
    try {
      await navigator.clipboard.writeText(meetingLinkFor(ev))
      showToast('Meeting link copied!')
    } catch {
      showToast('Could not copy — copy it manually: ' + meetingLinkFor(ev))
    }
  }

  async function emailMeetingLink(ev) {
    if (!ev.clientName) { showToast('No client on this appointment to email'); return }
    let c = null
    if (ev.client_id) {
      const { data } = await supabase.from('clients').select('email').eq('id', ev.client_id).maybeSingle()
      c = data
    }
    if (!c) {
      const { data } = await supabase.from('clients').select('email').eq('name', ev.clientName).limit(1)
      c = data?.[0] || null
    }
    const { data: leadRows } = c ? { data: [] } : await supabase.from('leads').select('email').eq('name', ev.clientName).limit(1)
    const email = c?.email || leadRows?.[0]?.email
    if (!email) { showToast('No email on file for ' + ev.clientName); return }

    const when = ev.date ? new Date(ev.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
    const link = meetingLinkFor(ev)
    try {
      await sendGmailEmail(supabase, {
        to: email,
        subject: `Video meeting link — ${when}${ev.time ? ' at ' + fmtTime(ev.time) : ''}`,
        body: `Hi ${ev.clientName.split(' ')[0]},\n\nHere's the link for your upcoming video meeting${when ? ' on ' + when : ''}${ev.time ? ' at ' + fmtTime(ev.time) : ''}:\n\n${link}\n\nNo download or account needed — just click the link a few minutes before your appointment, allow camera/microphone access, and you're in.`,
      })
      showToast('✅ Meeting link emailed to ' + ev.clientName)
    } catch (err) {
      showToast('Email failed: ' + (err?.message || 'unknown error'))
    }
  }

  async function saveEvent() {
    if (!form.title || !form.date) { showToast('Title and date required'); return }
    setSaving(true)
    let payload = { ...form, assignedTo: isRomyLabsAdmin ? adminCalendarOwner : form.assignedTo, updated_at: new Date().toISOString() }
    let error
    // Retry loop: strip unknown columns if PostgREST rejects them (same pattern as Clients.jsx)
    for (let attempt = 0; attempt < 12; attempt++) {
      if (form.id) {
        ;({ error } = await supabase.from('calevents').update(payload).eq('id', form.id))
      } else {
        const p = { ...payload, created_at: new Date().toISOString() }
        delete p.id
        ;({ error } = await supabase.from('calevents').insert([p]))
      }
      if (!error) break
      const match = error.message?.match(/column ['""]?(\w+)['""]? (of relation .* )?does not exist/i)
        || error.message?.match(/Could not find the '(\w+)' column/i)
      if (match && match[1] in payload) {
        const { [match[1]]: _, ...rest } = payload
        payload = rest
        continue
      }
      break
    }
    setSaving(false)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('✅ Event saved!')
    const actorCal = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    if (!form.id) await triggerWorkflow('lead_appointment_set', form.clientName ? 'client' : 'lead', form.clientName || '', actorCal).catch(()=>{})
    if (form.status === 'completed') await triggerWorkflow('lead_appointment_completed', 'client', form.clientName || '', actorCal).catch(()=>{})

    // Log appointment to lead/client notes
    if (form.clientName) {
      const fmtTime = form.time ? new Date(`2000-01-01T${form.time}`).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}) : ''
      const noteText = `📅 Appointment ${form.id ? 'updated' : 'scheduled'}: ${form.title || form.eventType} on ${form.date}${fmtTime ? ' at ' + fmtTime : ''} — by ${actorCal}${form.notes ? '\nNotes: ' + form.notes : ''}`
      const { data: leadRows } = await supabase.from('leads').select('id').eq('name', form.clientName).limit(1).catch(()=>({data:[]}))
      const leadRow = leadRows?.[0] || null
      if (leadRow?.id) {
        await supabase.from('lead_notes').insert({ lead_id: leadRow.id, lead_name: form.clientName, text: noteText, type: 'System', author: actorCal, created_at: new Date().toISOString() }).catch(()=>{})
      } else {
        await supabase.from('client_notes').insert({ clientname: form.clientName, text: noteText, author: actorCal, visible_to_client: false }).catch(()=>{})
      }
    }
    setShowForm(false); setForm({ title:'',clientName:'',client_id:'',assignedTo:isRomyLabsAdmin ? adminCalendarOwner : '',date:'',time:'',endTime:'',eventType:'Consultation Call',color:'bb',notes:'',recurring:'none',status:'scheduled' })
    load()
  }

  async function deleteEvent(id) {
    const { error } = await supabase.from('calevents').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setEvents(prev => prev.filter(e => e.id !== id)); setSelectedEvent(null); setConfirmDel(null); showToast('Deleted')
  }

  async function quickStatus(ev, status) {
    await supabase.from('calevents').update({ status, updated_at: new Date().toISOString() }).eq('id', ev.id)
    setSelectedEvent({ ...ev, status }); load()
    // Marking an appointment complete is how a lead's consultation actually
    // wraps up — forward-only, so this no-ops for client appointments
    // (no matching lead row) or leads already past this stage.
    if (status === 'completed' && ev.clientName) {
      await advanceLeadStatus(supabase, ev.clientName, 'Consultation Completed')
    }
  }

  const [showBooking, setShowBooking] = useState(false)
  const goToday = () => setCurrentDate(new Date())
  const goPrev  = () => {
    const d = new Date(currentDate)
    view === 'month' ? d.setMonth(d.getMonth()-1) : view === 'week' ? d.setDate(d.getDate()-7) : d.setDate(d.getDate()-1)
    setCurrentDate(d)
  }
  const goNext  = () => {
    const d = new Date(currentDate)
    view === 'month' ? d.setMonth(d.getMonth()+1) : view === 'week' ? d.setDate(d.getDate()+7) : d.setDate(d.getDate()+1)
    setCurrentDate(d)
  }

  const getMonthDays = () => {
    const y = currentDate.getFullYear(), m = currentDate.getMonth()
    const first = new Date(y, m, 1), last = new Date(y, m+1, 0)
    const days = []
    for (let i = 0; i < first.getDay(); i++) days.push(null)
    for (let d = 1; d <= last.getDate(); d++) days.push(new Date(y, m, d))
    while (days.length % 7 !== 0) days.push(null)
    return days
  }

  const getWeekDays = () => {
    const d = new Date(currentDate); d.setDate(d.getDate() - d.getDay())
    return Array.from({ length: 7 }, (_, i) => { const dd = new Date(d); dd.setDate(d.getDate()+i); return dd })
  }

  function eventsForDay(date) {
    const ds = date.toDateString()
    const cal = events.filter(e => e.date && new Date(e.date + 'T12:00').toDateString() === ds)
    const dls = deadlines.filter(d => d.dueDate && new Date(d.dueDate + 'T12:00').toDateString() === ds)
      .map(d => ({ ...d, title: d.title, clientName: d.clientName, color: 'br', status: 'cancelled', _isDl: true }))
    return [...cal, ...dls].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  }

  const isToday = date => date.toDateString() === new Date().toDateString()

  const viewTitle = () => {
    if (view === 'month') return `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    if (view === 'week') {
      const days = getWeekDays()
      return `${MONTHS[days[0].getMonth()]} ${days[0].getDate()} – ${days[6].getDate()}, ${days[6].getFullYear()}`
    }
    return currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  function openDayMenu(date, e) {
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 260)
    const y = Math.min(e.clientY, window.innerHeight - 320)
    setDayMenuDate(date); setDayMenuPos({ x, y })
  }

  function openNewForm(date, hour) {
    const d = new Date(date); d.setHours(hour ?? 9, 0, 0, 0)
    setForm(f => ({
      ...f,
      title: '', date: date.toISOString().slice(0, 10),
      time: `${String(d.getHours()).padStart(2,'0')}:00`,
      assignedTo: isRomyLabsAdmin ? adminCalendarOwner : '',
      id: undefined
    }))
    setShowForm(true); setDayMenuPos(null); setDayMenuDate(null)
  }

  function openEditForm(ev) {
    setForm({ ...ev, assignedTo: isRomyLabsAdmin ? adminCalendarOwner : (ev.assignedTo || '') })
    setShowForm(true); setSelectedEvent(null)
  }

  const inp = { width: '100%', padding: '9px 11px', border: '1px solid var(--br)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--sf)', color: 'var(--tx)', boxSizing: 'border-box' }
  const lbl = { fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'block' }

  const EventPill = ({ ev, onClick }) => {
    const sc = scOf(ev)
    const identity = productIdentity(ev)
    return (
      <div onClick={e => { e.stopPropagation(); onClick() }} data-cal-event
        style={{ background: sc.bg, borderLeft: `3px solid ${sc.border}`, borderRadius: 4, padding: '3px 6px', marginBottom: 2, cursor: 'pointer', overflow: 'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:4, minWidth:0 }}>
          {identity?.logo && <img src={identity.logo} alt="" aria-hidden="true" style={{ width:13, height:13, objectFit:'contain', borderRadius:3, flexShrink:0 }} />}
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: sc.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.time && <span style={{ opacity: .7 }}>{fmtTime(ev.time)} </span>}
            {identity ? `${identity.label} · ` : ''}{ev._isDl ? '⏰ ' : ''}{ev.clientName || ev.title}
          </p>
        </div>
      </div>
    )
  }

  // ── EVENT DETAIL PANEL ──
  if (selectedEvent) {
    const sc = scOf(selectedEvent)
    const identity = productIdentity(selectedEvent)
    return (
      <div style={{ padding: '1.5rem', background: 'var(--bg)', minHeight: '100%' }}>
        {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#16a34a', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 999 }}>{toast}</div>}
        <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16 }}>← Back to Calendar</button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: 'capitalize', marginBottom: 8, display: 'inline-block' }}>
              {(selectedEvent.status || 'scheduled').replace('_', ' ')}
            </span>
            {identity && (
              <div style={{ display:'flex', alignItems:'center', gap:6, margin:'6px 0' }}>
                <img src={identity.logo} alt="" aria-hidden="true" style={{ width:20, height:20, objectFit:'contain', borderRadius:4 }} />
                <span style={{ fontSize:11, fontWeight:800, color:'var(--t2)', textTransform:'uppercase', letterSpacing:'.05em' }}>{identity.label}</span>
              </div>
            )}
            <h1 style={{ margin: '6px 0 4px', fontSize: 22, fontWeight: 800, color: 'var(--tx)' }}>{selectedEvent.title}</h1>
            {selectedEvent.clientName && <p style={{ margin: 0, fontSize: 14, color: 'var(--t3)' }}>{selectedEvent.clientName}</p>}
          </div>
          {!selectedEvent._isDl && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => openEditForm(selectedEvent)} style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✏️ Edit</button>
              <button onClick={() => setConfirmDel(selectedEvent.id)} style={{ padding: '8px 16px', background: '#3b1a1a', color: '#fca5a5', border: '1px solid #ef4444', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🗑 Delete</button>
            </div>
          )}
        </div>

        {/* ── Pending ICS invite banner ── */}
        {selectedEvent.source === 'ics_auto' && selectedEvent.eventType === 'Pending' && (
          <div style={{ background: '#2a1f10', border: '1px solid #f59e0b', borderRadius: 12, padding: '16px 20px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#fcd34d' }}>📩 Calendar Invite — Pending Your Response</p>
              {selectedEvent.contact_email && <p style={{ margin: 0, fontSize: 12, color: '#92400e' }}>From: {selectedEvent.contact_email}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={async () => {
                await supabase.from('calevents').update({ eventType: 'Meeting', status: 'scheduled' }).eq('id', selectedEvent.id)
                setSelectedEvent(ev => ({ ...ev, eventType: 'Meeting', status: 'scheduled' }))
                setEvents(evs => evs.map(e => e.id === selectedEvent.id ? { ...e, eventType: 'Meeting', status: 'scheduled' } : e))
                showToast('✅ Invite accepted')
              }} style={{ padding: '8px 18px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>✅ Accept</button>
              <button onClick={async () => {
                await supabase.from('calevents').delete().eq('id', selectedEvent.id)
                setEvents(evs => evs.filter(e => e.id !== selectedEvent.id))
                setSelectedEvent(null)
                showToast('❌ Invite declined and removed')
              }} style={{ padding: '8px 18px', background: '#3b1a1a', color: '#fca5a5', border: '1px solid #ef4444', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>❌ Decline</button>
            </div>
          </div>
        )}

        {!selectedEvent._isDl && (
          <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Video Meeting</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code style={{ flex: 1, minWidth: 200, fontSize: 12, color: '#93c5fd', background: 'var(--bg)', padding: '8px 10px', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meetingLinkFor(selectedEvent)}
              </code>
              <button onClick={() => copyMeetingLink(selectedEvent)} style={{ padding: '7px 12px', borderRadius: 6, background: 'var(--s2)', border: '1px solid var(--br)', color: 'var(--tx)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
              <button onClick={() => window.open(meetingLinkFor(selectedEvent), '_blank')} style={{ padding: '7px 12px', borderRadius: 6, background: 'var(--s2)', border: '1px solid var(--br)', color: 'var(--tx)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Join Now</button>
              {selectedEvent.clientName && (
                <button onClick={() => emailMeetingLink(selectedEvent)} style={{ padding: '7px 12px', borderRadius: 6, background: '#16a34a', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📧 Email to {selectedEvent.clientName.split(' ')[0]}</button>
              )}
            </div>
          </div>
        )}

        {!selectedEvent._isDl && (
          <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Quick Status</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['scheduled','in_progress','completed','cancelled'].map(s => (
                <button key={s} onClick={() => quickStatus(selectedEvent, s)} style={{
                  padding: '6px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                  background: (selectedEvent.status||'scheduled') === s ? STATUS_COLORS[s].bg : 'transparent',
                  color: (selectedEvent.status||'scheduled') === s ? STATUS_COLORS[s].text : 'var(--t3)',
                  border: (selectedEvent.status||'scheduled') === s ? `1px solid ${STATUS_COLORS[s].border}` : '1px solid var(--br)',
                }}>{s.replace('_', ' ')}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 12, padding: '14px 16px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--tx)' }}>Details</h3>
          {[
            ['Date', selectedEvent.date ? new Date(selectedEvent.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '—'],
            ['Time', selectedEvent.time ? fmtTime(selectedEvent.time) + (selectedEvent.endTime ? ' – ' + fmtTime(selectedEvent.endTime) : '') : '—'],
            ['Type', selectedEvent.eventType || '—'],
            ['Assigned To', selectedEvent.assignedTo || 'Unassigned'],
            ['Recurring', selectedEvent.recurring || 'None'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--br)' }}>
              <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 13, color: 'var(--tx)' }}>{value}</span>
            </div>
          ))}
          {selectedEvent.notes && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--t3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--t2)', lineHeight: 1.6 }}>{selectedEvent.notes}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', position: 'absolute', inset: 0, background: 'var(--bg)', overflow: 'hidden' }}>
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#16a34a', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 999, boxShadow: '0 4px 20px rgba(0,0,0,.4)' }}>{toast}</div>}

      {/* ── MAIN CALENDAR AREA ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ background: 'var(--nav)', borderBottom: '1px solid var(--br)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={goToday} style={{ padding: '7px 16px', background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, color: 'var(--tx)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Today</button>
            <button onClick={() => setShowBooking(true)} style={{ padding: '7px 16px', background: '#1d4ed8', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📅 Send Booking Link</button>
            <div style={{ display: 'flex', gap: 2 }}>
              <button onClick={goPrev} style={{ width: 32, height: 32, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
              <button onClick={goNext} style={{ width: 32, height: 32, background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx)' }}>{viewTitle()}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, overflow: 'hidden' }}>
              {['month','week','day'].map((v, i) => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: '7px 16px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
                  background: view === v ? '#16a34a' : 'transparent',
                  color: view === v ? '#fff' : 'var(--t3)',
                  borderRight: i < 2 ? '1px solid var(--br)' : 'none',
                }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
              ))}
            </div>
            <button onClick={() => { setForm(f => ({...f, date: new Date().toISOString().slice(0,10), assignedTo: isRomyLabsAdmin ? adminCalendarOwner : '', id: undefined})); setShowForm(true) }} style={{ padding: '8px 18px', background: '#16a34a', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              + Add Event
            </button>
            <button onClick={() => setShowUnscheduled(s => !s)} style={{ padding: '7px 12px', background: showUnscheduled ? 'rgba(74,222,128,.15)' : 'var(--sf)', border: '1px solid var(--br)', borderRadius: 8, color: showUnscheduled ? '#4ade80' : 'var(--t3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Upcoming {deadlines.filter(d => { const dl = Math.ceil((new Date(d.dueDate)-new Date())/86400000); return dl <= 7 && dl >= 0 }).length > 0 &&
                <span style={{ background: '#fbbf24', color: '#000', borderRadius: 99, padding: '0 6px', fontSize: 10, fontWeight: 800, marginLeft: 4 }}>
                  {deadlines.filter(d => { const dl = Math.ceil((new Date(d.dueDate)-new Date())/86400000); return dl <= 7 && dl >= 0 }).length}
                </span>}
            </button>
          </div>
        </div>

        {/* Calendar body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>Loading…</div>
          ) : view === 'month' ? (
            <div className="cal-grid-scroll" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', minWidth: 700, background: 'var(--nav)', borderBottom: '1px solid var(--br)', flexShrink: 0 }}>
                {DAYS.map((d, i) => (
                  <div key={d} style={{ padding: '10px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: i===0||i===6 ? '#ef4444' : 'var(--t3)', letterSpacing: '.06em' }}>{d}</div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', minWidth: 700, gridAutoRows: 'minmax(110px,1fr)', flex: 1 }}>
                {getMonthDays().map((date, i) => {
                  const dayEvs = date ? eventsForDay(date) : []
                  const today = date && isToday(date)
                  return (
                    <div key={i} onClick={e => date && openDayMenu(date, e)} onDoubleClick={() => date && openNewForm(date)}
                      style={{ border: '1px solid var(--br)', background: today ? 'rgba(74,222,128,.04)' : 'var(--bg)', padding: 6, cursor: date ? 'pointer' : 'default', overflow: 'hidden' }}
                      onMouseEnter={e => { if (date) e.currentTarget.style.background = today ? 'rgba(74,222,128,.07)' : 'rgba(255,255,255,.02)' }}
                      onMouseLeave={e => { if (date) e.currentTarget.style.background = today ? 'rgba(74,222,128,.04)' : 'var(--bg)' }}>
                      {date && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: today ? 800 : 500, color: today ? '#fff' : date.getMonth() !== currentDate.getMonth() ? 'var(--b2c)' : 'var(--tx)', background: today ? '#16a34a' : 'transparent', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{date.getDate()}</span>
                            {dayEvs.length > 0 && <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>{dayEvs.length}</span>}
                          </div>
                          {dayEvs.slice(0, 3).map((ev, j) => <EventPill key={ev.id||j} ev={ev} onClick={() => setSelectedEvent(ev)} />)}
                          {dayEvs.length > 3 && <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>+{dayEvs.length-3} more</p>}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : view === 'week' ? (
            <div className="cal-grid-scroll" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)', minWidth: 760, background: 'var(--nav)', borderBottom: '1px solid var(--br)', flexShrink: 0 }}>
                <div style={{ borderRight: '1px solid var(--br)' }} />
                {getWeekDays().map((date, i) => (
                  <div key={i} onClick={e => openDayMenu(date, e)} style={{ padding: '10px 8px', textAlign: 'center', borderLeft: i > 0 ? '1px solid var(--br)' : 'none', cursor: 'pointer' }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: i===0||i===6 ? '#ef4444' : 'var(--t3)', letterSpacing: '.06em' }}>{DAYS[i]}</p>
                    <span style={{ fontSize: 18, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', marginTop: 2, background: isToday(date) ? '#16a34a' : 'transparent', color: isToday(date) ? '#fff' : 'var(--tx)' }}>{date.getDate()}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', minWidth: 760 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7,1fr)' }}>
                  {Array.from({ length: 15 }, (_, h) => h + 6).map(hour => (
                    <div key={hour} style={{ display: 'contents' }}>
                      <div style={{ padding: '0 8px', height: 60, borderRight: '1px solid var(--br)', borderBottom: '1px solid rgba(30,41,59,.5)', display: 'flex', alignItems: 'flex-start', paddingTop: 4 }}>
                        <span style={{ fontSize: 10, color: 'var(--b2c)', fontWeight: 600, whiteSpace: 'nowrap' }}>{hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour-12} PM`}</span>
                      </div>
                      {getWeekDays().map((date, di) => {
                        const slotEvs = eventsForDay(date).filter(ev => {
                          if (!ev.time) return false
                          const [h] = ev.time.split(':').map(Number)
                          return h === hour
                        })
                        return (
                          <div key={di} style={{ height: 60, borderLeft: '1px solid var(--br)', borderBottom: '1px solid rgba(30,41,59,.5)', padding: '2px 4px' }}
                            onDoubleClick={() => openNewForm(date, hour)}>
                            {slotEvs.map((ev, j) => <EventPill key={ev.id||j} ev={ev} onClick={() => setSelectedEvent(ev)} />)}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // DAY VIEW
            <div style={{ padding: 24 }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: 'var(--tx)' }}>
                {currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h2>
              {eventsForDay(currentDate).length === 0 ? (
                <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--t3)' }}>No events scheduled</p>
                  <button onClick={() => openNewForm(currentDate)} style={{ marginTop: 16, padding: '8px 20px', background: '#16a34a', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add Event</button>
                </div>
              ) : eventsForDay(currentDate).map((ev, i) => {
                const sc = scOf(ev)
                return (
                  <div key={i} onClick={() => setSelectedEvent(ev)} style={{ background: sc.bg, borderLeft: `4px solid ${sc.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 10, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        {ev.time && <p style={{ margin: '0 0 4px', fontSize: 12, color: sc.text, opacity: .8, fontWeight: 600 }}>{fmtTime(ev.time)}</p>}
                        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: sc.text }}>{ev.clientName || ev.title}</p>
                        {ev.clientName && ev.title !== ev.clientName && <p style={{ margin: '2px 0 0', fontSize: 13, color: sc.text, opacity: .8 }}>{ev.title}</p>}
                        {ev.notes && <p style={{ margin: '6px 0 0', fontSize: 12, color: sc.text, opacity: .6 }}>{ev.notes}</p>}
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, background: `${sc.border}33`, color: sc.text, padding: '4px 10px', borderRadius: 99, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{(ev.status || 'scheduled').replace('_',' ')}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── UPCOMING DEADLINES SIDEBAR ── */}
      {showUnscheduled && (
        <div className="cal-unscheduled-panel" style={{ width: 270, background: 'var(--nav)', borderLeft: '1px solid var(--br)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--tx)' }}>Upcoming Deadlines</h3>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--t3)' }}>{deadlines.length} active</p>
            </div>
            <button onClick={() => setShowUnscheduled(false)} style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            {deadlines.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--t3)' }}>No active deadlines</p>
              </div>
            ) : deadlines.map((d, i) => {
              const dl = Math.ceil((new Date(d.dueDate) - new Date()) / 86400000)
              const overdue = dl < 0, urgent = dl >= 0 && dl <= 7
              return (
                <div key={i} style={{ background: 'var(--sf)', border: `1px solid ${overdue ? '#ef4444' : urgent ? '#d97706' : 'var(--s2)'}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</p>
                  <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--t3)' }}>{d.clientName || ''}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--t3)' }}>{d.dueDate}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: overdue ? '#fca5a5' : urgent ? '#fbbf24' : '#4ade80' }}>
                      {overdue ? 'OVERDUE' : dl === 0 ? 'TODAY' : `${dl}d left`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── DAY CONTEXT MENU ── */}
      {dayMenuPos && dayMenuDate && (
        <>
          <div onClick={() => { setDayMenuPos(null); setDayMenuDate(null) }} style={{ position: 'fixed', inset: 0, zIndex: 498 }} />
          <div style={{ position: 'fixed', left: dayMenuPos.x, top: dayMenuPos.y, background: 'var(--nav)', border: '1px solid var(--br)', borderRadius: 12, padding: 8, zIndex: 499, minWidth: 240, boxShadow: '0 12px 40px rgba(0,0,0,.6)' }}>
            <div style={{ padding: '6px 10px 10px', borderBottom: '1px solid var(--br)', marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--tx)' }}>
                {dayMenuDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
              </p>
            </div>
            {[
              { icon: '📅', label: 'New Event',      action: () => openNewForm(dayMenuDate, dayMenuDate.getHours() || 9) },
              { icon: '📆', label: 'View Day',       action: () => { setCurrentDate(dayMenuDate); setView('day'); setDayMenuPos(null) } },
              { icon: '📍', label: 'Map Route',      action: () => {
                const addrs = eventsForDay(dayMenuDate).map(ev => {
                  const c = ev.client_id ? clients.find(cl => cl.id === ev.client_id) : clients.find(cl => cl.name === ev.clientName)
                  return c ? c.address : null
                }).filter(Boolean)
                if (addrs.length) window.open(`https://www.google.com/maps/dir/${addrs.map(a => encodeURIComponent(a)).join('/')}`, '_blank')
                else showToast('No client addresses found')
                setDayMenuPos(null)
              }},
            ].map(item => (
              <button key={item.label} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', background: 'none', border: 'none', borderRadius: 8, color: 'var(--t2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{item.icon}</span>
                <span style={{ fontWeight: 500 }}>{item.label}</span>
              </button>
            ))}
            {eventsForDay(dayMenuDate).length > 0 && (
              <div style={{ borderTop: '1px solid var(--br)', marginTop: 6, paddingTop: 8, maxHeight: 180, overflowY: 'auto' }}>
                <p style={{ margin: '0 0 6px 10px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  {eventsForDay(dayMenuDate).length} scheduled
                </p>
                {eventsForDay(dayMenuDate).map((ev, i) => {
                  const sc = scOf(ev)
                  return (
                    <div key={i} onClick={() => { setSelectedEvent(ev); setDayMenuPos(null) }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, marginBottom: 2, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ev.eventType === 'Pending' ? '#f59e0b' : sc.border, flexShrink: 0, boxShadow: ev.eventType === 'Pending' ? '0 0 6px #f59e0b' : 'none' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: ev.eventType === 'Pending' ? '#fcd34d' : sc.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.eventType === 'Pending' ? '⏳ ' : ''}{ev.clientName || ev.title}</p>
                        {ev.time && <p style={{ margin: 0, fontSize: 10, color: 'var(--t3)' }}>{fmtTime(ev.time)}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── ADD/EDIT EVENT MODAL ── */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--nav)', border: '1px solid var(--br)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--tx)' }}>{form.id ? '✏️ Edit Event' : '+ New Event'}</h2>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={lbl}>Title *</label>
                <input style={inp} value={form.title} onChange={e => fld('title', e.target.value)} autoFocus />
              </div>
              <div><label style={lbl}>Client</label>
                <select style={inp} value={form.client_id || ''} onChange={e => { const c = clients.find(x => x.id === e.target.value); fld('client_id', e.target.value); fld('clientName', c?.name || '') }}>
                  <option value="">— No client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="cal-form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={lbl}>Date *</label>
                  <input type="date" style={inp} value={form.date} onChange={e => fld('date', e.target.value)} />
                </div>
                <div><label style={lbl}>Start Time</label>
                  <input type="time" style={inp} value={form.time} onChange={e => fld('time', e.target.value)} />
                </div>
              </div>
              <div className="cal-form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={lbl}>End Time</label>
                  <input type="time" style={inp} value={form.endTime} onChange={e => fld('endTime', e.target.value)} />
                </div>
                <div><label style={lbl}>Assigned To</label>
                  <select style={inp} value={form.assignedTo} onChange={e => fld('assignedTo', e.target.value)} disabled={isRomyLabsAdmin}>
                    {isRomyLabsAdmin ? (
                      <option value={adminCalendarOwner}>{adminCalendarOwner}</option>
                    ) : (
                      <>
                        <option value="">— Anyone —</option>
                        {employees.map(em => <option key={em.id} value={em.name}>{em.name}</option>)}
                      </>
                    )}
                  </select>
                </div>
              </div>
              <div className="cal-form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={lbl}>Event Type</label>
                  <select style={inp} value={form.eventType} onChange={e => fld('eventType', e.target.value)}>
                    {['Consultation Call','Client Meeting','IRS Call','IRS Appointment','Court Date','Hearing','Deadline','Follow-up Call','Document Due','Payment Due','Team Meeting','Other'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={e => fld('status', e.target.value)}>
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div><label style={lbl}>Notes</label>
                <textarea style={{ ...inp, height: 70, resize: 'vertical' }} value={form.notes} onChange={e => fld('notes', e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowForm(false)} style={{ padding: '10px 20px', background: 'transparent', border: '1px solid var(--br)', borderRadius: 9, color: 'var(--t3)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={saveEvent} disabled={saving} style={{ padding: '10px 28px', background: '#16a34a', border: 'none', borderRadius: 9, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {saving ? 'Saving…' : form.id ? 'Update Event' : 'Save Event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmModal open={!!confirmDel} label="event" onConfirm={() => deleteEvent(confirmDel)} onCancel={() => setConfirmDel(null)} />
      {showBooking && <InternalBooking onClose={() => setShowBooking(false)} />}
    </div>
  )
}



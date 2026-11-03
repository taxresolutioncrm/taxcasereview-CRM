import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Runs once in the authenticated RomyLabs Admin shell, not just on /calendar.
// Browser-local wall-clock comparison keeps calendar HH:mm values in America/New_York,
// including on computers in a different local timezone.
const TZ = 'America/New_York'
const LEADS = [30, 15, 5]
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const deliveryKey = (id, date, time, lead) => 'romylabs-meeting-reminder:' + [id, date, time, lead].join(':')
const nowEastWallMs = () => {
  const parts = Object.fromEntries(formatter.formatToParts(new Date())
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}
const startEastWallMs = event => {
  const date = String(event.event_date || '')
  const time = String(event.event_time || '')
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const clock = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match || !clock) return NaN
  const [, yy, mm, dd] = match.map(Number)
  const hour = Number(clock[1]), minute = Number(clock[2])
  if (hour > 23 || minute > 59) return NaN
  const value = Date.UTC(yy, mm - 1, dd, hour, minute)
  const parsed = new Date(value)
  if (parsed.getUTCFullYear() !== yy || parsed.getUTCMonth() !== mm - 1 || parsed.getUTCDate() !== dd) return NaN
  return value
}
const displayTime = time => {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return ''
  const hour = Number(match[1])
  return (hour % 12 || 12) + ':' + match[2] + (hour >= 12 ? ' PM' : ' AM')
}
const storageHas = key => { try { return localStorage.getItem(key) === '1' } catch { return false } }
const storageMark = key => { try { localStorage.setItem(key, '1') } catch { /* in-app alerts still work */ } }

export default function AdminMeetingReminders() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [permission, setPermission] = useState(
    () => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  )
  const eventsRef = useRef([])
  const deliveredRef = useRef(new Set())
  const loadingRef = useRef(false)

  const check = useCallback(() => {
    const now = nowEastWallMs()
    for (const event of eventsRef.current) {
      if (['cancelled', 'canceled', 'completed', 'draft'].includes(String(event.status || '').toLowerCase())) continue
      const start = startEastWallMs(event)
      if (!Number.isFinite(start)) continue
      const remaining = start - now
      for (const lead of LEADS) {
        const threshold = lead * 60_000
        // Poll every 10 seconds and allow 90 seconds for tab resumption.
        // Never replay obsolete 30-minute alerts after a lengthy computer sleep.
        if (remaining > threshold || remaining <= threshold - 90_000) continue
        const key = deliveryKey(event.id, event.event_date, event.event_time, lead)
        if (deliveredRef.current.has(key) || storageHas(key)) continue
        deliveredRef.current.add(key)
        storageMark(key)
        const label = event.client_name || event.title || 'Meeting'
        const notice = { key, id: event.id, label, lead, time: displayTime(event.event_time), product: event.product_id }
        setAlerts(current => [...current, notice].slice(-8))
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const notification = new Notification('Meeting in ' + lead + ' minutes', {
              body: label + ' at ' + notice.time + ' ET',
              tag: key,
            })
            notification.onclick = () => {
              window.focus()
              window.location.assign('/crm-admin/calendar')
              notification.close()
            }
          } catch { /* in-app alert is still visible */ }
        }
      }
    }
  }, [])

  const refresh = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const { data, error } = await supabase.rpc('admin_product_calendar_events', { p_product_id: 'all' })
      if (error) throw error
      eventsRef.current = data || []
      check()
    } catch (error) {
      console.warn('[AdminMeetingReminders] Calendar refresh failed:', error?.message || error)
    } finally {
      loadingRef.current = false
    }
  }, [check])

  useEffect(() => {
    void refresh()
    const checkTimer = window.setInterval(check, 10_000)
    const refreshTimer = window.setInterval(() => { void refresh() }, 60_000)
    const onResume = () => { if (document.visibilityState === 'visible') void refresh() }
    const onFocus = () => { void refresh() }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onFocus)
    // Refresh when appointments are inserted, updated or removed elsewhere.
    const channel = supabase.channel('romylabs-admin-meeting-reminders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calevents' }, () => { void refresh() })
      .subscribe()
    return () => {
      window.clearInterval(checkTimer)
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [check, refresh])

  const enableDesktop = async () => {
    if (typeof Notification === 'undefined') return
    try { setPermission(await Notification.requestPermission()) }
    catch { setPermission('denied') }
  }

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 100000, display: 'flex',
      flexDirection: 'column', alignItems: 'flex-end', gap: 10, maxWidth: 'min(380px, calc(100vw - 32px))' }}
      aria-live="polite">
      {alerts.map(alert => (
        <div key={alert.key} role="alert" style={{ width: '100%', boxSizing: 'border-box',
          background: '#12233c', border: '1px solid #38bdf8', borderLeft: '5px solid #38bdf8',
          borderRadius: 12, padding: '14px 16px', color: '#f8fafc',
          boxShadow: '0 15px 45px rgba(0,0,0,.55)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>🔔 Meeting in {alert.lead} minutes</div>
            <button type="button" aria-label="Dismiss meeting reminder"
              onClick={() => setAlerts(old => old.filter(item => item.key !== alert.key))}
              style={{ border: 0, background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 20 }}>×</button>
          </div>
          <div style={{ fontSize: 13, marginTop: 7 }}>{alert.label}</div>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>{alert.time} Eastern</div>
          <button type="button" onClick={() => { setAlerts(old => old.filter(item => item.key !== alert.key)); navigate('/crm-admin/calendar') }}
            style={{ background: '#0284c7', color: 'white', border: 0, cursor: 'pointer',
              borderRadius: 7, fontWeight: 700, fontSize: 12, padding: '7px 12px', marginTop: 10 }}>
            Open Calendar
          </button>
        </div>
      ))}
      {permission === 'default' && (
        <button type="button" onClick={enableDesktop}
          title="Allow desktop pop-ups as well as in-app meeting reminders"
          style={{ background: '#11233b', color: '#e0f2fe', border: '1px solid #2563eb',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          🔔 Enable desktop meeting alerts
        </button>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { supabase } from '../lib/supabase'
import { bookUrl } from '../lib/bookingEmails'

// ── Online Booking settings (Calendly-style) ──
// Config lives in settings.booking_config (jsonb). The public /book page
// reads it via the anon-safe booking_get_config RPC — nothing here is
// readable by anon directly.

export const DEFAULT_BOOKING_CONFIG = {
  enabled: false,
  slotMinutes: 30,
  bufferMinutes: 0,
  leadHours: 4,
  maxDaysOut: 30,
  types: ['Free Consultation'],
  blockedDates: [],
  // Optional pay-to-book: when required, the client pays via Stripe Checkout
  // before the appointment is created. Amount is in dollars; label shows on
  // the Stripe page and the booking screen.
  payment: { required: false, amount: '', label: '' },
  hours: {
    mon: ['09:00', '17:00'], tue: ['09:00', '17:00'], wed: ['09:00', '17:00'],
    thu: ['09:00', '17:00'], fri: ['09:00', '17:00'], sat: null, sun: null,
  },
}

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]
const TYPE_OPTIONS = ['Free Consultation', 'Case Discussion', 'Tax Investigation Review', 'Document Signing', 'Follow-Up Call', 'In-Person Meeting']

export default function BookingSettings() {
  const [tenantId, setTenantId] = useState(null)
  const [cfg, setCfg] = useState(DEFAULT_BOOKING_CONFIG)
  const [rowId, setRowId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: tid } = await supabase.rpc('current_tenant_id')
      setTenantId(tid || null)
      if (!tid) { setLoading(false); return }
      const { data } = await supabase.from('settings')
        .select('id, booking_config')
        .eq('tenant_id', tid)
        .maybeSingle()
      if (data) {
        setRowId(data.id)
        if (data.booking_config) setCfg({ ...DEFAULT_BOOKING_CONFIG, ...data.booking_config, blockedDates: data.booking_config.blockedDates || [], payment: { ...DEFAULT_BOOKING_CONFIG.payment, ...(data.booking_config.payment || {}) }, hours: { ...DEFAULT_BOOKING_CONFIG.hours, ...(data.booking_config.hours || {}) } })
      }
      setLoading(false)
    })()
  }, [])

  function set(k, v) { setCfg(c => ({ ...c, [k]: v })) }
  function setDay(day, val) { setCfg(c => ({ ...c, hours: { ...c.hours, [day]: val } })) }

  async function persist(next) {
    setSaving(true); setMsg('')
    let error
    let tid = tenantId
    if (!tid) {
      const { data } = await supabase.rpc('current_tenant_id')
      tid = data || null
      if (tid) setTenantId(tid)
    }
    if (!tid) {
      setSaving(false)
      setMsg('❌ Could not resolve this office')
      return false
    }
    if (rowId) ({ error } = await supabase.from('settings').update({ booking_config: next }).eq('tenant_id', tid).eq('id', rowId))
    else {
      const res = await supabase.from('settings').insert([{ tenant_id: tid, booking_config: next }]).select('id').single()
      error = res.error; if (res.data) setRowId(res.data.id)
    }
    setSaving(false)
    setMsg(error ? '❌ ' + error.message : '✅ Saved')
    setTimeout(() => setMsg(''), 4000)
    return !error
  }

  async function save() { await persist(cfg) }

  // The master switch saves itself immediately — flipping it must never
  // depend on remembering to hit Save.
  async function toggleEnabled(on) {
    const next = { ...cfg, enabled: on }
    setCfg(next)
    await persist(next)
  }

  function copyLink() {
    navigator.clipboard.writeText(bookUrl()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) })
  }

  if (loading) return <div className="card"><div style={{ padding: 16, color: 'var(--t3)' }}>Loading…</div></div>

  const sel = { padding: '6px 8px' }

  return (
    <div className="card">
      <div className="card-header"><span className="card-title">📅 Online Booking</span></div>
      <div style={{ padding: '4px 16px 16px' }}>
        <div style={{ color: 'var(--t3)', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
          Calendly-style public scheduling. Share the link below — visitors pick an open slot based on the
          availability you set here, and the appointment lands on the CRM calendar automatically (with a new
          lead created if we don't already know them). Slots already taken on the calendar are never offered.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.enabled} onChange={e => toggleEnabled(e.target.checked)} />
          Online booking is {cfg.enabled ? 'ON' : 'OFF'} <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(saves instantly)</span>
        </label>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <input readOnly value={bookUrl()} style={{ flex: 1, minWidth: 260, fontSize: 12 }} onFocus={e => e.target.select()} />
          <button className="btn sec" onClick={copyLink}>{copied ? '✅ Copied' : '📋 Copy Link'}</button>
          <a className="btn sec" href={bookUrl()} target="_blank" rel="noreferrer">↗ Preview</a>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Appointment length</label>
            <select style={sel} value={cfg.slotMinutes} onChange={e => set('slotMinutes', Number(e.target.value))}>
              {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Buffer between</label>
            <select style={sel} value={cfg.bufferMinutes} onChange={e => set('bufferMinutes', Number(e.target.value))}>
              {[0, 5, 10, 15, 30].map(m => <option key={m} value={m}>{m ? `${m} minutes` : 'None'}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Minimum notice</label>
            <select style={sel} value={cfg.leadHours} onChange={e => set('leadHours', Number(e.target.value))}>
              {[1, 2, 4, 12, 24, 48].map(h => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Book up to</label>
            <select style={sel} value={cfg.maxDaysOut} onChange={e => set('maxDaysOut', Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} days out</option>)}
            </select>
          </div>
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Weekly availability <span style={{ color: 'var(--t3)', fontWeight: 400 }}>(Eastern time)</span></div>
        <div style={{ marginBottom: 16 }}>
          {DAYS.map(([key, label]) => {
            const open = !!cfg.hours[key]
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 12.5 }}>
                <label style={{ width: 110, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={open} onChange={e => setDay(key, e.target.checked ? ['09:00', '17:00'] : null)} />
                  {label}
                </label>
                {open ? (
                  <>
                    <input type="time" value={cfg.hours[key][0]} onChange={e => setDay(key, [e.target.value, cfg.hours[key][1]])} />
                    <span style={{ color: 'var(--t3)' }}>to</span>
                    <input type="time" value={cfg.hours[key][1]} onChange={e => setDay(key, [cfg.hours[key][0], e.target.value])} />
                  </>
                ) : <span style={{ color: 'var(--t3)' }}>Unavailable</span>}
              </div>
            )
          })}
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Days off / blocked dates <span style={{ color: 'var(--t3)', fontWeight: 400 }}>(overrides weekly hours — holidays, vacation, court dates)</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <input type="date" id="bk-block-date" min={new Date().toISOString().slice(0, 10)} style={{ padding: '6px 8px' }} />
          <button className="btn sec" onClick={() => {
            const el = document.getElementById('bk-block-date')
            if (el?.value && !cfg.blockedDates.includes(el.value)) { set('blockedDates', [...cfg.blockedDates, el.value].sort()); el.value = '' }
          }}>+ Block Date</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {cfg.blockedDates.length === 0 ? <span style={{ color: 'var(--t3)', fontSize: 12 }}>None blocked</span> :
            cfg.blockedDates.map(d => (
              <span key={d} style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 7, padding: '3px 9px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => set('blockedDates', cfg.blockedDates.filter(x => x !== d))}>✕</span>
              </span>
            ))}
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Appointment types offered publicly</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          {TYPE_OPTIONS.map(t => (
            <label key={t} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={cfg.types.includes(t)}
                onChange={e => set('types', e.target.checked ? [...cfg.types, t] : cfg.types.filter(x => x !== t))} />
              {t}
            </label>
          ))}
        </div>

        <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Require payment to book <span style={{ color: 'var(--t3)', fontWeight: 400 }}>(optional — collects a deposit/fee via Stripe before the slot is confirmed)</span></div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!cfg.payment?.required}
              onChange={e => set('payment', { ...cfg.payment, required: e.target.checked })} />
            Charge a fee before confirming the appointment
          </label>
          {cfg.payment?.required && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
                Amount (USD)
                <input type="text" inputMode="decimal" style={{ padding: '6px 8px', width: 120 }}
                  placeholder="399" value={formatMoneyInput(cfg.payment.amount)}
                  onChange={e => set('payment', { ...cfg.payment, amount: parseMoney(e.target.value) })} />
              </label>
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 200 }}>
                What they're paying for (shown on the checkout page)
                <input style={{ padding: '6px 8px' }}
                  placeholder="Tax Investigation Review" value={cfg.payment.label}
                  onChange={e => set('payment', { ...cfg.payment, label: e.target.value })} />
              </label>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn pri" disabled={saving || cfg.types.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save Booking Settings'}</button>
          {msg && <span style={{ fontSize: 12.5 }}>{msg}</span>}
        </div>
      </div>
    </div>
  )
}

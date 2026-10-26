import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { ICONS } from '../lib/activityLog'
import { exportCSV, exportPDF, exportExcel } from '../lib/exportUtils'

const CATEGORY_COLORS = {
  lead:     '#a855f7', client:  '#3b82f6', call:   '#22c55e',
  email:    '#0ea5e9', sms:     '#6366f1', fax:    '#dc2626',
  payment:  '#10b981', esign:   '#7c3aed', document:'#f97316',
  session:  '#64748b', case:    '#f59e0b', task:   '#06b6d4',
  note:     '#94a3b8', invoice: '#ef4444',
}

function fmtTime(dt) {
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
function fmtDuration(a, b) {
  const mins = Math.round((new Date(b) - new Date(a)) / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m`
  return `${Math.floor(mins/60)}h ${mins%60}m`
}
function today() { return new Date().toISOString().slice(0,10) }

// ── Period helpers — Day / Week / Month, each supporting a From→To range ──
// Week inputs use the native <input type="week"> value format "YYYY-Www"
// (ISO 8601 week numbering, Monday–Sunday). Month inputs use "YYYY-MM".
function isoWeekStart(weekStr) {
  const [yearStr, weekPart] = weekStr.split('-W')
  const year = parseInt(yearStr, 10)
  const week = parseInt(weekPart, 10)
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  const dow = simple.getUTCDay() || 7 // Mon=1 .. Sun=7
  const monday = new Date(simple)
  monday.setUTCDate(simple.getUTCDate() - dow + 1)
  return monday
}
function isoWeekEnd(weekStr) {
  const monday = isoWeekStart(weekStr)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return sunday
}
function currentIsoWeekString(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
function monthStart(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
}
function monthEnd(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
}
function currentMonthString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
// Computes the ISO datetime bounds + a human label for the selected period.
// fromVal/toVal being equal means a single day/week/month; different means
// a multi-period range (e.g. 3 weeks spanning fromVal through toVal).
function computeRange(periodType, fromVal, toVal) {
  if (periodType === 'week') {
    const start = isoWeekStart(fromVal)
    const end = isoWeekEnd(toVal)
    end.setUTCHours(23, 59, 59, 999)
    const s = start.toISOString().slice(0, 10), e = end.toISOString().slice(0, 10)
    return { startISO: start.toISOString(), endISO: end.toISOString(), label: fromVal === toVal ? `Week of ${s}` : `${s} → ${e}` }
  }
  if (periodType === 'month') {
    const start = monthStart(fromVal)
    const end = monthEnd(toVal)
    return { startISO: start.toISOString(), endISO: end.toISOString(), label: fromVal === toVal ? fromVal : `${fromVal} → ${toVal}` }
  }
  // day
  return { startISO: fromVal + 'T00:00:00.000Z', endISO: toVal + 'T23:59:59.999Z', label: fromVal === toVal ? fromVal : `${fromVal} → ${toVal}` }
}

export default function ActivityReport() {
  const { role } = useApp()
  const [periodType, setPeriodType] = useState('day') // day | week | month
  const [fromVal,    setFromVal]    = useState(today())
  const [toVal,      setToVal]      = useState(today())
  const [employees,  setEmployees]  = useState([])
  const [selEmp,     setSelEmp]     = useState('All')
  const [selEntity,  setSelEntity]  = useState('')   // filter by client/lead name
  const [logs,       setLogs]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState('')
  const [truncated,  setTruncated]  = useState(false)
  const [view,       setView]       = useState('summary') // summary | timeline

  const canView = ['Super Admin','Admin','Manager'].includes(role)
  const { startISO, endISO, label: rangeLabel } = computeRange(periodType, fromVal, toVal)

  function changePeriodType(pt) {
    setPeriodType(pt)
    if (pt === 'day')   { setFromVal(today()); setToVal(today()) }
    if (pt === 'week')  { const w = currentIsoWeekString(); setFromVal(w); setToVal(w) }
    if (pt === 'month') { const m = currentMonthString(); setFromVal(m); setToVal(m) }
  }

  useEffect(() => {
    supabase.from('employees').select('id,name,role,status').eq('status','Active').order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  useEffect(() => { load() }, [periodType, fromVal, toVal, selEmp])

  async function load() {
    setLoading(true)
    setLoadError('')
    setTruncated(false)
    const pageSize = 500
    const maxRows = 10000
    const rows = []
    try {
      for (let offset = 0; offset < maxRows; offset += pageSize) {
        let query = supabase.from('activity_log').select('*')
          .gte('created_at', startISO).lte('created_at', endISO)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1)
        if (selEmp !== 'All') query = query.eq('employee_name', selEmp)
        const { data, error } = await query
        if (error) throw error
        rows.push(...(data || []))
        if (!data || data.length < pageSize) break
        if (rows.length >= maxRows) setTruncated(true)
      }
      setLogs(rows)
    } catch (error) {
      setLogs([])
      setLoadError(error?.message || 'Activity report could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  if (!canView) return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--tx)' }}>Access Restricted</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>Activity reports are visible to Admins and Managers only.</div>
    </div>
  )

  // ── Summary stats per employee ─────────────────────────────────────────────
  const byEmp = {}
  logs.forEach(l => {
    if (!byEmp[l.employee_name]) byEmp[l.employee_name] = { name: l.employee_name, logs: [], loginAt: null, lastAt: null }
    byEmp[l.employee_name].logs.push(l)
    if (l.action === 'session_login' && !byEmp[l.employee_name].loginAt) byEmp[l.employee_name].loginAt = l.created_at
    byEmp[l.employee_name].lastAt = l.created_at
  })

  const empSummaries = Object.values(byEmp).map(e => ({
    ...e,
    total:    e.logs.length,
    calls:    e.logs.filter(l => l.category === 'call').length,
    leads:    e.logs.filter(l => l.category === 'lead').length,
    clients:  e.logs.filter(l => l.category === 'client').length,
    payments: e.logs.filter(l => l.category === 'payment').length,
    esigns:   e.logs.filter(l => l.category === 'esign').length,
    online: e.loginAt && e.lastAt ? fmtDuration(e.loginAt, e.lastAt) : null,
  })).sort((a,b) => b.total - a.total)

  const filteredLogs = logs
    .filter(l => selEmp === 'All' || l.employee_name === selEmp)
    .filter(l => !selEntity.trim() || (l.entity_name || '').toLowerCase().includes(selEntity.toLowerCase()))

  return (
    <div>
      {loadError && <div role="alert" style={{padding:12,marginBottom:16,borderRadius:8,background:'rgba(239,68,68,.1)',color:'#fecaca'}}>Unable to load activity: {loadError} <button onClick={load} style={{marginLeft:12}}>Retry</button></div>}
      {truncated && <div role="status" style={{padding:12,marginBottom:16,borderRadius:8,background:'rgba(245,158,11,.1)',color:'#fde68a'}}>Report contains more than 10,000 records. Narrow the date or employee filters for complete totals and exports.</div>}
      {/* Header controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['day','week','month'].map(pt => (
            <span key={pt} className={`chip${periodType === pt ? ' on' : ''}`} onClick={() => changePeriodType(pt)} style={{ textTransform: 'capitalize' }}>{pt}</span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--t3)' }}>From</label>
          <input type={periodType === 'week' ? 'week' : periodType === 'month' ? 'month' : 'date'}
            value={fromVal}
            onChange={e => { const v = e.target.value; setFromVal(v); if (v > toVal) setToVal(v) }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }} />
          <label style={{ fontSize: 11, color: 'var(--t3)' }}>To</label>
          <input type={periodType === 'week' ? 'week' : periodType === 'month' ? 'month' : 'date'}
            value={toVal}
            onChange={e => { const v = e.target.value; setToVal(v); if (v < fromVal) setFromVal(v) }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }} />
          <span style={{ fontSize: 11, color: 'var(--t3)' }} title="Set From and To to different periods to export/view multiple weeks or months at once">
            {fromVal !== toVal ? `📅 ${rangeLabel}` : ''}
          </span>
        </div>

        <select value={selEmp} onChange={e => { setSelEmp(e.target.value); setView(e.target.value === 'All' ? 'summary' : 'timeline') }}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }}>
          <option value="All">All Employees</option>
          {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
        </select>
        <input
          value={selEntity} onChange={e => { setSelEntity(e.target.value); if (e.target.value) setView('timeline') }}
          placeholder="Filter by client/lead name…"
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13, minWidth: 200 }}
        />
        {selEmp !== 'All' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {['summary','timeline'].map(v => (
              <span key={v} className={`chip${view === v ? ' on' : ''}`} onClick={() => setView(v)} style={{ textTransform: 'capitalize' }}>{v}</span>
            ))}
          </div>
        )}
        <button className="btn sec" style={{ fontSize: 12, padding: '6px 14px' }} onClick={load}>↻ Refresh</button>
        <button className="btn sec" style={{ fontSize: 12, padding: '6px 14px' }}
          onClick={() => exportCSV(
            [['Employee','Time','Action','Category','Description','Entity'],
             ...filteredLogs.map(l => [l.employee_name, new Date(l.created_at).toLocaleString(), l.action, l.category, l.description||'', l.entity_name||''])],
            `activity-report-${rangeLabel.replace(/[^0-9a-zA-Z-]+/g,'_')}`
          )}>⬇ CSV</button>
        <button className="btn sec" style={{ fontSize: 12, padding: '6px 14px' }}
          onClick={() => exportExcel(
            [['Employee','Time','Action','Category','Description','Entity'],
             ...filteredLogs.map(l => [l.employee_name, new Date(l.created_at).toLocaleString(), l.action, l.category, l.description||'', l.entity_name||''])],
            `activity-report-${rangeLabel.replace(/[^0-9a-zA-Z-]+/g,'_')}`
          )}>📊 Excel</button>
        <button className="btn sec" style={{ fontSize: 12, padding: '6px 14px' }}
          onClick={() => exportPDF(`Activity Report — ${rangeLabel}`, [{
            heading: selEmp === 'All' ? 'All Staff Activity' : `${selEmp} — Activity`,
            headers: ['Employee','Time','Category','Description'],
            rows: filteredLogs.map(l => [l.employee_name, new Date(l.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}), l.category, l.description||''])
          }])}>🖨️ PDF</button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total Actions',  val: logs.length,                                           color: 'var(--tx)' },
          { label: 'Calls Logged',   val: logs.filter(l=>l.category==='call').length,            color: 'var(--green)' },
          { label: 'Leads Touched',  val: logs.filter(l=>l.category==='lead').length,            color: 'var(--blue)' },
          { label: 'Payments',       val: logs.filter(l=>l.category==='payment').length,         color: '#10b981' },
          { label: 'E-Signs Sent',   val: logs.filter(l=>l.category==='esign').length,           color: '#7c3aed' },
          { label: 'Active Staff',   val: Object.keys(byEmp).length,                             color: 'var(--warn)' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Loading activity…</div>
      ) : logs.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--tx)', marginBottom: 4 }}>No activity recorded</div>
          <div style={{ fontSize: 13, color: 'var(--t3)' }}>Activity logging started from today. Actions taken before this won't appear.</div>
        </div>
      ) : view === 'summary' ? (
        // ── Summary view ────────────────────────────────────────────────────
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {empSummaries.map(emp => (
            <div key={emp.name} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Employee header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: '1px solid var(--br)', cursor: 'pointer' }}
                onClick={() => { setSelEmp(emp.name); setView('timeline') }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {emp.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)' }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                    {emp.loginAt ? `Login ${fmtTime(emp.loginAt)}` : 'No login recorded'}
                    {emp.online ? ` · Active ${emp.online}` : ''}
                    {emp.lastAt ? ` · Last action ${fmtTime(emp.lastAt)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {[
                    { icon: '⚡', val: emp.total, label: 'actions' },
                    { icon: '📞', val: emp.calls, label: 'calls' },
                    { icon: '👥', val: emp.leads, label: 'leads' },
                    { icon: '💳', val: emp.payments, label: 'payments' },
                    { icon: '✍️', val: emp.esigns, label: 'esigns' },
                  ].filter(s => s.val > 0).map(s => (
                    <div key={s.label} style={{ textAlign: 'center', background: 'var(--s2)', borderRadius: 8, padding: '4px 10px', minWidth: 44 }}>
                      <div style={{ fontSize: 13 }}>{s.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--tx)', lineHeight: 1 }}>{s.val}</div>
                      <div style={{ fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: 'var(--blue)', marginLeft: 8, flexShrink: 0 }}>View timeline →</span>
              </div>

              {/* Last 3 actions preview */}
              <div style={{ padding: '8px 18px' }}>
                {emp.logs.slice(-3).reverse().map((l, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: i < 2 ? '1px solid var(--br)' : 'none', fontSize: 12 }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{ICONS[l.category] || '📌'}</span>
                    <span style={{ color: 'var(--t2)', flexShrink: 0, width: 72 }}>{fmtTime(l.created_at)}</span>
                    <span style={{ color: 'var(--tx)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // ── Timeline view ────────────────────────────────────────────────────
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{selEmp}</span>
              <span style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 8 }}>{filteredLogs.length} actions in {rangeLabel}</span>
            </div>
            <button className="btn sec" style={{ fontSize: 12 }} onClick={() => { setSelEmp('All'); setView('summary') }}>← All staff</button>
          </div>

          {filteredLogs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No activity for {selEmp} in this period.</div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {filteredLogs.map((l, i) => {
                const color = CATEGORY_COLORS[l.category] || 'var(--t3)'
                const prev = filteredLogs[i - 1]
                const gap = prev ? Math.round((new Date(l.created_at) - new Date(prev.created_at)) / 60000) : 0
                return (
                  <div key={l.id}>
                    {/* Show idle gap if > 10 minutes between actions */}
                    {gap > 10 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 18px 4px 58px' }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--br)', borderStyle: 'dashed' }} />
                        <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>idle {gap < 60 ? `${gap}m` : `${Math.floor(gap/60)}h ${gap%60}m`}</span>
                        <div style={{ flex: 1, height: 1, background: 'var(--br)' }} />
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 18px' }}>
                      {/* Timeline dot */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 5 }} />
                        {i < filteredLogs.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 16, background: 'var(--br)', marginTop: 3 }} />}
                      </div>
                      {/* Time */}
                      <div style={{ fontSize: 12, color: 'var(--t3)', width: 64, flexShrink: 0, marginTop: 3 }}>{fmtTime(l.created_at)}</div>
                      {/* Icon + content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 15 }}>{ICONS[l.category] || '📌'}</span>
                          <span style={{ fontSize: 13, color: 'var(--tx)', fontWeight: 600 }}>{l.description}</span>
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: color + '22', color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', flexShrink: 0 }}>
                            {l.category}
                          </span>
                        </div>
                        {l.meta && Object.keys(l.meta).length > 0 && l.category !== 'session' && (
                          <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                            {Object.entries(l.meta).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { FIRM } from '../lib/firmBranding'

const TYPE_LABEL = { pto: 'PTO', sick: 'Sick Day', vacation: 'Vacation' }
const TYPE_COLOR = { pto: 'var(--blue)', sick: 'var(--bad)', vacation: 'var(--green)' }
const TYPE_BG    = { pto: 'var(--blt)', sick: 'rgba(239,68,68,.12)', vacation: 'rgba(74,222,128,.12)' }
const TYPE_ICON  = { pto: '🏖️', sick: '🤒', vacation: '✈️' }
const STATUS_C   = { pending: 'ba', approved: 'bg', denied: 'br', cancelled: 'bn' }

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
}

export default function TimeOff() {
  const { user } = useApp()
  const [requests, setRequests]   = useState([])
  const [employees, setEmployees] = useState([])
  const [filter, setFilter]       = useState('pending')
  const [toast, setToast]         = useState('')
  const [working, setWorking]     = useState(null)

  useEffect(() => { load() }, [])
  useEffect(() => {
    let refreshTimer = null
    const scheduleLoad = () => {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(load, 350)
    }
    const cfg = { event:'*', schema:'public', table:'time_off_requests', ...(FIRM.tenantId ? { filter:`tenant_id=eq.${FIRM.tenantId}` } : {}) }
    const ch = supabase.channel('timeoff-rt')
      .on('postgres_changes', cfg, scheduleLoad)
      .subscribe()
    return () => { clearTimeout(refreshTimer); supabase.removeChannel(ch) }
  }, [])

  async function load() {
    const [{ data: reqs }, { data: emps }] = await Promise.all([
      supabase.from('time_off_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('employees').select('id,name,pto_balance,sick_balance,vacation_balance'),
    ])
    setRequests(reqs || [])
    setEmployees(emps || [])
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function review(req, status) {
    setWorking(req.id)
    const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    const { error } = await supabase.from('time_off_requests')
      .update({ status, reviewed_by: actor, reviewed_at: new Date().toISOString() })
      .eq('id', req.id)
    if (error) { showToast('Error: ' + error.message); setWorking(null); return }
    if (status === 'approved') {
      const col = req.type === 'pto' ? 'pto_balance' : req.type === 'sick' ? 'sick_balance' : 'vacation_balance'
      const emp = employees.find(e => e.id === req.employee_id) || employees.find(e => e.name === req.employee_name)
      if (emp) {
        const updated = Math.max(0, (emp[col] || 0) - req.days)
        await supabase.from('employees').update({ [col]: updated }).eq('id', emp.id)
      }
    }
    // Optimistic local update
    setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status, reviewed_by: actor, reviewed_at: new Date().toISOString() } : r))
    showToast(status === 'approved' ? '✅ Approved' : '🚫 Denied')
    setWorking(null)
  }

  const filtered     = filter === 'All' ? requests : requests.filter(r => r.status === filter)
  const pendingCount = requests.filter(r => r.status === 'pending').length
  const approvedYTD  = requests.filter(r => r.status === 'approved').reduce((s, r) => s + (r.days || 0), 0)

  return (
    <div>
      {toast && <div className="toast show">{toast}</div>}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Pending',      val: pendingCount,                                  color: 'var(--warn)' },
          { label: 'Approved YTD', val: approvedYTD + ' days',                         color: 'var(--green)' },
          { label: 'Total',        val: requests.length,                                color: 'var(--tx)' },
          { label: 'Denied',       val: requests.filter(r=>r.status==='denied').length, color: 'var(--bad)' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Balance cards per employee */}
      {employees.some(e => (e.pto_balance || e.sick_balance || e.vacation_balance)) && (
        <div className="card" style={{ marginBottom: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>Employee Balances</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {employees.filter(e => e.pto_balance || e.sick_balance || e.vacation_balance).map(emp => (
              <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 11, flexShrink: 0 }}>
                  {initials(emp.name)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, minWidth: 120 }}>{emp.name}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[['pto','PTO','var(--blue)'],['sick','Sick','var(--bad)'],['vacation','Vacation','var(--green)']].map(([key,label,color]) => (
                    <span key={key} style={{ fontSize: 12, background: 'var(--s2)', borderRadius: 6, padding: '3px 10px', color }}>
                      <span style={{ fontWeight: 700 }}>{emp[key+'_balance'] ?? 0}</span>
                      <span style={{ color: 'var(--t3)', marginLeft: 4 }}>{label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {['pending', 'approved', 'denied', 'cancelled', 'All'].map(s => (
          <span key={s} className={`chip${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)} style={{ textTransform: 'capitalize' }}>
            {s}{s === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </span>
        ))}
      </div>

      {/* Requests list */}
      <div className="card">
        <div className="ch">
          <span className="ct">Time Off Requests <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t3)', marginLeft: 6 }}>({filtered.length})</span></span>
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>Submitted from the Employee Portal</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--tx)', marginBottom: 4 }}>
              No {filter === 'All' ? '' : filter} requests
            </div>
            <div style={{ fontSize: 13 }}>Employees submit time off requests from the /clockin kiosk.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
                borderBottom: '1px solid var(--br)', transition: 'background .1s'
              }}>
                {/* Type icon */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: TYPE_BG[r.type] || 'var(--s2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
                }}>
                  {TYPE_ICON[r.type] || '📋'}
                </div>

                {/* Main info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)' }}>{r.employee_name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: TYPE_BG[r.type], color: TYPE_COLOR[r.type] }}>
                      {TYPE_LABEL[r.type] || r.type}
                    </span>
                    <span className={`bdg ${STATUS_C[r.status] || 'bn'}`} style={{ textTransform: 'capitalize', fontSize: 11 }}>{r.status}</span>
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>📅</span>
                    <span style={{ fontWeight: 600, color: 'var(--tx)' }}>{fmtDate(r.start_date)}</span>
                    {r.start_date !== r.end_date && <><span style={{ color: 'var(--t3)' }}>→</span><span style={{ fontWeight: 600, color: 'var(--tx)' }}>{fmtDate(r.end_date)}</span></>}
                    <span style={{ color: 'var(--t3)' }}>·</span>
                    <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{r.days} day{r.days !== 1 ? 's' : ''}</span>
                  </div>

                  {r.reason && (
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 5, fontStyle: 'italic', borderLeft: '2px solid var(--br)', paddingLeft: 8 }}>
                      "{r.reason}"
                    </div>
                  )}
                  {r.reviewed_by && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 5 }}>
                      Reviewed by {r.reviewed_by}{r.reviewed_at ? ' · ' + new Date(r.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignSelf: 'center' }}>
                    <button className="btn ok" style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700 }}
                      disabled={working === r.id} onClick={() => review(r, 'approved')}>✓ Approve</button>
                    <button className="btn del" style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700 }}
                      disabled={working === r.id} onClick={() => review(r, 'denied')}>✕ Deny</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { applyPaymentToInvoice, reversePaymentFromInvoice } from '../lib/invoiceSync'
import ClientLink from '../components/ClientLink'

export default function AccountsReceivable() {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all | scheduled | overdue | paid

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('payments')
      .select('*')
      .in('trade_type', ['1st Trade', '2nd Trade'])
      .order('scheduled_date', { ascending: true })
    if (data) setPayments(data)
    setLoading(false)
  }

  async function markPaid(p) {
    const paidDate = new Date().toISOString().slice(0, 10)
    const { error: payErr } = await supabase.from('payments').update({
      payment_status: 'Paid',
      status: 'Cleared',
      date: paidDate,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    if (payErr) return
    if (p.invNum) {
      try {
        await applyPaymentToInvoice(p.invNum, p.amount)
      } catch (invoiceErr) {
        await supabase.from('payments').update({
          payment_status: p.payment_status,
          status: p.status,
          date: p.date,
          updated_at: new Date().toISOString(),
        }).eq('id', p.id)
        return
      }
    }
    load()
  }

  async function unmarkPaid(p) {
    if (p.invNum) {
      try {
        await reversePaymentFromInvoice(p.invNum, p.amount)
      } catch {
        return
      }
    }
    const { error: payErr } = await supabase.from('payments').update({
      payment_status: 'Scheduled',
      status: 'Scheduled',
      date: null,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    if (payErr) {
      if (p.invNum) await applyPaymentToInvoice(p.invNum, p.amount).catch(()=>{})
      return
    }
    load()
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function resolveStatus(p) {
    if (p.payment_status === 'Paid') return 'Paid'
    if (!p.scheduled_date) return p.payment_status || 'Scheduled'
    const due = new Date(p.scheduled_date)
    due.setHours(0, 0, 0, 0)
    return due < today ? 'Overdue' : 'Scheduled'
  }

  const enriched = payments.map(p => ({ ...p, _status: resolveStatus(p) }))

  const filtered = enriched.filter(p => {
    if (filter === 'all') return true
    return p._status.toLowerCase() === filter
  })

  // Group by month
  function monthKey(p) {
    if (!p.scheduled_date) return 'Unscheduled'
    const d = new Date(p.scheduled_date)
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const grouped = {}
  filtered.forEach(p => {
    const k = monthKey(p)
    if (!grouped[k]) grouped[k] = []
    grouped[k].push(p)
  })

  // Sort months chronologically
  const sortedMonths = Object.keys(grouped).sort((a, b) => {
    if (a === 'Unscheduled') return 1
    if (b === 'Unscheduled') return -1
    return new Date(a) - new Date(b)
  })

  // Summary stats
  const totalScheduled = enriched.filter(p => p._status === 'Scheduled').reduce((s, p) => s + Number(p.amount || 0), 0)
  const totalOverdue   = enriched.filter(p => p._status === 'Overdue').reduce((s, p) => s + Number(p.amount || 0), 0)
  const totalPaid      = enriched.filter(p => p._status === 'Paid').reduce((s, p) => s + Number(p.amount || 0), 0)
  const total1st       = enriched.filter(p => p.trade_type === '1st Trade').reduce((s, p) => s + Number(p.amount || 0), 0)
  const total2nd       = enriched.filter(p => p.trade_type === '2nd Trade').reduce((s, p) => s + Number(p.amount || 0), 0)

  const fmt = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const statusStyle = {
    Paid:      { color: 'var(--ok)',   bg: 'rgba(34,197,94,.12)',  label: '✓ Paid' },
    Scheduled: { color: 'var(--blue)', bg: 'rgba(37,99,235,.12)',  label: '⏳ Scheduled' },
    Overdue:   { color: 'var(--bad)',  bg: 'rgba(239,68,68,.12)',  label: '⚠ Overdue' },
  }

  return (
    <div style={{padding:'20px 24px',maxWidth:1000,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',marginBottom:16}}>
        <div>
          <h2 style={{fontSize:17,fontWeight:700,margin:0}}>💳 Accounts Receivable</h2>
          <p style={{fontSize:12,color:'var(--t3)',margin:'4px 0 0'}}>Track installment plans, scheduled payments, and collections.</p>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Scheduled', value: fmt(totalScheduled), color: 'var(--blue)' },
          { label: 'Overdue',   value: fmt(totalOverdue),   color: 'var(--bad)' },
          { label: 'Collected', value: fmt(totalPaid),      color: 'var(--ok)' },
          { label: '1st Trade', value: fmt(total1st),       color: 'var(--t2)' },
          { label: '2nd Trade', value: fmt(total2nd),       color: 'var(--t2)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['all','All'],['scheduled','Scheduled'],['overdue','Overdue'],['paid','Paid']].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderColor: filter === v ? 'var(--blue)' : 'var(--br)',
              background: filter === v ? 'var(--blue)' : 'var(--s2)',
              color: filter === v ? '#fff' : 'var(--t2)' }}>
            {l}
          </button>
        ))}
        <button onClick={load} className="btn sec" style={{ marginLeft: 'auto', fontSize: 12 }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ color: 'var(--t3)', textAlign: 'center', padding: 40 }}>Loading…</div>}

      {!loading && sortedMonths.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>
          No AR entries yet. Create a 2nd Trade installment plan from a client's Payments tab.
        </div>
      )}

      {sortedMonths.map(month => {
        const rows = grouped[month]
        const monthTotal = rows.reduce((s, p) => s + Number(p.amount || 0), 0)
        const hasOverdue = rows.some(p => p._status === 'Overdue')

        return (
          <div key={month} className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
            {/* Month header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', background: 'var(--s2)', borderBottom: '1px solid var(--br)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--tx)' }}>{month}</span>
                {hasOverdue && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--bad)', background: 'rgba(239,68,68,.12)', padding: '2px 8px', borderRadius: 99 }}>⚠ Has Overdue</span>}
              </div>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--blue)' }}>{fmt(monthTotal)}</span>
            </div>

            {/* Payment rows */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--br)' }}>
                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Client</th>
                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Trade</th>
                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Due Date</th>
                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Amount</th>
                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Status</th>
                    <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Notes</th>
                    <th style={{ padding: '8px 16px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(p => {
                    const st = statusStyle[p._status] || statusStyle.Scheduled
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--br)' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13 }}>{p.clientName ? <ClientLink name={p.clientName} /> : '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                            background: p.trade_type === '1st Trade' ? 'rgba(37,99,235,.12)' : 'rgba(124,58,237,.12)',
                            color: p.trade_type === '1st Trade' ? 'var(--blue)' : '#7c3aed' }}>
                            {p.trade_type || '—'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--t2)' }}>
                          {p.scheduled_date ? new Date(p.scheduled_date + 'T12:00:00').toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13 }}>{fmt(p.amount)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                            background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--t3)' }}>{p.notes || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          {p._status !== 'Paid' ? (
                            <button className="btn sec" style={{ fontSize: 11, padding: '4px 10px' }}
                              onClick={() => markPaid(p)}>
                              Mark Paid
                            </button>
                          ) : (
                            <button className="btn sec" style={{ fontSize: 11, padding: '4px 10px', opacity: 0.8 }}
                              title="Reverses this payment and its invoice write-back"
                              onClick={() => unmarkPaid(p)}>
                              ↩ Undo
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

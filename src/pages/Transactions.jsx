import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { Link } from 'react-router-dom'
import { exportReportXlsx } from '../lib/reportExcelExport'

// Nashville parity candidate. The ledger is paginated on the server and is deliberately
// separate from confirmed positive collections. Requires the summary RPC migration.
const PAGE_SIZE = 100
const RETURNED = ['Refunded', 'Chk Returned', 'Chargeback']
const STATUS = ['Posted', 'Cleared', 'No Status', 'TBD', 'New Agmt', ...RETURNED, 'Disputed', 'FAIL']
const DRILLS = [
  { id: 'collected', label: 'Collected Transactions', key: 'collectedCount' },
  { id: 'amount', label: 'Total Collected', key: 'collectedAmount', money: true },
  { id: 'returned', label: 'Refunded / Returned', key: 'returnedCount' },
  { id: 'disputed', label: 'Disputed', key: 'disputedCount' },
  { id: 'failed', label: 'Failed Attempts', key: 'failedCount' },
]
const fmtMoney = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' }) : '—'

export default function Transactions() {
  const { user, myTenantId } = useApp()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [associate, setAssociate] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [drill, setDrill] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [summary, setSummary] = useState(null)
  const [associates, setAssociates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timeout)
  }, [searchInput])
  useEffect(() => setPage(0), [search, status, associate, dateFrom, dateTo, drill])

  useEffect(() => {
    if (!user || !myTenantId) return
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const tenant = myTenantId
        const safeSearch = search.replace(/[,%()]/g, ' ').trim()
        let query = supabase.from('payment_transactions')
          .select('id,client_id,client_name,payment_date,associate,amount,deposit_account,service_type,status,notes', { count: 'exact' })
          .eq('tenant_id', tenant)
        if (safeSearch) query = query.ilike('client_name', '%' + safeSearch + '%')
        if (associate !== 'all') query = query.eq('associate', associate)
        if (dateFrom) query = query.gte('payment_date', dateFrom)
        if (dateTo) query = query.lte('payment_date', dateTo)
        if (drill === 'collected' || drill === 'amount') query = query.in('status', ['Posted', 'Cleared']).gt('amount', 0)
        else if (drill === 'returned') query = query.in('status', RETURNED)
        else if (drill === 'disputed') query = query.eq('status', 'Disputed')
        else if (drill === 'failed') query = query.eq('status', 'FAIL')
        else if (status !== 'all') query = query.eq('status', status)
        const pageRequest = query.order('payment_date', { ascending: false })
          .order('id', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        const summaryRequest = supabase.rpc('tcr_transaction_summary', {
          p_tenant: tenant, p_search: safeSearch || null, p_associate: associate === 'all' ? null : associate,
          p_from: dateFrom || null, p_to: dateTo || null,
        })
        const [ledger, totals] = await Promise.all([pageRequest, summaryRequest])
        if (ledger.error) throw ledger.error
        if (totals.error) throw totals.error
        if (!active) return
        setRows(ledger.data || [])
        setCount(ledger.count || 0)
        setSummary(totals.data)
        // Associate discovery must not depend on the currently visible ledger page.
        if (!associates.length) {
          const { data: names, error: nameError } = await supabase.from('payment_transactions')
            .select('associate').eq('tenant_id', tenant).not('associate', 'is', null).limit(1000)
          if (!nameError && active) setAssociates([...new Set((names || []).map(v => v.associate).filter(Boolean))].sort())
        }
      } catch (e) {
        if (active) { setError(e?.message || 'Transactions could not be loaded'); setRows([]); setCount(0); setSummary(null) }
      } finally { if (active) setLoading(false) }
    }
    load()
    return () => { active = false }
  }, [user, myTenantId, search, status, associate, dateFrom, dateTo, drill, page, revision])

  async function exportExcel() {
    if (!myTenantId || loading || error || exporting) return
    setExporting(true); setExportError('')
    try {
      // Export the full filtered result, not just the visible 100-row page.
      // Cap exports to prevent a multi-minute memory spike in the browser.
      if (count > 25000) throw new Error('More than 25,000 matching records. Narrow the dates or filters before exporting.')
      const safeSearch = search.replace(/[,%()]/g, ' ').trim()
      const allRows = []
      for (let offset = 0; offset < count; offset += 1000) {
        let q = supabase.from('payment_transactions')
          .select('id,client_name,payment_date,associate,amount,deposit_account,service_type,status,notes')
          .eq('tenant_id', myTenantId)
        if (safeSearch) q = q.ilike('client_name','%' + safeSearch + '%')
        if (associate !== 'all') q = q.eq('associate', associate)
        if (dateFrom) q = q.gte('payment_date', dateFrom)
        if (dateTo) q = q.lte('payment_date', dateTo)
        if (drill === 'collected' || drill === 'amount') q = q.in('status',['Posted','Cleared']).gt('amount',0)
        else if (drill === 'returned') q = q.in('status', RETURNED)
        else if (drill === 'disputed') q = q.eq('status','Disputed')
        else if (drill === 'failed') q = q.eq('status','FAIL')
        else if (status !== 'all') q = q.eq('status',status)
        const result = await q.order('payment_date',{ascending:false}).order('id',{ascending:false})
          .range(offset,Math.min(count-1,offset+999))
        if (result.error) throw result.error
        allRows.push(...(result.data || []))
      }
      if (allRows.length !== count) throw new Error('The ledger changed during export. Refresh and retry to avoid an incomplete Excel file.')
      await exportReportXlsx({
        filename: 'transactions-' + (dateFrom || 'all') + '-to-' + (dateTo || 'all') + '.xlsx',
        sheetName: 'Transactions',
        headers: ['Date','Client','Associate','Amount','Deposit Account','Service','Status','Notes'],
        rows: allRows.map(t=>[t.payment_date,t.client_name,t.associate,Number(t.amount || 0),t.deposit_account,t.service_type,t.status,t.notes]),
        moneyColumns: [3],
      })
    } catch(e) { setExportError(e?.message || 'Excel export failed') }
    finally { setExporting(false) }
  }

  const clear = () => { setSearchInput(''); setSearch(''); setStatus('all'); setAssociate('all'); setDateFrom(''); setDateTo(''); setDrill(''); setPage(0) }
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const tileStyle = { background: 'var(--s2)', border: '1px solid var(--b1)', borderRadius: 12, padding: '14px 16px', color: 'var(--t1)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }
  const inputStyle = { padding: '8px 12px', borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--b1)', color: 'var(--t1)', fontFamily: 'inherit', minHeight: 38 }

  return <div style={{ padding: '24px 28px', maxWidth: '100%', overflowX: 'hidden' }}>
    <h1 style={{ fontSize: 22, margin: '0 0 4px', color: 'var(--t1)' }}>Transactions</h1>
    <p style={{ color: 'var(--t3)', fontSize: 13, margin: '0 0 20px' }}>Complete transaction ledger; collections include positive confirmed payments only.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 10, marginBottom: 16 }}>
      {DRILLS.map(card => <button key={card.id} type="button" aria-pressed={drill === card.id}
        onClick={() => { setDrill(drill === card.id ? '' : card.id); setStatus('all') }}
        style={{ ...tileStyle, outline: drill === card.id ? '2px solid var(--blue)' : 'none' }}>
        <div style={{ color: 'var(--t3)', fontSize: 11, marginBottom: 8 }}>{card.label}</div>
        <strong style={{ fontSize: 20 }}>{summary ? card.money ? fmtMoney(summary[card.key]) : Number(summary[card.key] || 0).toLocaleString() : '—'}</strong>
      </button>)}
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <input aria-label="Search client name" placeholder="Search client name" value={searchInput} onChange={e => setSearchInput(e.target.value)} style={{ ...inputStyle, flex: '1 1 180px' }}/>
      <select aria-label="Transaction status" value={status} onChange={e => { setStatus(e.target.value); setDrill('') }} style={inputStyle}>
        <option value="all">All statuses</option>{STATUS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select aria-label="Associate" value={associate} onChange={e => setAssociate(e.target.value)} style={inputStyle}>
        <option value="all">All associates</option>{associates.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <input aria-label="Date from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle}/>
      <input aria-label="Date to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle}/>
      <button type="button" onClick={clear} style={inputStyle}>Clear filters</button>
      <button type="button" onClick={exportExcel} disabled={loading || exporting || !!error || count === 0} style={inputStyle} aria-label="Export filtered transactions to Excel">{exporting?'Exporting…':'Export to Excel (.xlsx)'}</button>
    </div>
    {drill && <p role="status" style={{ color: 'var(--t2)' }}>Showing {DRILLS.find(d => d.id === drill)?.label} — <button onClick={() => setDrill('')}>Clear drill-down</button></p>}
    {exportError && <div role="alert" style={{color:'#ef4444',marginBottom:12}}>{exportError}</div>}
    {error && <div role="alert" style={{ padding: 18, border: '1px solid #ef4444', borderRadius: 8, marginBottom: 12, color: 'var(--t1)' }}>
      Transactions unavailable: {error} <button onClick={() => setRevision(v => v + 1)}>Retry</button>
    </div>}
    <p aria-live="polite" style={{ color: 'var(--t3)', fontSize: 12 }}>{loading ? 'Loading…' : error ? 'Could not retrieve totals' : count.toLocaleString() + ' ledger records matched'}</p>
    <div style={{ overflowX: 'auto', border: '1px solid var(--b1)', borderRadius: 12 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 900, width: '100%', fontSize: 13 }}>
        <thead><tr>{['Date','Client','Associate','Amount','Deposit Acct','Service','Status','Notes'].map(s =>
          <th key={s} scope="col" style={{ padding: 12, textAlign: 'left', color: 'var(--t2)', borderBottom: '1px solid var(--b1)' }}>{s}</th>)}</tr></thead>
        <tbody>{rows.map(t => <tr key={t.id} style={{ borderBottom: '1px solid var(--b1)' }}>
          <td style={{ padding: 12, whiteSpace: 'nowrap' }}>{fmtDate(t.payment_date)}</td>
          <td style={{ padding: 12 }}>{t.client_id ? <Link to={'/clients/' + encodeURIComponent(t.client_id)} style={{ color: 'var(--blue)', fontWeight: 600 }}>{t.client_name || 'Open client'}</Link> : (t.client_name || '—')}</td><td style={{ padding: 12 }}>{t.associate || '—'}</td>
          <td style={{ padding: 12, whiteSpace: 'nowrap' }}>{fmtMoney(t.amount)}</td>
          <td style={{ padding: 12 }}>{t.deposit_account || '—'}</td><td style={{ padding: 12 }}>{t.service_type || '—'}</td>
          <td style={{ padding: 12 }}>{t.status || 'No Status'}</td><td style={{ padding: 12 }}>{t.notes || '—'}</td>
        </tr>)}
        {!rows.length && !loading && <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center' }}>{error ? 'Could not load records' : 'No matching records'}</td></tr>}
        </tbody>
      </table>
    </div>
    <nav aria-label="Transaction pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
      <button disabled={loading || page === 0} onClick={() => setPage(v => Math.max(0, v - 1))}>Previous</button>
      <span>Page {page + 1} of {totalPages}</span>
      <button disabled={loading || page + 1 >= totalPages} onClick={() => setPage(v => v + 1)}>Next</button>
    </nav>
  </div>
}

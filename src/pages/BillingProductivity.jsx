import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/money'
import { exportReportXlsx } from '../lib/reportExcelExport'

const easternDate = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
function dateRange(period) {
  const today = easternDate(new Date())
  const start = new Date(today + 'T12:00:00Z')
  if (period === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  if (period === 'month') start.setUTCDate(1)
  return { start_on: start.toISOString().slice(0,10), end_on: today }
}
const card = { background:'var(--s2)',border:'1px solid var(--br)',borderRadius:10,padding:'12px 14px' }
const control = { width:'100%',minHeight:42,boxSizing:'border-box',padding:'8px 12px',border:'1px solid var(--br)',borderRadius:8,background:'var(--s2)',color:'var(--tx)' }

export default function BillingProductivity() {
  const [period,setPeriod] = useState('week')
  const [search,setSearch] = useState('')
  const [data,setData] = useState([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [revision,setRevision] = useState(0)
  const [exporting,setExporting] = useState(false)
  const [exportError,setExportError] = useState('')
  useEffect(() => {
    let active = true
    const fetchReport = async () => {
      setLoading(true); setError('')
      const result = await supabase.rpc('billing_productivity_report',dateRange(period))
      if(!active) return
      if(result.error){setError(result.error.message);setData([])} else setData(result.data || [])
      setLoading(false)
    }
    fetchReport()
    return () => {active = false}
  },[period,revision])
  const rows = useMemo(()=>data.filter(r=>String(r.staff_name || '').toLowerCase().includes(search.trim().toLowerCase())),[data,search])
  const totals = useMemo(()=>rows.reduce((a,r)=>({
    entries:a.entries+Number(r.entries||0),hours:a.hours+Number(r.hours||0),
    recorded:a.recorded+Number(r.recorded||0),billed:a.billed+Number(r.billed||0)
  }),{entries:0,hours:0,recorded:0,billed:0}),[rows])
  const exportExcel = async () => {
    if (loading || error || exporting) return
    setExporting(true); setExportError('')
    try {
      const range = dateRange(period)
      const exportRows = rows.map(r => [
        r.work_date, r.staff_name, Number(r.entries || 0), Number(r.hours || 0),
        Number(r.recorded || 0), Number(r.billed || 0),
      ])
      exportRows.push(['TOTAL', '', totals.entries, totals.hours, totals.recorded, totals.billed])
      await exportReportXlsx({
        filename: 'employee-productivity-' + range.start_on + '-to-' + range.end_on + '.xlsx',
        sheetName: 'Employee Productivity',
        headers: ['Date', 'Employee', 'Entries', 'Hours', 'Recorded', 'Billed'],
        rows: exportRows, decimalColumns: [3], moneyColumns: [4,5],
      })
    } catch (e) {
      setExportError(e?.message || 'Excel export failed')
    } finally { setExporting(false) }
  }
  return <section aria-label="Employee Productivity" style={{...card,marginBottom:16,padding:16}}>
    <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:12}}>
      <div><h3 style={{margin:0,color:'var(--tx)'}}>Employee Productivity</h3><p style={{margin:'4px 0',fontSize:12,color:'var(--t3)'}}>Authorized employee time and billing activity</p></div>
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        <button type="button" className="btn sec" disabled={loading || !!error || exporting || !rows.length} onClick={exportExcel} aria-label="Export employee productivity report to Excel">{exporting?'Preparing Excel…':'Export to Excel (.xlsx)'}</button>
        <button type="button" className="btn sec" disabled={loading} onClick={()=>setRevision(n=>n+1)}>↻ {loading?'Loading…':'Refresh'}</button>
      </div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,230px),1fr))',gap:10,marginBottom:12}}>
      <label style={{fontSize:12,color:'var(--t2)'}}>Employee search<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search employees" style={control}/></label>
      <label style={{fontSize:12,color:'var(--t2)'}}>Reporting period<select value={period} onChange={e=>setPeriod(e.target.value)} style={control}>
        <option value="day">Today</option><option value="week">This week (Monday–Sunday)</option><option value="month">This month</option>
      </select></label>
    </div>
    {exportError && <p role="alert" style={{color:'#ef4444'}}>{exportError}</p>}
    {error ? <div role="alert" style={{...card,borderColor:'#ef4444'}}>Could not load Employee Productivity: {error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button></div> : <>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(125px,1fr))',gap:10,marginBottom:12}} aria-live="polite">
        {[['Time entries',totals.entries],['Total hours',totals.hours.toFixed(2)+'h'],['Recorded',formatMoney(totals.recorded)],['Billed',formatMoney(totals.billed)]].map(([label,val])=><div key={label} style={card}><div style={{fontSize:11,color:'var(--t3)'}}>{label}</div><strong style={{fontSize:19,color:'var(--tx)'}}>{loading?'—':val}</strong></div>)}
      </div>
      {loading ? <p role="status">Loading productivity report…</p> : rows.length ?
      <div style={{overflowX:'auto',maxWidth:'100%',border:'1px solid var(--br)',borderRadius:9}}><table style={{borderCollapse:'collapse',minWidth:630,width:'100%',fontSize:12}}>
        <thead><tr>{['Date','Employee','Entries','Hours','Recorded','Billed'].map(h=><th key={h} scope="col" style={{padding:10,textAlign:'left',background:'var(--s2)',color:'var(--t2)'}}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r=><tr key={r.work_date+'|'+r.staff_name}>{[r.work_date,r.staff_name,r.entries,Number(r.hours||0).toFixed(2),formatMoney(r.recorded),formatMoney(r.billed)].map((x,i)=><td key={i} style={{padding:10,borderTop:'1px solid var(--br)',color:'var(--tx)',whiteSpace:'nowrap'}}>{x}</td>)}</tr>)}</tbody>
      </table></div> : <p style={{fontSize:13,color:'var(--t3)'}}>{search?'No employees match the search.':'No time entries for this period.'}</p>}
    </>}
  </section>
}

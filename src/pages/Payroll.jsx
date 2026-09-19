import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import PayrollStatCards from '../components/PayrollStatCards'
import { hoursFromEntry, buildLineItems, currentPeriod } from '../lib/payrollUtils'
import { useApp } from '../context/AppContext'

const PAY_METHODS = ['Direct Deposit','Check','Cash']

// Small stat block used in Pay Stubs cards
function Stat({ label, value, color, bold, big }) {
  return (
    <div style={{ textAlign:'right', minWidth:60 }}>
      <div style={{ fontSize:9, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize: big?15:12, fontWeight: bold?800:600, color: color||'var(--tx)' }}>{value}</div>
    </div>
  )
}

export default function Payroll() {
  const { role, employeeName } = useApp()
  const isPrivileged = ['Super Admin','Admin','Manager'].includes(role)

  const [runs,       setRuns]       = useState([])
  const [employees,  setEmployees]  = useState([])
  const [timeEntries,setTimeEntries]= useState([])
  const [confirmDel, setConfirmDel] = useState(null)
  const [modal,      setModal]      = useState(false)
  const [detailId,   setDetailId]   = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [toast,      setToast]      = useState('')
  const [search,     setSearch]     = useState('')

  // Pay period form state
  const today = new Date()
  const [periodLabel, setPeriodLabel] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd,   setPeriodEnd]   = useState('')
  const [payDate,     setPayDate]     = useState('')
  const [notes,       setNotes]       = useState('')
  const [lineItems,   setLineItems]   = useState([])
  const [activeTab,   setActiveTab]   = useState('payroll')
  const [firm,        setFirm]        = useState(null)   // settings row → pay stub letterhead

  // Edit punch modal state (so you can fix time entries right from Payroll)
  const [editPunch,       setEditPunch]       = useState(null)
  const [editPunchForm,   setEditPunchForm]   = useState({ employee:'', date:'', inTime:'', outTime:'', hours:'', notes:'' })
  const [editPunchSaving, setEditPunchSaving] = useState(false)
  const [deletePunchId,   setDeletePunchId]   = useState(null)
  const [teSearch,        setTeSearch]        = useState('')
  const [teFilterEmp,     setTeFilterEmp]     = useState('All')

  useEffect(() => {
    load()
    let reloadTimer = null
    const timeCh = supabase.channel('payroll-timeentries-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'timeentries' }, () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(loadTimeEntries, 300)
      })
      .subscribe()
    const empCh = supabase.channel('payroll-employees-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'employees' }, () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(loadEmployees, 300)
      })
      .subscribe()
    return () => {
      clearTimeout(reloadTimer)
      supabase.removeChannel(timeCh)
      supabase.removeChannel(empCh)
    }
  }, [])

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('*').eq('status','Active').order('name')
    if (data) setEmployees(data)
  }

  async function loadTimeEntries() {
    const jan1 = `${new Date().getFullYear()}-01-01`
    const { data } = await supabase.from('timeentries').select('*')
      .gte('date', jan1)
      .order('date',{ascending:false})
      .limit(30000)
    if (data) setTimeEntries(data)
  }

  async function load() {
    const [{ data:r },{ data:s }] = await Promise.all([
      supabase.from('payrollruns').select('*').order('created_at',{ascending:false}).limit(250),
      supabase.from('settings').select('name,phone,email,address,city,state,zip,logourl').limit(1).maybeSingle(),
    ])
    if (r) setRuns(r)
    if (s) setFirm(s)
    await Promise.all([loadEmployees(),loadTimeEntries()])
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(''),3000) }

  // TimeClock helpers (same logic as TimeClock.jsx)
  function parseTimeToMinsLocal(t) {
    if (!t) return null; t = t.trim()
    const ampm = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
    if (ampm) { let h=parseInt(ampm[1]),m=parseInt(ampm[2]); if(ampm[3].toUpperCase()==='PM'&&h!==12)h+=12; if(ampm[3].toUpperCase()==='AM'&&h===12)h=0; return h*60+m }
    const plain = t.match(/^(\d+):(\d+)$/); if(plain) return parseInt(plain[1])*60+parseInt(plain[2]); return null
  }
  function calcHoursLocal(inT, outT) {
    const inM=parseTimeToMinsLocal(inT),outM=parseTimeToMinsLocal(outT)
    if(inM===null||outM===null) return ''
    let d=outM-inM; if(d<=0)d+=24*60; return (d/60).toFixed(2)
  }
  function fmt12Local(t) {
    if(!t) return '—'; if(t.match(/AM|PM/i)) return t
    const [h,m]=t.split(':').map(Number); const ap=h>=12?'PM':'AM'; const hr=h%12||12
    return `${hr}:${String(m).padStart(2,'0')} ${ap}`
  }

  function openEditPunch(e) {
    setEditPunch(e)
    setEditPunchForm({ employee:e.employee||'', date:e.date||'', inTime:e.inTime||'', outTime:e.outTime||'', hours:e.hours||'', notes:e.notes||'' })
  }
  async function saveEditPunch() {
    if (!editPunch) return
    setEditPunchSaving(true)
    const hours = calcHoursLocal(editPunchForm.inTime, editPunchForm.outTime) || (editPunchForm.hours ? parseFloat(editPunchForm.hours) : null)
    const { error } = await supabase.from('timeentries').update({
      employee: editPunchForm.employee, date: editPunchForm.date,
      inTime: editPunchForm.inTime, outTime: editPunchForm.outTime,
      hours: hours ? parseFloat(hours) : null, notes: editPunchForm.notes,
    }).eq('id', editPunch.id)
    setEditPunchSaving(false)
    if (error) { showToast('Error: '+error.message); return }
    showToast('✅ Punch updated!')
    setEditPunch(null); load()
  }
  async function deleteEditPunch(id) {
    const { error } = await supabase.from('timeentries').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); setDeletePunchId(null); return }
    setDeletePunchId(null); showToast('Deleted'); load()
  }

  function openNewRun() {
    const { start, end, label } = currentPeriod(today)
    setPeriodLabel(label)
    setPeriodStart(start)
    setPeriodEnd(end)
    setPayDate(new Date(new Date(end).getTime() + 2*24*60*60*1000).toISOString().slice(0,10))
    setNotes('')
    setLineItems(buildLineItems(employees, timeEntries, start, end))
    setModal(true)
  }

  // Recompute line items when date range changes
  function onRangeChange(start, end) {
    if (start && end) setLineItems(buildLineItems(employees, timeEntries, start, end))
  }

  // Keep the open "Process Payroll" modal in sync with live TimeClock + employee data
  useEffect(() => {
    if (modal && periodStart && periodEnd) {
      setLineItems(buildLineItems(employees, timeEntries, periodStart, periodEnd))
    }
  }, [timeEntries, employees])

  function updateLine(i, k, v) {
    setLineItems(lines => lines.map((l,idx) => {
      if (idx!==i) return l
      const u = {...l, [k]:v}
      if (['gross','fedTax','stateTax','ss','medicare'].includes(k)) {
        const g=parseFloat(u.gross||0), ft=parseFloat(u.fedTax||0), st=parseFloat(u.stateTax||0), s=parseFloat(u.ss||0), m=parseFloat(u.medicare||0)
        const tt=ft+st+s+m; u.totalTaxes=tt.toFixed(2); u.net=Math.max(0,g-tt).toFixed(2)
      }
      if (k==='hours' && l.payType==='Hourly') {
        const g=parseFloat(l.rate||0)*parseFloat(v||0)
        const ft=g*0.22, st=g*0.06, ss=g*0.062, med=g*0.0145, tt=ft+st+ss+med
        u.gross=g.toFixed(2); u.fedTax=ft.toFixed(2); u.stateTax=st.toFixed(2)
        u.ss=ss.toFixed(2); u.medicare=med.toFixed(2); u.totalTaxes=tt.toFixed(2); u.net=Math.max(0,g-tt).toFixed(2)
      }
      return u
    }))
  }

  async function saveRun() {
    if (!periodLabel) { showToast('Pay period required'); return }
    setSaving(true)
    const grossPay   = lineItems.reduce((s,l)=>s+parseFloat(l.gross||0),0)
    const totalTaxes = lineItems.reduce((s,l)=>s+parseFloat(l.totalTaxes||0),0)
    const netPay     = lineItems.reduce((s,l)=>s+parseFloat(l.net||0),0)
    const { error } = await supabase.from('payrollruns').insert([{
      period: periodLabel, payDate, notes,
      grossPay: grossPay.toFixed(2), totalTaxes: totalTaxes.toFixed(2),
      netPay: netPay.toFixed(2), numEmployees: lineItems.length,
      status: 'Completed', lineItems: JSON.stringify(lineItems),
      created_at: new Date().toISOString()
    }])
    setSaving(false)
    if (error) { showToast('Error: '+error.message); return }
    showToast('✅ Payroll run saved!')
    setModal(false); load()
  }

  async function del(id) { setConfirmDel(id) }
  async function confirmDel2() {
    const { error } = await supabase.from('payrollruns').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setConfirmDel(null); showToast('Deleted'); load()
  }

  const totalNet   = runs.reduce((s,r)=>s+parseFloat(r.netPay||0),0)
  const totalGross = runs.reduce((s,r)=>s+parseFloat(r.grossPay||0),0)
  const ytdGross   = runs.filter(r=>r.payDate?.startsWith(today.getFullYear().toString())).reduce((s,r)=>s+parseFloat(r.grossPay||0),0)
  const filtered   = runs.filter(r=>!search || r.period?.toLowerCase().includes(search.toLowerCase()))
  const detail     = detailId ? runs.find(r=>r.id===detailId) : null
  let detailLines  = []
  if (detail?.lineItems) { try { detailLines = JSON.parse(detail.lineItems) } catch {} }

  // YTD per employee — estimated directly from actual logged hours (same
  // math as the Pay Stubs tab), not just from officially processed payroll
  // runs. Runs-only showed $0 for everyone whenever payroll hadn't been
  // formally processed yet, even when real punches existed — buildLineItems
  // already buckets by ISO week internally so OT still comes out correct
  // across a wide Jan-1-to-today range.
  const jan1 = `${today.getFullYear()}-01-01`
  const todayStr = today.toISOString().slice(0,10)
  const ytdLines = buildLineItems(employees, timeEntries, jan1, todayStr)
  const ytdByEmp = {}
  ytdLines.forEach(l => { ytdByEmp[l.name] = { gross: parseFloat(l.gross||0), net: parseFloat(l.net||0) } })

  const empNames = employees.length>0 ? employees.map(e=>e.name) : ['Romy Cruz','Dana Richard','Yesenia Gonzalez']

  // Pay Stubs tab: current-period breakdown per employee
  const { start: curStart, end: curEnd, label: curLabel } = currentPeriod(today)
  const stubLines = buildLineItems(employees, timeEntries, curStart, curEnd)

  // Firm letterhead shared by both pay-stub print paths — logo from the
  // firm-assets bucket + name/address/phone from Settings. Falls back to the
  // firm name alone if settings hasn't loaded yet.
  const LH_CSS = `
    .lh{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1e3a8a;padding-bottom:14px;margin-bottom:18px}
    .lh img{max-height:52px;max-width:170px;object-fit:contain}
    .lh-name{font-size:17px;font-weight:800;color:#1e3a8a;letter-spacing:.02em}
    .lh-line{font-size:11px;color:#64748b;margin-top:2px}`
  function firmLetterhead() {
    const logoSrc = firm?.logourl || ''
    const name  = firm?.name || 'Tax Case Review'
    const addr1 = firm?.address || ''
    const cityLine = [firm?.city, firm?.state].filter(Boolean).join(', ')
    const addr2 = `${cityLine}${firm?.zip ? ' ' + firm.zip : ''}`.trim()
    const contact = [firm?.phone, firm?.email].filter(Boolean).join(' · ')
    return `<div class="lh">
      <img src="${logoSrc}" alt="" onerror="this.style.display='none'"/>
      <div>
        <div class="lh-name">${name}</div>
        ${addr1 ? `<div class="lh-line">${addr1}</div>` : ''}
        ${addr2 ? `<div class="lh-line">${addr2}</div>` : ''}
        ${contact ? `<div class="lh-line">${contact}</div>` : ''}
      </div>
    </div>`
  }

  function printStub(l) {
    const w = window.open('', '_blank')
    w.document.write(`
      <html><head><title>Pay Stub — ${l.name}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:30px;color:#1a1a1a}
        ${LH_CSS}
        h1{font-size:16px;margin:0 0 4px;color:#1e3a8a;letter-spacing:.06em;text-transform:uppercase}
        .sub{color:#666;font-size:12px;margin-bottom:20px}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-top:14px}
        td,th{padding:8px 10px;border-bottom:1px solid #ddd;text-align:left}
        th{color:#666;font-weight:600;font-size:11px;text-transform:uppercase}
        .net{font-weight:800;font-size:16px;color:#16a34a}
        .bad{color:#dc2626}
      </style></head><body>
        ${firmLetterhead()}
        <h1>Pay Stub</h1>
        <div class="sub">${l.name} · ${l.payType} · Period: ${curLabel}</div>
        <table>
          <tr><th>Item</th><th>Hours</th><th>Amount</th></tr>
          <tr><td>Regular Pay</td><td>${l.regularHours}h</td><td>$${(l.payType==='Hourly' ? (parseFloat(l.regularHours)*l.rate) : (parseFloat(l.gross)-parseFloat(l.otHours)*l.rate*1.5)).toFixed(2)}</td></tr>
          <tr><td>Overtime Pay (1.5x)</td><td>${l.otHours}h</td><td>$${(parseFloat(l.otHours)*l.rate*1.5).toFixed(2)}</td></tr>
          <tr><td><strong>Gross Pay</strong></td><td>${l.hours}h</td><td><strong>$${parseFloat(l.gross).toLocaleString()}</strong></td></tr>
          <tr><td>Federal Tax</td><td></td><td class="bad">-$${l.fedTax}</td></tr>
          <tr><td>State Tax</td><td></td><td class="bad">-$${l.stateTax}</td></tr>
          <tr><td>Social Security</td><td></td><td class="bad">-$${l.ss}</td></tr>
          <tr><td>Medicare</td><td></td><td class="bad">-$${l.medicare}</td></tr>
          <tr><td colspan="2" class="net">Net Pay</td><td class="net">$${parseFloat(l.net).toLocaleString()}</td></tr>
        </table>
        <p style="margin-top:30px;font-size:11px;color:#999">Payment Method: ${l.payMethod}</p>
      </body></html>
    `)
    w.document.close()
    w.print()
  }

  // Anyone below Manager/Admin/Super Admin only ever sees their own pay —
  // never the full company payroll, run history, or other employees' data.
  if (!isPrivileged) {
    const me = employees.find(e => (e.name||'').trim().toLowerCase() === (employeeName||'').trim().toLowerCase())
    const myEntries = timeEntries.filter(t => (t.employee||'').trim().toLowerCase() === (employeeName||'').trim().toLowerCase())
    const { start: curStart2, end: curEnd2, label: curLabel2 } = currentPeriod(today)
    const myLine = me ? buildLineItems([me], myEntries, curStart2, curEnd2)[0] : null
    const jan1b = `${today.getFullYear()}-01-01`
    const todayStr2 = today.toISOString().slice(0,10)
    const myYtd = me ? buildLineItems([me], myEntries, jan1b, todayStr2)[0] : null
    const recentEntries = myEntries.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,20)

    return (
      <div>
        {toast && <div className="toast show">{toast}</div>}
        <h2 style={{ fontSize:15, fontWeight:700, margin:'0 0 14px' }}>💼 My Pay</h2>

        {!me ? (
          <div className="card" style={{ padding:24, textAlign:'center', color:'var(--t3)' }}>
            No employee record found matching your account. Contact an admin to get linked up.
          </div>
        ) : (<>
          <div style={{ fontSize:12, color:'var(--t3)', marginBottom:10 }}>
            Current pay period: <strong style={{color:'var(--tx)'}}>{curLabel2}</strong>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:8, marginBottom:14 }}>
            {[
              ['Regular Hrs', myLine?.regularHours+'h', '#22c55e'],
              ['Overtime Hrs', myLine?.otHours+'h', '#f59e0b'],
              ['Gross Pay', '$'+(myLine?parseFloat(myLine.gross).toLocaleString():'0'), '#A78BFA'],
              ['Net Pay', '$'+(myLine?parseFloat(myLine.net).toLocaleString():'0'), '#22c55e'],
              ['YTD Gross', '$'+(myYtd?Math.round(parseFloat(myYtd.gross)).toLocaleString():'0'), 'var(--warn)'],
            ].map(([l,v,c])=>(
              <div key={l} className="card" style={{ padding:'12px 14px' }}>
                <div style={{ fontWeight:800, fontSize:18, color:c }}>{v}</div>
                <div style={{ fontSize:10, color:'var(--t3)', marginTop:3, textTransform:'uppercase', letterSpacing:'.05em' }}>{l}</div>
              </div>
            ))}
          </div>

          {myLine && (
            <div className="card" style={{ marginBottom:14, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', marginBottom:10 }}>This Period — Breakdown</div>
              <div style={{ display:'flex', gap:22, flexWrap:'wrap' }}>
                <Stat label="Fed Tax" value={'-$'+myLine.fedTax} color="var(--bad)" />
                <Stat label="State Tax" value={'-$'+myLine.stateTax} color="var(--bad)" />
                <Stat label="SS" value={'-$'+myLine.ss} color="var(--bad)" />
                <Stat label="Medicare" value={'-$'+myLine.medicare} color="var(--bad)" />
                <Stat label="Net Pay" value={'$'+parseFloat(myLine.net).toLocaleString()} color="var(--ok)" bold big />
                <button className="btn sec" style={{ fontSize:11, padding:'6px 14px' }} onClick={()=>printStub(myLine)}>🖨️ Stub</button>
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', marginBottom:10 }}>My Punch History</div>
            {recentEntries.length===0 ? (
              <div style={{ padding:20, textAlign:'center', color:'var(--t3)', fontSize:13 }}>No punches on file yet.</div>
            ) : (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--br)' }}>
                    {['Date','Clock In','Clock Out','Hours'].map(h=>(
                      <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.map(e=>(
                    <tr key={e.id} style={{ borderBottom:'1px solid var(--br)' }}>
                      <td style={{ padding:'8px 10px', color:'var(--t2)' }}>{e.date}</td>
                      <td style={{ padding:'8px 10px', color:'var(--ok)', fontWeight:600 }}>{e.inTime||'—'}</td>
                      <td style={{ padding:'8px 10px', color:'var(--t2)' }}>{e.outTime||'—'}</td>
                      <td style={{ padding:'8px 10px', fontWeight:700, color:'#38BDF8' }}>{e.hours?e.hours+'h':'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}
      </div>
    )
  }

  const [periodOffset, setPeriodOffset] = useState(0) // 0 = current, -1 = prev, etc.

  // Navigate to an offset period from today
  function getPeriodByOffset(offset) {
    const d = new Date()
    // Each offset = half-month step
    let month = d.getMonth(), year = d.getFullYear()
    let isFirst = d.getDate() <= 15
    let steps = isFirst ? 0 : 1  // 0=first half of current month, 1=second half
    steps += offset
    // Normalize
    let totalHalves = year * 24 + month * 2 + steps
    const newYear = Math.floor(totalHalves / 24)
    const rem = totalHalves % 24
    const newMonth = Math.floor(rem / 2)
    const newIsFirst = rem % 2 === 0
    const start = new Date(newYear, newMonth, newIsFirst ? 1 : 16)
    const end = new Date(newYear, newMonth, newIsFirst ? 15 : new Date(newYear, newMonth + 1, 0).getDate())
    const fmt = dt => dt.toISOString().slice(0,10)
    const label = `${start.toLocaleString('default',{month:'short'})} ${start.getDate()} – ${end.toLocaleString('default',{month:'short'})} ${end.getDate()}, ${newYear}`
    return { start: fmt(start), end: fmt(end), label }
  }

  const navPeriod = getPeriodByOffset(periodOffset)

  function exportCSV() {
    const filtered = timeEntries.filter(e => e.date >= navPeriod.start && e.date <= navPeriod.end)
    const rows = [['Employee','Date','Clock In','Clock Out','Hours','Method'], ...filtered.map(e=>[e.employee||'',e.date||'',e.inTime||'',e.outTime||'',e.hours||'',e.method||'Manual'])]
    const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], {type:'text/csv'})
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `payroll-${navPeriod.start}-to-${navPeriod.end}.csv`; a.click()
  }

  function printAllStubs() {
    const lines = buildLineItems(employees, timeEntries.filter(e=>e.date>=navPeriod.start&&e.date<=navPeriod.end), navPeriod.start, navPeriod.end)
    if (!lines.length) { showToast('No data for this period'); return }
    const w = window.open('','_blank')
    const lh = firmLetterhead()
    w.document.write(`<!DOCTYPE html><html><head><title>Pay Stubs — ${navPeriod.label}</title>
      <style>body{font-family:Arial,sans-serif;margin:0;padding:0}
      ${LH_CSS}
      .stub{border:1px solid #ccc;padding:24px 32px;margin:20px auto;max-width:680px;page-break-after:always}
      h2{color:#1e3a8a;margin:0 0 4px}h3{margin:0 0 16px;color:#64748b;font-weight:400}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      td,th{padding:7px 10px;border:1px solid #e2e8f0;font-size:13px}th{background:#f1f5f9;font-size:11px;text-transform:uppercase}
      .total{font-weight:700;font-size:15px;color:#16a34a}.net{font-size:18px;font-weight:800;color:#16a34a}
      @media print{.stub{page-break-after:always;margin:0;border:none}}</style></head><body>
      ${lines.map(l=>`<div class="stub">
        ${lh}<h3>Pay Stub — ${navPeriod.label}</h3>
        <table><tr><th>Employee</th><th>Pay Type</th><th>Hours</th><th>Rate</th><th>Gross</th></tr>
        <tr><td>${l.name}</td><td>${l.payType}</td><td>${l.hours}</td><td>$${l.rate||'—'}/hr</td><td>$${parseFloat(l.gross||0).toFixed(2)}</td></tr></table>
        <table style="margin-top:12px"><tr><th>Federal Tax</th><th>State Tax</th><th>SS</th><th>Medicare</th><th>Total Deductions</th></tr>
        <tr><td>-$${parseFloat(l.fedTax||0).toFixed(2)}</td><td>-$${parseFloat(l.stateTax||0).toFixed(2)}</td>
        <td>-$${parseFloat(l.ss||0).toFixed(2)}</td><td>-$${parseFloat(l.medicare||0).toFixed(2)}</td>
        <td>-$${parseFloat(l.totalTaxes||0).toFixed(2)}</td></tr></table>
        <div style="text-align:right;margin-top:16px;padding-top:12px;border-top:2px solid #1e3a8a">
          <span class="net">Net Pay: $${parseFloat(l.net||0).toFixed(2)}</span></div>
      </div>`).join('')}
      </body></html>`)
    w.document.close(); setTimeout(()=>w.print(), 300)
  }

  return (
    <div style={{padding:'20px 24px', maxWidth:1100, margin:'0 auto'}}>
      {toast && <div className="toast show">{toast}</div>}

      {/* PHL-style header: period nav + Export CSV + Print All Stubs */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={()=>setPeriodOffset(o=>o-1)} className="btn sec" style={{ padding:'5px 10px', fontSize:14 }}>‹</button>
          <span style={{ fontSize:13, color:'var(--t2)', minWidth:160, textAlign:'center', fontWeight:600 }}>{navPeriod.label}</span>
          <button onClick={()=>setPeriodOffset(o=>Math.min(o+1,0))} className="btn sec" style={{ padding:'5px 10px', fontSize:14 }} disabled={periodOffset>=0}>›</button>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn sec" onClick={exportCSV} style={{ fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
            🗂 Export CSV
          </button>
          <button className="btn ok" onClick={printAllStubs} style={{ fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
            🖨️ Print All Stubs
          </button>
          <button className="btn pri" onClick={openNewRun} disabled={employees.length===0} style={{ fontSize:12 }}>
            {employees.length===0 ? 'Add Employees First' : '+ Process Payroll'}
          </button>
        </div>
      </div>

      <PayrollStatCards employees={employees} timeEntries={timeEntries} />

      {/* Tab Bar — matches PHL CRM layout */}
      <div style={{ display:'flex', gap:0, marginBottom:16, borderBottom:'1px solid var(--br)' }}>
        {[['today',"Today's Log"],['payroll','Payroll'],['stubs','Pay Stubs'],['punch','Punch History']].map(([k,l]) => (
          <button key={k} onClick={()=>setActiveTab(k)}
            style={{ padding:'10px 20px', border:'none', borderBottom: activeTab===k?'2px solid var(--blue)':'2px solid transparent',
              background:'none', cursor:'pointer', fontSize:13, fontWeight:activeTab===k?700:500,
              color:activeTab===k?'var(--blue)':'var(--t2)', whiteSpace:'nowrap' }}>
            {l}
          </button>
        ))}
      </div>

      {activeTab==='payroll' && (<>

      {/* Run totals at a glance */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:8, marginBottom:14 }}>
        {[
          ['Total Net Paid', '$'+Math.round(totalNet).toLocaleString(), 'var(--ok)'],
          ['Total Gross',    '$'+Math.round(totalGross).toLocaleString(), '#A78BFA'],
          ['YTD Gross',      '$'+Math.round(ytdGross).toLocaleString(), 'var(--warn)'],
          ['Payroll Runs',   runs.length, 'var(--tx)'],
        ].map(([l,v,c]) => (
          <div key={l} className="card" style={{ padding:'12px 14px' }}>
            <div style={{ fontWeight:800, fontSize:18, color:c }}>{v}</div>
            <div style={{ fontSize:10, color:'var(--t3)', marginTop:3, textTransform:'uppercase', letterSpacing:'.05em' }}>{l}</div>
          </div>
        ))}
      </div>

      {/* YTD per employee */}
      <div className="card" style={{ marginBottom:14, padding:'12px 16px' }}>
        <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', marginBottom:10 }}>YTD by Employee <span style={{ textTransform:'none', fontWeight:400, letterSpacing:0 }}>— estimated from logged hours</span></div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:10 }}>
          {empNames.map(name => {
            const y = ytdByEmp[name] || {gross:0,net:0}
            // Hours from time entries this year
            const yHrs = timeEntries.filter(t=>t.employee===name&&t.date?.startsWith(today.getFullYear().toString())).reduce((s,t)=>s+hoursFromEntry(t),0)
            return (
              <div key={name} style={{ background:'var(--s2)', borderRadius:8, padding:'10px 12px', border:'1px solid var(--br)' }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>{name}</div>
                <div style={{ display:'flex', gap:12, fontSize:12 }}>
                  <span style={{ color:'var(--t3)' }}>Gross: <span style={{ color:'#A78BFA', fontWeight:700 }}>${Math.round(y.gross).toLocaleString()}</span></span>
                  <span style={{ color:'var(--t3)' }}>Net: <span style={{ color:'var(--ok)', fontWeight:700 }}>${Math.round(y.net).toLocaleString()}</span></span>
                </div>
                <div style={{ fontSize:11, color:'var(--t3)', marginTop:4 }}>
                  {yHrs.toFixed(1)}h logged this year
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Runs list */}
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search pay periods…"
          style={{ flex:1, padding:'7px 12px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)', fontSize:12 }}/>
      </div>

      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {filtered.length===0 ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--t3)', fontSize:13 }}>No payroll runs yet.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--br)', background:'var(--s2)' }}>
                {['Pay Period','Pay Date','Gross','Taxes','Net Pay','Employees','Status',''].map(h=>(
                  <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <>
                  <tr key={r.id} style={{ borderBottom:'1px solid var(--br)', background:detailId===r.id?'var(--s2)':'' }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=detailId===r.id?'var(--s2)':''}>
                    <td style={{ padding:'9px 12px', fontWeight:700 }} onClick={()=>setDetailId(detailId===r.id?null:r.id)}>{r.period}</td>
                    <td style={{ padding:'9px 12px', color:'var(--t2)' }}>{r.payDate||'—'}</td>
                    <td style={{ padding:'9px 12px', fontWeight:600 }}>${parseFloat(r.grossPay||0).toLocaleString()}</td>
                    <td style={{ padding:'9px 12px', color:'var(--bad)' }}>${parseFloat(r.totalTaxes||0).toLocaleString()}</td>
                    <td style={{ padding:'9px 12px', fontWeight:700, color:'var(--ok)', fontSize:13 }}>${parseFloat(r.netPay||0).toLocaleString()}</td>
                    <td style={{ padding:'9px 12px' }}>{r.numEmployees}</td>
                    <td style={{ padding:'9px 12px' }}><span className={`bdg ${r.status==='Completed'?'bg':'ba'}`}>{r.status}</span></td>
                    <td style={{ padding:'9px 12px' }}>
                      <div style={{ display:'flex', gap:5 }}>
                        <button className="btn sec" style={{ fontSize:10, padding:'3px 8px' }} onClick={()=>setDetailId(detailId===r.id?null:r.id)}>{detailId===r.id?'▲':'▼'} Detail</button>
                        <button className="btn del" style={{ fontSize:10, padding:'3px 8px' }} onClick={()=>del(r.id)}>Del</button>
                      </div>
                    </td>
                  </tr>
                  {detailId===r.id && detailLines.length>0 && (
                    <tr key={r.id+'d'}>
                      <td colSpan={8} style={{ padding:0, background:'var(--s3)' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                          <thead>
                            <tr style={{ borderBottom:'1px solid var(--br)' }}>
                              {['Employee','Type','Hours','Gross','Fed Tax','State Tax','SS','Medicare','Total Tax','Net Pay','Method'].map(h=>(
                                <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'var(--t3)', fontWeight:600, fontSize:10 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {detailLines.map((l,i)=>(
                              <tr key={i} style={{ borderBottom:'1px solid var(--br)' }}>
                                <td style={{ padding:'6px 10px', fontWeight:600 }}>{l.name}</td>
                                <td style={{ padding:'6px 10px', color:'var(--t2)' }}>{l.payType}</td>
                                <td style={{ padding:'6px 10px' }}>{l.hours||'—'}h</td>
                                <td style={{ padding:'6px 10px', fontWeight:700 }}>${parseFloat(l.gross||0).toLocaleString()}</td>
                                <td style={{ padding:'6px 10px', color:'var(--bad)' }}>${parseFloat(l.fedTax||0).toFixed(2)}</td>
                                <td style={{ padding:'6px 10px', color:'var(--bad)' }}>${parseFloat(l.stateTax||0).toFixed(2)}</td>
                                <td style={{ padding:'6px 10px', color:'var(--bad)' }}>${parseFloat(l.ss||0).toFixed(2)}</td>
                                <td style={{ padding:'6px 10px', color:'var(--bad)' }}>${parseFloat(l.medicare||0).toFixed(2)}</td>
                                <td style={{ padding:'6px 10px', color:'var(--bad)', fontWeight:600 }}>${parseFloat(l.totalTaxes||0).toFixed(2)}</td>
                                <td style={{ padding:'6px 10px', fontWeight:700, color:'var(--ok)' }}>${parseFloat(l.net||0).toLocaleString()}</td>
                                <td style={{ padding:'6px 10px', color:'var(--t2)' }}>{l.payMethod||'—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>)}

      {/* ── Pay Stubs Tab ─────────────────────────────────────── */}
      {activeTab==='stubs' && (<>
        <div style={{ fontSize:12, color:'var(--t3)', marginBottom:12 }}>
          Showing current pay period: <strong style={{color:'var(--tx)'}}>{currentPeriod().label}</strong>
        </div>        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {stubLines.map(l => {
            const initials = l.name.split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
            return (
              <div key={l.name} className="card" style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                <div style={{ width:38, height:38, borderRadius:'50%', background:'var(--ok)', color:'#fff',
                  display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0 }}>
                  {initials}
                </div>
                <div style={{ minWidth:160 }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>{l.name}</div>
                  <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:3 }}>
                    <span className="bdg bn" style={{ fontSize:9 }}>{l.payType}</span>
                    <span style={{ fontSize:11, color:'var(--t3)' }}>{l.payType==='Hourly' ? `$${l.rate}/hr` : l.payType}</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap:22, flex:1, flexWrap:'wrap', justifyContent:'flex-end', alignItems:'center' }}>
                  <Stat label="Regular" value={l.regularHours+'h'} />
                  <Stat label="Overtime" value={l.otHours+'h'} color={parseFloat(l.otHours)>0?'var(--warn)':'var(--t3)'} />
                  <Stat label="Gross Pay" value={'$'+parseFloat(l.gross).toLocaleString()} color="#8b5cf6" bold />
                  <Stat label="Fed Tax" value={'-$'+l.fedTax} color="var(--bad)" />
                  <Stat label="SS" value={'-$'+l.ss} color="var(--bad)" />
                  <Stat label="Medicare" value={'-$'+l.medicare} color="var(--bad)" />
                  <Stat label="Net Pay" value={'$'+parseFloat(l.net).toLocaleString()} color="var(--ok)" bold big />
                  <button className="btn sec" style={{ fontSize:11, padding:'6px 14px' }} onClick={()=>printStub(l)}>🖨️ Stub</button>
                </div>
              </div>
            )
          })}
          {stubLines.length===0 && (
            <div className="card" style={{ padding:24, textAlign:'center', color:'var(--t3)', fontSize:13 }}>No employees yet.</div>
          )}
        </div>
      </>)}

      {/* ── Today's Log Tab ─────────────────────────────────────── */}
      {activeTab==='today' && (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid var(--br)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:700, fontSize:14 }}>Live Clock Status — {new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</span>
            <span style={{ fontSize:11, color:'var(--t3)' }}>Updates every 30s</span>
          </div>
          {(() => {
            const today = new Date().toISOString().slice(0,10)
            const todayEntries = timeEntries.filter(e => e.date === today)
            const clockedIn = todayEntries.filter(e => e.inTime && !e.outTime)
            const clockedOut = todayEntries.filter(e => e.inTime && e.outTime)
            if (todayEntries.length === 0) return (
              <div style={{ padding:40, textAlign:'center', color:'var(--t3)' }}>
                <div style={{ fontSize:32, marginBottom:8 }}>⏰</div>
                <div style={{ fontWeight:700, color:'var(--tx)', marginBottom:4 }}>No punches yet today</div>
                <div style={{ fontSize:12 }}>Staff can clock in via the Time Kiosk (/clockin) or Employee Portal</div>
              </div>
            )
            return (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--br)', background:'var(--s2)' }}>
                    {['Employee','Clock In','Clock Out','Hours','Method','Status'].map(h=>(
                      <th key={h} style={{ padding:'9px 14px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {todayEntries.sort((a,b)=>(b.inTime||'').localeCompare(a.inTime||'')).map(e => (
                    <tr key={e.id} style={{ borderBottom:'1px solid var(--br)' }}>
                      <td style={{ padding:'11px 14px', fontWeight:700 }}>{e.employee}</td>
                      <td style={{ padding:'11px 14px', color:'var(--ok)', fontWeight:600 }}>{fmt12Local(e.inTime)}</td>
                      <td style={{ padding:'11px 14px', color:e.outTime?'var(--bad)':'var(--t3)' }}>{e.outTime ? fmt12Local(e.outTime) : '—'}</td>
                      <td style={{ padding:'11px 14px', fontWeight:700, color:'#38BDF8' }}>{e.hours ? e.hours+'h' : e.inTime && !e.outTime ? <span style={{ color:'var(--warn)', fontSize:12 }}>Live</span> : '—'}</td>
                      <td style={{ padding:'11px 14px' }}>
                        <span className="bdg bn" style={{ fontSize:11 }}>{e.method || 'Manual'}</span>
                      </td>
                      <td style={{ padding:'11px 14px' }}>
                        {e.outTime
                          ? <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'var(--t2)' }}><span style={{ width:8,height:8,borderRadius:'50%',background:'#64748b',flexShrink:0 }}/>Clocked Out</span>
                          : <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'var(--ok)', fontWeight:700 }}><span style={{ width:8,height:8,borderRadius:'50%',background:'var(--ok)',flexShrink:0, animation:'pulse 1.5s infinite' }}/>Active</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
        </div>
      )}

      {/* ── Punch History Tab ─────────────────────────────────────── */}
      {activeTab==='punch' && (<>
        <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
          <input value={teSearch} onChange={e=>setTeSearch(e.target.value)} placeholder="Search employee…"
            style={{ flex:1, minWidth:140, padding:'7px 12px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)', fontSize:12 }}/>
          <select value={teFilterEmp} onChange={e=>setTeFilterEmp(e.target.value)}
            style={{ padding:'7px 10px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)', fontSize:12 }}>
            <option value="All">All Staff</option>
            {[...new Set(timeEntries.map(t=>t.employee).filter(Boolean))].sort().map(e=><option key={e}>{e}</option>)}
          </select>
        </div>
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--br)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontWeight:700, fontSize:13 }}>Punch History — {currentPeriod().label}</span>
            <span style={{ fontSize:11, color:'var(--t3)' }}>
              {timeEntries.filter(e=>{ const ms=teFilterEmp==='All'||e.employee===teFilterEmp; const ss=!teSearch||e.employee?.toLowerCase().includes(teSearch.toLowerCase()); return ms&&ss }).length} events
            </span>
          </div>
          {timeEntries.filter(e=>{
            const ms = teFilterEmp==='All'||e.employee===teFilterEmp
            const ss = !teSearch || e.employee?.toLowerCase().includes(teSearch.toLowerCase())
            return ms && ss
          }).length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'var(--t3)', fontSize:13 }}>No punch history for this period.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--br)', background:'var(--s2)' }}>
                  {['Employee','Date','Clock In','Clock Out','Hours','Method','Status',''].map(h=>(
                    <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timeEntries.filter(e=>{
                  const ms = teFilterEmp==='All'||e.employee===teFilterEmp
                  const ss = !teSearch || e.employee?.toLowerCase().includes(teSearch.toLowerCase())
                  return ms && ss
                }).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.inTime||'').localeCompare(a.inTime||'')).map(e=>(
                  <tr key={e.id} style={{ borderBottom:'1px solid var(--br)' }}
                    onMouseEnter={ev=>ev.currentTarget.style.background='var(--s2)'}
                    onMouseLeave={ev=>ev.currentTarget.style.background=''}>
                    <td style={{ padding:'11px 12px' }}>
                      <div style={{ fontWeight:700, fontSize:13 }}>{e.employee}</div>
                      <div style={{ fontSize:10, color:'var(--t3)' }}>{e.employeeId || ''}</div>
                    </td>
                    <td style={{ padding:'11px 12px', color:'var(--t2)' }}>
                      {e.date ? new Date(e.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : '—'}
                    </td>
                    <td style={{ padding:'11px 12px', color:'var(--ok)', fontWeight:600 }}>{fmt12Local(e.inTime)}</td>
                    <td style={{ padding:'11px 12px', color:e.outTime?'var(--bad)':'var(--t3)', fontWeight:e.outTime?600:400 }}>
                      {e.outTime ? fmt12Local(e.outTime) : <span className="bdg ba" style={{ fontSize:10 }}>Active</span>}
                    </td>
                    <td style={{ padding:'11px 12px', fontWeight:700, color:'#38BDF8' }}>{e.hours ? e.hours+'h' : '—'}</td>
                    <td style={{ padding:'11px 12px' }}>
                      <span className="bdg bn" style={{ fontSize:11 }}>{e.method || 'Manual'}</span>
                    </td>
                    <td style={{ padding:'11px 12px' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'var(--t2)' }}>
                        <span style={{ width:8,height:8,borderRadius:'50%',background:e.outTime?'#64748b':'var(--ok)',flexShrink:0 }}/>
                        {e.outTime ? 'Clocked Out' : 'Active'}
                      </span>
                    </td>
                    <td style={{ padding:'9px 8px' }}>
                      <div style={{ display:'flex', gap:5 }}>
                        {e.inTime && e.outTime && !e.hours && (
                          <button className="btn sec" style={{ fontSize:10, padding:'3px 8px', color:'var(--warn)' }}
                            onClick={async()=>{ const h=calcHoursLocal(e.inTime,e.outTime); if(h){await supabase.from('timeentries').update({hours:parseFloat(h)}).eq('id',e.id);showToast('✅ Recalculated: '+h+'h');load()} }}>
                            ↻
                          </button>
                        )}
                        <button className="btn sec" style={{ fontSize:12, padding:'3px 8px' }} onClick={()=>openEditPunch(e)}>✏️</button>
                        <button className="btn del" style={{ fontSize:12, padding:'3px 8px' }} onClick={()=>setDeletePunchId(e.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>)}

      {/* Edit Punch Modal */}
      {editPunch && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setEditPunch(null)}>
          <div className="modal" style={{ maxWidth:480 }}>
            <div className="mh">
              <span className="mt">✏️ Edit Time Entry</span>
              <button className="xbtn" onClick={()=>setEditPunch(null)}>&times;</button>
            </div>
            <div className="fg2">
              <div className="field"><label>Employee</label>
                <select value={editPunchForm.employee} onChange={e=>setEditPunchForm(f=>({...f,employee:e.target.value}))}>
                  {[...new Set(timeEntries.map(t=>t.employee).filter(Boolean))].sort().map(emp=><option key={emp}>{emp}</option>)}
                </select>
              </div>
              <div className="field"><label>Date</label>
                <input type="date" value={editPunchForm.date} onChange={e=>setEditPunchForm(f=>({...f,date:e.target.value}))}/>
              </div>
            </div>
            <div className="fg2">
              <div className="field"><label>Time In</label>
                <input type="time" value={editPunchForm.inTime} onChange={e=>setEditPunchForm(f=>({...f,inTime:e.target.value,hours:calcHoursLocal(e.target.value,f.outTime)}))}/>
              </div>
              <div className="field"><label>Time Out</label>
                <input type="time" value={editPunchForm.outTime} onChange={e=>setEditPunchForm(f=>({...f,outTime:e.target.value,hours:calcHoursLocal(f.inTime,e.target.value)}))}/>
              </div>
            </div>
            <div className="fg2">
              <div className="field"><label>Hours (auto-calc or override)</label>
                <input type="number" step="0.25" value={editPunchForm.hours||''} onChange={e=>setEditPunchForm(f=>({...f,hours:e.target.value}))} placeholder="Auto-calculated"/>
              </div>
              <div className="field"><label>Notes</label>
                <input value={editPunchForm.notes||''} onChange={e=>setEditPunchForm(f=>({...f,notes:e.target.value}))}/>
              </div>
            </div>
            {editPunchForm.inTime && editPunchForm.outTime && (
              <div style={{ background:'var(--s3)', borderRadius:6, padding:'8px 12px', marginBottom:10, fontSize:12, display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'var(--t2)' }}>Calculated Hours</span>
                <span style={{ fontWeight:700, color:'var(--ok)' }}>{calcHoursLocal(editPunchForm.inTime,editPunchForm.outTime)||'—'}h {parseTimeToMinsLocal(editPunchForm.outTime)<parseTimeToMinsLocal(editPunchForm.inTime)?'(overnight ✓)':''}</span>
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn del" style={{ flex:1 }} onClick={()=>{setDeletePunchId(editPunch.id);setEditPunch(null)}}>🗑 Delete</button>
              <button className="btn pri" style={{ flex:2, justifyContent:'center' }} onClick={saveEditPunch} disabled={editPunchSaving}>
                {editPunchSaving?'Saving…':'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletePunchId && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setDeletePunchId(null)}>
          <div className="modal" style={{ maxWidth:360, textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🗑️</div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>Delete this time entry?</div>
            <div style={{ fontSize:12, color:'var(--t3)', marginBottom:18 }}>This cannot be undone and will affect payroll calculations.</div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn sec" style={{ flex:1 }} onClick={()=>setDeletePunchId(null)}>Cancel</button>
              <button className="btn del" style={{ flex:1 }} onClick={()=>deleteEditPunch(deletePunchId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* New Run Modal */}
      {modal && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div className="modal" style={{ width:920, maxWidth:'96vw' }}>
            <div className="mh">
              <span className="mt">Process Payroll</span>
              <button className="xbtn" onClick={()=>setModal(false)}>&times;</button>
            </div>

            {/* Period setup */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10, marginBottom:14 }}>
              <div className="field" style={{ margin:0 }}>
                <label>Pay Period Label *</label>
                <input value={periodLabel} onChange={e=>setPeriodLabel(e.target.value)} placeholder="e.g. June 1–15, 2025"/>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Period Start</label>
                <input type="date" value={periodStart} onChange={e=>{ setPeriodStart(e.target.value); onRangeChange(e.target.value, periodEnd) }}/>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Period End</label>
                <input type="date" value={periodEnd} onChange={e=>{ setPeriodEnd(e.target.value); onRangeChange(periodStart, e.target.value) }}/>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Pay Date</label>
                <input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)}/>
              </div>
            </div>

            {/* Hours pulled notice */}
            {periodStart && periodEnd && (
              <div style={{ background:'rgba(26,127,212,.08)', border:'1px solid rgba(26,127,212,.25)', borderRadius:8, padding:'8px 14px', marginBottom:12, fontSize:12, color:'var(--t2)' }}>
                📊 Hours auto-loaded from time entries between <strong>{periodStart}</strong> and <strong>{periodEnd}</strong>.
                Adjust the date range above to recalculate, or edit hours/gross directly in the table.
              </div>
            )}

            {/* Line items table */}
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', marginBottom:8 }}>Employee Pay</div>
            <div style={{ overflowX:'auto', marginBottom:12 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, minWidth:820 }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid var(--br)', background:'var(--s3)' }}>
                    {['Employee','Type','Hours Pulled','Gross ($)','Fed Tax','State Tax','SS','Medicare','Net Pay','Method'].map(h=>(
                      <th key={h} style={{ padding:'6px 8px', textAlign:'left', color:'var(--t3)', fontWeight:600, fontSize:10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((l,i)=>(
                    <tr key={i} style={{ borderBottom:'1px solid var(--br)' }}>
                      <td style={{ padding:'6px 8px', fontWeight:600, fontSize:12 }}>
                        {l.name}
                        {l.entryCount > 0 && <span style={{ fontSize:9, color:'var(--ok)', marginLeft:5 }}>({l.entryCount} punches)</span>}
                      </td>
                      <td style={{ padding:'6px 8px' }}><span className="bdg bn" style={{ fontSize:9 }}>{l.payType}</span></td>
                      <td style={{ padding:'4px 8px' }}>
                        <input type="number" step="0.5" value={l.hours} onChange={e=>updateLine(i,'hours',e.target.value)}
                          style={{ width:65, padding:'3px 6px', fontSize:11, background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}/>
                      </td>
                      <td style={{ padding:'4px 8px' }}>
                        <input type="text" inputMode="decimal" value={formatMoneyInput(l.gross)} onChange={e=>updateLine(i,'gross',parseMoney(e.target.value))}
                          style={{ width:80, padding:'3px 6px', fontSize:11, background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}/>
                      </td>
                      <td style={{ padding:'4px 8px' }}>
                        <input type="text" inputMode="decimal" value={formatMoneyInput(l.fedTax)} onChange={e=>updateLine(i,'fedTax',parseMoney(e.target.value))}
                          style={{ width:65, padding:'3px 6px', fontSize:11, background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}/>
                      </td>
                      <td style={{ padding:'4px 8px' }}>
                        <input type="text" inputMode="decimal" value={formatMoneyInput(l.stateTax)} onChange={e=>updateLine(i,'stateTax',parseMoney(e.target.value))}
                          style={{ width:62, padding:'3px 6px', fontSize:11, background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}/>
                      </td>
                      <td style={{ padding:'4px 8px' }}>
                        <input type="text" inputMode="decimal" value={formatMoneyInput(l.ss)} onChange={e=>updateLine(i,'ss',parseMoney(e.target.value))}
                          style={{ width:62, padding:'3px 6px', fontSize:11, background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}/>
                      </td>
                      <td style={{ padding:'4px 8px' }}>
                        <input type="text" inputMode="decimal" value={formatMoneyInput(l.medicare)} onChange={e=>updateLine(i,'medicare',parseMoney(e.target.value))}
                          style={{ width:62, padding:'3px 6px', fontSize:11, background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}/>
                      </td>
                      <td style={{ padding:'6px 8px', fontWeight:700, color:'var(--ok)', fontSize:13 }}>${parseFloat(l.net||0).toLocaleString()}</td>
                      <td style={{ padding:'4px 8px' }}>
                        <select value={l.payMethod||'Direct Deposit'} onChange={e=>updateLine(i,'payMethod',e.target.value)}
                          style={{ fontSize:10, padding:'3px 6px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:4, color:'var(--tx)' }}>
                          {PAY_METHODS.map(m=><option key={m}>{m}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:'2px solid var(--br)', background:'var(--s3)' }}>
                    <td colSpan={2} style={{ padding:'8px 8px', fontWeight:700, fontSize:12 }}>TOTALS</td>
                    <td style={{ padding:'8px 8px', fontWeight:700 }}>{lineItems.reduce((s,l)=>s+parseFloat(l.hours||0),0).toFixed(1)}h</td>
                    <td style={{ padding:'8px 8px', fontWeight:700 }}>${lineItems.reduce((s,l)=>s+parseFloat(l.gross||0),0).toLocaleString()}</td>
                    <td colSpan={4} style={{ padding:'8px 8px', color:'var(--bad)', fontWeight:700 }}>-${lineItems.reduce((s,l)=>s+parseFloat(l.totalTaxes||0),0).toFixed(2)}</td>
                    <td style={{ padding:'8px 8px', fontWeight:800, color:'var(--ok)', fontSize:13 }}>${lineItems.reduce((s,l)=>s+parseFloat(l.net||0),0).toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="field"><label>Notes</label><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Payroll notes…"/></div>

            <button className="btn pri" style={{ width:'100%', justifyContent:'center', padding:10 }} onClick={saveRun} disabled={saving}>
              {saving ? 'Processing…' : '✅ Confirm & Save Payroll Run'}
            </button>
          </div>
        </div>
      )}
      <DeleteConfirmModal open={!!confirmDel} label="payroll run" onConfirm={confirmDel2} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}


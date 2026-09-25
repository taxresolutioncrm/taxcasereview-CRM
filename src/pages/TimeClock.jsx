import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import PayrollStatCards from '../components/PayrollStatCards'
import { useApp } from '../context/AppContext'

const BLANK = { employee:'', date:'', inTime:'', outTime:'', hours:'', notes:'' }

// Parse either "4:29 PM" or "16:29" into total minutes
function parseTimeToMins(t) {
  if (!t) return null
  t = t.trim()
  const ampm = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (ampm) {
    let h = parseInt(ampm[1]), m = parseInt(ampm[2])
    const period = ampm[3].toUpperCase()
    if (period==='PM' && h!==12) h += 12
    if (period==='AM' && h===12) h = 0
    return h*60 + m
  }
  const plain = t.match(/^(\d+):(\d+)$/)
  if (plain) return parseInt(plain[1])*60 + parseInt(plain[2])
  return null
}

function calcHours(inT, outT) {
  const inM = parseTimeToMins(inT), outM = parseTimeToMins(outT)
  if (inM === null || outM === null) return ''
  let diffMins = outM - inM
  if (diffMins <= 0) diffMins += 24 * 60  // overnight shift: clock-out is next day
  const diff = diffMins / 60
  return diff > 0 ? diff.toFixed(2) : ''
}

function fmt12(t) {
  if (!t) return '—'
  if (t.match(/AM|PM/i)) return t
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2,'0')} ${ampm}`
}

function elapsedStr(inTime, now) {
  const inM = parseTimeToMins(inTime)
  if (inM === null) return ''
  const nowM = now.getHours()*60 + now.getMinutes()
  const diffSecs = Math.max(0, (nowM - inM)*60 + now.getSeconds())
  const h = Math.floor(diffSecs/3600), m = Math.floor((diffSecs%3600)/60), s = diffSecs%60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

export default function TimeClock() {
  const { role, employeeName, myTenantId } = useApp()
  const isPrivileged = ['Super Admin','Admin','Manager'].includes(role)

  const [items,      setItems]      = useState([])
  const [employees,  setEmployees]  = useState([])
  const [modal,      setModal]      = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [editId,     setEditId]     = useState(null)
  const [form,       setForm]       = useState(BLANK)
  const [saving,     setSaving]     = useState(false)
  const [toast,      setToast]      = useState('')
  const [search,     setSearch]     = useState('')
  const [filterEmp,  setFilterEmp]  = useState('All')
  const [filterWeek, setFilterWeek] = useState('all')
  // openEntries: { empName: [ {id, inTime, date}, ... ] } — multiple open punches per person
  const [openEntries, setOpenEntries] = useState({})
  const [now,        setNow]        = useState(new Date())
  const [activeTab,  setActiveTab]  = useState('today')
  const [historyItems,setHistoryItems] = useState([])
  const [historyTotal,setHistoryTotal] = useState(0)
  const [historyHours,setHistoryHours] = useState(0)
  const [historyPage,setHistoryPage] = useState(0)
  const [historyLoading,setHistoryLoading] = useState(false)
  const [historyVersion,setHistoryVersion] = useState(0)
  const HISTORY_PAGE_SIZE = 250
  const timerRef = useRef(null)

  useEffect(() => {
    load()
    timerRef.current = setInterval(() => setNow(new Date()), 1000)
    let reloadTimer = null
    const ch = supabase.channel('timeclock-admin-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timeentries' }, () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => {
          load()
          setHistoryVersion(v=>v+1)
        }, 250)
      })
      .subscribe()
    return () => { clearInterval(timerRef.current); clearTimeout(reloadTimer); supabase.removeChannel(ch) }
  }, [])

  async function load() {
    const todayKey = new Date().toISOString().slice(0,10)
    const [{ data:todayRows }, { data:openRows }, { data:e }] = await Promise.all([
      supabase.from('timeentries').select('*').eq('date', todayKey).order('created_at', { ascending: false }),
      supabase.from('timeentries').select('*').or('outTime.is.null,hours.is.null').order('created_at', { ascending: false }).limit(500),
      supabase.from('employees').select('*').eq('tenant_id', myTenantId).eq('status','Active').order('name'),
    ])
    const merged = []
    const seen = new Set()
    for (const row of [...(todayRows||[]), ...(openRows||[])]) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      merged.push(row)
    }
    setItems(merged)
    const open = {}
    ;(openRows||[]).filter(e => !e.outTime && !e.hours).forEach(e => {
      if (!open[e.employee]) open[e.employee] = []
      open[e.employee].push({ id:e.id,inTime:e.inTime,date:e.date })
    })
    setOpenEntries(open)
    if (e) setEmployees(e)
  }

  function historyDateRange() {
    const todayKey = new Date().toISOString().slice(0,10)
    if (filterWeek === 'today') return { start: todayKey, end: todayKey }
    if (filterWeek === 'week') {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay())
      return { start:d.toISOString().slice(0,10), end:null }
    }
    if (filterWeek === 'month') return { start:todayKey.slice(0,7)+'-01', end:null }
    return { start:null,end:null }
  }

  async function loadHistory(page = 0) {
    if (!isPrivileged) return
    setHistoryLoading(true)
    const range = historyDateRange()
    const { data, error } = await supabase.rpc('timeclock_history_page', {
      p_employee: filterEmp === 'All' ? null : filterEmp,
      p_start_date: range.start,
      p_end_date: range.end,
      p_search: search.trim() || null,
      p_offset: page * HISTORY_PAGE_SIZE,
      p_limit: HISTORY_PAGE_SIZE,
    })
    setHistoryLoading(false)
    if (error) { showToast('History load failed: '+error.message); return }
    setHistoryItems(Array.isArray(data?.rows) ? data.rows : [])
    setHistoryTotal(Number(data?.total_count || 0))
    setHistoryHours(Number(data?.total_hours || 0))
  }

  useEffect(() => {
    if (!isPrivileged || activeTab !== 'history') return
    const t=setTimeout(()=>{ setHistoryPage(0); loadHistory(0) },200)
    return ()=>clearTimeout(t)
  }, [activeTab,filterEmp,filterWeek,search])

  useEffect(() => {
    if (!historyVersion || !isPrivileged || activeTab !== 'history') return
    loadHistory(historyPage)
  }, [historyVersion])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function clockIn(empName) {
    const now2 = new Date()
    const inTime = now2.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const date = now2.toISOString().slice(0, 10)
    const { data, error } = await supabase.from('timeentries').insert([{
      employee: empName, date, inTime, outTime: null, hours: null, notes: null, method: 'CRM'
    }]).select().single()
    if (error) { showToast('Error: ' + error.message); return }
    setOpenEntries(prev => ({
      ...prev,
      [empName]: [...(prev[empName] || []), { id: data.id, inTime, date }]
    }))
    showToast(`✅ ${empName.split(' ')[0]} clocked in at ${inTime}`)
    load()
  }

  async function clockOut(empName) {
    const entries = openEntries[empName]
    if (!entries || entries.length === 0) return
    // Clock out the MOST RECENT open entry
    const entry = entries[entries.length - 1]
    const outTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const hours = calcHours(entry.inTime, outTime) || '0'
    const { error } = await supabase.from('timeentries').update({
      outTime, hours: parseFloat(hours)
    }).eq('id', entry.id)
    if (error) { showToast('Error: ' + error.message); return }
    const remaining = entries.slice(0, -1)
    setOpenEntries(prev => {
      const n = { ...prev }
      if (remaining.length === 0) delete n[empName]
      else n[empName] = remaining
      return n
    })
    showToast(`✅ ${empName.split(' ')[0]} clocked out — ${hours}h logged`)
    load()
  }

  async function recalcHours(entry) {
    const hrs = calcHours(entry.inTime, entry.outTime)
    if (!hrs) { showToast('Cannot calculate — missing in/out time'); return }
    const { error } = await supabase.from('timeentries').update({ hours: parseFloat(hrs) }).eq('id', entry.id)
    if (error) { showToast('Error: ' + error.message); return }
    showToast(`✅ Recalculated: ${hrs}h`)
    load()
  }

  async function save() {
    if (!form.employee || !form.date) { showToast('Employee and date required'); return }
    setSaving(true)
    const hours = calcHours(form.inTime, form.outTime) || (form.hours ? parseFloat(form.hours) : null)
    if (editId) {
      const { error } = await supabase.from('timeentries').update({ employee: form.employee, date: form.date, inTime: form.inTime, outTime: form.outTime, hours, notes: form.notes }).eq('id', editId)
      if (error) { showToast('Error: ' + error.message); setSaving(false); return }
      showToast('✅ Entry updated!')
    } else {
      const { error } = await supabase.from('timeentries').insert([{ ...form, hours, created_at: new Date().toISOString() }])
      if (error) { showToast('Error: ' + error.message); setSaving(false); return }
      showToast('✅ Time entry saved!')
    }
    setSaving(false); setModal(false); setForm(BLANK); setEditId(null); load()
  }

  async function del(id) { setConfirmDel(id) }
  async function confirmDelEntry() {
    const { error } = await supabase.from('timeentries').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setItems(prev => prev.filter(i => i.id !== confirmDel)); setConfirmDel(null); showToast('Deleted')
  }

  const empNames = employees.length > 0 ? employees.map(e => e.name) : ['Romy Cruz', 'Dana Richard', 'Yesenia Gonzalez']
  const today = new Date().toISOString().slice(0, 10)

  const filtered = activeTab === 'history' ? historyItems : items

  const totalHours = activeTab === 'history'
    ? historyHours
    : filtered.reduce((s, e) => s + parseFloat(e.hours || 0), 0)

  // Today's entries (for Today's Log tab)
  const todayEntries = items.filter(e => e.date === today)
  const clockedInCount  = Object.keys(openEntries).filter(emp => (openEntries[emp]||[]).length>0).length
  const clockedOutToday = todayEntries.filter(e => e.outTime).length
  const totalPunchesToday = todayEntries.length

  function exportTodayCSV() {
    const rows = [['Employee','Date','Clock In','Clock Out','Hours','Notes']]
    todayEntries.forEach(e => rows.push([e.employee, e.date, fmt12(e.inTime)||'', e.outTime?fmt12(e.outTime):'', e.hours||'', e.notes||'']))
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type:'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `timeclock-${today}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Self-service view for non-privileged employees ──
  // Everyone can clock in/out right here in the CRM — no Employee Portal
  // login required. Only their own status + recent punches are visible.
  if (!isPrivileged) {
    const myOpen = openEntries[employeeName] || []
    const isClockedIn = myOpen.length > 0
    const myEntries = items
      .filter(t => (t.employee||'').trim().toLowerCase() === (employeeName||'').trim().toLowerCase())
      .sort((a,b) => (b.date||'').localeCompare(a.date||'') || (b.created_at||'').localeCompare(a.created_at||''))
      .slice(0, 15)

    return (
      <div style={{padding:'20px 24px',maxWidth:560,margin:'0 auto'}}>
        {toast && <div className="toast show">{toast}</div>}

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <h2 style={{ fontSize:15, fontWeight:700, margin:0 }}>⏱️ Time Clock</h2>
          <div style={{ fontSize:12, color:'var(--t3)', padding:'6px 10px', background:'var(--s2)', borderRadius:6, fontVariantNumeric:'tabular-nums' }}>
            {now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
          </div>
        </div>

        <div className="card" style={{ padding:'28px 20px', textAlign:'center', marginBottom:16 }}>
          {isClockedIn ? (
            <>
              <div style={{ fontSize:13, color:'var(--ok)', marginBottom:6 }}>🟢 Clocked in since {fmt12(myOpen[myOpen.length-1].inTime)}</div>
              <div style={{ fontSize:28, fontWeight:800, fontVariantNumeric:'tabular-nums', marginBottom:18 }}>
                {elapsedStr(myOpen[myOpen.length-1].inTime, now)}
              </div>
              <button className="btn" style={{ background:'var(--bad)', color:'#fff', padding:'12px 32px', fontSize:14, fontWeight:700 }}
                onClick={() => clockOut(employeeName)}>
                ⏹ Clock Out
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize:13, color:'var(--t3)', marginBottom:18 }}>Not clocked in</div>
              <button className="btn" style={{ background:'var(--ok)', color:'#fff', padding:'12px 32px', fontSize:14, fontWeight:700 }}
                onClick={() => clockIn(employeeName)}>
                ▶ Clock In
              </button>
            </>
          )}
        </div>

        <div className="card">
          <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', padding:'12px 14px 8px' }}>
            My Recent Punches
          </div>
          {myEntries.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:'var(--t3)', fontSize:13 }}>No punches on file yet.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--br)' }}>
                  {['Date','Clock In','Clock Out','Hours'].map(h=>(
                    <th key={h} style={{ textAlign:'left', padding:'6px 14px', color:'var(--t3)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myEntries.map(e => (
                  <tr key={e.id} style={{ borderBottom:'1px solid var(--br)' }}>
                    <td style={{ padding:'8px 14px' }}>{e.date}</td>
                    <td style={{ padding:'8px 14px', color:'var(--ok)' }}>{fmt12(e.inTime)}</td>
                    <td style={{ padding:'8px 14px', color:e.outTime?'var(--bad)':'var(--t3)' }}>{e.outTime?fmt12(e.outTime):'—'}</td>
                    <td style={{ padding:'8px 14px', fontWeight:600 }}>{e.hours?`${e.hours}h`:'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{padding:'20px 24px',maxWidth:1000,margin:'0 auto'}}>
      {toast && <div className="toast show">{toast}</div>}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
        <h2 style={{ fontSize:15, fontWeight:700, margin:0 }}>⏱️ Time Clock</h2>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ fontSize:12, color:'var(--t3)', padding:'6px 10px', background:'var(--s2)', borderRadius:6, fontVariantNumeric:'tabular-nums' }}>
            {now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
          </div>
          <button className="btn pri" onClick={() => { setForm({...BLANK, date:today}); setEditId(null); setModal(true) }}>+ Log Entry</button>
        </div>
      </div>

      <PayrollStatCards employees={employees} timeEntries={items} />

      {/* Tab Bar */}
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid var(--br)' }}>
        {[['today',"Today's Log"],['history','Punch History']].map(([k,l]) => (
          <button key={k} onClick={()=>setActiveTab(k)}
            style={{ padding:'10px 18px', border:'none', borderBottom: activeTab===k?'2px solid var(--blue)':'2px solid transparent',
              background:'none', cursor:'pointer', fontSize:13, fontWeight:activeTab===k?700:500,
              color:activeTab===k?'var(--blue)':'var(--t2)' }}>
            {l}
          </button>
        ))}
      </div>

      {activeTab==='today' && (<>
      {/* Clock In/Out Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:10, marginBottom:16 }}>
        {empNames.map(emp => {
          const empOpen = openEntries[emp] || []
          const isClockedIn = empOpen.length > 0
          const lastEntry = empOpen[empOpen.length - 1]
          const todayHrs = items.filter(e => e.employee===emp && e.date===today && e.hours).reduce((s,e) => s+parseFloat(e.hours||0), 0)
          const punchCount = empOpen.length

          return (
            <div key={emp} className="card" style={{ padding:'14px 16px', border:isClockedIn?'1px solid var(--ok)':'1px solid var(--br)', background:isClockedIn?'rgba(34,197,94,.06)':'' }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:13 }}>{emp}</div>
                  <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>
                    {isClockedIn
                      ? <span style={{ color:'var(--ok)', fontWeight:600 }}>● IN since {lastEntry.inTime}</span>
                      : <span>○ Clocked Out</span>}
                  </div>
                  {punchCount > 1 && (
                    <div style={{ fontSize:10, color:'var(--warn)', marginTop:2 }}>{punchCount} open punches</div>
                  )}
                </div>
                <div style={{ textAlign:'right' }}>
                  {isClockedIn && <div style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:'var(--ok)' }}>{elapsedStr(lastEntry.inTime, now)}</div>}
                  {todayHrs > 0 && <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>{todayHrs.toFixed(2)}h logged today</div>}
                </div>
              </div>

              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => clockIn(emp)}
                  style={{ flex:1, padding:'7px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, background:'var(--ok)', color:'#fff' }}>
                  ▶ Clock In
                </button>
                {isClockedIn && (
                  <button onClick={() => clockOut(emp)}
                    style={{ flex:1, padding:'7px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, background:'var(--bad)', color:'#fff' }}>
                    ⏹ Clock Out
                  </button>
                )}
              </div>

              {/* Show open punch list if multiple */}
              {punchCount > 1 && (
                <div style={{ marginTop:8, fontSize:10, color:'var(--t3)', borderTop:'1px solid var(--br)', paddingTop:6 }}>
                  {empOpen.map((e,i) => (
                    <div key={e.id} style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                      <span>Punch {i+1}: {e.inTime}</span>
                      <span style={{ color:'#f59e0b' }}>open</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Today's Log mini-stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:16 }}>
        {[
          ['CURRENTLY CLOCKED IN', clockedInCount, '#22c55e'],
          ['CLOCKED OUT TODAY', clockedOutToday, 'var(--t2)'],
          ['TOTAL PUNCHES TODAY', totalPunchesToday, '#3b82f6'],
          ['ACTIVE EMPLOYEES', empNames.length, '#8b5cf6'],
        ].map(([l,v,c]) => (
          <div key={l} className="card" style={{ padding:'12px 14px', borderTop:`3px solid ${c}` }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{l}</div>
            <div style={{ fontSize:20, fontWeight:800, color:c }}>{v || '—'}</div>
          </div>
        ))}
      </div>

      {/* Today's clock events */}
      <div className="card" style={{ padding:0, overflow:'hidden', marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderBottom:'1px solid var(--br)' }}>
          <div style={{ fontWeight:700, fontSize:13 }}>Clock events — {now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
          <button className="btn sec" style={{ fontSize:11, padding:'4px 10px' }} onClick={exportTodayCSV}>📥 Export CSV</button>
        </div>
        {todayEntries.length === 0 ? (
          <div style={{ padding:'36px 20px', textAlign:'center', color:'var(--t3)', fontSize:13 }}>
            <div style={{ fontSize:28, marginBottom:6 }}>⏰</div>
            No clock events today yet.
          </div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--br)', background:'var(--s2)' }}>
                {['Employee','Clock In','Clock Out','Hours','Notes','Status',''].map(h=>(
                  <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {todayEntries.map(e=>(
                <tr key={e.id} style={{ borderBottom:'1px solid var(--br)' }}>
                  <td style={{ padding:'9px 12px', fontWeight:600 }}>{e.employee}</td>
                  <td style={{ padding:'9px 12px', color:'var(--ok)', fontWeight:600 }}>{fmt12(e.inTime)||'—'}</td>
                  <td style={{ padding:'9px 12px', color:e.outTime?'var(--bad)':'var(--t3)' }}>{e.outTime?fmt12(e.outTime):'—'}</td>
                  <td style={{ padding:'9px 12px', fontWeight:700, color:'#38BDF8' }}>{e.hours?e.hours+'h':'—'}</td>
                  <td style={{ padding:'9px 12px', color:'var(--t2)', fontSize:11 }}>{e.notes||'—'}</td>
                  <td style={{ padding:'9px 12px' }}>{e.outTime ? <span className="bdg bg">Clocked Out</span> : <span className="bdg ba">Active</span>}</td>
                  <td style={{ padding:'9px 8px' }}>
                    <div style={{ display:'flex', gap:5 }}>
                      {e.inTime && e.outTime && !e.hours && (
                        <button className="btn sec" style={{ fontSize:10, padding:'3px 8px', color:'var(--warn)' }} onClick={() => recalcHours(e)}>↻ Recalc</button>
                      )}
                      <button className="btn sec" style={{ fontSize:10, padding:'3px 8px' }} onClick={() => { setForm({...BLANK,...e}); setEditId(e.id); setModal(true) }}>✏️ Edit</button>
                      <button className="btn del" style={{ fontSize:10, padding:'3px 8px' }} onClick={() => del(e.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {historyTotal > HISTORY_PAGE_SIZE && (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,marginTop:10}}>
          <div style={{fontSize:11,color:'var(--t3)'}}>
            Showing {historyTotal ? historyPage*HISTORY_PAGE_SIZE+1 : 0}–{Math.min((historyPage+1)*HISTORY_PAGE_SIZE,historyTotal)} of {historyTotal}
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button className="btn sec" disabled={historyPage===0 || historyLoading} onClick={()=>{const p=Math.max(0,historyPage-1);setHistoryPage(p);loadHistory(p)}}>← Prev</button>
            <span style={{fontSize:11,color:'var(--t2)'}}>Page {historyPage+1} / {Math.max(1,Math.ceil(historyTotal/HISTORY_PAGE_SIZE))}</span>
            <button className="btn sec" disabled={(historyPage+1)*HISTORY_PAGE_SIZE>=historyTotal || historyLoading} onClick={()=>{const p=historyPage+1;setHistoryPage(p);loadHistory(p)}}>Next →</button>
          </div>
        </div>
      )}
      </>)}

      {activeTab==='history' && (<>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:8, marginBottom:12 }}>
        {[
          ['Total Hours', totalHours.toFixed(1)+'h', 'var(--b2c)'],
          ['Entries', historyTotal, 'var(--tx)'],
          ['Active Now', Object.keys(openEntries).length, 'var(--ok)'],
          ...empNames.map(e => [e.split(' ')[0], filtered.filter(en => en.employee===e).reduce((s,en) => s+parseFloat(en.hours||0),0).toFixed(1)+'h', 'var(--t2)'])
        ].map(([l,v,c]) => (
          <div key={l} className="card" style={{ padding:'8px 12px', textAlign:'center' }}>
            <div style={{ fontWeight:800, fontSize:16, color:c }}>{v}</div>
            <div style={{ fontSize:10, color:'var(--t3)', marginTop:2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
          style={{ flex:1, minWidth:140, padding:'7px 12px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)', fontSize:12 }}/>
        <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)}
          style={{ padding:'7px 10px', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6, color:'var(--tx)', fontSize:12 }}>
          <option value="All">All Staff</option>
          {empNames.map(e => <option key={e}>{e}</option>)}
        </select>
        {[['all','All Time'],['today','Today'],['week','This Week'],['month','This Month']].map(([k,l]) => (
          <button key={k} className={`btn ${filterWeek===k?'pri':'sec'}`} style={{ fontSize:10, padding:'4px 10px' }} onClick={() => setFilterWeek(k)}>{l}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {historyLoading ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--t3)', fontSize:13 }}>Loading history…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:24, textAlign:'center', color:'var(--t3)', fontSize:13 }}>No time entries yet.</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--br)', background:'var(--s2)' }}>
                {['Employee','Date','Clock In','Clock Out','Hours','Notes',''].map(h => (
                  <th key={h} style={{ padding:'9px 12px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} style={{ borderBottom:'1px solid var(--br)' }}
                  onMouseEnter={ev => ev.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={ev => ev.currentTarget.style.background=''}>
                  <td style={{ padding:'9px 12px', fontWeight:600 }}>{e.employee}</td>
                  <td style={{ padding:'9px 12px', color:'var(--t2)' }}>{e.date}</td>
                  <td style={{ padding:'9px 12px', color:'var(--ok)', fontWeight:600 }}>{fmt12(e.inTime) || e.inTime || '—'}</td>
                  <td style={{ padding:'9px 12px', color:e.outTime?'var(--bad)':'var(--t3)' }}>
                    {e.outTime || <span className="bdg ba">Active</span>}
                  </td>
                  <td style={{ padding:'9px 12px', fontWeight:700, color:'#38BDF8' }}>{e.hours ? e.hours+'h' : '—'}</td>
                  <td style={{ padding:'9px 12px', color:'var(--t2)', fontSize:11, maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.notes||'—'}</td>
                  <td style={{ padding:'9px 12px' }}>
                    <div style={{ display:'flex', gap:5 }}>
                      {e.inTime && e.outTime && !e.hours && (
                        <button className="btn sec" style={{ fontSize:10, padding:'3px 8px', color:'var(--warn)' }} onClick={() => recalcHours(e)} title="Recalculate hours (handles overnight shifts)">↻ Recalc</button>
                      )}
                      <button className="btn sec" style={{ fontSize:10, padding:'3px 8px' }} onClick={() => { setForm({...BLANK,...e}); setEditId(e.id); setModal(true) }}>Edit</button>
                      <button className="btn del" style={{ fontSize:10, padding:'3px 8px' }} onClick={() => del(e.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>)}

      {/* Modal */}
      {modal && (
        <div className="modal-bg open" onClick={ev => ev.target===ev.currentTarget && (setModal(false), setEditId(null))}>
          <div className="modal">
            <div className="mh">
              <span className="mt">{editId ? 'Edit Entry' : 'Log Time Entry'}</span>
              <button className="xbtn" onClick={() => { setModal(false); setEditId(null) }}>&times;</button>
            </div>
            <div className="fg2">
              <div className="field"><label>Employee</label>
                <select value={form.employee} onChange={e => fld('employee', e.target.value)}>
                  <option value="">— Select —</option>
                  {empNames.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e => fld('date', e.target.value)}/></div>
            </div>
            <div className="fg2">
              <div className="field"><label>Time In</label><input type="time" value={form.inTime} onChange={e => fld('inTime', e.target.value)}/></div>
              <div className="field"><label>Time Out</label>
                <input type="time" value={form.outTime} onChange={e => { fld('outTime', e.target.value); fld('hours', calcHours(form.inTime, e.target.value)) }}/>
              </div>
            </div>
            <div className="fg2">
              <div className="field"><label>Hours (auto-calc or override)</label>
                <input type="number" step="0.25" value={form.hours} onChange={e => fld('hours', e.target.value)} placeholder="Auto-calculated"/>
              </div>
              <div className="field"><label>Notes</label><input value={form.notes||''} onChange={e => fld('notes', e.target.value)}/></div>
            </div>
            {form.inTime && form.outTime && (
              <div style={{ background:'var(--s3)', borderRadius:6, padding:'8px 12px', marginBottom:10, fontSize:12, display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'var(--t2)' }}>Calculated Hours</span>
                <span style={{ fontWeight:700, color:'var(--ok)' }}>{calcHours(form.inTime, form.outTime)||'—'}h</span>
              </div>
            )}
            <button className="btn pri" style={{ width:'100%', justifyContent:'center', padding:10 }} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editId ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}
      <DeleteConfirmModal open={!!confirmDel} label="time entry" onConfirm={confirmDelEntry} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}


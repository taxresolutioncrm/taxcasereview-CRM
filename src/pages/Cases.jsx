import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { logActivity, getActor } from '../lib/activityLog'
import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { useApp } from '../context/AppContext'
import ClientLink from '../components/ClientLink'
import { CASE_STATUSES as STATUSES, CASE_STATUS_COLORS as STATUS_C, ACTIVE_STATUSES, PENDING_STATUSES, RESOLVED_STATUSES } from '../lib/caseStatuses'
const CASE_TYPES = ['OIC','Installment Agreement','CNC','Penalty Abatement','Lien Withdrawal','TFRP','Appeals','Payroll Tax','Audit','Liens/Levies','Unfiled Returns','Tax Investigation','Other']

const BLANK = { clientName:'', caseType:'OIC', irsBalance:'', status:'Open', assignedTo:'', taxAssociate:'', deadline:'', taxYears:'', resolutionAmount:'', notes:'' }

// ── Small helpers ─────────────────────────────────────────────────────────────
function fmt$(n) { return n ? '$' + Number(n).toLocaleString() : '—' }
function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function isOverdue(d) { return d && new Date(d + 'T00:00:00') < new Date() }
function savings(irsBalance, resolutionAmount) {
  const b = Number(irsBalance), r = Number(resolutionAmount)
  if (!b || !r || r >= b) return null
  return Math.round((1 - r / b) * 100)
}

export default function Cases() {
  const { id: urlCaseId } = useParams()
  const navigate = useNavigate()
  const { user, myTenantId } = useApp()
  const [cases,       setCases]       = useState([])
  const [confirmDel,  setConfirmDel]  = useState(null)
  const [clients,     setClients]     = useState([])
  const [employees,   setEmployees]   = useState([])
  const [filter,      setFilter]      = useState('All')
  const [repFilter,   setRepFilter]   = useState('All')
  const [sortCol, setSortCol] = useState('clientName')
  const [sortDir, setSortDir] = useState('asc')
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
    const [modal,       setModal]       = useState(false)
  // Auto-open add modal when navigated here with ?new=1
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') { setForm(BLANK); setModal(true) } }, [searchParams])
  const [editCase,    setEditCase]    = useState(null)
  const [form,        setForm]        = useState(BLANK)
  const [sug,         setSug]         = useState([])
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState('')
  const [detail,      setDetail]      = useState(null)
  const [caseNotes,   setCaseNotes]   = useState([])
  const [newNote,     setNewNote]     = useState('')
  const [addingNote,  setAddingNote]  = useState(false)
  const [showAllCaseNotes, setShowAllCaseNotes] = useState(false)

  // Guard: don't load until auth session confirmed — prevents wrong-tenant data on hard refresh
  useEffect(() => { if (user && myTenantId) load() }, [user?.id, myTenantId])

  useEffect(() => {
    if (!urlCaseId || detail || !myTenantId) return
    let cancelled = false
    supabase.from('cases').select('*').eq('tenant_id', myTenantId).eq('id', urlCaseId).single().then(({ data }) => {
      if (!cancelled && data) { setDetail(data); loadCaseNotes(data.id) }
    })
    return () => { cancelled = true }
  }, [urlCaseId, myTenantId])

  useEffect(() => {
    if (urlCaseId && cases.length > 0 && !detail) {
      const found = cases.find(c => String(c.id) === String(urlCaseId))
      if (found) { setDetail(found); loadCaseNotes(found.id) }
    }
  }, [urlCaseId, cases])

  useEffect(() => {
    if (detail && String(detail.id) !== String(urlCaseId || '')) {
      setDetail(null)
    }
  }, [urlCaseId, detail])

  async function load() {
    const [{ data: cs }, { data: cl }, { data: em }] = await Promise.all([
      supabase.from('cases').select('*').eq('tenant_id', myTenantId).order('created_at', { ascending: false }),
      supabase.from('clients').select('id,name,irsBalance,taxYears,issueType').eq('tenant_id', myTenantId),
      supabase.from('employees').select('id,name').eq('tenant_id', myTenantId)
    ])
    if (cs) setCases(cs)
    if (cl) setClients(cl)
    if (em) setEmployees(em)
  }

  async function loadCaseNotes(caseId) {
    const { data } = await supabase.from('case_notes').select('*').eq('tenant_id', myTenantId).eq('case_id', caseId).order('created_at', { ascending: false })
    setCaseNotes(data || [])
  }

  async function addCaseNote() {
    if (!newNote.trim() || !detail) return
    setAddingNote(true)
    const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    await supabase.from('case_notes').insert([{
      tenant_id: myTenantId,
      case_id: detail.id,
      text: newNote.trim(),
      created_by: actor,
      created_at: new Date().toISOString()
    }])
    setAddingNote(false)
    setNewNote('')
    loadCaseNotes(detail.id)
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 4000) }
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function searchClient(val) {
    fld('clientName', val)
    if (val.length < 2) { setSug([]); return }
    setSug(clients.filter(c => c.name.toLowerCase().includes(val.toLowerCase())).slice(0, 6))
  }
  function pickClient(c) {
    setForm(f => ({ ...f, clientName: c.name, irsBalance: c.irsBalance || '', taxYears: c.taxYears || '', caseType: c.issueType || f.caseType }))
    setSug([])
  }

  const filtered = cases
    .filter(c => filter === 'All' || c.status === filter)
    .filter(c => repFilter === 'All' || (repFilter === 'Unassigned' ? !c.assignedTo : c.assignedTo === repFilter))

  const reps = employees.length > 0 ? employees.map(e => e.name) : ['Romy Cruz', 'Dana Richard', 'Yesenia Gonzalez']

  const sortedCases = [...filtered].sort((a, b) => {
    let av, bv
    if (sortCol === 'clientName')  { av = a.clientName||''; bv = b.clientName||'' }
    else if (sortCol === 'type')   { av = a.caseType||''; bv = b.caseType||'' }
    else if (sortCol === 'balance'){ av = parseFloat(a.irsBalance)||0; bv = parseFloat(b.irsBalance)||0 }
    else if (sortCol === 'resolution'){ av = a.resolutionAmount||''; bv = b.resolutionAmount||'' }
    else if (sortCol === 'status') { av = a.status||''; bv = b.status||'' }
    else if (sortCol === 'assigned'){ av = a.assignedTo||''; bv = b.assignedTo||'' }
    else if (sortCol === 'para')   { av = a.taxAssociate||''; bv = b.taxAssociate||'' }
    else if (sortCol === 'deadline'){ av = a.deadline||''; bv = b.deadline||'' }
    else { av = a.clientName||''; bv = b.clientName||'' }
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  async function save() {
    if (!form.clientName.trim()) { showToast('Client name is required'); return }
    setSaving(true)
    // Case number is assigned atomically by the database per tenant.
    const payload = { ...form, created_at: new Date().toISOString() }
    const { data, error } = await supabase.from('cases').insert([payload]).select()
    setSaving(false)
    if (error) { showToast('❌ Save error: ' + error.message); return }
    showToast('✅ Case created!')
    const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    await triggerWorkflow('case_created', 'case', payload.clientName || '', actor).catch(() => {})
    await logActivity(supabase,{employeeName:actor,action:'case_created',category:'case',description:`Opened case: ${payload.clientName} — ${payload.caseType}`,entityName:payload.clientName,meta:{caseType:payload.caseType}}).catch(()=>{})
    setModal(false); setForm(BLANK); load()
  }

  async function saveEdit() {
    setSaving(true)
    const { id, created_at, caseNum, ...rest } = form
    const { error } = await supabase.from('cases').update(rest).eq('id', id)
    setSaving(false)
    if (error) { showToast('❌ Update error: ' + error.message); return }
    showToast('✅ Saved!')
    setEditCase(null)
    const { data } = await supabase.from('cases').select('*').eq('id', id).single()
    if (data) setDetail(data)
    load()
  }

  function deleteCase(id) { setConfirmDel(id) }
  async function confirmDeleteCase() {
    const id = confirmDel
    setConfirmDel(null)
    const { error } = await supabase.from('cases').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message); return }
    setCases(prev => prev.filter(c => c.id !== id)); showToast('Deleted'); setDetail(null); navigate('/cases', { replace: true })
  }

  function openDetail(c) { setDetail(c); loadCaseNotes(c.id); navigate('/cases/' + c.id, { replace: false }) }
  function clientHrefForCase(c) {
    const hit = clients.find(x => String(x.name || '').trim().toLowerCase() === String(c.clientName || '').trim().toLowerCase())
    return hit?.id ? `/clients/${hit.id}?from=cases` : ''
  }
  function openEdit(c) { setForm({ ...BLANK, ...c }); setEditCase(c) }

  // ── Stat summary for list header ─────────────────────────────────────────────
  const statCounts = STATUSES.reduce((acc, s) => {
    acc[s] = cases.filter(c => c.status === s).length
    return acc
  }, {})
  const sumStatuses = list => list.reduce((n, s) => n + (statCounts[s] || 0), 0)
  const activeCount   = sumStatuses(ACTIVE_STATUSES)
  const pendingCount  = sumStatuses(PENDING_STATUSES)
  const resolvedCount = sumStatuses(RESOLVED_STATUSES)

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (detail) {
    const c = detail
    const pct = savings(c.irsBalance, c.resolutionAmount)
    const overdue = isOverdue(c.deadline)

    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {toast && <div className="toast show">{toast}</div>}

        {/* Header bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { setDetail(null); navigate('/cases', { replace: true }) }}>← Cases</button>
          <div style={{ flex: 1 }} />
          <button className="btn pri" onClick={() => openEdit(c)}>✏️ Edit Case</button>
          <button className="btn del" onClick={() => deleteCase(c.id)}>🗑</button>
        </div>

        {/* Hero card */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}><ClientLink name={c.clientName} style={{ color: 'inherit', textDecoration: 'none' }} /></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className={`bdg ${STATUS_C[c.status] || 'bn'}`}>{c.status}</span>
                <span className="bdg bb">{c.caseType}</span>
                <span className="bdg bn" style={{ fontSize: 10, letterSpacing: '.03em' }}>{c.caseNum}</span>
                {c.assignedTo && <span className="bdg bn">👤 {c.assignedTo}</span>}
                {c.taxAssociate && c.taxAssociate !== c.assignedTo && <span className="bdg bb" style={{fontSize:11}}>🤝 {c.taxAssociate}</span>}
              </div>
            </div>
            {pct && (
              <div style={{ textAlign: 'center', background: 'var(--bg)', border: '1px solid var(--green)', borderRadius: 10, padding: '8px 16px', minWidth: 80 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--green)', lineHeight: 1 }}>{pct}%</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.05em' }}>Savings</div>
              </div>
            )}
          </div>

          {/* Stat tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--br)' }}>
            {[
              { label: 'IRS Balance', val: fmt$(c.irsBalance), color: c.irsBalance ? 'var(--bad)' : undefined },
              { label: 'Resolution Amt', val: fmt$(c.resolutionAmount), color: c.resolutionAmount ? 'var(--green)' : undefined },
              { label: 'Tax Years', val: c.taxYears || '—' },
              { label: 'IRS Deadline', val: fmtDate(c.deadline), color: overdue ? 'var(--bad)' : undefined, badge: overdue ? '⚠️ Overdue' : null },
              { label: 'Case #', val: c.caseNum || '—' },
              { label: 'Opened', val: c.created_at ? fmtDate(c.created_at.slice(0, 10)) : '—' },
            ].map(({ label, val, color, badge }) => (
              <div key={label} style={{ background: 'var(--s2)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--t3)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--tx)' }}>{val}</div>
                {badge && <div style={{ fontSize: 10, color: 'var(--bad)', marginTop: 2 }}>{badge}</div>}
              </div>
            ))}
          </div>

          {c.notes && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--s2)', borderRadius: 7, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--t2)', borderLeft: '3px solid var(--blue)' }}>
              {c.notes}
            </div>
          )}
        </div>

        {/* Status pipeline */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', marginBottom: 12 }}>Case Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {STATUSES.map(s => {
              const active = c.status === s
              return (
                <button key={s}
                  className={`btn ${active ? 'pri' : 'sec'}`}
                  style={{
                    fontSize: 11, padding: '5px 12px', borderRadius: 20,
                    fontWeight: active ? 700 : 500,
                    boxShadow: active ? '0 0 0 2px var(--blue)' : 'none',
                    transition: 'all .15s'
                  }}
                  onClick={async () => {
                    if (s === c.status) return
                    const prevStatus = c.status
                    const { error } = await supabase.from('cases').update({ status: s }).eq('id', c.id)
                    if (error) { showToast('❌ ' + error.message); return }
                    const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
                    await supabase.from('client_notes').insert({
                      clientname: c.clientName,
                      text: `📁 Case status changed: ${prevStatus} → ${s} (${c.caseType}, ${c.caseNum})`,
                      author: actor,
                      visible_to_client: false,
                    })
                    await triggerWorkflow('case_status_changed', 'case', c.clientName, actor, s)
                    const { data } = await supabase.from('cases').select('*').eq('id', c.id).single()
                    if (data) setDetail(data)
                    load()
                    showToast(`✅ Status → ${s}`)
                    const _csa=getActor(user); await logActivity(supabase,{employeeName:_csa.name,employeeEmail:_csa.email,action:'case_status_changed',category:'case',description:`Case status: ${prevStatus} → ${s} (${c.clientName})`,entityName:c.clientName,meta:{from:prevStatus,to:s}}).catch(()=>{})
                  }}
                >{s}</button>
              )
            })}
          </div>
        </div>

        {/* Case Notes */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>📝 Case Notes</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {caseNotes.length > 3 && (
                <span onClick={() => setShowAllCaseNotes(s => !s)}
                  style={{ fontSize: 11, color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }}>
                  {showAllCaseNotes ? 'Show less' : `View all ${caseNotes.length}`}
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--t3)', background: 'var(--s2)', borderRadius: 20, padding: '2px 8px' }}>{caseNotes.length}</span>
            </div>
          </div>

          {/* Note input */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addCaseNote()}
              placeholder="Add a note… (Enter to save)"
              style={{ flex: 1, padding: '7px 11px', borderRadius: 7, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }} />
            <button className="btn pri" onClick={addCaseNote} disabled={addingNote || !newNote.trim()} style={{ padding: '6px 14px', fontSize: 13 }}>
              {addingNote ? '…' : 'Add'}
            </button>
          </div>

          {/* Notes list */}
          {caseNotes.length === 0
            ? <div style={{ color: 'var(--t3)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>No notes yet.</div>
            : (showAllCaseNotes ? caseNotes : caseNotes.slice(0, 3)).map((n, i) => (
              <div key={n.id || i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid var(--br)', alignItems: 'flex-start' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%', background: 'var(--blt)',
                  color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, flexShrink: 0, textTransform: 'uppercase'
                }}>
                  {(n.created_by || 'S').slice(0, 2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx)' }}>{n.created_by || 'Staff'}</span>
                    <span style={{ fontSize: 10, color: 'var(--t3)' }}>
                      {n.created_at ? new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--tx)', lineHeight: 1.5 }}>{n.text}</div>
                </div>
                <button onClick={async () => { const { error } = await supabase.from('case_notes').delete().eq('id', n.id); if (error) { showToast('Error: ' + error.message); return } loadCaseNotes(detail.id) }}
                  style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 16, flexShrink: 0, lineHeight: 1, padding: '0 2px' }}>×</button>
              </div>
            ))
          }
        </div>

        {editCase && (
          <CaseModal form={form} fld={fld} reps={reps} saving={saving} onSave={saveEdit}
            onClose={() => setEditCase(null)} title="Edit Case"
            clients={clients} sug={sug} searchClient={searchClient} pickClient={pickClient} />
        )}
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div>
      {toast && <div className="toast show">{toast}</div>}

      {/* Summary stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total Cases', val: cases.length, color: 'var(--tx)' },
          { label: 'Active', val: activeCount, color: 'var(--blue)' },
          { label: 'Attention Needed', val: pendingCount, color: 'var(--warn)' },
          { label: 'Resolved', val: resolvedCount, color: 'var(--green)' },
        ].map(({ label, val, color }) => (
          <div key={label} className="card" style={{ padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Status filter chips */}
      <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {['All', ...STATUSES].map(s => (
          <span key={s} className={`chip${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)}>
            {s}{s !== 'All' && statCounts[s] ? ` (${statCounts[s]})` : ''}
          </span>
        ))}
      </div>

      {/* Cases by Rep */}
      {(() => {
        const repMap = {}
        cases.forEach(c => { const r = c.assignedTo || 'Unassigned'; repMap[r] = (repMap[r] || 0) + 1 })
        const repList = Object.entries(repMap).sort((a, b) => b[1] - a[1])
        if (!repList.length) return null
        return (
          <div className="card" style={{ padding: '10px 16px', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Cases by Rep</div>
              {repFilter !== 'All' && <span onClick={() => setRepFilter('All')} style={{ fontSize: 11, color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }}>Clear</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {repList.map(([rep, count]) => (
                <div key={rep} onClick={() => setRepFilter(f => f === rep ? 'All' : rep)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, borderRadius: 20, padding: '4px 6px 4px 12px',
                    fontSize: 12, cursor: 'pointer', userSelect: 'none', transition: 'all .1s', border: '1px solid',
                    background: repFilter === rep ? 'var(--blt)' : 'var(--s2)',
                    borderColor: repFilter === rep ? 'var(--blue)' : 'var(--br)',
                    color: repFilter === rep ? 'var(--b2)' : 'var(--tx)'
                  }}>
                  <span style={{ fontWeight: 700 }}>{rep}</span>
                  <span style={{
                    background: repFilter === rep ? 'var(--blue)' : 'var(--b2c)',
                    color: repFilter === rep ? '#fff' : 'var(--b2)',
                    borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 800
                  }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Cases table */}
      <div className="card">
        <div className="ch">
          <span className="ct">
            {repFilter === 'All' ? 'All Cases' : (repFilter === 'Unassigned' ? 'Unassigned Cases' : repFilter + '\u2019s Cases')}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t3)', marginLeft: 6 }}>({filtered.length})</span>
          </span>
          <button className="btn pri" onClick={() => { setForm(BLANK); setModal(true) }}>+ New Case</button>
        </div>
        <div className="ovx">
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>#</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('clientName')}>Client{sortCol==='clientName'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('type')}>Type{sortCol==='type'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('balance')}>Balance{sortCol==='balance'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('resolution')}>Resolution{sortCol==='resolution'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('status')}>Status{sortCol==='status'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('assigned')}>Associate{sortCol==='assigned'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('para')}>Para{sortCol==='para'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>toggleSort('deadline')}>Deadline{sortCol==='deadline'?(sortDir==='asc'?' ↑':' ↓'):''}</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? (
                  <tr>
                    <td colSpan={9}>
                      <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--t3)' }}>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--tx)', marginBottom: 4 }}>No cases found</div>
                        <div style={{ fontSize: 13 }}>
                          {filter !== 'All' ? `No cases with status "${filter}".` : 'Cases are created from a client profile.'}
                        </div>
                      </div>
                    </td>
                  </tr>
                )
                : sortedCases.map(c => {
                  const overdue = isOverdue(c.deadline)
                  const pct = savings(c.irsBalance, c.resolutionAmount)
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(c)}>
                      <td style={{ color: 'var(--t3)', fontSize: 11 }}>{c.caseNum}</td>
                      <td style={{ fontWeight: 700, fontSize: 13 }} onClick={e=>e.stopPropagation()}>
                        {clientHrefForCase(c)
                          ? <a
                              href={clientHrefForCase(c)}
                              onClick={e=>e.stopPropagation()}
                              style={{ color:'var(--bad)', textDecoration:'underline', textUnderlineOffset:2, fontWeight:700 }}
                              title="Open client file"
                            >{c.clientName}</a>
                          : <span>{c.clientName}</span>}
                      </td>
                      <td><span className="bdg bb" style={{fontSize:12,padding:'3px 9px'}}>{c.caseType}</span></td>
                      <td style={{ color: c.irsBalance ? 'var(--bad)' : 'var(--t3)', fontWeight: 600 }}>{fmt$(c.irsBalance)}</td>
                      <td>
                        {c.resolutionAmount
                          ? <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 13 }}>
                            {fmt$(c.resolutionAmount)}
                            {pct && <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 4 }}>({pct}% off)</span>}
                          </span>
                          : <span style={{ color: 'var(--t3)', fontSize: 13 }}>—</span>
                        }
                      </td>
                      <td><span className={`bdg ${STATUS_C[c.status] || 'bn'}`} style={{fontSize:12,padding:'3px 9px'}}>{c.status}</span></td>
                      <td style={{ color: 'var(--t2)', fontSize: 12 }}>{c.assignedTo || '—'}</td>
                      <td style={{ color: 'var(--t2)', fontSize: 12 }}>{c.taxAssociate || '—'}</td>
                      <td style={{ color: overdue ? 'var(--bad)' : 'var(--t2)', fontSize: 12, fontWeight: overdue ? 700 : 400 }}>
                        {overdue && '⚠️ '}{c.deadline ? fmtDate(c.deadline) : '—'}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn del" style={{ padding: '3px 8px', fontSize: 13 }}
                          onClick={() => deleteCase(c.id)}>🗑</button>
                      </td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <CaseModal form={form} fld={fld} reps={reps} saving={saving} onSave={save}
          onClose={() => setModal(false)} title="New Case"
          clients={clients} sug={sug} searchClient={searchClient} pickClient={pickClient} />
      )}

      <DeleteConfirmModal open={!!confirmDel} label="case" onConfirm={confirmDeleteCase} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}

function CaseModal({ form, fld, reps, saving, onSave, onClose, title, sug, searchClient, pickClient }) {
  return (
    <div className="modal-bg open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="mh">
          <span className="mt">{title}</span>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>

        <div className="field" style={{ position: 'relative' }}>
          <label>Client Name * (search)</label>
          <input value={form.clientName} onChange={e => searchClient(e.target.value)}
            placeholder="Type to search clients…" autoComplete="off" />
          {sug.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--s3)', border: '1px solid var(--b2c)', borderRadius: 7, zIndex: 500, maxHeight: 160, overflowY: 'auto' }}>
              {sug.map(c => (
                <div key={c.id} onClick={() => pickClient(c)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fg2">
          <div className="field">
            <label>Case Type</label>
            <select value={form.caseType} onChange={e => fld('caseType', e.target.value)}>
              {CASE_TYPES.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={e => fld('status', e.target.value)}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="fg2">
          <div className="field">
            <label>IRS Balance ($)</label>
            <input type="text" inputMode="decimal" value={formatMoneyInput(form.irsBalance)} onChange={e => fld('irsBalance', parseMoney(e.target.value))} placeholder="Auto-filled from client" />
          </div>
          <div className="field">
            <label>Resolution Amount ($)</label>
            <input type="text" inputMode="decimal" value={formatMoneyInput(form.resolutionAmount)} onChange={e => fld('resolutionAmount', parseMoney(e.target.value))} placeholder="Proposed settlement" />
          </div>
        </div>

        <div className="fg2">
          <div className="field">
            <label>Assigned To</label>
            <select value={form.assignedTo} onChange={e => fld('assignedTo', e.target.value)}>
              <option value="">Unassigned</option>
              {reps.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tax Years</label>
            <input value={form.taxYears} onChange={e => fld('taxYears', e.target.value)} placeholder="2020, 2021, 2022" />
          </div>
          <div className="field"><label>Para</label>
            <select value={form.taxAssociate||''} onChange={e => fld('taxAssociate', e.target.value)}>
              <option value="">— None —</option>
              {reps.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label>IRS Deadline</label>
          <input type="date" value={form.deadline} onChange={e => fld('deadline', e.target.value)} />
        </div>

        <div className="field">
          <label>Notes</label>
          <textarea value={form.notes} onChange={e => fld('notes', e.target.value)} style={{ minHeight: 80 }} />
        </div>

        <button className="btn pri" style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 14 }}
          onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : title}
        </button>
      </div>
    </div>
  )
}

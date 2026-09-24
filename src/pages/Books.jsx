import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

const CATEGORIES = ['Revenue','Retainer','Payment Plan','Consultation','Other Income','Rent','Payroll','Software','Marketing','Office','Taxes','Utilities','Legal','Other Expense']
const TYPES = ['Income','Expense']
const ACCOUNTS = ['Checking','Savings','Credit Card','Cash','Other']

export default function Books() {
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useApp()

  // Read ?client= from URL
  const params = new URLSearchParams(location.search)
  const clientParam = params.get('client') || ''

  const [tab, setTab]           = useState('ledger')
  const [confirmDel, setConfirmDel] = useState(null)
  const [entries, setEntries]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [year, setYear]         = useState(new Date().getFullYear())
  const [clientFilter, setClientFilter] = useState(clientParam)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ date: new Date().toISOString().slice(0,10), description:'', amount:'', type:'Income', category:'Revenue', client_id:'', notes:'', reconciled: false, payee:'', account:'Checking' })
  const [saving, setSaving]     = useState(false)
  const [clients, setClients]   = useState([])
  useEffect(() => {
    if (params.get('new') === '1') setShowForm(true)
  }, [location.search])


  useEffect(() => { loadAll() }, [year, clientFilter])
  useEffect(() => { loadClients() }, [])

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name').order('name')
    setClients(data || [])
  }

  async function loadAll() {
    setLoading(true)
    let q = supabase.from('bookkeeping').select('*').order('date', { ascending: false, nullsFirst: false })
    if (clientFilter) q = q.eq('client_name', clientFilter)
    const { data, error } = await q
    if (error) showToast(error.message, 'err')
    setEntries(data || [])
    setLoading(false)
  }

  async function save() {
    if (!form.description || !form.amount) return showToast('Description and amount required', 'err')
    setSaving(true)
    const payload = { ...form, amount: parseFloat(form.amount), client_name: clientFilter || form.client_name || null }
    const { error } = await supabase.from('bookkeeping').insert([payload])
    setSaving(false)
    if (error) return showToast(error.message, 'err')
    showToast('Entry added!')
    setShowForm(false)
    setForm({ date: new Date().toISOString().slice(0,10), description:'', amount:'', type:'Income', category:'Revenue', client_name:'', notes:'', reconciled: false, payee:'', account:'Checking' })
    loadAll()
  }

  async function toggleReconciled(entry) {
    const { error } = await supabase.from('bookkeeping').update({ reconciled: !entry.reconciled }).eq('id', entry.id)
    if (error) { showToast('Error: ' + error.message, 'err'); return }
    loadAll()
  }

  async function deleteEntry(id) { setConfirmDel(id) }
  async function confirmDeleteEntry() {
    const { error } = await supabase.from('bookkeeping').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setEntries(prev => prev.filter(e => e.id !== confirmDel))
    setConfirmDel(null); showToast('Deleted')
    loadAll()
  }

  const filtered = entries.filter(e => {
    if (typeFilter !== 'All' && e.type !== typeFilter) return false
    if (search && !e.description?.toLowerCase().includes(search.toLowerCase()) && !e.category?.toLowerCase().includes(search.toLowerCase())) return false
    // Year filter — use date field if set, fall back to created_at
    const entryYear = e.date ? e.date.slice(0,4) : e.created_at?.slice(0,4)
    if (year && entryYear && String(entryYear) !== String(year)) return false
    return true
  })

  const totalIncome  = filtered.filter(e => e.type === 'Income').reduce((s,e) => s + (Number(e.amount)||0), 0)
  const totalExpense = filtered.filter(e => e.type === 'Expense').reduce((s,e) => s + (Number(e.amount)||0), 0)
  const netProfit    = totalIncome - totalExpense

  // Monthly P&L data
  const monthlyData = Array.from({length:12}, (_,i) => {
    const m = String(i+1).padStart(2,'0')
    const inc = entries.filter(e => e.type==='Income'  && (e.date?.slice(5,7)||new Date(e.created_at).toISOString().slice(5,7))===m).reduce((s,e)=>s+(Number(e.amount)||0),0)
    const exp = entries.filter(e => e.type==='Expense' && (e.date?.slice(5,7)||new Date(e.created_at).toISOString().slice(5,7))===m).reduce((s,e)=>s+(Number(e.amount)||0),0)
    return { month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i], inc, exp, net: inc-exp }
  })

  // Category breakdown
  const catBreakdown = {}
  filtered.filter(e=>e.type==='Expense').forEach(e => {
    catBreakdown[e.category||'Other'] = (catBreakdown[e.category||'Other']||0) + (Number(e.amount)||0)
  })
  const maxCat = Math.max(...Object.values(catBreakdown), 1)

  async function exportQuickBooksCSV() {
    // QuickBooks Online "3-column" bank transaction import format:
    // Date, Description, Amount — Amount positive = money in, negative = money out
    const rows = [['Date','Description','Amount']]
    filtered.forEach(e => {
      const d = e.date || e.created_at?.slice(0,10) || ''
      const [yyyy,mm,dd] = d.split('-')
      const dateStr = (yyyy && mm && dd) ? `${mm}/${dd}/${yyyy}` : d
      const amt = Number(e.amount || 0)
      const signedAmt = e.type === 'Income' ? amt : -amt
      const desc = [e.description, e.payee ? `(${e.payee})` : ''].filter(Boolean).join(' ')
      rows.push([dateStr, desc, signedAmt.toFixed(2)])
    })
    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quickbooks-import-${clientFilter ? clientFilter.replace(/\s+/g,'-')+'-' : ''}${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('✅ CSV exported — ready to import into QuickBooks Online')
  }

  const TABS = ['ledger','pnl','categories']

  return (
    <div style={{padding:'20px 24px',maxWidth:1100,margin:'0 auto'}}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {clientParam && (
            <button className="btn" onClick={() => navigate('/clients')} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              ← Back to {clientParam}
            </button>
          )}
          <div>
            <div style={{ fontWeight:700, fontSize:20, color:'var(--tx)' }}>
              Books & Ledger {clientFilter ? `— ${clientFilter}` : ''}
            </div>
            <div style={{ fontSize:13, color:'var(--t3)' }}>{year} · {filtered.length} entries</div>
          </div>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          {clientFilter && (
            <span style={{ fontSize:12, background:'var(--blue)22', color:'var(--blue)', border:'1px solid var(--blue)44', borderRadius:20, padding:'3px 12px', fontWeight:600 }}>
              📋 {clientFilter}
              <button onClick={()=>setClientFilter('')} style={{ background:'none', border:'none', color:'var(--blue)', cursor:'pointer', marginLeft:6, fontSize:14, lineHeight:1 }}>×</button>
            </span>
          )}
          <select value={year} onChange={e=>setYear(Number(e.target.value))}
            style={{ padding:'7px 12px', borderRadius:8, border:'1px solid var(--br)', background:'var(--s2)', color:'var(--tx)', fontSize:13 }}>
            {/* Generated from the current year rather than hardcoded, so the
                list never goes stale and prior years stay available for a P&L
                that is being prepared after the fact. */}
            {Array.from({ length: 9 }, (_, i) => new Date().getFullYear() + 1 - i)
              .map(y=><option key={y}>{y}</option>)}
          </select>
          <button className="btn" onClick={exportQuickBooksCSV} style={{ display:'flex', alignItems:'center', gap:6 }}>
            ⬇️ Export to QuickBooks
          </button>
          <button className="btn pri" onClick={()=>setShowForm(true)} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Entry
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        {[
          { label:'Total Income',  val:totalIncome,  color:'var(--ok)',  icon:'📈' },
          { label:'Total Expenses',val:totalExpense, color:'var(--bad)', icon:'📉' },
          { label:'Net Profit',    val:netProfit,    color: netProfit>=0?'var(--ok)':'var(--bad)', icon:'💰' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding:'16px 20px' }}>
            <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', marginBottom:6 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize:22, fontWeight:800, color:s.color }}>${Math.abs(s.val).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16, borderBottom:'1px solid var(--br)', paddingBottom:0 }}>
        {[['ledger','📒 Ledger'],['pnl','📊 P&L'],['categories','🏷️ Categories']].map(([key,label]) => (
          <button key={key} onClick={()=>setTab(key)} style={{
            padding:'8px 18px', borderRadius:'8px 8px 0 0',
            border:'1px solid var(--br)', borderBottom: tab===key ? '2px solid var(--blue)' : '1px solid transparent',
            background: tab===key ? 'var(--sf)' : 'transparent',
            color: tab===key ? 'var(--blue)' : 'var(--t3)',
            fontWeight: tab===key ? 700 : 400,
            cursor:'pointer', fontSize:13, marginBottom:-1
          }}>{label}</button>
        ))}
      </div>

      {/* Ledger tab */}
      {tab === 'ledger' && (
        <div className="card">
          <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search entries…"
              style={{ flex:1, minWidth:200, padding:'7px 12px', borderRadius:8, border:'1px solid var(--br)', background:'var(--s2)', color:'var(--tx)', fontSize:13 }}/>
            {['All','Income','Expense'].map(t => (
              <button key={t} onClick={()=>setTypeFilter(t)} className={typeFilter===t?'btn pri':'btn'} style={{fontSize:12}}>{t}</button>
            ))}
          </div>
          {loading ? (
            <div style={{ textAlign:'center', padding:40, color:'var(--t3)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'var(--t3)' }}>
              <div style={{ fontSize:36, marginBottom:10 }}>📒</div>
              <div style={{ fontWeight:600, color:'var(--tx)' }}>No entries yet</div>
              <div style={{ fontSize:13, marginTop:4 }}>Click "Add Entry" to get started</div>
            </div>
          ) : (
            <div className="ovx">
              <table>
                <thead>
                  <tr>
                    <th>✓</th><th>Date</th><th>Description</th><th>Payee</th><th>Category</th><th>Type</th><th style={{textAlign:'right'}}>Amount</th><th>Notes</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id} style={{ opacity: e.reconciled ? .6 : 1 }}>
                      <td>
                        <div onClick={()=>toggleReconciled(e)} style={{
                          width:16, height:16, borderRadius:4, cursor:'pointer',
                          border:'1.5px solid var(--br)',
                          background: e.reconciled ? 'var(--ok)' : 'var(--s2)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          color:'#fff', fontSize:10
                        }}>{e.reconciled?'✓':''}</div>
                      </td>
                      <td style={{ fontSize:12, color:'var(--t3)', whiteSpace:'nowrap' }}>{e.date || e.created_at?.slice(0,10)}</td>
                      <td style={{ fontWeight:600 }}>{e.description}</td>
                      <td style={{ fontSize:12, color:'var(--t3)' }}>{e.payee||'—'}</td>
                      <td><span className="bdg bn" style={{fontSize:10}}>{e.category}</span></td>
                      <td><span className={`bdg ${e.type==='Income'?'bg':'br'}`} style={{fontSize:10}}>{e.type}</span></td>
                      <td style={{ textAlign:'right', fontWeight:700, color: e.type==='Income'?'var(--ok)':'var(--bad)', whiteSpace:'nowrap' }}>
                        {e.type==='Income'?'+':'-'}${Number(e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2})}
                      </td>
                      <td style={{ fontSize:12, color:'var(--t3)' }}>{e.notes||'—'}</td>
                      <td>
                        <button className="btn sm" onClick={()=>deleteEntry(e.id)} style={{ color:'var(--bad)', fontSize:11 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* P&L tab */}
      {tab === 'pnl' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {clientParam && (
            <div style={{ background:'var(--blue)11', border:'1px solid var(--blue)33', borderRadius:10, padding:'10px 16px', fontSize:13, color:'var(--t2)' }}>
              📋 Showing P&L for <strong>{clientParam}</strong> — {year}
            </div>
          )}
          <div className="card">
            <div style={{ fontWeight:700, fontSize:14, color:'var(--tx)', marginBottom:14 }}>Monthly Income vs Expenses — {year}</div>
            <table style={{ width:'100%' }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{textAlign:'right',color:'var(--ok)'}}>Income</th>
                  <th style={{textAlign:'right',color:'var(--bad)'}}>Expenses</th>
                  <th style={{textAlign:'right'}}>Net</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map(m => (
                  <tr key={m.month}>
                    <td style={{fontWeight:600}}>{m.month}</td>
                    <td style={{textAlign:'right',color:'var(--ok)',fontWeight:600}}>{m.inc>0?'$'+m.inc.toLocaleString(undefined,{minimumFractionDigits:2}):'—'}</td>
                    <td style={{textAlign:'right',color:'var(--bad)',fontWeight:600}}>{m.exp>0?'$'+m.exp.toLocaleString(undefined,{minimumFractionDigits:2}):'—'}</td>
                    <td style={{textAlign:'right',fontWeight:700,color:m.net>=0?'var(--ok)':'var(--bad)'}}>
                      {m.inc===0&&m.exp===0?'—':(m.net>=0?'+':'')+('$'+Math.abs(m.net).toLocaleString(undefined,{minimumFractionDigits:2}))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:'2px solid var(--br)' }}>
                  <td style={{fontWeight:800,fontSize:14}}>Total</td>
                  <td style={{textAlign:'right',fontWeight:800,color:'var(--ok)',fontSize:14}}>${totalIncome.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                  <td style={{textAlign:'right',fontWeight:800,color:'var(--bad)',fontSize:14}}>${totalExpense.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                  <td style={{textAlign:'right',fontWeight:800,fontSize:14,color:netProfit>=0?'var(--ok)':'var(--bad)'}}>
                    {netProfit>=0?'+':''} ${netProfit.toLocaleString(undefined,{minimumFractionDigits:2})}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Categories tab */}
      {tab === 'categories' && (
        <div className="card">
          <div style={{ fontWeight:700, fontSize:14, color:'var(--tx)', marginBottom:14 }}>Expense Breakdown by Category</div>
          {Object.keys(catBreakdown).length === 0 ? (
            <div style={{ color:'var(--t3)', fontSize:13, textAlign:'center', padding:30 }}>No expense entries yet</div>
          ) : (
            Object.entries(catBreakdown).sort((a,b)=>b[1]-a[1]).map(([cat, amt]) => (
              <div key={cat} style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:13 }}>
                  <span style={{ fontWeight:600 }}>{cat}</span>
                  <span style={{ fontWeight:700, color:'var(--bad)' }}>${amt.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                </div>
                <div style={{ height:8, background:'var(--s2)', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${(amt/maxCat)*100}%`, background:'var(--bad)', borderRadius:4, transition:'width .3s' }}/>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add Entry modal */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}
          onClick={e=>e.target===e.currentTarget&&setShowForm(false)}>
          <div style={{ background:'var(--sf)', border:'1px solid var(--br)', borderRadius:14, width:'100%', maxWidth:480, padding:28 }}>
            <div style={{ fontWeight:700, fontSize:17, color:'var(--tx)', marginBottom:20, display:'flex', justifyContent:'space-between' }}>
              Add Ledger Entry
              <button onClick={()=>setShowForm(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)', fontSize:20 }}>✕</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="field" style={{gridColumn:'1/-1'}}>
                <label>Description *</label>
                <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. Retainer from client" autoFocus/>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                  {TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Amount *</label>
                <input type="text" inputMode="decimal" value={formatMoneyInput(form.amount)} onChange={e=>setForm(f=>({...f,amount:parseMoney(e.target.value)}))} placeholder="0.00"/>
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Date</label>
                <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
              </div>
              <div className="field">
                <label>Payee / Vendor</label>
                <input value={form.payee||''} onChange={e=>setForm(f=>({...f,payee:e.target.value}))} placeholder="Who was paid / who paid you"/>
              </div>
              <div className="field">
                <label>Account</label>
                <select value={form.account||'Checking'} onChange={e=>setForm(f=>({...f,account:e.target.value}))}>
                  {ACCOUNTS.map(a=><option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field" style={{gridColumn:'1/-1'}}>
                <label>Client (optional)</label>
                <input list="books-clients-list" value={form.client_name||''} onChange={e=>setForm(f=>({...f,client_name:e.target.value}))}
                  placeholder="Type to search clients…"/>
                <datalist id="books-clients-list">
                  {clients.map(c=><option key={c.id} value={c.name}/>)}
                </datalist>
              </div>
              <div className="field" style={{gridColumn:'1/-1'}}>
                <label>Notes</label>
                <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes"/>
              </div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:20 }}>
              <button className="btn" onClick={()=>setShowForm(false)}>Cancel</button>
              <button className="btn pri" onClick={save} disabled={saving}>{saving?'Saving…':'Add Entry'}</button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmModal open={!!confirmDel} label="bookkeeping entry" onConfirm={confirmDeleteEntry} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}





import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { logActivity, getActor } from '../lib/activityLog'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { applyPaymentToInvoice, reversePaymentFromInvoice } from '../lib/invoiceSync'
import ClientLink from '../components/ClientLink'
import { FIRM } from '../lib/firmBranding'

const BLANK = { clientName:'', client_id:'', invNum:'', amount:'', method:'Credit Card', checkNum:'', date:'', status:'Cleared', notes:'', reference:'' }
const METHODS = ['Credit Card','ACH / Bank Transfer','Check','Cash','Zelle','Venmo','PayPal','Money Order','Wire Transfer','Other']
const SETTLED_PAYMENT_STATUSES = new Set(['cleared','paid','posted','completed','succeeded','success'])
function isSettledPaymentStatus(status) {
  return SETTLED_PAYMENT_STATUSES.has(String(status || '').trim().toLowerCase())
}

export default function Payments() {
  const { user } = useApp()
  const [items,    setItems]    = useState([])
  const [sortCol,  setSortCol]  = useState('date')
  const [sortDir,  setSortDir]  = useState('desc')
  const [confirmDel, setConfirmDel] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [clients,  setClients]  = useState([])
    const [modal,    setModal]    = useState(false)
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') { setForm(BLANK); setEditId(null); setModal(true) } }, [searchParams])
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState(BLANK)
  const [saving,   setSaving]   = useState(false)
  const [toast,    setToast]    = useState('')
  const [search,   setSearch]   = useState('')
  const [filterMethod, setFilterMethod] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [suggestions, setSug]   = useState([])
  const [showSug,  setShowSug]  = useState(false)
  const [invSug,   setInvSug]   = useState([])
  const [running,  setRunning]  = useState(false)
  const [batchLog, setBatchLog] = useState([])
  const [paymentProvider, setPaymentProvider] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data:p },{ data:inv },{ data:cl },{ data:cfg }] = await Promise.all([
      supabase.from('payments').select('*').order('created_at',{ascending:false}),
      supabase.from('invoices').select('id,invNum,clientName,client_id,total,taxRate,paid,status'),
      supabase.from('clients').select('id,name,autopay_enabled,autopay_amount,autopay_frequency,autopay_next_charge,autopay_last_result,autopay_last_charged_at,default_payment_method_id,payment_method_brand,payment_method_last4'),
      supabase.from('settings').select('payment_provider').limit(1).maybeSingle(),
    ])
    if (p)   setItems(p)
    if (inv) setInvoices(inv)
    if (cl)  setClients(cl)
    setPaymentProvider(cfg?.payment_provider || null)
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(''),3000) }
  function fld(k,v) { setForm(f=>({...f,[k]:v})) }

  function advanceDate(dateStr, frequency) {
    const d = new Date(dateStr + 'T00:00:00')
    if (frequency === 'weekly') d.setDate(d.getDate() + 7)
    else if (frequency === 'biweekly') d.setDate(d.getDate() + 14)
    else d.setMonth(d.getMonth() + 1) // monthly (and one-time just won't be picked up again since it's toggled off below)
    return d.toISOString().slice(0, 10)
  }

  async function chargeClientNow(client) {
    if (paymentProvider !== 'stripe') { showToast('Online card charging is not connected for this office. Connect a payment processor in Settings first.'); return }
    setRunning(true)
    const { data, error } = await supabase.functions.invoke('stripe-charge', {
      body: { clientId: client.id, amount: client.autopay_amount, source: 'manual' }
    })
    setRunning(false)
    if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
    showToast(`✅ Charged ${client.name} $${client.autopay_amount}`)
    load()
  }

  async function runAutopayBatch() {
    if (paymentProvider !== 'stripe') { showToast('Autopay is unavailable until this office connects its payment processor.'); return }
    const today = new Date().toISOString().slice(0, 10)
    const due = clients.filter(c => c.autopay_enabled && c.autopay_amount && c.autopay_next_charge && c.autopay_next_charge <= today)
    if (due.length === 0) { showToast('Nothing due today'); return }
    if (!confirm(`Run autopay for ${due.length} client${due.length!==1?'s':''} totaling $${due.reduce((s,c)=>s+Number(c.autopay_amount||0),0).toFixed(2)}?`)) return

    setRunning(true); setBatchLog([])
    for (const c of due) {
      const { data, error } = await supabase.functions.invoke('stripe-charge', {
        body: { clientId: c.id, amount: c.autopay_amount, source: 'autopay' }
      })
      const ok = !error && !data?.error
      setBatchLog(prev => [...prev, { name: c.name, amount: c.autopay_amount, ok, msg: ok ? 'Charged' : (data?.error || error.message) }])
      if (ok) {
        const nextDate = c.autopay_frequency === 'one-time' ? null : advanceDate(c.autopay_next_charge, c.autopay_frequency)
        await supabase.from('clients').update({
          autopay_next_charge: nextDate,
          autopay_enabled: c.autopay_frequency === 'one-time' ? false : true,
        }).eq('id', c.id)
      }
    }
    setRunning(false)
    showToast('Batch run complete')
    load()
  }

  function searchClient(val) {
    fld('clientName',val)
    fld('client_id','')
    setSug(val.length<2?[]:clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6))
    setShowSug(true)
    // Update invoice suggestions
    if (val.length>=2) {
      setInvSug(invoices.filter(i=>i.clientName?.toLowerCase().includes(val.toLowerCase())&&i.status!=='Paid').slice(0,4))
    }
  }

  function selectInvoice(inv) {
    fld('invNum', inv.invNum)
    fld('clientName', inv.clientName)
    fld('client_id', inv.client_id || '')
    const subtotal = parseFloat(inv.total||0)
    const taxRate = parseFloat(inv.taxRate||0)
    const balance = subtotal + (subtotal * taxRate / 100) - parseFloat(inv.paid||0)
    if (balance > 0) fld('amount', String(balance.toFixed(2)))
    setInvSug([])
    setSug([]); setShowSug(false)
  }

  async function save() {
    if (!form.clientName || !form.amount) { showToast('Client and amount required'); return }
    const amountNum = Number(form.amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) { showToast('Enter a valid payment amount'); return }
    setSaving(true)
    const previous = editId ? items.find(i => i.id === editId) : null
    const payload = { ...form, date: form.date||new Date().toISOString().slice(0,10) }
    let error
    let insertedPaymentId = null
    if (editId) {
      ;({error} = await supabase.from('payments').update({...payload, updated_at:new Date().toISOString()}).eq('id',editId))
    } else {
      const { data: inserted, error: insertErr } = await supabase.from('payments')
        .insert([{...payload, created_at:new Date().toISOString()}])
        .select('id').single()
      error = insertErr
      insertedPaymentId = inserted?.id || null
    }
    if (error) {
      setSaving(false)
      showToast('Error: '+error.message)
      return
    }

    // Keep invoice.paid synchronized with the payment row, including edits,
    // invoice changes, status changes, and amount changes.
    try {
      const prevApplied = previous && previous.invNum && isSettledPaymentStatus(previous.status)
      const nextApplied = form.invNum && isSettledPaymentStatus(form.status)
      if (prevApplied && nextApplied && previous.invNum === form.invNum) {
        const delta = amountNum - Number(previous.amount || 0)
        if (Math.abs(delta) > 0.0001) {
          if (delta > 0) await applyPaymentToInvoice(form.invNum, delta)
          else await reversePaymentFromInvoice(form.invNum, Math.abs(delta))
        }
      } else {
        if (prevApplied) await reversePaymentFromInvoice(previous.invNum, previous.amount)
        try {
          if (nextApplied) await applyPaymentToInvoice(form.invNum, amountNum)
        } catch (invoiceErr) {
          if (prevApplied) await applyPaymentToInvoice(previous.invNum, previous.amount).catch(()=>{})
          throw invoiceErr
        }
      }
    } catch (invoiceErr) {
      // Revert the payment row if invoice reconciliation failed, so the two
      // ledgers never silently drift apart.
      if (editId && previous) {
        const { id, tenant_id, created_at, ...restore } = previous
        await supabase.from('payments').update(restore).eq('id',editId)
      } else if (insertedPaymentId) {
        await supabase.from('payments').delete().eq('id',insertedPaymentId)
      }
      setSaving(false)
      showToast('Invoice sync failed: ' + (invoiceErr?.message || invoiceErr))
      return
    }

    setSaving(false)
    showToast('✅ Payment recorded!')
    const actor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    await triggerWorkflow('payment_received', 'client', form.clientName, actor).catch(()=>{})
    await logActivity(supabase,{employeeName:actor,action:'payment_recorded',category:'payment',description:`Recorded payment $${form.amount} — ${form.clientName}`,entityName:form.clientName,meta:{amount:form.amount,method:form.method}}).catch(()=>{})
    setModal(false); setForm(BLANK); setEditId(null); load()
  }

  function openEdit(p) {
    setForm({...BLANK,...p}); setEditId(p.id); setModal(true)
  }

  async function deleteItem(id) {
    setConfirmDel(id)
  }
  async function confirmDeleteItem() {
    if (!confirmDel) return
    const row = items.find(i => i.id === confirmDel)
    const { error } = await supabase.from('payments').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    // Deleting a recorded payment must give the money back to the invoice,
    // or the invoice keeps showing collected funds that no longer exist.
    if (row?.invNum && (isSettledPaymentStatus(row.status) || isSettledPaymentStatus(row.payment_status))) {
      try {
        await reversePaymentFromInvoice(row.invNum, row.amount)
      } catch (invoiceErr) {
        showToast('Payment deleted, but invoice sync failed: ' + (invoiceErr?.message || invoiceErr))
        setConfirmDel(null)
        load()
        return
      }
    }
    setItems(prev => prev.filter(i => i.id !== confirmDel)); setConfirmDel(null); showToast('Deleted')
  }

  const cleared = items.filter(p=>['Cleared','paid','Posted','completed'].includes(p.status)).reduce((s,p)=>s+parseFloat(p.amount||0),0)
  const pending = items.filter(p=>['Pending','TBD','No Status','New Agmt'].includes(p.status)).reduce((s,p)=>s+parseFloat(p.amount||0),0)

  const filtered = items.filter(p=>{
    const q = search.toLowerCase()
    const ms = !q || (p.clientName||p.clientname)?.toLowerCase().includes(q) || p.invNum?.includes(q)
    const mm = filterMethod==='All' || p.method===filterMethod
    const ms2 = filterStatus==='All' || p.status===filterStatus
    return ms && mm && ms2
  })

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortCol] || ''
    let bv = b[sortCol] || ''
    if (sortCol === 'amount') { av = parseFloat(av||0); bv = parseFloat(bv||0) }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase() }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  // Group by method for breakdown
  const byMethod = {}
  items.filter(p=>p.status==='Cleared').forEach(p=>{ byMethod[p.method||'Other']=(byMethod[p.method||'Other']||0)+parseFloat(p.amount||0) })


  function printReceipt(pay) {
    const w = window.open('','_blank','width=600,height=700')
    const date = pay.date ? new Date(pay.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payment Receipt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif}
  body{padding:40px;max-width:500px;margin:auto;color:#111}
  .center{text-align:center}
  .firm{font-size:18px;font-weight:900;color:#1A7FD4;margin-bottom:4px}
  .sub{font-size:11px;color:#64748b;margin-bottom:24px}
  .receipt-title{font-size:22px;font-weight:700;margin:20px 0 4px}
  .check{font-size:48px;margin:16px 0}
  .amount{font-size:32px;font-weight:900;color:#16a34a;margin:12px 0}
  .row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
  .row:last-child{border-bottom:none}
  .label{color:#64748b}
  .value{font-weight:600}
  .box{background:#f8fafc;border-radius:10px;padding:16px 20px;margin:20px 0}
  .footer{text-align:center;font-size:11px;color:#94a3b8;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0}
  @media print{.no-print{display:none}}
</style></head><body onload="window.print()">
  <div class="no-print" style="text-align:center;margin-bottom:20px">
    <button onclick="window.print()" style="padding:8px 24px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">🖨️ Print Receipt</button>
  </div>
  <div class="center">
    <div class="firm">${FIRM.name || 'Tax Case Review'}</div>
    <div class="sub">${FIRM.tagline || 'IRS Resolution Services'}</div>
    <div class="check">✅</div>
    <div class="receipt-title">Payment Receipt</div>
    <div class="amount">$${Number(pay.amount||0).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
  </div>
  <div class="box">
    <div class="row"><span class="label">Client</span><span class="value">${pay.clientName||pay.clientname||'—'}</span></div>
    <div class="row"><span class="label">Date</span><span class="value">${date}</span></div>
    <div class="row"><span class="label">Method</span><span class="value">${pay.method||'—'}</span></div>
    <div class="row"><span class="label">Status</span><span class="value">${pay.status||'Cleared'}</span></div>
    ${pay.notes?`<div class="row"><span class="label">Notes</span><span class="value">${pay.notes}</span></div>`:''}
    ${pay.reference?`<div class="row"><span class="label">Reference</span><span class="value">${pay.reference}</span></div>`:''}
  </div>
  <div class="footer">${[FIRM.name, FIRM.address].filter(Boolean).join(' · ')} · Not a Law Firm</div>
</body></html>`)
    w.document.close()
  }

  return (
    <div style={{maxWidth:1000}}>
      {toast&&<div className="toast show">{toast}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>💳 Payments</h2>
        <button className="btn pri" onClick={()=>{setForm(BLANK);setEditId(null);setModal(true)}}>+ Record Payment</button>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:8,marginBottom:14}}>
        {[
          ['Total Collected','$'+Math.round(cleared).toLocaleString(),'var(--ok)'],
          ['Pending','$'+Math.round(pending).toLocaleString(),'var(--warn)'],
          ['Payments',items.length,'var(--blue)'],
          ['Failed',items.filter(p=>p.status==='Failed').length,'var(--bad)'],
        ].map(([label,val,color])=>(
          <div key={label} className="card" style={{padding:'10px 12px',textAlign:'center'}}>
            <div style={{fontWeight:800,fontSize:18,color,lineHeight:1}}>{val}</div>
            <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Autopay */}
      <div className="card" style={{marginBottom:14}}>
        <div className="ch">
          <span className="ct">🔁 Autopay</span>
          <button className="btn pri" disabled={running} onClick={runAutopayBatch}>{running?'Running…':'Run Today\u2019s Batch'}</button>
        </div>
        {(() => {
          const today = new Date().toISOString().slice(0,10)
          const autopayClients = clients.filter(c=>c.autopay_enabled)
          const due = autopayClients.filter(c=>c.autopay_next_charge && c.autopay_next_charge<=today)
          return autopayClients.length === 0 ? (
            <div style={{textAlign:'center',color:'var(--t3)',padding:'16px 0'}}>No clients on autopay yet. Enable it from a client's Overview tab.</div>
          ) : (
            <>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:10}}>{due.length} due today/overdue out of {autopayClients.length} on autopay</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {autopayClients.map(c=>(
                  <div key={c.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 10px',background:'var(--s2)',borderRadius:8,flexWrap:'wrap',gap:6}}>
                    <div>
                      <span style={{fontWeight:600,fontSize:13}}>{c.name}</span>
                      <span style={{fontSize:11,color:'var(--t3)',marginLeft:8}}>${c.autopay_amount} · {c.autopay_frequency} · next {c.autopay_next_charge||'—'}</span>
                      {!c.default_payment_method_id && <span style={{fontSize:11,color:'var(--bad)',marginLeft:8}}>⚠️ no payment method on file</span>}
                      {c.autopay_last_result && <span style={{fontSize:11,marginLeft:8,color:c.autopay_last_result==='succeeded'?'var(--ok)':'var(--bad)'}}>{c.autopay_last_result==='succeeded'?'✅':'❌'} last run</span>}
                    </div>
                    <button className="btn" style={{fontSize:11,padding:'4px 10px'}} disabled={running||!c.default_payment_method_id} onClick={()=>chargeClientNow(c)}>Charge Now</button>
                  </div>
                ))}
              </div>
              {batchLog.length>0 && (
                <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--br)'}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--t3)',marginBottom:6}}>Last batch run:</div>
                  {batchLog.map((r,i)=>(
                    <div key={i} style={{fontSize:12,color:r.ok?'var(--ok)':'var(--bad)'}}>{r.ok?'✅':'❌'} {r.name} — ${r.amount} {!r.ok && `(${r.msg})`}</div>
                  ))}
                </div>
              )}
            </>
          )
        })()}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,marginBottom:12,alignItems:'start'}}>
        {/* Filters */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search client or invoice #…"
            style={{flex:1,minWidth:160,padding:'7px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}/>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
            style={{padding:'7px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}>
            <option value="All">All Statuses</option>
            {['Cleared','Pending','Failed'].map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={filterMethod} onChange={e=>setFilterMethod(e.target.value)}
            style={{padding:'7px 10px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}>
            <option value="All">All Methods</option>
            {METHODS.map(m=><option key={m}>{m}</option>)}
          </select>
        </div>

        {/* Method breakdown mini */}
        {Object.keys(byMethod).length > 0 && (
          <div className="card" style={{padding:'8px 12px',fontSize:11,minWidth:180}}>
            <div style={{fontWeight:700,fontSize:10,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:6}}>By Method</div>
            {Object.entries(byMethod).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([m,v])=>(
              <div key={m} style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                <span style={{color:'var(--t2)'}}>{m}</span>
                <span style={{fontWeight:700}}>${Math.round(v).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {filtered.length===0 ? (
          <div style={{padding:24,textAlign:'center',color:'var(--t3)',fontSize:13}}>
            <div style={{fontSize:32,marginBottom:8}}>💰</div>
            <div style={{fontWeight:600,fontSize:14,color:'var(--tx)',marginBottom:4}}>{items.length===0?'No payments yet':'No payments match your filters'}</div>
            <div style={{fontSize:12}}>{items.length===0?'Click + Record Payment to log your first payment.':''}</div>
          </div>
        ) : (
          <div className="ovx"><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                {[
                  {label:'Client', col:'clientName'},
                  {label:'Invoice #', col:'invNum'},
                  {label:'Amount', col:'amount'},
                  {label:'Method', col:'method'},
                  {label:'Check #', col:'checkNum'},
                  {label:'Date', col:'date'},
                  {label:'Status', col:'status'},
                  {label:'', col:null},
                ].map(({label, col}) => (
                  <th key={label} onClick={col ? ()=>toggleSort(col) : undefined}
                    style={{padding:'9px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em',cursor:col?'pointer':'default',userSelect:'none',whiteSpace:'nowrap'}}>
                    {label}{col && sortCol===col ? (sortDir==='asc'?' ↑':' ↓') : col ? ' ↕' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(p=>(
                <tr key={p.id} style={{borderBottom:'1px solid var(--br)'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <td style={{padding:'9px 12px',fontWeight:600}}><ClientLink name={p.clientName || p.clientname} /></td>
                  <td style={{padding:'9px 12px',color:'var(--blue)',fontSize:11,fontWeight:600}}>{p.invNum||'—'}</td>
                  <td style={{padding:'9px 12px',fontWeight:700,color:'var(--ok)',fontSize:13}}>${parseFloat(p.amount||0).toLocaleString()}</td>
                  <td style={{padding:'9px 12px'}}><span className="bdg bn" style={{fontSize:10}}>{p.method}</span></td>
                  <td style={{padding:'9px 12px',color:'var(--t3)',fontSize:11}}>{p.checkNum||'—'}</td>
                  <td style={{padding:'9px 12px',color:'var(--t2)'}}>{p.date||'—'}</td>
                  <td style={{padding:'9px 12px'}}><span className={`bdg ${p.status==='Cleared'?'bg':p.status==='Failed'?'br':'ba'}`}>{p.status}</span></td>
                  <td style={{padding:'9px 12px'}}>
                    <div style={{display:'flex',gap:5}}>
                      <button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>openEdit(p)}>Edit</button>
                      <button className="btn sec" style={{fontSize:12,padding:'4px 10px',marginRight:2}} onClick={()=>printReceipt(p)}>🖨️</button>
                    <button className="btn del" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>deleteItem(p.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Modal */}
      {modal&&(
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&(setModal(false),setEditId(null))}>
          <div className="modal" style={{width:560}}>
            <div className="mh">
              <span className="mt">{editId?'Edit Payment':'Record Payment'}</span>
              <button className="xbtn" onClick={()=>{setModal(false);setEditId(null)}}>&times;</button>
            </div>

            {/* Invoice quick-link */}
            {invSug.length>0&&(
              <div style={{background:'var(--s3)',borderRadius:7,padding:10,marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',marginBottom:6}}>Open Invoices for this Client</div>
                {invSug.map(inv=>{
                  const bal = parseFloat(inv.total||0)-parseFloat(inv.paid||0)
                  return (
                    <div key={inv.id} onClick={()=>selectInvoice(inv)}
                      style={{padding:'6px 10px',cursor:'pointer',borderRadius:5,fontSize:12,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3,background:'var(--s2)'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--s3)'}
                      onMouseLeave={e=>e.currentTarget.style.background='var(--s2)'}>
                      <span style={{fontWeight:600}}>{inv.invNum}</span>
                      <span style={{color:'var(--warn)',fontWeight:700}}>Balance: ${bal.toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="field" style={{position:'relative'}}>
              <label>Client *</label>
              <input value={form.clientName} onChange={e=>searchClient(e.target.value)}
                placeholder="Search client…" autoComplete="off"
                onBlur={()=>setTimeout(()=>setShowSug(false),150)}/>
              {showSug&&suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--s3)',border:'1px solid var(--b2c)',borderRadius:7,zIndex:500}}>
                  {suggestions.map(c=>(
                    <div key={c.id} onClick={()=>{fld('clientName',c.name);fld('client_id',c.id);setSug([]);setShowSug(false);setInvSug(invoices.filter(i=>(i.client_id?i.client_id===c.id:i.clientName===c.name)&&i.status!=='Paid').slice(0,4))}}
                      style={{padding:'8px 12px',cursor:'pointer',fontSize:13}}>{c.name}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label>Invoice # (optional)</label>
              <input value={form.invNum} onChange={e=>fld('invNum',e.target.value)} placeholder="INV-XXXXXX"/>
            </div>

            <div className="fg2">
              <div className="field">
                <label>Amount *</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}>$</span>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(form.amount)} onChange={e=>fld('amount',parseMoney(e.target.value))} style={{paddingLeft:22}} placeholder="0.00"/>
                </div>
              </div>
              <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e=>fld('date',e.target.value)}/></div>
            </div>

            <div className="fg2">
              <div className="field"><label>Method</label>
                <select value={form.method} onChange={e=>fld('method',e.target.value)}>
                  {METHODS.map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="field"><label>Check # (if check)</label><input value={form.checkNum||''} onChange={e=>fld('checkNum',e.target.value)} placeholder="Optional"/></div>
            </div>

            <div className="fg2">
              <div className="field"><label>Status</label>
                <select value={form.status} onChange={e=>fld('status',e.target.value)}>
                  {['Cleared','Pending','Failed'].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field"><label>Notes</label><input value={form.notes||''} onChange={e=>fld('notes',e.target.value)}/></div>
              <div className="field"><label>Reference / Memo</label><input value={form.reference||''} onChange={e=>fld('reference',e.target.value)} placeholder="e.g. Canopy ID, check memo, confirmation #"/></div>
            </div>

            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={save} disabled={saving}>
              {saving?'Saving…':editId?'Update Payment':'Record Payment'}
            </button>
          </div>
        </div>
      )}
      <DeleteConfirmModal open={!!confirmDel} label="payment" onConfirm={confirmDeleteItem} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}


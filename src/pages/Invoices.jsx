import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { logActivity, getActor } from '../lib/activityLog'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import { sendGmailEmail } from '../lib/gmailUtils'
import { useApp } from '../context/AppContext'
import { useFirm } from '../lib/useFirm'
import { generateInvoicePdfBase64 } from '../lib/invoicePdf'
import ClientLink from '../components/ClientLink'
import { applyPaymentToInvoice } from '../lib/invoiceSync'

const BLANK = { clientName:'', client_id:'', caseNum:'', lineItems:'', total:'', paid:'0', dueDate:'', taxRate:'0', status:'Unpaid', notes:'' }
const SERVICE_TEMPLATES = [
  'OIC Representation Services',
  'Installment Agreement Setup',
  'IRS Transcript Analysis',
  'Penalty Abatement Filing',
  'Audit Representation',
  'Tax Return Preparation',
  'Power of Attorney Filing',
  'CDP Hearing Representation',
  'Lien Discharge/Subordination',
  'Wage Garnishment Release',
]

function SBdg({s}) {
  const m = {Paid:'bg',Partial:'ba',Overdue:'br',Unpaid:'bn'}
  return <span className={`bdg ${m[s]||'bn'}`}>{s}</span>
}

export default function Invoices() {
  const { user } = useApp()
  const [items,    setItems]    = useState([])
  const [clients,  setClients]  = useState([])
    const [modal,    setModal]    = useState(false)
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') { setForm(BLANK); setEditId(null); setModal(true) } }, [searchParams])
  const [editId,   setEditId]   = useState(null)
  const [form,     setForm]     = useState(BLANK)
  const [saving,   setSaving]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [toast,    setToast]    = useState('')
  const [search,   setSearch]   = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [suggestions, setSug]   = useState([])
  const [showSug,  setShowSug]  = useState(false)
  const [cases,    setCases]    = useState([])
  const firm = useFirm()

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data:inv },{ data:cl },{ data:cs }] = await Promise.all([
      supabase.from('invoices').select('*').order('created_at',{ascending:false}),
      supabase.from('clients').select('id,name,email,assignedTo'),
      supabase.from('cases').select('clientName,caseNum,created_at').order('created_at',{ascending:false})
    ])
    if (inv) setItems(inv)
    if (cl)  setClients(cl)
    if (cs)  setCases(cs)
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(''),3000) }
  function fld(k,v) { setForm(f=>({...f,[k]:v})) }

  function searchClient(val) {
    fld('clientName',val)
    fld('client_id','')
    if (val.length < 2) { setSug([]); setShowSug(false); return }
    const matches = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSug(matches); setShowSug(matches.length > 0)
  }

  function selectClient(c) {
    fld('clientName', c.name)
    fld('client_id', c.id)
    // Auto-fill Case # from this client's most recent case, if they have one
    const match = cases.find(cs => cs.clientName === c.name)
    if (match) fld('caseNum', match.caseNum)
    setSug([]); setShowSug(false)
  }

  const subtotal = parseFloat(form.total||0)
  const paid     = parseFloat(form.paid||0)
  const tax      = subtotal * (parseFloat(form.taxRate||0)/100)
  const balance  = (subtotal + tax) - paid

  async function save() {
    if (!form.clientName || !form.total) { showToast('Client and total required'); return }
    setSaving(true)
    const statusCalc = paid >= (subtotal+tax) ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid'
    if (editId) {
      const {error} = await supabase.from('invoices').update({...form, status:statusCalc, updated_at:new Date().toISOString()}).eq('id',editId)
      if (error) { showToast('Error: '+error.message); setSaving(false); return }
      showToast('✅ Invoice updated!')
    } else {
      // Invoice number is assigned atomically by the database per tenant.
      const {error} = await supabase.from('invoices').insert([{...form, status:statusCalc, created_at:new Date().toISOString()}])
      if (error) { showToast('Error: '+error.message); setSaving(false); return }
      showToast('✅ Invoice created!')
    }
    setSaving(false); setModal(false); setForm(BLANK); setEditId(null); load()
  }

  function openEdit(inv) {
    setForm({...BLANK,...inv})
    setEditId(inv.id)
    setModal(true)
  }

  async function sendInvoiceEmail(inv, isReminder = false) {
    // Prefer the stable client id; keep a bounded name fallback only for legacy rows.
    let client = null
    if (inv.client_id) {
      const { data } = await supabase.from('clients').select('id,email').eq('id', inv.client_id).maybeSingle()
      client = data
    }
    if (!client) {
      const { data } = await supabase.from('clients').select('id,email').eq('name', inv.clientName).limit(1)
      client = data?.[0] || null
    }
    const { data: leadRows } = client ? { data: [] } : await supabase.from('leads').select('email').eq('name', inv.clientName).limit(1)
    const to = client?.email || leadRows?.[0]?.email
    if (!to) { showToast('No email on file for this client'); return }

    const invNum = inv.invNum || inv.id?.slice(-6) || ''
    const subtotal = parseFloat(inv.total||0)
    const taxRate  = parseFloat(inv.taxRate||0)
    const tax      = subtotal * (taxRate/100)
    const paid     = parseFloat(inv.paid||0)
    const balance  = (subtotal + tax) - paid
    const payLink  = client?.id ? `${window.location.origin}/portal/${client.id}?section=payments` : null
    const subject = isReminder
      ? `Payment Reminder — Invoice #${invNum} — ${firm.name}`
      : `Invoice #${invNum} — ${firm.name}`
    const breakdown = `Subtotal: $${subtotal.toLocaleString()}`
      + (taxRate>0 ? `\nTax (${taxRate}%): $${tax.toLocaleString()}` : '')
      + (paid>0 ? `\nPaid: -$${paid.toLocaleString()}` : '')
      + `\nBalance Due: $${balance.toLocaleString()}`

    // Attach the real branded PDF on the initial send (not on reminders —
    // those are just a nudge about an invoice already sent).
    let attachments = []
    let attachedOk = false
    if (!isReminder) {
      try {
        const base64Data = await generateInvoicePdfBase64(inv, firm)
        attachments = [{ filename: `Invoice-${invNum}.pdf`, mimeType: 'application/pdf', base64Data }]
        attachedOk = true
      } catch (e) {
        // Don't block sending the invoice over a PDF generation hiccup —
        // just fall back to the plain-text breakdown below.
        console.error('Invoice PDF generation failed:', e)
      }
    }

    const body = isReminder
      ? `Dear ${inv.clientName},

This is a friendly reminder that Invoice #${invNum} for $${balance.toLocaleString()} is due on ${inv.dueDate||'soon'} and remains unpaid.${payLink ? `\n\n━━━━━━━━━━━━━━━━━━━━━\n💳 PAY ONLINE (SECURE)\n${payLink}\n━━━━━━━━━━━━━━━━━━━━━` : ''}

Please contact our office if you have any questions.`
      : `Dear ${inv.clientName},

${attachedOk ? 'Please find your invoice attached.' : 'Here are the details for your invoice:'}

Invoice #: ${invNum}
Due Date: ${inv.dueDate||'Upon receipt'}

${breakdown}
${payLink ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💳 PAY ONLINE — SECURE CLIENT PORTAL\n\nCurrent Balance Due: $${balance.toLocaleString('en-US',{minimumFractionDigits:2})}\n\nClick the link below to make a payment, set up a monthly payment plan, or view your payment history:\n${payLink}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

Please contact our office with any questions.`

    try {
      await sendGmailEmail(supabase, { to, subject, body, attachments })
      await supabase.from('invoices').update({ status: isReminder ? inv.status : 'Sent', updated_at: new Date().toISOString() }).eq('id', inv.id)
      showToast(`✅ ${isReminder ? 'Reminder' : 'Invoice'} sent to ${to}`)
      const actorI = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
      if (!isReminder) { await triggerWorkflow('invoice_sent', 'client', inv?.clientName || '', actorI).catch(()=>{}); await logActivity(supabase,{employeeName:actorI,action:'invoice_sent',category:'invoice',description:`Sent invoice #${invNum} ($${balance.toLocaleString()}) → ${inv.clientName}`,entityName:inv.clientName,meta:{amount:balance,invNum}}).catch(()=>{}) }
      load()
    } catch (e) {
      showToast('Email error: ' + e.message)
    }
  }

  async function recordPayment(inv) {
    const subtotal = parseFloat(inv.total || 0)
    const taxRate = parseFloat(inv.taxRate || 0)
    const invoiceTotal = subtotal + (subtotal * taxRate / 100)
    const previouslyPaid = parseFloat(inv.paid || 0)
    const remaining = Math.max(0, invoiceTotal - previouslyPaid)
    const amount = prompt(`Record payment for Invoice #${inv.invNum||inv.id?.slice(-6)||''}.\nEnter amount received:`, remaining.toFixed(2))
    if (!amount) return
    const paymentAmount = parseFloat(amount)
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) { showToast('Enter a valid payment amount'); return }

    const { data: paymentRow, error: paymentErr } = await supabase.from('payments').insert([{
      clientName: inv.clientName,
      client_id: inv.client_id || null,
      amount: String(paymentAmount),
      method: 'Manual',
      invNum: inv.invNum || null,
      invoiceId: inv.id,
      status: 'Cleared',
      notes: `Payment for Invoice #${inv.invNum||''}`,
      created_at: new Date().toISOString()
    }]).select('id').single()
    if (paymentErr) { showToast('Payment save failed: ' + paymentErr.message); return }

    try {
      await applyPaymentToInvoice(inv.invNum, paymentAmount)
    } catch (invoiceErr) {
      if (paymentRow?.id) await supabase.from('payments').delete().eq('id',paymentRow.id)
      showToast('Invoice sync failed: ' + (invoiceErr?.message || invoiceErr))
      return
    }

    showToast(`✅ Payment of ${paymentAmount.toLocaleString()} recorded`)
    load()
  }

  async function markPaid(inv) {
    const subtotal = parseFloat(inv.total||0)
    const taxRate = parseFloat(inv.taxRate||0)
    const total = subtotal + (subtotal * taxRate / 100)
    const {error} = await supabase.from('invoices').update({paid:String(total), status:'Paid', updated_at:new Date().toISOString()}).eq('id',inv.id)
    if (error) { showToast('Error: ' + error.message); return }
    showToast('✅ Marked as Paid!')
    const actorIP = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    await triggerWorkflow('invoice_paid', 'client', inv?.clientName || '', actorIP).catch(()=>{})
    await logActivity(supabase,{employeeName:actorIP,action:'invoice_paid',category:'invoice',description:`Marked invoice paid — ${inv.clientName}`,entityName:inv.clientName,meta:{invNum:inv.invNum}}).catch(()=>{})
    load()
  }

  async function deleteItem(id) { setConfirmDel(id) }
  async function confirmDeleteInvoice() {
    const { error } = await supabase.from('invoices').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setItems(prev => prev.filter(i => i.id !== confirmDel)); setConfirmDel(null); showToast('Deleted')
  }

  const totalInvoiced = items.reduce((s,i)=>s+parseFloat(i.total||0),0)
  const totalPaid     = items.reduce((s,i)=>s+parseFloat(i.paid||0),0)
  const totalOwed     = totalInvoiced - totalPaid
  const overdue       = items.filter(i=>i.status==='Overdue'||( i.dueDate && new Date(i.dueDate)<new Date() && i.status!=='Paid')).length

  const filtered = items.filter(i => {
    const q = search.toLowerCase()
    const matchSearch = !q || i.clientName?.toLowerCase().includes(q) || i.invNum?.includes(q)
    const matchStatus = filterStatus==='All' || i.status===filterStatus
    return matchSearch && matchStatus
  })


  function printInvoice(inv) {
    const w = window.open('','_blank','width=800,height=900')
    const date = inv.date ? new Date(inv.date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
    const dueDate = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : 'Upon Receipt'
    const subtotal = parseFloat(inv.total||0)
    const taxRate  = parseFloat(inv.taxRate||0)
    const tax      = subtotal * (taxRate/100)
    const paid     = parseFloat(inv.paid||0)
    const balance  = (subtotal + tax) - paid
    const lineRows = (inv.lineItems||'Professional Tax Resolution Services').split('\n').filter(Boolean)
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoice ${inv.invNum||inv.id?.slice(-6)||''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif}
  body{padding:40px;color:#111;font-size:13px;line-height:1.5;max-width:720px;margin:auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:3px solid #1A7FD4}
  .firm-name{font-size:22px;font-weight:900;color:#1A7FD4}
  .firm-sub{font-size:11px;color:#64748b;margin-top:2px}
  .inv-title{font-size:28px;font-weight:900;color:#111;text-align:right}
  .inv-num{font-size:13px;color:#64748b;text-align:right;margin-top:4px}
  .status-badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:6px;
    background:${inv.status==='Paid'?'#dcfce7':inv.status==='Overdue'?'#fee2e2':'#fef9c3'};
    color:${inv.status==='Paid'?'#166534':inv.status==='Overdue'?'#991b1b':'#854d0e'}}
  .section{display:flex;gap:40px;margin-bottom:28px}
  .section-block{flex:1}
  .section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:6px}
  .section-value{font-size:13px;font-weight:600;color:#111}
  .section-sub{font-size:12px;color:#64748b;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  thead tr{background:#f1f5f9}
  th{padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:1px solid #e2e8f0}
  td{padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px}
  .totals{margin-left:auto;width:280px;margin-bottom:24px}
  .totals-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:#475569}
  .totals-row.due{font-weight:800;font-size:16px;color:#111;border-top:2px solid #1A7FD4;padding-top:10px;margin-top:4px}
  .notes{background:#f8fafc;border-radius:8px;padding:14px 16px;margin-bottom:24px;font-size:12px;color:#64748b;line-height:1.7}
  .footer{text-align:center;font-size:11px;color:#94a3b8;margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0}
  @media print{body{padding:20px}.no-print{display:none}}
</style></head><body onload="window.print()">
  <div class="no-print" style="text-align:center;margin-bottom:20px">
    <button onclick="window.print()" style="padding:8px 24px;background:#1A7FD4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">🖨️ Print / Save PDF</button>
  </div>
  <div class="header">
    <div style="display:flex;align-items:center;gap:12px">
      ${firm.logoUrl ? `<img src="${firm.logoUrl}" style="height:48px;width:auto;object-fit:contain" onerror="this.style.display='none'"/>` : ''}
      <div>
        <div class="firm-name">${firm.name}</div>
        <div class="firm-sub">${firm.tagline}</div>
        <div class="firm-sub">${firm.address || '631 US Highway One Ste 304, North Palm Beach, FL 33408'}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div class="inv-title">INVOICE</div>
      <div class="inv-num">#${inv.invNum||inv.id?.slice(-6)||'INV-001'}</div>
      <div><span class="status-badge">${inv.status||'Unpaid'}</span></div>
    </div>
  </div>
  <div class="section">
    <div class="section-block">
      <div class="section-label">Bill To</div>
      <div class="section-value">${inv.clientName||'Client'}</div>
      ${inv.caseNum?`<div class="section-sub">Case #${inv.caseNum}</div>`:''}
    </div>
    <div class="section-block">
      <div class="section-label">Invoice Date</div>
      <div class="section-value">${date}</div>
    </div>
    <div class="section-block">
      <div class="section-label">Due Date</div>
      <div class="section-value">${dueDate}</div>
    </div>
    <div class="section-block">
      <div class="section-label">Balance Due</div>
      <div class="section-value" style="color:#1A7FD4;font-size:18px">$${balance.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
    </div>
  </div>
  <div className="ovx"><table>
    <thead><tr><th>Description</th></tr></thead>
    <tbody>
      ${lineRows.map(r=>`<tr><td>${r}</td></tr>`).join('')}
    </tbody>
  </table>
  <div class="totals">
    <div class="totals-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    ${taxRate>0?`<div class="totals-row"><span>Tax (${taxRate}%)</span><span>$${tax.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>`:''}
    ${paid>0?`<div class="totals-row"><span>Amount Paid</span><span>-$${paid.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>`:''}
    <div class="totals-row due"><span>Balance Due</span><span>$${balance.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
  </div>
  ${inv.notes?`<div class="notes"><strong>Notes:</strong> ${inv.notes}</div>`:''}
  <div class="footer">
    ${firm.footer()}<br/>
    Thank you for your business.
  </div>
</body></html>`)
    w.document.close()
  }

  return (
    <div style={{maxWidth:1000}}>
      {toast && <div className="toast show">{toast}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>🧾 Invoices</h2>
        <button className="btn pri" onClick={()=>{setForm(BLANK);setEditId(null);setModal(true)}}>+ New Invoice</button>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8,marginBottom:14}}>
        {[
          ['Total Invoiced','$'+Math.round(totalInvoiced).toLocaleString(),'var(--tx)'],
          ['Collected','$'+Math.round(totalPaid).toLocaleString(),'var(--ok)'],
          ['Outstanding','$'+Math.round(totalOwed).toLocaleString(),totalOwed>0?'var(--warn)':'var(--t2)'],
          ['Overdue',overdue,overdue>0?'var(--bad)':'var(--t2)'],
          ['Paid',items.filter(i=>i.status==='Paid').length,'var(--ok)'],
          ['Unpaid',items.filter(i=>i.status==='Unpaid').length,'var(--warn)'],
        ].map(([label,val,color])=>(
          <div key={label} className="card" style={{padding:'10px 12px',textAlign:'center'}}>
            <div style={{fontWeight:800,fontSize:18,color,lineHeight:1}}>{val}</div>
            <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search client or invoice #…"
          style={{flex:1,minWidth:160,padding:'7px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}/>
        {['All','Unpaid','Partial','Paid','Overdue'].map(s=>(
          <button key={s} className={`btn ${filterStatus===s?'pri':'sec'}`}
            style={{fontSize:10,padding:'4px 10px'}} onClick={()=>setFilterStatus(s)}>{s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {filtered.length===0 ? (
          <div style={{textAlign:'center',padding:'40px 20px',color:'var(--t3)'}}>
            <div style={{fontSize:32,marginBottom:8}}>🧾</div>
            <div style={{fontWeight:600,fontSize:14,color:'var(--tx)',marginBottom:4}}>{items.length===0?'No invoices yet':'No invoices match your filters'}</div>
            <div style={{fontSize:12}}>{items.length===0?'Click + New Invoice to create your first invoice.':''}</div>
          </div>
        ) : (
          <div className="ovx"><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                {['Invoice #','Client','Total','Paid','Balance','Due Date','Status','Actions'].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv=>{
                const t=parseFloat(inv.total||0), p=parseFloat(inv.paid||0), bal=t-p
                const isOverdue = inv.dueDate && new Date(inv.dueDate)<new Date() && inv.status!=='Paid'
                return (
                  <tr key={inv.id} style={{borderBottom:'1px solid var(--br)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{padding:'9px 12px',fontWeight:700,color:'var(--blue)',fontSize:11}}>{inv.invNum}</td>
                    <td style={{padding:'9px 12px',fontWeight:600}}><ClientLink name={inv.clientName} /></td>
                    <td style={{padding:'9px 12px',fontWeight:600}}>${t.toLocaleString()}</td>
                    <td style={{padding:'9px 12px',color:'var(--ok)'}}>${p.toLocaleString()}</td>
                    <td style={{padding:'9px 12px',fontWeight:bal>0?700:400,color:bal>0?'var(--warn)':'var(--t2)'}}>${bal.toLocaleString()}</td>
                    <td style={{padding:'9px 12px',color:isOverdue?'var(--bad)':'var(--t2)',fontWeight:isOverdue?700:400}}>{inv.dueDate||'—'}</td>
                    <td style={{padding:'9px 12px'}}><SBdg s={isOverdue&&inv.status!=='Paid'?'Overdue':inv.status||'Unpaid'}/></td>
                    <td style={{padding:'9px 8px'}}>
                      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                        <button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>openEdit(inv)}>✏️</button>
                        {inv.status!=='Paid'&&<button className="btn" style={{fontSize:12,padding:'4px 10px',background:'var(--ok)',color:'#fff',border:'none',borderRadius:5,cursor:'pointer'}} onClick={()=>markPaid(inv)}>✓ Paid</button>}
                        {inv.status!=='Paid'&&<button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>recordPayment(inv)}>💳</button>}
                        <button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>sendInvoiceEmail(inv)}>📧</button>
                        {isOverdue&&<button className="btn sec" style={{fontSize:10,padding:'3px 6px',color:'var(--warn)'}} onClick={()=>sendInvoiceEmail(inv,true)}>⚠️ Remind</button>}
                        <button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>printInvoice(inv)}>🖨️</button>
                        <button className="btn del" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>deleteItem(inv.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {/* Modal */}
      {modal&&(
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&(setModal(false),setEditId(null))}>
          <div className="modal" style={{width:600}}>
            <div className="mh">
              <span className="mt">{editId?'Edit Invoice':'New Invoice'}</span>
              <button className="xbtn" onClick={()=>{setModal(false);setEditId(null)}}>&times;</button>
            </div>

            {/* Client search */}
            <div className="field" style={{position:'relative'}}>
              <label>Client *</label>
              <input value={form.clientName} onChange={e=>searchClient(e.target.value)}
                placeholder="Search client name…" autoComplete="off"
                onBlur={()=>setTimeout(()=>setShowSug(false),150)}
                onFocus={()=>form.clientName.length>=2&&setShowSug(suggestions.length>0)}/>
              {showSug&&suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--s3)',border:'1px solid var(--b2c)',borderRadius:7,zIndex:500,maxHeight:160,overflowY:'auto'}}>
                  {suggestions.map(c=>(
                    <div key={c.id} onClick={()=>selectClient(c)}
                      style={{padding:'8px 12px',cursor:'pointer',fontSize:13,borderBottom:'1px solid var(--br)'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>{c.name}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="fg2">
              <div className="field"><label>Case #</label><input value={form.caseNum} onChange={e=>fld('caseNum',e.target.value)} placeholder="Auto-fills from client's case, or type manually"/></div>
              <div className="field"><label>Due Date</label><input type="date" value={form.dueDate} onChange={e=>fld('dueDate',e.target.value)}/></div>
            </div>

            {/* Line items with templates */}
            <div className="field">
              <label style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Services / Line Items</span>
                <select onChange={e=>{if(e.target.value)fld('lineItems',(form.lineItems?form.lineItems+'\n':'')+e.target.value);e.target.value=''}}
                  style={{fontSize:10,padding:'2px 6px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:4,color:'var(--tx)'}}>
                  <option value="">+ Add Template</option>
                  {SERVICE_TEMPLATES.map(t=><option key={t}>{t}</option>)}
                </select>
              </label>
              <textarea value={form.lineItems} onChange={e=>fld('lineItems',e.target.value)}
                rows={4} placeholder="e.g. OIC Representation Services - $2,500&#10;IRS Transcript Request - $150"
                style={{minHeight:80,resize:'vertical'}}/>
            </div>

            <div className="fg2">
              <div className="field">
                <label>Total Amount *</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}>$</span>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(form.total)} onChange={e=>fld('total',parseMoney(e.target.value))} style={{paddingLeft:22}} placeholder="0.00"/>
                </div>
              </div>
              <div className="field">
                <label>Amount Paid</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}>$</span>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(form.paid)} onChange={e=>fld('paid',parseMoney(e.target.value))} style={{paddingLeft:22}} placeholder="0.00"/>
                </div>
              </div>
            </div>

            <div className="fg2">
              <div className="field"><label>Tax Rate %</label><input type="number" value={form.taxRate} onChange={e=>fld('taxRate',e.target.value)} placeholder="0"/></div>
              <div className="field"><label>Status</label>
                <select value={form.status} onChange={e=>fld('status',e.target.value)}>
                  {['Unpaid','Partial','Paid','Overdue'].map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {/* Live preview */}
            {(parseFloat(form.total)||0) > 0 && (
              <div style={{background:'var(--s3)',borderRadius:7,padding:'10px 14px',marginBottom:10,fontSize:12.5}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'var(--t2)'}}>Subtotal</span><span>${subtotal.toLocaleString()}</span></div>
                {parseFloat(form.taxRate||0)>0&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4,color:'var(--t3)'}}><span>Tax ({form.taxRate}%)</span><span>${tax.toFixed(2)}</span></div>}
                {paid>0&&<div style={{display:'flex',justifyContent:'space-between',marginBottom:4,color:'var(--ok)'}}><span>Paid</span><span>-${paid.toLocaleString()}</span></div>}
                <div style={{display:'flex',justifyContent:'space-between',fontWeight:700,borderTop:'1px solid var(--br)',paddingTop:6}}>
                  <span>Balance Due</span>
                  <span style={{color:balance>0?'var(--warn)':'var(--ok)',fontSize:15}}>${balance.toFixed(2)}</span>
                </div>
              </div>
            )}

            <div className="field"><label>Notes</label><input value={form.notes||''} onChange={e=>fld('notes',e.target.value)} placeholder="Internal notes…"/></div>

            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={save} disabled={saving}>
              {saving?'Saving…':editId?'Update Invoice':'Create Invoice'}
            </button>
          </div>
        </div>
      )}

      <DeleteConfirmModal open={!!confirmDel} label="invoice" onConfirm={confirmDeleteInvoice} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}


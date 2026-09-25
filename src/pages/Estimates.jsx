import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { sendGmailEmail } from '../lib/gmailUtils'

const BLANK = { clientName:'', client_id:'', service:'', description:'', amount:'', depositAmount:'', validUntil:'', status:'Draft', assignedTo:'', notes:'' }
const SERVICES = ['OIC — Offer in Compromise','Installment Agreement (IA)','Currently Not Collectible (CNC)','Penalty Abatement','Audit Representation','Lien Release / Discharge','Wage Garnishment Release','IRS Appeals Representation','Tax Return Preparation','Transcript Analysis Package','CDP Hearing','Trust Fund Recovery Defense','Innocent Spouse Relief','Business Tax Resolution','Payroll Tax Representation']
const EST_STATUSES = ['Draft','Sent','In Review','Accepted','Rejected','Expired']

export default function Estimates() {
  const { myTenantId } = useApp()
  const [items,     setItems]    = useState([])
  const [clients,   setClients]  = useState([])
  const [employees, setEmployees]= useState([])
  const [modal,     setModal]    = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [editId,    setEditId]   = useState(null)
  const [form,      setForm]     = useState(BLANK)
  const [saving,    setSaving]   = useState(false)
  const [toast,     setToast]    = useState('')
  const [search,    setSearch]   = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [suggestions, setSug]    = useState([])
  const [showSug,   setShowSug]  = useState(false)

  useEffect(() => { if (myTenantId) load() }, [myTenantId])

  async function load() {
    const [{ data:e },{ data:c },{ data:emp }] = await Promise.all([
      supabase.from('estimates').select('*').eq('tenant_id', myTenantId).order('created_at',{ascending:false}),
      supabase.from('clients').select('id,name,email,issueType,assignedTo').eq('tenant_id', myTenantId),
      supabase.from('employees').select('name').eq('tenant_id', myTenantId),
    ])
    if (e)   setItems(e)
    if (c)   setClients(c)
    if (emp) setEmployees(emp)
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(''),3000) }
  function fld(k,v) { setForm(f=>({...f,[k]:v})) }

  function searchClient(val) {
    fld('clientName',val)
    fld('client_id','')
    if (val.length<2) { setSug([]); setShowSug(false); return }
    const matches = clients.filter(c=>c.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSug(matches); setShowSug(matches.length>0)
  }

  function selectClient(c) {
    fld('clientName', c.name)
    fld('client_id', c.id)
    if (c.assignedTo) fld('assignedTo', c.assignedTo)
    setSug([]); setShowSug(false)
  }

  async function save() {
    if (!form.clientName || !form.amount) { showToast('Client and amount required'); return }
    setSaving(true)
    if (editId) {
      const {error} = await supabase.from('estimates').update({...form, updated_at:new Date().toISOString()}).eq('id',editId)
      if (error) { showToast('Error: '+error.message); setSaving(false); return }
      showToast('✅ Estimate updated!')
    } else {
      const {error} = await supabase.from('estimates').insert([{...form, created_at:new Date().toISOString()}])
      if (error) { showToast('Error: '+error.message); setSaving(false); return }
      showToast('✅ Estimate created!')
    }
    setSaving(false); setModal(false); setForm(BLANK); setEditId(null); load()
  }

  async function sendEstimate(est) {
    let client = null
    if (est.client_id) {
      const { data } = await supabase.from('clients').select('email').eq('id', est.client_id).maybeSingle()
      client = data
    }
    if (!client) {
      const { data } = await supabase.from('clients').select('email').eq('name', est.clientName).limit(1)
      client = data?.[0] || null
    }
    const { data: leadRows } = client ? { data: [] } : await supabase.from('leads').select('email').eq('name', est.clientName).limit(1)
    const to = client?.email || leadRows?.[0]?.email
    if (!to) { showToast('No email on file for this client'); return }
    const subject = `Estimate #${est.estNum||''} — Tax Case Review`
    const body = `Dear ${est.clientName},\n\nPlease review the following estimate from Tax Case Review.\n\nEstimate #: ${est.estNum||''}\nAmount: $${parseFloat(est.amount||0).toLocaleString()}\nValid Until: ${est.validUntil||'30 days'}\n\nServices:\n${est.description||''}\n\nTo accept this estimate, please reply to this email or call our office.`
    try {
      await sendGmailEmail(supabase, { to, subject, body })
      await supabase.from('estimates').update({ status: 'Sent', updated_at: new Date().toISOString() }).eq('id', est.id)
      showToast(`✅ Estimate sent to ${to}`)
      load()
    } catch (e) { showToast('Email error: ' + e.message) }
  }

  async function convertToInvoice(est) {
    if (!confirm('Convert this estimate to an invoice?')) return
    const { data: createdInvoice, error } = await supabase.from('invoices').insert([{
      clientName: est.clientName, client_id: est.client_id || null, lineItems: est.service + (est.description?'\n'+est.description:''),
      total: est.amount, paid:'0', status:'Unpaid',
      created_at: new Date().toISOString()
    }]).select('id,invNum').single()
    if (error) { showToast('Error: '+error.message); return }
    await supabase.from('estimates').update({status:'Accepted', updated_at:new Date().toISOString()}).eq('id',est.id)
    showToast('✅ Converted to Invoice '+(createdInvoice?.invNum || '')+'!')
    load()
  }

  async function del(id) { setConfirmDel(id) }
  async function confirmDelEstimate() {
    const { error } = await supabase.from('estimates').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setItems(prev => prev.filter(i => i.id !== confirmDel)); setConfirmDel(null); showToast('Deleted')
  }

  const reps = employees.length>0 ? employees.map(e=>e.name) : ['Romy Cruz','Dana Richard','Yesenia Gonzalez']

  const filtered = items.filter(i=>{
    const q = search.toLowerCase()
    const ms = !q || i.clientName?.toLowerCase().includes(q) || i.estNum?.includes(q)
    const mst = filterStatus==='All' || i.status===filterStatus
    return ms && mst
  })

  const totalValue = items.reduce((s,e)=>s+parseFloat(e.amount||0),0)
  const accepted   = items.filter(e=>e.status==='Accepted').reduce((s,e)=>s+parseFloat(e.amount||0),0)

  return (
    <div style={{padding:'20px 24px',maxWidth:1100,margin:'0 auto'}}>
      {toast&&<div className="toast show">{toast}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:8}}>
        <h2 style={{fontSize:15,fontWeight:700,margin:0}}>📝 Estimates</h2>
        <button className="btn pri" onClick={()=>{setForm(BLANK);setEditId(null);setModal(true)}}>+ New Estimate</button>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8,marginBottom:14}}>
        {[
          ['Total Pipeline','$'+Math.round(totalValue).toLocaleString(),'var(--blue)'],
          ['Accepted','$'+Math.round(accepted).toLocaleString(),'var(--ok)'],
          ['Sent',items.filter(e=>e.status==='Sent'||e.status==='In Review').length,'var(--warn)'],
          ['Rejected',items.filter(e=>e.status==='Rejected').length,'var(--bad)'],
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
          placeholder="Search client or estimate #…"
          style={{flex:1,minWidth:160,padding:'7px 12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:12}}/>
        {['All',...EST_STATUSES].map(s=>(
          <button key={s} className={`btn ${filterStatus===s?'pri':'sec'}`}
            style={{fontSize:10,padding:'4px 10px'}} onClick={()=>setFilterStatus(s)}>{s}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        {filtered.length===0 ? (
          <div style={{textAlign:'center',padding:'40px 20px',color:'var(--t3)'}}>
            <div style={{fontSize:32,marginBottom:8}}>📝</div>
            <div style={{fontWeight:600,fontSize:14,color:'var(--tx)',marginBottom:4}}>{items.length===0?'No estimates yet':'No estimates match your filters'}</div>
            <div style={{fontSize:12}}>{items.length===0?'Click + New Estimate to get started.':''}</div>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--br)',background:'var(--s2)'}}>
                {['Est #','Client','Service','Amount','Deposit','Valid Until','Rep','Status','Actions'].map(h=>(
                  <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.05em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(est=>{
                const expired = est.validUntil && new Date(est.validUntil)<new Date() && est.status!=='Accepted'
                return (
                  <tr key={est.id} style={{borderBottom:'1px solid var(--br)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--s2)'}
                    onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{padding:'9px 12px',fontWeight:700,color:'var(--blue)',fontSize:11}}>{est.estNum||'—'}</td>
                    <td style={{padding:'9px 12px',fontWeight:600}}>{est.clientName}</td>
                    <td style={{padding:'9px 12px',color:'var(--t2)',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{est.service||'—'}</td>
                    <td style={{padding:'9px 12px',fontWeight:700,fontSize:13}}>${parseFloat(est.amount||0).toLocaleString()}</td>
                    <td style={{padding:'9px 12px',color:'var(--t2)'}}>{est.depositAmount?'$'+parseFloat(est.depositAmount).toLocaleString():'—'}</td>
                    <td style={{padding:'9px 12px',color:expired?'var(--bad)':'var(--t2)',fontWeight:expired?700:400}}>{est.validUntil||'—'}</td>
                    <td style={{padding:'9px 12px',color:'var(--t2)'}}>{est.assignedTo||'—'}</td>
                    <td style={{padding:'9px 12px'}}>
                      <span className={`bdg ${est.status==='Accepted'?'bg':est.status==='Rejected'?'br':est.status==='Sent'||est.status==='In Review'?'ba':'bn'}`}>
                        {expired&&est.status!=='Accepted'?'Expired':est.status}
                      </span>
                    </td>
                    <td style={{padding:'9px 12px'}}>
                      <div style={{display:'flex',gap:5}}>
                        <button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>{setForm({...BLANK,...est});setEditId(est.id);setModal(true)}}>✏️</button>
                        <button className="btn sec" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>sendEstimate(est)}>📧 Send</button>
                        {est.status!=='Rejected'&&<button className="btn" style={{fontSize:12,padding:'4px 10px',background:'var(--ok)',color:'#fff',border:'none',borderRadius:5,cursor:'pointer'}} onClick={()=>convertToInvoice(est)}>→ Invoice</button>}
                        <button className="btn del" style={{fontSize:12,padding:'4px 10px'}} onClick={()=>del(est.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal&&(
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&(setModal(false),setEditId(null))}>
          <div className="modal" style={{width:580}}>
            <div className="mh">
              <span className="mt">{editId?'Edit Estimate':'New Estimate'}</span>
              <button className="xbtn" onClick={()=>{setModal(false);setEditId(null)}}>&times;</button>
            </div>

            <div className="field" style={{position:'relative'}}>
              <label>Client *</label>
              <input value={form.clientName} onChange={e=>searchClient(e.target.value)}
                placeholder="Search client…" autoComplete="off"
                onBlur={()=>setTimeout(()=>setShowSug(false),150)}/>
              {showSug&&suggestions.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'var(--s3)',border:'1px solid var(--b2c)',borderRadius:7,zIndex:500}}>
                  {suggestions.map(c=>(
                    <div key={c.id} onClick={()=>selectClient(c)}
                      style={{padding:'8px 12px',cursor:'pointer',fontSize:13}}>{c.name}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Service</span>
                <select onChange={e=>{if(e.target.value)fld('service',e.target.value);e.target.value=''}}
                  style={{fontSize:10,padding:'2px 6px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:4,color:'var(--tx)'}}>
                  <option value="">Select Template</option>
                  {SERVICES.map(s=><option key={s}>{s}</option>)}
                </select>
              </label>
              <input value={form.service} onChange={e=>fld('service',e.target.value)} placeholder="Service name"/>
            </div>

            <div className="field"><label>Scope / Description</label>
              <textarea value={form.description||''} onChange={e=>fld('description',e.target.value)}
                rows={3} placeholder="Describe what's included in this estimate…"/>
            </div>

            <div className="fg2">
              <div className="field">
                <label>Total Amount *</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}>$</span>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(form.amount)} onChange={e=>fld('amount',parseMoney(e.target.value))} style={{paddingLeft:22}} placeholder="0.00"/>
                </div>
              </div>
              <div className="field">
                <label>Deposit Amount</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}>$</span>
                  <input type="text" inputMode="decimal" value={formatMoneyInput(form.depositAmount||'')} onChange={e=>fld('depositAmount',parseMoney(e.target.value))} style={{paddingLeft:22}} placeholder="0.00"/>
                </div>
              </div>
            </div>

            <div className="fg2">
              <div className="field"><label>Valid Until</label><input type="date" value={form.validUntil} onChange={e=>fld('validUntil',e.target.value)}/></div>
              <div className="field"><label>Status</label>
                <select value={form.status} onChange={e=>fld('status',e.target.value)}>
                  {EST_STATUSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="fg2">
              <div className="field"><label>Assigned Rep</label>
                <select value={form.assignedTo||''} onChange={e=>fld('assignedTo',e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {reps.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="field"><label>Notes</label><input value={form.notes||''} onChange={e=>fld('notes',e.target.value)}/></div>
            </div>

            {/* Preview */}
            {parseFloat(form.amount||0)>0&&(
              <div style={{background:'var(--s3)',borderRadius:7,padding:'10px 14px',marginBottom:10,fontSize:12.5}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{color:'var(--t2)'}}>Total Estimate</span><span style={{fontWeight:700,fontSize:14}}>${parseFloat(form.amount||0).toLocaleString()}</span></div>
                {parseFloat(form.depositAmount||0)>0&&<div style={{display:'flex',justifyContent:'space-between',color:'var(--warn)'}}><span>Deposit Required</span><span style={{fontWeight:700}}>${parseFloat(form.depositAmount).toLocaleString()}</span></div>}
              </div>
            )}

            <button className="btn pri" style={{width:'100%',justifyContent:'center',padding:10}} onClick={save} disabled={saving}>
              {saving?'Saving…':editId?'Update Estimate':'Create Estimate'}
            </button>
          </div>
        </div>
      )}
      <DeleteConfirmModal open={!!confirmDel} label="estimate" onConfirm={confirmDelEstimate} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}


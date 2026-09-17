import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildFlArticlesPdf, validateFloridaLlcFiling } from '../lib/flArticlesPdf'

const SUNBIZ_FILE = 'https://dos.fl.gov/sunbiz/start-business/efile/fl-llc/'

const EMPTY = {
  principal_address:'', mailing_address:'', registered_agent:'', registered_agent_address:'',
  authorized_representative:'', authorized_representative_title:'AR', correspondence_email:'',
  effective_date:'', registered_agent_accepted:false, business_purpose:''
}

export default function FloridaFilingPanel(){
  const [open,setOpen]=useState(false)
  const [cases,setCases]=useState([])
  const [caseId,setCaseId]=useState('')
  const [form,setForm]=useState(EMPTY)
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [msg,setMsg]=useState('')
  const [nameCheck,setNameCheck]=useState(null)
  const [checkingName,setCheckingName]=useState(false)

  async function load(){
    setLoading(true)
    const {data,error}=await supabase.from('formacorp')
      .select('*').eq('state','FL').in('entity_type',['LLC','Professional LLC (PLLC)'])
      .order('created_at',{ascending:false})
    setLoading(false)
    if(error){setMsg(error.message);return}
    setCases(data||[])
    if(!caseId && data?.[0]) selectCase(data[0])
  }

  useEffect(()=>{if(open)load()},[open])

  function selectCase(c){
    setCaseId(c.id)
    setForm({
      principal_address:c.principal_address||'',
      mailing_address:c.mailing_address||'',
      registered_agent:c.registered_agent||'',
      registered_agent_address:c.registered_agent_address||'',
      authorized_representative:c.authorized_representative||'',
      authorized_representative_title:c.authorized_representative_title||'AR',
      correspondence_email:c.correspondence_email||'',
      effective_date:c.effective_date||'',
      registered_agent_accepted:!!c.registered_agent_accepted,
      business_purpose:c.business_purpose||''
    })
    setNameCheck(null);setMsg('')
  }

  const selected=useMemo(()=>cases.find(c=>c.id===caseId)||null,[cases,caseId])
  const merged=useMemo(()=>selected?{...selected,...form}:null,[selected,form])
  const issues=useMemo(()=>merged?validateFloridaLlcFiling(merged):[],[merged])
  const ready=!!merged && issues.length===0

  async function save(){
    if(!selected)return
    setSaving(true);setMsg('')
    const payload={...form}
    if(!payload.mailing_address)payload.mailing_address=payload.principal_address
    const {data,error}=await supabase.from('formacorp').update(payload).eq('id',selected.id).select().single()
    setSaving(false)
    if(error){setMsg(error.message);return}
    setCases(rows=>rows.map(r=>r.id===data.id?data:r))
    selectCase(data)
    setMsg('Saved filing details.')
  }

  async function checkName(){
    if(!selected?.entity_name)return
    setCheckingName(true);setNameCheck(null)
    const {data,error}=await supabase.functions.invoke('sunbiz-search',{body:{mode:'name-check',name:selected.entity_name}})
    setCheckingName(false)
    if(error||!data?.ok){setNameCheck({ok:false,reason:data?.reason||error?.message||'unavailable'});return}
    setNameCheck(data)
  }

  async function downloadPdf(){
    if(!merged)return
    const errs=validateFloridaLlcFiling(merged)
    if(errs.length){setMsg('Complete the required filing fields before generating the packet.');return}
    try{
      const blob=await buildFlArticlesPdf(merged)
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a')
      a.href=url;a.download=`Articles-of-Organization-${(merged.entity_name||'LLC').replace(/[^a-z0-9]+/gi,'-')}.pdf`
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)
    }catch(e){setMsg(e?.message||String(e))}
  }

  const field=(key,label,props={})=><div className="field"><label>{label}</label><input value={form[key]||''} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} {...props}/></div>

  return <>
    <button className="btn pri" onClick={()=>setOpen(true)} style={{position:'fixed',right:24,bottom:24,zIndex:1200,boxShadow:'0 8px 24px rgba(0,0,0,.28)'}}>🏛️ Florida Filing Readiness</button>
    {open&&<div className="modal-bg open" style={{zIndex:5000}} onClick={e=>e.target===e.currentTarget&&setOpen(false)}>
      <div className="modal" style={{width:'min(980px,95vw)',maxHeight:'90vh',overflowY:'auto'}}>
        <div className="mh"><div><div className="mt">Florida LLC Filing Readiness</div><div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Shared Tax Office workflow · tenant-scoped</div></div><button className="xbtn" onClick={()=>setOpen(false)}>&times;</button></div>
        {loading?<div style={{padding:24,color:'var(--t3)'}}>Loading Florida formation cases…</div>:<>
          <div className="field"><label>Formation case</label><select value={caseId} onChange={e=>{const c=cases.find(x=>x.id===e.target.value);if(c)selectCase(c)}}><option value="">— Select —</option>{cases.map(c=><option key={c.id} value={c.id}>{c.entity_name} · {c.client_name}</option>)}</select></div>
          {!selected?<div style={{padding:18,color:'var(--t3)'}}>Create a Florida LLC/PLLC formation case first.</div>:<>
            <div className="card" style={{marginBottom:12,padding:12}}>
              <div style={{fontWeight:800,marginBottom:6}}>{selected.entity_name}</div>
              <div style={{fontSize:11,color:'var(--t3)'}}>Florida requires an LLC name containing LLC, L.L.C. or Limited Liability Company. The state makes the final name-availability decision.</div>
              <div style={{display:'flex',gap:7,flexWrap:'wrap',marginTop:9}}><button className="btn sm" onClick={checkName} disabled={checkingName}>{checkingName?'Checking…':'🔎 Check Sunbiz name'}</button><a className="btn sm" href={SUNBIZ_FILE} target="_blank" rel="noreferrer">Open official Sunbiz filing ↗</a></div>
              {nameCheck&&<div style={{fontSize:11,marginTop:8,color:nameCheck.ok?(nameCheck.available?'var(--ok)':'var(--warn)'):'var(--warn)'}}>{!nameCheck.ok?'Sunbiz lookup unavailable — verify manually before filing.':nameCheck.available?'No exact active match found. Final approval still occurs at filing.':'An exact active match exists; do not file this name as-is.'}</div>}
            </div>

            <div className="fg2">{field('principal_address','Principal street address *',{placeholder:'Street, City, FL ZIP'})}{field('mailing_address','Mailing address',{placeholder:'Leave blank to use principal address'})}</div>
            <div className="fg2">{field('registered_agent','Registered agent name *',{placeholder:'Individual or eligible entity'})}{field('registered_agent_address','Registered agent FL street address *',{placeholder:'No P.O. Box'})}</div>
            <div className="fg2">{field('authorized_representative','Authorized representative / signer *',{placeholder:'Person who will sign/file'})}<div className="field"><label>Representative title *</label><select value={form.authorized_representative_title||'AR'} onChange={e=>setForm(f=>({...f,authorized_representative_title:e.target.value}))}><option value="AR">AR — Authorized Representative</option><option value="MGR">MGR — Manager</option></select></div></div>
            <div className="fg2">{field('correspondence_email','Correspondence email *',{type:'email',placeholder:'Filing confirmation email'})}{field('effective_date','Effective date (optional)',{type:'date'})}</div>
            <div className="field"><label>Business purpose {selected.entity_type==='Professional LLC (PLLC)'?'*':''}</label><input value={form.business_purpose||''} onChange={e=>setForm(f=>({...f,business_purpose:e.target.value}))} placeholder={selected.entity_type==='Professional LLC (PLLC)'?'Specific professional purpose required':'Optional for standard Florida LLC'}/></div>
            <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12,margin:'8px 0 12px'}}><input type="checkbox" checked={!!form.registered_agent_accepted} onChange={e=>setForm(f=>({...f,registered_agent_accepted:e.target.checked}))} style={{width:'auto',marginTop:2}}/><span>I confirm the registered agent has agreed to serve. This confirmation does not replace the registered agent's legally required signature/typed acceptance on Sunbiz.</span></label>

            <div className="card" style={{padding:12,marginBottom:12,borderColor:ready?'rgba(34,197,94,.35)':'rgba(245,158,11,.35)'}}><div style={{fontWeight:800,color:ready?'var(--ok)':'var(--warn)',marginBottom:6}}>{ready?'✅ Filing packet data is complete':'⚠️ Filing packet is not ready'}</div>{issues.length>0&&<div style={{fontSize:11,color:'var(--t2)',lineHeight:1.6}}>{issues.map(x=><div key={x}>• {x}</div>)}</div>}<div style={{fontSize:10,color:'var(--t3)',marginTop:8}}>This checks the CRM data required to prepare the filing. Florida still makes the final legal/name acceptance decision when the filing is submitted.</div></div>

            {msg&&<div style={{fontSize:11,color:'var(--t2)',marginBottom:10}}>{msg}</div>}
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn pri" onClick={save} disabled={saving}>{saving?'Saving…':'Save filing details'}</button><button className="btn" onClick={downloadPdf} disabled={!ready}>📄 Generate filing packet</button><a className="btn" href={SUNBIZ_FILE} target="_blank" rel="noreferrer">🏛️ File on Sunbiz ↗</a></div>
          </>}
        </>}
      </div>
    </div>}
  </>
}

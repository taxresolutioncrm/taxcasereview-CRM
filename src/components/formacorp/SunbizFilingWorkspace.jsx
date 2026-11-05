import { useState } from 'react'

const URLS = {
  'LLC':'https://efile.sunbiz.org/llc_file.html',
  'Professional LLC (PLLC)':'https://efile.sunbiz.org/llc_file.html',
  'C-Corp':'https://efile.sunbiz.org/profit_file.html',
  'Non-Profit 501(c)(3)':'https://efile.sunbiz.org/np_file.html',
}
const rows = c => [
  ['Company name', c.entity_name],
  ['Principal address', c.principal_address],
  ['Mailing address', c.mailing_address || c.principal_address],
  ['Registered agent', c.registered_agent],
  ['Registered agent address', c.registered_agent_address],
  ['Registered agent signature', c.fl_registered_agent_signature],
  ['Correspondence contact', c.fl_correspondence_name || c.client_name],
  ['Correspondence email', c.correspondence_email],
  ['Authorized representative', c.authorized_representative],
  ['Authorized representative signature', c.fl_authorized_representative_signature],
  ['Effective date', c.effective_date || 'Effective upon filing'],
]

export default function SunbizFilingWorkspace({caseRecord, onClose, onRecordReceipt}) {
  const [showOfficial,setShowOfficial]=useState(false)
  const [receipt,setReceipt]=useState({tracking:caseRecord.fl_tracking_number||'',payment:caseRecord.fl_payment_reference||'',reference:caseRecord.fl_confirmation_url||''})
  const [recording,setRecording]=useState(false)
  const [copied,setCopied]=useState('')
  const officialUrl=URLS[caseRecord.entity_type]
  const isPreviouslyRecorded=!!caseRecord.fl_submitted_at
  const copy=async (label,value)=>{
    if(!value)return
    try { await navigator.clipboard.writeText(String(value)); setCopied(label) }
    catch { setCopied('Copy unavailable—select the value manually') }
  }
  const save=async()=>{
    if(recording||!receipt.tracking.trim()||!receipt.payment.trim())return
    setRecording(true)
    try { await onRecordReceipt({tracking:receipt.tracking.trim(),payment:receipt.payment.trim(),reference:receipt.reference.trim()}) }
    finally {setRecording(false)}
  }
  return <div className="modal-bg open" role="dialog" aria-modal="true" aria-label="Florida official filing workspace">
    <div className="modal" style={{width:1120,maxWidth:'97vw',maxHeight:'96vh',overflowY:'auto',padding:20}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start'}}>
        <div><div style={{fontWeight:800,fontSize:18}}>Florida Filing — Sunbiz Workspace</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>{caseRecord.entity_name} • Official government website remains operated by the Florida Department of State</div></div>
        <button className="btn sm" onClick={onClose} aria-label="Close filing workspace">✕</button>
      </div>
      <div style={{padding:12,background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,fontSize:12,margin:'16px 0'}}>
        <strong>Official online filing and government payment</strong>
        <div style={{color:'var(--t3)',lineHeight:1.55,marginTop:5}}>
          The government website is loaded directly from efile.sunbiz.org, not copied or impersonated by FormaCorp.
          Florida may prevent its website from being displayed inside other applications.
          For security, FormaCorp cannot read, prefill or complete fields in that government frame, capture payment information, or automatically detect state acceptance.
          If the government page blocks embedding, use the official direct link. A submission is not complete until Florida provides a receipt.
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(235px, 0.38fr) minmax(0, 1fr)',gap:12}}>
        <aside style={{border:'1px solid var(--br)',background:'var(--s2)',borderRadius:8,padding:12,alignSelf:'start'}}>
          <div style={{fontSize:13,fontWeight:800,marginBottom:6}}>Your saved filing details</div>
          <div style={{fontSize:11,color:'var(--t3)',marginBottom:9}}>Copy a value into the official government form when requested.</div>
          {rows(caseRecord).map(([label,value])=><div key={label} style={{padding:'9px 0',borderBottom:'1px solid var(--br)',fontSize:11}}>
            <div style={{fontWeight:700,marginBottom:4}}>{label}</div>
            <div style={{display:'flex',alignItems:'start',gap:6,justifyContent:'space-between'}}>
              <span style={{overflowWrap:'anywhere',color:'var(--t3)'}}>{value||'—'}</span>
              {!!value&&<button className="btn sm" style={{flexShrink:0}} onClick={()=>copy(label,value)} aria-label={'Copy '+label}>Copy</button>}
            </div>
          </div>)}
          {copied&&<div role="status" style={{marginTop:8,fontSize:11}}>{copied==='Copy unavailable—select the value manually'?copied:copied+' copied'}</div>}
          {Array.isArray(caseRecord.fl_llc_managers)&&caseRecord.fl_llc_managers.filter(m=>m.name).length>0&&<div style={{paddingTop:10}}>
            <strong style={{fontSize:12}}>Managers / Authorized Persons</strong>
            {caseRecord.fl_llc_managers.filter(m=>m.name).map((m,i)=><div key={i} style={{padding:'6px 0',fontSize:11}}>
              <span>{m.title} — {m.name} — {m.street_address}</span>
              <button className="btn sm" onClick={()=>copy('Authorized person', [m.title,m.name,m.street_address].filter(Boolean).join(' / '))}>Copy</button>
            </div>)}
          </div>}
        </aside>
        <section style={{minWidth:0}}>
          {!officialUrl ? <div style={{padding:12,border:'1px solid var(--br)',borderRadius:8}}>This filing type has no verified official online destination. Use the existing state-specific filing workflow.</div> : <>
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:10}}>
              <button className="btn pri" onClick={()=>setShowOfficial(true)}>Open official Sunbiz page here</button>
              <a className="btn" href={officialUrl} target="_blank" rel="noopener noreferrer">Open official Sunbiz in a separate tab</a>
            </div>
            <div style={{minHeight:440,border:'1px solid var(--br)',borderRadius:8,overflow:'hidden',background:'var(--s2)'}}>
              {showOfficial ?
                <iframe title="Official Florida Sunbiz government filing website" src={officialUrl}
                  style={{width:'100%',height:'min(66vh,740px)',minHeight:440,border:0,background:'#fff'}}
                  referrerPolicy="strict-origin-when-cross-origin" allow="payment"
                /> :
                <div style={{padding:25,fontSize:13,color:'var(--t3)',lineHeight:1.65}}>
                  Choose <strong>Open official Sunbiz page here</strong> to attempt an embedded government session.
                  If Florida blocks embedding, use the separate-tab link. Your FormaCorp case stays saved.
                </div>
              }
            </div>
          </>}
        </section>
      </div>
      <div style={{marginTop:14,padding:14,border:'1px solid var(--br)',borderRadius:8,background:'var(--s2)'}}>
        <strong style={{fontSize:13}}>Record official Florida confirmation</strong>
        <p style={{fontSize:11,color:'var(--t3)',margin:'5px 0 12px'}}>Enter these only after the government site confirms the submission and payment. Fax-provider acceptance is not an official receipt.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:9}}>
          <label style={{fontSize:11}}>State tracking number<input style={{width:'100%',marginTop:4}} value={receipt.tracking} onChange={e=>setReceipt(r=>({...r,tracking:e.target.value}))} placeholder="Florida tracking number"/></label>
          <label style={{fontSize:11}}>Government payment reference<input style={{width:'100%',marginTop:4}} value={receipt.payment} onChange={e=>setReceipt(r=>({...r,payment:e.target.value}))} placeholder="State payment receipt"/></label>
          <label style={{fontSize:11}}>Official confirmation URL (optional)<input style={{width:'100%',marginTop:4}} value={receipt.reference} onChange={e=>setReceipt(r=>({...r,reference:e.target.value}))} placeholder="https://..."/></label>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:10,flexWrap:'wrap'}}>
          <button className="btn pri" disabled={recording||isPreviouslyRecorded||!receipt.tracking.trim()||!receipt.payment.trim()} onClick={save}>{recording?'Recording…':isPreviouslyRecorded?'Submission already recorded':'Record confirmed state submission'}</button>
          <span style={{fontSize:11,color:'var(--t3)'}}>This records an externally issued receipt; it never submits a filing or charges a card.</span>
        </div>
      </div>
    </div>
  </div>
}

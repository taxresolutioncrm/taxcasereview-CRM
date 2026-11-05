import { useMemo, useState } from 'react'

const STEPS = ['Business & Fees', 'Addresses', 'Registered Agent', 'Authorized Persons', 'Signatures', 'Review']
const EMPTY_MANAGER = { title:'AMBR', name:'', street_address:'' }
const trim = value => String(value ?? '').trim()
const emailValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(value))
const poBox = value => /\bP\.?\s*O\.?\s*Box\b/i.test(trim(value))
const florida = value => /\b(FL|Florida)\b/i.test(trim(value))
const legalName = name => /(?:L\.?L\.?C\.?|Limited Liability Company)$/i.test(trim(name))
const fieldStyle = {width:'100%',padding:'10px 12px',borderRadius:7,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',fontSize:13}
const cardStyle = {padding:'14px 16px',border:'1px solid var(--br)',borderRadius:9,background:'var(--s2)',marginBottom:12}
const Labeled = ({label,children,hint}) => <div style={{marginBottom:12}}><label style={{display:'block',fontSize:12,fontWeight:700,marginBottom:5}}>{label}</label>{children}{hint&&<div style={{fontSize:10,color:'var(--t3)',marginTop:4}}>{hint}</div>}</div>
const money = value => '$'+Number(value).toFixed(2)
export default function FloridaSunbizIntake({ onSave, onClose, saving=false }) {
  const [step,setStep]=useState(0)
  const [form,setForm]=useState({
    client_name:'', entity_type:'LLC', state:'FL', entity_name:'', owners:'', registered_agent:'',
    principal_address:'', mailing_address:'', registered_agent_address:'',
    authorized_representative:'', authorized_representative_title:'AMBR',
    correspondence_email:'', fl_correspondence_name:'', effective_date:'',
    registered_agent_accepted:false, fl_registered_agent_signature:'',
    fl_authorized_representative_signature:'', fl_filing_authorized:false,
    fl_certificate_of_status:false, fl_certified_copy:false,
    fl_optional_provisions:'', fl_llc_managers:[{...EMPTY_MANAGER}],
    service_plan:'Launch', business_purpose:'',
  })
  const [sameMail,setSameMail]=useState(true)
  const [issues,setIssues]=useState([])
  const set=(key,value)=>{setForm(old=>({...old,[key]:value}));setIssues([])}
  const managers=Array.isArray(form.fl_llc_managers)?form.fl_llc_managers:[]
  const updateManager=(index,key,value)=>set('fl_llc_managers',managers.map((m,i)=>i===index?{...m,[key]:value}:m))
  const fee=125+(form.fl_certificate_of_status?5:0)+(form.fl_certified_copy?30:0)
  const payload=useMemo(()=>({...form,mailing_address:sameMail?'':form.mailing_address,fl_llc_managers:managers.filter(m=>trim(m.name)),fl_state_fee:fee,state_fee_amount:fee}),[form,sameMail,fee])
  const validation=()=>{
    const errors=[]
    if(!trim(form.client_name))errors.push('CRM client / contact is required')
    if(!trim(form.entity_name)||!legalName(form.entity_name))errors.push('Company name must end in LLC or Limited Liability Company')
    if(!trim(form.principal_address)||poBox(form.principal_address))errors.push('Valid principal physical address is required')
    if(!sameMail&&!trim(form.mailing_address))errors.push('Mailing address is required')
    if(!trim(form.registered_agent))errors.push('Registered agent legal name is required')
    if(!trim(form.registered_agent_address)||poBox(form.registered_agent_address)||!florida(form.registered_agent_address))errors.push('Registered agent must have a Florida physical street address')
    if(trim(form.registered_agent).toLowerCase()===trim(form.entity_name).toLowerCase())errors.push('The LLC cannot be its own registered agent')
    if(!form.registered_agent_accepted||!trim(form.fl_registered_agent_signature))errors.push('Registered-agent acceptance and signature are required')
    if(!trim(form.authorized_representative)||!trim(form.fl_authorized_representative_signature))errors.push('Authorized representative and signature are required')
    if(!trim(form.fl_correspondence_name)||!emailValid(form.correspondence_email))errors.push('Correspondence contact name and valid email are required')
    if(form.effective_date) {
      const effective=new Date(form.effective_date+'T12:00:00')
      const today=new Date();today.setHours(12,0,0,0)
      if(Number.isNaN(effective.getTime())) errors.push('Effective date must be a valid calendar date')
      else if(effective>=today && Math.round((effective-today)/86400000)>90) errors.push('Effective date cannot be more than 90 days after filing')
      else if(effective<today) {
        let businessDays=0
        const cursor=new Date(effective)
        while(cursor<today) {
          cursor.setDate(cursor.getDate()+1)
          if(cursor.getDay()!==0 && cursor.getDay()!==6) businessDays++
          if(businessDays>5) break
        }
        if(businessDays>5) errors.push('Effective date cannot be more than 5 business days before filing')
      }
    }
    if(!form.fl_filing_authorized)errors.push('Filing authorization is required')
    if(managers.some(m=>trim(m.name)&&(!trim(m.street_address)||poBox(m.street_address))))errors.push('Each listed manager/authorized person needs a street address')
    return errors
  }
  const next=()=>{if(step===STEPS.length-2){const errors=validation();setIssues(errors);if(errors.length){setStep(STEPS.length-1);return}}setStep(n=>Math.min(STEPS.length-1,n+1))}
  const submit=()=>{const errors=validation();setIssues(errors);if(errors.length)return;onSave(payload)}
  const input=(key,placeholder='',type='text')=><input type={type} style={fieldStyle} value={form[key]||''} placeholder={placeholder} onChange={event=>set(key,event.target.value)}/>
  const section=(label,children)=><div style={cardStyle}><div style={{fontSize:13,fontWeight:800,marginBottom:12}}>{label}</div>{children}</div>
  const reviewRows=[
    ['Company',form.entity_name],['CRM Client',form.client_name],['Principal Office',form.principal_address],
    ['Mailing Address',sameMail?'Same as principal office':form.mailing_address],
    ['Registered Agent',form.registered_agent],['Registered Agent Street Address',form.registered_agent_address],
    ['Agent Acceptance',form.registered_agent_accepted?'Accepted':'Missing'],
    ['Agent Signature',form.fl_registered_agent_signature],['Correspondence Name',form.fl_correspondence_name],
    ['Correspondence Email',form.correspondence_email],
    ['Authorized Signer',form.authorized_representative],['Authorized Signer Signature',form.fl_authorized_representative_signature],
    ['Effective Date',form.effective_date||'Effective on filing'],
    ['Optional Provisions',form.fl_optional_provisions||'None'],
    ['Certificate of Status',form.fl_certificate_of_status?'Yes (+$5)':'No'],
    ['Certified Copy',form.fl_certified_copy?'Yes (+$30)':'No'],
  ]
  return <div className="modal-bg open" role="dialog" aria-modal="true" aria-label="Florida LLC formation intake">
    <div className="modal" style={{width:760,maxWidth:'96vw',maxHeight:'94vh',overflowY:'auto',padding:22}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:15}}>
        <div><div style={{fontSize:17,fontWeight:800}}>Florida LLC — Articles of Organization</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:5}}>FormaCorp native filing intake • Your information stays in the CRM. This is not a government website or a submitted state filing.</div></div>
        <button className="btn sm" onClick={onClose} aria-label="Close Florida intake">✕</button>
      </div>
      <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:17}}>{STEPS.map((label,i)=><button key={label} type="button" onClick={()=>setStep(i)} style={{padding:'6px 9px',borderRadius:7,fontSize:10,fontWeight:700,border:'1px solid var(--br)',background:step===i?'var(--blue)':'var(--s2)',color:step===i?'#fff':'var(--tx)',cursor:'pointer'}}>{i+1}. {label}</button>)}</div>
      {step===0&&<>
        {section('Filing information',<>
          <Labeled label="CRM Client / Contact *" hint="Used to connect this business formation to the existing CRM client record.">{input('client_name','Client name')}</Labeled>
          <Labeled label="Limited Liability Company Name *">{input('entity_name','Example Company, LLC')}</Labeled>
          <Labeled label="Effective Date (optional)" hint="Leave blank to use the state's filing date. A requested alternate date must be accepted by Florida.">{input('effective_date','','date')}</Labeled>
          <Labeled label="Professional Purpose (if applicable)">{input('business_purpose','Optional for a standard LLC')}</Labeled>
        </>)}
        {section('Government filing options',<>
          <label style={{display:'block',marginBottom:9,fontSize:12}}><input type="checkbox" checked={form.fl_certificate_of_status} onChange={e=>set('fl_certificate_of_status',e.target.checked)}/> Certificate of Status — $5 optional</label>
          <label style={{display:'block',marginBottom:9,fontSize:12}}><input type="checkbox" checked={form.fl_certified_copy} onChange={e=>set('fl_certified_copy',e.target.checked)}/> Certified Copy — $30 optional</label>
          <div style={{fontSize:13,fontWeight:800}}>Florida government fee: {money(fee)}</div>
          <div style={{fontSize:10,color:'var(--t3)',marginTop:6}}>Base $125 = Articles $100 + registered-agent designation $25. No state payment is collected by this intake.</div>
        </>)}
      </>}
      {step===1&&<>
        {section('Principal Place of Business',<Labeled label="Full physical street address *" hint="Street, unit, city, state and ZIP. No P.O. Box.">{input('principal_address','123 Main St, Suite 2, Miami, FL 33101')}</Labeled>)}
        {section('Mailing Address',<>
          <label style={{display:'block',fontSize:12,marginBottom:12}}><input type="checkbox" checked={sameMail} onChange={e=>setSameMail(e.target.checked)}/> Same as principal office</label>
          {!sameMail&&<Labeled label="Full mailing address *" hint="A P.O. Box is permitted for the mailing address.">{input('mailing_address','Street or P.O. Box, city, state, ZIP')}</Labeled>}
        </>)}
      </>}
      {step===2&&section('Registered Agent — name, address and acceptance',<>
        <Labeled label="Registered Agent Legal Name *">{input('registered_agent','Full legal name or eligible business entity')}</Labeled>
        <button className="btn sm" onClick={()=>set('registered_agent_address',form.principal_address)} style={{marginBottom:9}}>Use principal address</button>
        <Labeled label="Florida physical street address *">{input('registered_agent_address','Street, city, FL ZIP')}</Labeled>
        <label style={{display:'block',fontSize:12,marginBottom:11}}><input type="checkbox" checked={form.registered_agent_accepted} onChange={e=>set('registered_agent_accepted',e.target.checked)}/> Registered agent has agreed to accept the appointment</label>
        <Labeled label="Registered Agent Typed Signature *" hint="Only enter the agent's name with the agent's explicit permission.">{input('fl_registered_agent_signature','Registered agent full legal name')}</Labeled>
      </>)}
      {step===3&&<>
        {section('Person(s) Authorized to Manage LLC — optional',<>
          <div style={{fontSize:11,color:'var(--t3)',marginBottom:11}}>List only persons Florida permits in this section. Banking or workers' compensation requirements may make this information useful.</div>
          {managers.map((m,i)=><div key={i} style={{padding:10,border:'1px solid var(--br)',borderRadius:7,marginBottom:11}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><strong style={{fontSize:12}}>Authorized person #{i+1}</strong><button className="btn sm" disabled={managers.length===1} onClick={()=>set('fl_llc_managers',managers.filter((_,j)=>i!==j))}>Remove</button></div>
            <Labeled label="Title"><select style={fieldStyle} value={m.title||'AMBR'} onChange={e=>updateManager(i,'title',e.target.value)}><option value="AMBR">AMBR — Authorized Member</option><option value="MGR">MGR — Manager</option><option value="AR">AR — Authorized Representative</option></select></Labeled>
            <Labeled label="Full Legal Name"><input style={fieldStyle} value={m.name||''} onChange={e=>updateManager(i,'name',e.target.value)} placeholder="First and last / entity name"/></Labeled>
            <button className="btn sm" style={{marginBottom:7}} onClick={()=>updateManager(i,'street_address',form.principal_address)}>Use principal address</button>
            <Labeled label="Street Address"><input style={fieldStyle} value={m.street_address||''} onChange={e=>updateManager(i,'street_address',e.target.value)} placeholder="Street, city, state, ZIP"/></Labeled>
          </div>)}
          <button className="btn sm" onClick={()=>set('fl_llc_managers',[...managers,{...EMPTY_MANAGER}])}>＋ Add another authorized person</button>
        </>)}
        {section('Other Provisions (Optional)',<Labeled label="Additional provisions for legal review"><textarea rows={4} style={fieldStyle} value={form.fl_optional_provisions||''} onChange={e=>set('fl_optional_provisions',e.target.value)} placeholder="Leave blank if none"/></Labeled>)}
      </>}
      {step===4&&section('Correspondence and filing signature',<>
        <Labeled label="Correspondence Name *">{input('fl_correspondence_name','Full name for state notices')}</Labeled>
        <Labeled label="Correspondence Email *">{input('correspondence_email','name@example.com','email')}</Labeled>
        <Labeled label="Authorized Representative / Filing Signer *">{input('authorized_representative','Person signing the Articles')}</Labeled>
        <Labeled label="Authorized Representative Typed Signature *">{input('fl_authorized_representative_signature','Signer full legal name')}</Labeled>
        <label style={{display:'block',fontSize:12,lineHeight:1.5}}><input type="checkbox" checked={form.fl_filing_authorized} onChange={e=>set('fl_filing_authorized',e.target.checked)}/> I am authorized to prepare this filing, and all typed signatures were entered with the respective signers' permission. I understand filed information becomes public record.</label>
      </>)}
      {step===5&&<>
        {section('Review Filing Information',<>
          {reviewRows.map(([label,value])=><div key={label} className="dr"><span className="dl">{label}</span><span className="dv" style={{maxWidth:'58%',overflowWrap:'anywhere',textAlign:'right'}}>{value||'—'}</span></div>)}
          <div style={{fontSize:12,fontWeight:700,marginTop:12}}>Authorized persons listed</div>
          {managers.filter(m=>trim(m.name)).length ? managers.filter(m=>trim(m.name)).map((m,i)=><div key={i} style={{fontSize:12,marginTop:5}}>{m.title} — {m.name} — {m.street_address}</div>) : <div style={{fontSize:12,color:'var(--t3)',marginTop:5}}>None listed (optional)</div>}
          <div style={{fontSize:15,fontWeight:800,marginTop:15}}>Estimated Florida government fee: {money(fee)}</div>
        </>)}
        {issues.length>0&&<div role="alert" style={{padding:12,borderRadius:7,border:'1px solid var(--warn)',color:'var(--warn)',fontSize:12,marginBottom:12}}><strong>Correct these fields before saving:</strong><ul style={{marginTop:7}}>{issues.map(item=><li key={item}>{item}</li>)}</ul></div>}
        <div style={{fontSize:11,color:'var(--t3)',lineHeight:1.6}}>Saving creates a FormaCorp filing case and captures the intake. It does NOT submit to Florida, reserve the entity name, charge government fees, or confirm approval. Standard online submission and payment still occur on official Sunbiz until a verified authorized filing channel is configured.</div>
      </>}
      <div style={{display:'flex',justifyContent:'space-between',gap:8,paddingTop:14,marginTop:13,borderTop:'1px solid var(--br)'}}>
        <button className="btn" disabled={saving} onClick={()=>step===0?onClose():setStep(n=>n-1)}>{step===0?'Cancel':'← Back'}</button>
        {step<STEPS.length-1?<button className="btn pri" onClick={next}>Continue →</button>:<button className="btn pri" disabled={saving} onClick={submit}>{saving?'Saving…':'Save Florida LLC Filing Case'}</button>}
      </div>
    </div>
  </div>
}

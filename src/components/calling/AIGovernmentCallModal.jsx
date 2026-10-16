import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { AI_GOVERNMENT_CALL_PURPOSES, getGovernmentCallPurpose, formatGovernmentNumber } from '../../lib/governmentCallRecipes'

export default function AIGovernmentCallModal({ client, caseRecord=null, onClose, onStarted, showToast }) {
  const recommended = useMemo(() => {
    const status = String(client?.irsStatus || client?.stateStatus || caseRecord?.caseType || '').toLowerCase()
    if (/acs|collection|levy|lien/.test(status)) return 'irs-acs'
    if (/installment|payment/.test(status)) return 'irs-payment-plan'
    return 'irs-investigation'
  }, [client, caseRecord])

  const [purposeKey, setPurposeKey] = useState(recommended)
  const purpose = getGovernmentCallPurpose(purposeKey)
  const [stateAgency, setStateAgency] = useState(client?.state ? `${client.state} Department of Revenue` : '')
  const [phone, setPhone] = useState(purpose.phone || '')
  const [objective, setObjective] = useState(purpose.objective)
  const [starting, setStarting] = useState(false)
  const [employees, setEmployees] = useState([])
  const [assignedToEmail, setAssignedToEmail] = useState('')

  useEffect(() => {
    let cancelled=false
    supabase.from('employees').select('name,email,status,perm_comms')
      .eq('status','Active').order('name')
      .then(({data}) => {
        if(cancelled)return
        setEmployees((data||[]).filter(e=>e.email&&Number(e.perm_comms||0)>=1))
      })
      .catch(()=>{})
    return()=>{cancelled=true}
  }, [])

  function choose(key) {
    const next=getGovernmentCallPurpose(key)
    setPurposeKey(key)
    setPhone(next.phone || '')
    setObjective(next.objective)
    if(next.agency==='STATE' && !stateAgency && client?.state) setStateAgency(`${client.state} Department of Revenue`)
  }

  async function start() {
    const digits=String(phone||'').replace(/\D/g,'')
    if(digits.length!==10 && !(digits.length===11&&digits.startsWith('1'))) {
      showToast?.('Enter a valid 10-digit government phone number.')
      return
    }
    if(!objective.trim()) {
      showToast?.('Enter what the AI should accomplish on this call.')
      return
    }
    setStarting(true)
    try {
      const { data, error } = await supabase.functions.invoke('ai-government-call-start', {
        body: {
          client_id: client?.id || null,
          client_name: client?.name || caseRecord?.clientName || '',
          case_id: caseRecord?.id || null,
          purpose_key: purposeKey,
          agency: purpose.agency === 'STATE' ? (stateAgency || 'State Tax Agency') : purpose.agency,
          destination_number: phone,
          objective: objective.trim(),
          route_hints: purpose.routeHints || [],
          assigned_to_email: assignedToEmail || null,
        }
      })
      if(error || !data?.ok) throw new Error(data?.error || error?.message || 'Unable to start AI government call')
      showToast?.(`AI call started — ${data.agency || purpose.agency} ${formatGovernmentNumber(phone)}`)
      onStarted?.(data)
      onClose?.()
    } catch(e) {
      showToast?.('AI call failed: '+(e?.message||e))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&!starting&&onClose?.()}>
      <div className="modal" style={{maxWidth:760,width:'95vw'}}>
        <div className="mh">
          <div>
            <div className="mt">🤖 AI Government Call</div>
            <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>{client?.name || caseRecord?.clientName || 'Client'} · choose what you need accomplished</div>
          </div>
          <button className="xbtn" disabled={starting} onClick={onClose}>&times;</button>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:9,marginBottom:18}}>
          {AI_GOVERNMENT_CALL_PURPOSES.map(p=>(
            <button key={p.key} type="button" onClick={()=>choose(p.key)} style={{
              textAlign:'left',padding:'12px 13px',borderRadius:10,cursor:'pointer',
              border:purposeKey===p.key?'2px solid var(--blue)':'1px solid var(--br)',
              background:purposeKey===p.key?'var(--blt)':'var(--s2)',color:'var(--tx)'
            }}>
              <div style={{fontSize:20,marginBottom:5}}>{p.icon}</div>
              <div style={{fontWeight:800,fontSize:12}}>{p.label}</div>
              {p.key===recommended&&<div style={{fontSize:9,color:'var(--blue)',fontWeight:800,marginTop:4,textTransform:'uppercase'}}>Recommended from case</div>}
            </button>
          ))}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {purpose.agency==='STATE'&&(
            <div className="field">
              <label>State Agency</label>
              <input value={stateAgency} onChange={e=>setStateAgency(e.target.value)} placeholder="Florida Department of Revenue"/>
            </div>
          )}
          <div className="field" style={{gridColumn:purpose.agency==='STATE'?'auto':'1 / -1'}}>
            <label>Government Phone Number</label>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="866-860-4259"/>
          </div>
        </div>

        <div className="field">
          <label>Takeover Employee</label>
          <select value={assignedToEmail} onChange={e=>setAssignedToEmail(e.target.value)}>
            <option value="">Me — whoever starts this AI call</option>
            {employees.map(e=><option key={e.email} value={String(e.email).toLowerCase()}>{e.name || e.email}</option>)}
          </select>
          <div style={{fontSize:10,color:'var(--t3)',marginTop:5}}>This person gets the live-representative alert and TAKE OVER NOW button.</div>
        </div>

        <div className="field">
          <label>Call Objective</label>
          <textarea value={objective} onChange={e=>setObjective(e.target.value)} rows={3}
            placeholder="Describe what the AI needs to route toward before handing the live representative to staff."/>
        </div>

        {!!purpose.routeHints?.length&&(
          <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:10,padding:12,marginTop:8}}>
            <div style={{fontSize:10,fontWeight:800,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:7}}>Known route hints — AI still listens before pressing</div>
            <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
              {purpose.routeHints.map((h,i)=><span key={i} className="bdg bb" style={{fontSize:11}}>{h.digit} · {h.intent}</span>)}
            </div>
          </div>
        )}

        <div style={{fontSize:11,lineHeight:1.55,color:'var(--t3)',marginTop:14}}>
          The AI navigates the auto attendant and hold queue only. When a live government representative is detected, TaxRes alerts the assigned staff member for human takeover before taxpayer authentication or substantive account discussion.
        </div>

        <div style={{display:'flex',justifyContent:'flex-end',gap:9,marginTop:20}}>
          <button className="btn" disabled={starting} onClick={onClose}>Cancel</button>
          <button className="btn pri" disabled={starting} onClick={start}>{starting?'Starting AI Call…':'🤖 Start AI Call'}</button>
        </div>
      </div>
    </div>
  )
}

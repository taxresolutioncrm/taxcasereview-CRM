import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const EMPTY = { fl_authorized_shares:'', fl_officers_directors:'', fl_corp_details_saved:false }

export default function FloridaProfitCorpDetails({ caseRecord, value, onChange, showToast }) {
  const [busy,setBusy]=useState(false)

  useEffect(() => {
    let live=true
    async function load(){
      const r=await supabase.from('formacorp_filing_events').select('metadata').eq('case_id',caseRecord.id).eq('event_type','florida_profit_corp_details').order('created_at',{ascending:false}).limit(1).maybeSingle()
      if(!live) return
      const m=r.data?.metadata || EMPTY
      onChange({ fl_authorized_shares:String(m.fl_authorized_shares || ''), fl_officers_directors:String(m.fl_officers_directors || ''), fl_corp_details_saved:!!r.data })
    }
    load()
    return()=>{live=false}
  },[caseRecord.id])

  function fld(k,v){ onChange({ ...value, [k]:v, fl_corp_details_saved:false }) }

  async function save(){
    const shares=Number(value.fl_authorized_shares)
    if(!Number.isInteger(shares) || shares<1){ showToast?.('Authorized stock shares must be a whole number of at least 1','err'); return }
    setBusy(true)
    const user=await supabase.auth.getUser()
    const r=await supabase.from('formacorp_filing_events').insert([{
      case_id:caseRecord.id,event_type:'florida_profit_corp_details',status:'Saved',
      note:'Florida profit corporation filing details saved',
      metadata:{fl_authorized_shares:shares,fl_officers_directors:String(value.fl_officers_directors || '').trim()},
      actor_email:user.data?.user?.email || null,created_at:new Date().toISOString()
    }])
    setBusy(false)
    if(r.error){ showToast?.('Could not save corporation filing details: '+r.error.message,'err'); return }
    onChange({ ...value, fl_authorized_shares:String(shares), fl_corp_details_saved:true })
    showToast?.('✅ Florida corporation filing details saved')
  }

  return <div style={{marginTop:12,padding:'12px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8}}>
    <div style={{fontWeight:800,fontSize:11,marginBottom:4}}>🏦 Florida Profit Corporation Details</div>
    <div style={{fontSize:10,color:'var(--t3)',lineHeight:1.5,marginBottom:9}}>Florida requires at least one authorized stock share. Officer/director names and street addresses are optional for the state filing.</div>
    <div className="field"><label>Authorized Stock Shares *</label><input type="number" min="1" step="1" value={value.fl_authorized_shares || ''} onChange={e=>fld('fl_authorized_shares',e.target.value)} placeholder="Enter the authorized share count"/></div>
    <div className="field"><label>Officers / Directors and Street Addresses (optional)</label><textarea rows={4} value={value.fl_officers_directors || ''} onChange={e=>fld('fl_officers_directors',e.target.value)} placeholder="Example: President — Cruz, Rommel — 123 Main St, City, FL ZIP" style={{width:'100%',resize:'vertical'}}/></div>
    <button className="btn sm" onClick={save} disabled={busy}>{busy?'Saving…':'💾 Save Corporation Filing Details'}</button>
  </div>
}

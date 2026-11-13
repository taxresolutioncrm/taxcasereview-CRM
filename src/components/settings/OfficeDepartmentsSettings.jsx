import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ALL_DEPARTMENTS, ALL_HR_FEATURES, defaultDepartments, normalizeDepartments, normalizeHrFeatures } from '../../lib/departmentWorkspaces'

const DEPARTMENTS = [
  {key:'resolution', name:'Tax Resolution', hint:'IRS and state casework, transcripts, forms and deadlines'},
  {key:'preparation', name:'Tax Preparation', hint:'Tax returns, client organizers and preparation workflows'},
  {key:'bookkeeping', name:'Bookkeeping & Accounting', hint:'Books and ledger for accounting teams'},
  {key:'formation', name:'Business Formation', hint:'FormaCorp and business entity setup'},
  {key:'hr', name:'HR & Payroll', hint:'Employee time tracking, PTO, timesheets and payroll processing'}, 
]
const CENTURION = '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a'
const NASHVILLE = '489ace07-1a6b-4864-833a-4f8420568b40'
const TAXRES = 'a0000000-0000-0000-0000-000000000001'

export default function OfficeDepartmentsSettings({ user, showToast }) {
  const [offices,setOffices] = useState([])
  const [config,setConfig] = useState({})
  const [selected,setSelected] = useState('')
  const [enabled,setEnabled] = useState([...ALL_DEPARTMENTS])
  const [hrFeatures,setHrFeatures] = useState([...ALL_HR_FEATURES])
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  useEffect(() => {
    let cancelled=false
    const load=async () => {
      try {
        const [officeResult, configResult] = await Promise.all([
          supabase.rpc('admin_tenant_overview'),
          supabase.from('tenant_department_config').select('tenant_id,departments,hr_features'),
        ])
        if(officeResult.error) throw officeResult.error
        if(configResult.error) throw configResult.error
        if(cancelled) return
        const rows=[...(Array.isArray(officeResult.data)?officeResult.data:[]), {
          id:TAXRES,firm_name:'TaxRes CRM',tenant_code:'ADMIN',status:'active',
        }]
          .filter(row=>row?.id && row.id!==NASHVILLE && row.status!=='deleted')
          .filter((row,i,all)=>all.findIndex(other=>other.id===row.id)===i)
          .sort((a,b)=>String(a.firm_name||'').localeCompare(String(b.firm_name||'')))
        const configured=Object.fromEntries((configResult.data||[]).map(row=>[
          row.tenant_id,{departments:normalizeDepartments(row.departments,defaultDepartments(row.tenant_id)),hrFeatures:normalizeHrFeatures(row.hr_features)}, 
        ]))
        setOffices(rows)
        setConfig(configured)
        setSelected(current=>rows.some(o=>o.id===current)?current:(rows.find(o=>o.id===CENTURION)?.id||rows[0]?.id||''))
      } catch(e) {
        if(!cancelled) setError('Unable to load office department settings: '+String(e?.message||e))
      } finally { if(!cancelled) setLoading(false) }
    }
    load()
    return ()=>{cancelled=true}
  },[])
  useEffect(() => {
    if(!selected) return
    setEnabled([...(config[selected]?.departments||defaultDepartments(selected))])
    setHrFeatures([...(config[selected]?.hrFeatures||ALL_HR_FEATURES)])
  },[selected,config])
  const chosen=offices.find(x=>x.id===selected)
  const persisted=config[selected]?.departments||defaultDepartments(selected)
  const persistedHrFeatures=config[selected]?.hrFeatures||ALL_HR_FEATURES
  const dirty=JSON.stringify(enabled)!==JSON.stringify(persisted) || JSON.stringify(hrFeatures)!==JSON.stringify(persistedHrFeatures)
  function toggle(key,value) {
    setEnabled(previous=>ALL_DEPARTMENTS.filter(k=>k===key?value:previous.includes(k)))
    setError('')
  }
  async function save() {
    if(!selected || !user?.id || saving) return
    if(enabled.length===0) {
      setError('Enable at least one department for an office.')
      return
    }
    setSaving(true);setError('')
    try {
      const {error:writeError}=await supabase.from('tenant_department_config').upsert({
        tenant_id:selected,departments:enabled,hr_features:hrFeatures,updated_by:user.id,updated_at:new Date().toISOString(),
      },{onConflict:'tenant_id'})
      if(writeError) throw writeError
      const {data,error:readError}=await supabase.from('tenant_department_config')
        .select('tenant_id,departments,hr_features').eq('tenant_id',selected).single()
      if(readError) throw readError
      const confirmed=normalizeDepartments(data.departments,[])
      if(JSON.stringify(confirmed)!==JSON.stringify(enabled) || JSON.stringify(normalizeHrFeatures(data.hr_features))!==JSON.stringify(hrFeatures)) throw new Error('Saved configuration did not match requested department settings')
      setConfig(previous=>({...previous,[selected]:{departments:confirmed,hrFeatures:[...hrFeatures]}}))
      showToast?.('Office departments saved. Employees see their updated workspace after refresh.')
    } catch(e) {
      setError('Could not save department settings: '+String(e?.message||e))
    } finally {setSaving(false)}
  }
  return (
    <section className="card" aria-label="Office departments" style={{padding:'20px',maxWidth:760}}>
      <div style={{fontWeight:900,fontSize:20,color:'var(--tx)',marginBottom:6}}>Office Departments</div>
      <p style={{color:'var(--t2)',fontSize:13,lineHeight:1.65,margin:'0 0 18px'}}>Choose what each office sees in its sidebar and workspace. Disabled departments are hidden, not deleted. Existing staff permissions and database access rules remain in effect.</p>
      {loading?<div role="status">Loading offices…</div>:<>
        <label htmlFor="office-departments-select" style={{fontWeight:700,fontSize:13,display:'block',marginBottom:7}}>Select office</label>
        <select id="office-departments-select" value={selected} onChange={e=>{setSelected(e.target.value);setError('')}} disabled={saving} style={{width:'100%',padding:11,marginBottom:14,background:'var(--s2)',color:'var(--tx)',border:'1px solid var(--br)',borderRadius:8}}>
          {offices.map(office=><option key={office.id} value={office.id}>{office.firm_name||office.tenant_code||'Unnamed office'}</option>)}
        </select>
        {chosen && <div style={{fontSize:12,color:'var(--t3)',marginBottom:14}}>Configuration applies only to {chosen.firm_name||'this office'}.</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
          {DEPARTMENTS.map(dep=>(
            <label key={dep.key} style={{display:'flex',alignItems:'flex-start',gap:12,background:'var(--s2)',border:'1px solid var(--br)',borderRadius:12,padding:14,cursor:'pointer'}}>
              <input type="checkbox" aria-label={'Enable '+dep.name} checked={enabled.includes(dep.key)} disabled={saving||!selected} onChange={e=>toggle(dep.key,e.target.checked)} style={{width:18,height:18,marginTop:3,accentColor:'var(--blue)'}} />
              <span><strong style={{fontSize:14,color:'var(--tx)'}}>{dep.name}</strong><span style={{display:'block',fontSize:12,lineHeight:1.45,marginTop:5,color:'var(--t2)'}}>{dep.hint}</span></span>
            </label>
          ))}
        </div>
        {enabled.includes('hr') && <div aria-label="HR and Payroll features" style={{border:'1px solid var(--br)',background:'var(--s2)',borderRadius:12,padding:15,marginTop:14}}>
          <strong style={{display:'block',marginBottom:8,color:'var(--tx)'}}>HR & Payroll features</strong>
          <p style={{color:'var(--t2)',fontSize:12,margin:'0 0 12px'}}>Enable employee time tracking and payroll independently. Turning one off only simplifies the office workspace; existing records remain intact.</p>
          {[{key:'time_tracking',label:'Time Tracking',hint:'Time Clock, Time Kiosk, PTO and employee timesheets'},{key:'payroll',label:'Payroll Processing',hint:'Payroll runs, approvals and paystubs'}].map(item=><label key={item.key} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',color:'var(--tx)',fontSize:13}}><input type="checkbox" checked={hrFeatures.includes(item.key)} disabled={saving} onChange={e=>setHrFeatures(prev=>ALL_HR_FEATURES.filter(key=>key===item.key?e.target.checked:prev.includes(key)))} /><span><strong>{item.label}</strong><small style={{display:'block',color:'var(--t2)',marginTop:3}}>{item.hint}</small></span></label>)}
        </div>}
        <div style={{marginTop:16,padding:'11px 13px',fontSize:12,color:'var(--t2)',background:'var(--s2)',borderRadius:8}}>Shared tools such as Clients, Leads, Tasks, Communications, Documents, Billing and Office Settings stay available under existing permissions. Nashville runs independently and keeps its full-feature configuration.</div>
        {error&&<p role="alert" style={{color:'var(--bad)',marginTop:12}}>{error}</p>}
        <div style={{display:'flex',gap:10,justifyContent:'flex-end',alignItems:'center',marginTop:18,flexWrap:'wrap'}}>
          <button type="button" className="btn" disabled={!dirty||saving} onClick={()=>{setEnabled([...persisted]);setHrFeatures([...persistedHrFeatures])}}>Discard Changes</button>
          <button type="button" className="btn pri" disabled={!selected||!dirty||saving||enabled.length===0} onClick={save}>{saving?'Saving…':'Save Office Departments'}</button>
        </div>
      </>}
    </section>
  )
}

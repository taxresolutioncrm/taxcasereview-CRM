import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

const FIELDS = [
  ['name','Name'], ['department','IRS group / department'], ['manager','Manager'],
  ['phone','Phone'], ['fax','Fax'], ['email','Email'], ['address','Address'], ['notes','Notes'],
]
const TYPES = [
  ['revenueOfficerContact','Revenue Officer'],
  ['taxpayerAdvocateContact','Taxpayer Advocate'],
]
const normalize = value => Object.fromEntries(FIELDS.map(([key])=>[key,String(value?.[key] || '')]))

export default function ClientIRSContacts({ client, tenantId, onSaved }) {
  const { can } = useApp()
  const [fields,setFields] = useState({})
  const [editing,setEditing] = useState('')
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const [status,setStatus] = useState('')
  const canEdit = can('edit','clients')

  useEffect(() => {
    setFields(Object.fromEntries(TYPES.map(([key])=>[key,normalize(client?.[key])])))
    setEditing('')
    setError('')
    setStatus('')
  },[client?.id,client?.revenueOfficerContact,client?.taxpayerAdvocateContact])

  async function save(key) {
    if (!canEdit || saving || !tenantId || !client?.id) return
    setSaving(true);setError('');setStatus('')
    try {
      const next = normalize(fields[key])
      const { data, error:dbError } = await supabase.from('clients')
        .update({[key]:next})
        .eq('tenant_id',tenantId).eq('id',client.id)
        .select('id,"revenueOfficerContact","taxpayerAdvocateContact"').single()
      if (dbError) throw dbError
      if (!data || String(data.id)!==String(client.id)) throw new Error('Client contact update was not confirmed by the database')
      onSaved?.(data)
      setEditing('')
      setStatus(TYPES.find(([field])=>field===key)?.[1]+' saved')
    } catch (err) { setError(err?.message || 'Contact save failed') }
    finally { setSaving(false) }
  }

  return (
    <div data-testid="client-irs-contacts" style={{marginTop:12,display:'grid',gap:10}}>
      {TYPES.map(([key,title]) => {
        const value = fields[key] || normalize(client?.[key])
        const active = editing === key
        return <section key={key} style={{border:'1px solid var(--br)',borderRadius:9,padding:10,minWidth:0}}>
          <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
            <strong style={{fontSize:12,color:'var(--tx)'}}>{title}</strong>
            {canEdit && <button type="button" className="btn sec" disabled={saving} onClick={()=>{setEditing(active?'':key);setError('');setStatus('')}} style={{fontSize:11,padding:'4px 8px'}}>{active?'Cancel':'Edit'}</button>}
          </div>
          {active ? <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:8,marginTop:9}}>
              {FIELDS.map(([field,label])=><label key={field} style={{fontSize:11,color:'var(--t2)'}}>{label}
                {field==='notes'
                  ? <textarea rows={3} value={value[field]} onChange={e=>setFields(prev=>({...prev,[key]:{...value,[field]:e.target.value}}))} style={{display:'block',width:'100%',boxSizing:'border-box',marginTop:3}}/>
                  : <input type={field==='email'?'email':field==='phone'||field==='fax'?'tel':'text'} value={value[field]} onChange={e=>setFields(prev=>({...prev,[key]:{...value,[field]:e.target.value}}))} style={{display:'block',width:'100%',boxSizing:'border-box',marginTop:3}}/>}
              </label>)}
            </div>
            <button type="button" className="btn pri" disabled={saving} onClick={()=>save(key)} style={{marginTop:9,fontSize:11}}>{saving?'Saving…':'Save '+title}</button>
          </> : <div style={{marginTop:6,fontSize:11,color:'var(--t2)'}}>
            {FIELDS.filter(([field])=>value[field]).length ? FIELDS.filter(([field])=>value[field]).map(([field,label])=><div key={field} style={{margin:'3px 0',overflowWrap:'anywhere'}}><span style={{color:'var(--t3)'}}>{label}: </span>{value[field]}</div>)
            : <span style={{color:'var(--t3)'}}>No contact recorded.</span>}
          </div>}
        </section>
      })}
      {error && <div role="alert" style={{color:'var(--bad)',fontSize:11}}>Could not save IRS contact: {error}</div>}
      {status && <div role="status" style={{color:'var(--ok)',fontSize:11}}>{status}</div>}
    </div>
  )
}

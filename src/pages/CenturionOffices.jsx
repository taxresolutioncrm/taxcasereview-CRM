import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

// Dedicated Centurion backend only. Server enforces membership and owner rights;
// nothing about this UI confers office access.
export default function CenturionOffices() {
  const { showToast } = useApp()
  const [current, setCurrent] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [owner, setOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ firm_name:'', tenant_code:'', admin_email:'' })
  const [created, setCreated] = useState(null)

  async function refresh() {
    setLoading(true)
    const { data:{user}, error: authError } = await supabase.auth.getUser()
    if (authError || !user) { setLoading(false); return }
    const [office, accessible] = await Promise.all([
      supabase.rpc('current_tenant_id'),
      supabase.from('centurion_office_memberships')
        .select('tenant_id,role,active').eq('user_id',user.id).eq('active',true),
    ])
    if (office.error || accessible.error) {
      showToast('Office membership lookup failed: ' + (office.error?.message || accessible.error?.message), 'err')
      setLoading(false)
      return
    }
    setCurrent(office.data)
    setMemberships(accessible.data || [])
    setOwner((accessible.data || []).some(m => m.tenant_id === office.data && m.role === 'owner'))
    setLoading(false)
  }
  useEffect(() => { refresh() }, [])

  async function selectOffice(tenantId) {
    const { error } = await supabase.rpc('centurion_select_office', { p_tenant_id:tenantId })
    if (error) { showToast('Cannot select office: ' + error.message, 'err'); return }
    window.location.assign('/')
  }
  async function createOffice(event) {
    event.preventDefault()
    if (!owner || saving) return
    setSaving(true)
    setCreated(null)
    try {
      const { data, error } = await supabase.functions.invoke('centurion-provision-office', {
        body: {
          firm_name: form.firm_name.trim(),
          tenant_code: form.tenant_code.trim().toUpperCase(),
          admin_email: form.admin_email.trim().toLowerCase(),
        }
      })
      if (error || data?.error || !data?.tenant_id) {
        showToast('Office not created: ' + (data?.error || error?.message || 'Unknown error'), 'err')
        return
      }
      setCreated(data)
      setForm({ firm_name:'', tenant_code:'', admin_email:'' })
      showToast('Office created in Centurion. The administrator can sign into that office.')
      await refresh()
    } finally { setSaving(false) }
  }
  return <div style={{padding:24,maxWidth:760}}>
    <h1 style={{fontSize:24,color:'var(--tx)',margin:'0 0 8px'}}>Centurion Offices</h1>
    <p style={{color:'var(--t3)',marginBottom:22}}>Each office uses Centurion's dedicated database with separate, membership-protected records. TCR administration stays separate.</p>
    {loading ? <p>Checking office access…</p> : <>
      <section className="card" style={{padding:20,marginBottom:20}}>
        <h2 style={{fontSize:17,marginBottom:12}}>Your authorized offices</h2>
        {!memberships.length ? <p>No active office memberships. Contact the platform owner.</p> :
          memberships.map(m => <div key={m.tenant_id} style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap'}}>
            <span style={{fontSize:13}}>{m.tenant_id === current ? 'Current office' : 'Office'} · {m.tenant_id.slice(0,8)} · {m.role}</span>
            <button className="btn sec" disabled={m.tenant_id===current} onClick={() => selectOffice(m.tenant_id)}>
              {m.tenant_id===current ? 'Selected' : 'Switch office'}
            </button>
          </div>)}
      </section>
      {owner && <section className="card" style={{padding:20}}>
        <h2 style={{fontSize:17,marginBottom:12}}>Add Office</h2>
        <p style={{color:'var(--t3)',fontSize:13,marginBottom:16}}>The new administrator must first have a verified login in Centurion. Creating an office never creates another Supabase project.</p>
        <form onSubmit={createOffice} style={{display:'grid',gap:14}}>
          <label>Office name<input required maxLength={150} value={form.firm_name} onChange={e=>setForm(v=>({...v,firm_name:e.target.value}))} placeholder="New Tax Office" /></label>
          <label>Unique office code<input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" value={form.tenant_code} onChange={e=>setForm(v=>({...v,tenant_code:e.target.value}))} placeholder="NEWOFFICE" /></label>
          <label>Verified administrator email<input required type="email" value={form.admin_email} onChange={e=>setForm(v=>({...v,admin_email:e.target.value}))} placeholder="admin@newfirm.com" /></label>
          <button className="btn pri" type="submit" disabled={saving}>{saving ? 'Creating office…' : 'Create Office'}</button>
        </form>
        {created && <p style={{marginTop:16,color:'var(--ok)'}}>Created {created.tenant_code}. Office ID: {created.tenant_id}</p>}
      </section>}
    </>}
  </div>
}

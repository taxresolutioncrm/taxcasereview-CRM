import { validateFile, maybeCompressImage } from '../lib/uploadUtils'
import { formatMoneyInput, parseMoney } from '../lib/money'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { FIRM, label } from '../lib/firmBranding'
import { hasPlanFeature } from '../lib/planTiers'

// Scope queries to current tenant when FIRM.tenantId is available (platform admin sessions)
function tf(q) { return FIRM.tenantId ? q.eq('tenant_id', FIRM.tenantId) : q }

// Base access levels — these are the actual permission presets (never change these keys)
const ACCESS_LEVELS = ['Super Admin', 'Admin', 'Manager', 'Tax Associate', 'Tax Advisor', 'Sales Rep', 'View Only']
// Display labels for each access level — pulled from FIRM.labels or defaults
function getRoleLabels() {
  const l = FIRM.labels || {}
  return {
    'Super Admin':   'Super Admin',
    'Admin':         l.associateRole || 'Admin',
    'Tax Associate': l.paraRole || 'Tax Associate',
    'Tax Advisor':   l.taxAdvisorRole || 'Tax Advisor',
    'Manager':       'Manager',
    'Sales Rep':     l.salesRepRole || 'Sales',
    'View Only':     'View Only',
  }
}
const ROLE_COLORS = { 'Super Admin': '#ef4444', 'Admin': '#f59e0b', 'Tax Associate': '#3b82f6', 'View Only': '#64748b', 'Tax Advisor': '#10b981', 'Manager': '#06b6d4', 'Sales Rep': '#8b5cf6' }
// Role display colors (for the role badge — role is the title, access is the permission level)
const TITLE_COLORS = { 'Super Admin': '#ef4444', 'Associate': '#10b981', 'Para': '#0ea5e9', 'Manager': '#06b6d4', 'Staff': '#64748b', 'Sales': '#8b5cf6' }

// perm levels: 0=No Access, 1=View Only, 2=Edit, 3=Full Admin
const PERM_SECTIONS = [
  { key: 'perm_leads',     label: 'Lead Work',           desc: 'Sales pipeline — Leads only',             icon: '🎯' },
  { key: 'perm_clients',   label: 'Client Work',         desc: 'Clients, Cases, Tasks, Deadlines',        icon: '👥' },
  { key: 'perm_billing',   label: 'Billing',             desc: 'Estimates, Invoices, Payments, Books',    icon: '💳' },
  { key: 'perm_schedule',  label: 'Calendar & Schedule', desc: 'View and manage appointments',            icon: '📅' },
  { key: 'perm_documents', label: 'Documents & E-Sign',  desc: 'Upload, view, and request signatures',   icon: '📄' },
  { key: 'perm_irs',       label: 'IRS Resolution',      desc: 'Transcripts, IRS Forms, Tax Returns',    icon: '🏛️' },
  { key: 'perm_comms',     label: 'Communications',      desc: 'Email, SMS, Dialer, Team Chat',          icon: '💬' },
  { key: 'perm_reports',   label: 'Reports',             desc: 'View firm-wide analytics and reports',   icon: '📊' },
  { key: 'perm_hr',        label: 'HR & Payroll',        desc: 'Time clock, payroll, employee records',  icon: '🏢' },
  { key: 'perm_settings',  label: 'Settings & Users',    desc: 'Firm info, branding, user management',  icon: '⚙️' },
]

const LEVEL_OPTIONS = [
  { value: 0, label: 'No Access',   desc: 'Cannot see this section',             color: '#64748b' },
  { value: 1, label: 'View Only',   desc: 'Can view but not make changes',       color: '#3b82f6' },
  { value: 2, label: 'Edit',        desc: 'Can view and make changes',           color: '#f59e0b' },
  { value: 3, label: 'Full Admin',  desc: 'Full control including delete',       color: '#ef4444' },
]

// Default perm sets per role
const ROLE_PERM_DEFAULTS = {
  'Super Admin': { perm_leads:3, perm_clients:3, perm_billing:3, perm_schedule:3, perm_documents:3, perm_irs:3, perm_comms:3, perm_reports:3, perm_hr:3, perm_settings:3 },
  'Admin':       { perm_leads:2, perm_clients:2, perm_billing:2, perm_schedule:2, perm_documents:2, perm_irs:2, perm_comms:2, perm_reports:2, perm_hr:1, perm_settings:1 },
  'Tax Associate':       { perm_leads:1, perm_clients:1, perm_billing:0, perm_schedule:1, perm_documents:1, perm_irs:1, perm_comms:2, perm_reports:0, perm_hr:0, perm_settings:0 },
  'View Only':   { perm_leads:1, perm_clients:1, perm_billing:0, perm_schedule:1, perm_documents:1, perm_irs:1, perm_comms:1, perm_reports:0, perm_hr:0, perm_settings:0 },
  // Sales rep — leads only (no Clients/Cases, no Billing/IRS/HR/Reports/Settings).
  // Calendar/Comms/Documents are Edit so a rep can book appointments, call/
  // text/email leads, and send docs for e-signature. Leads list is further
  // scoped to "my assigned leads only" in Leads.jsx — that scoping is NOT a
  // perm level, it applies regardless of what perm_leads is set to here.
  'Tax Advisor': { perm_leads:2, perm_clients:0, perm_billing:0, perm_schedule:2, perm_documents:2, perm_irs:0, perm_comms:2, perm_reports:0, perm_hr:0, perm_settings:0 },
  // Sales rep — leads pipeline + comms; no access to client files, billing, IRS, HR, or settings
  'Sales Rep':   { perm_leads:2, perm_clients:0, perm_billing:0, perm_schedule:2, perm_documents:1, perm_irs:0, perm_comms:2, perm_reports:0, perm_hr:0, perm_settings:0 },
  // Sales manager — oversees Tax Advisors. Full Admin on Leads (sees every
  // rep's leads, unscoped — only 'Tax Advisor' gets the my-leads-only lock
  // in Leads.jsx) plus Reports visibility for team performance.
  'Manager':     { perm_leads:3, perm_clients:0, perm_billing:0, perm_schedule:2, perm_documents:2, perm_irs:0, perm_comms:2, perm_reports:1, perm_hr:0, perm_settings:0 },
}

const blankEmp = {
  name: '', email: '', phone: '', title: '', access: 'Tax Associate', extension: '', direct_number: '', team: '',
  hourlyRate: '', payType: 'Hourly', paymentMethod: 'Direct Deposit',
  hireDate: '', emergencyContact: '', emergencyPhone: '',
  address: '', filingStatus: 'Single',
  employeeId: '', ssn: '', portalPin: '',
  caf: '', ptin: '', sorShortId: '', sorUsername: '',
  bank_name: '', bank_account_type: 'Checking', routing_number: '', account_number: '',
  pto_balance: 0, sick_balance: 0, vacation_balance: 0,
  ...ROLE_PERM_DEFAULTS['Tax Associate']
}

const EMP_DOC_LABELS = ['W-4', 'I-9', 'Direct Deposit', 'SSN Card', 'Driver License', 'Contract', 'Background Check', 'Other']

// Map camelCase form state → snake_case DB columns
function toDbPayload(form) {
  const { hourlyRate, payType, paymentMethod, hireDate, emergencyContact, emergencyPhone,
          filingStatus, sorShortId, sorUsername, employeeId, portalPin,
          pto_balance, sick_balance, vacation_balance, ...rest } = form
  // Postgres numeric columns reject '' outright (the error this fixes:
  // "invalid input syntax for type numeric: \"\""). An employee with no
  // hourly rate set falls through fromDbRow's ?? chain to '', which used
  // to go straight into the payload unconverted. Same risk for the three
  // PTO/Sick/Vacation balance fields if a user manually clears one of
  // those number inputs. Empty string -> null for all four; any real
  // numeric string still passes through as-is for Postgres to parse.
  const numOrNull = v => (v === '' || v === undefined || v === null) ? null : v
  return {
    ...rest,
    hourly_rate:       numOrNull(hourlyRate),
    pay_type:          payType,
    payment_method:    paymentMethod,
    hire_date:         hireDate || null,
    emergency_contact: emergencyContact,
    emergency_phone:   emergencyPhone,
    extension:         form.extension || null,
    direct_number:     form.direct_number || null,
    team:              form.team || null,
    filing_status:     filingStatus,
    sor_short_id:      sorShortId,
    sor_username:      sorUsername,
    employee_id:       employeeId,
    portal_pin:        form.portalPin || null,
    pto_balance:       numOrNull(pto_balance),
    sick_balance:      numOrNull(sick_balance),
    vacation_balance:  numOrNull(vacation_balance),
  }
}

// Map snake_case DB row → camelCase form state
function fromDbRow(emp) {
  return {
    name:             emp.name || '',
    email:            emp.email || '',
    phone:            emp.phone || '',
    extension:        emp.extension || '',
    direct_number:    emp.direct_number || '',
    team:             emp.team || '',
    title:            emp.title ?? '',
    access:           emp.access || 'Tax Associate',
    hourlyRate:       emp.hourly_rate ?? emp.hourlyRate ?? '',
    payType:          ['Hourly','Salary','1099 Contractor'].includes(emp.pay_type || emp.payType) ? (emp.pay_type || emp.payType) : 'Hourly',
    paymentMethod:    emp.payment_method || emp.paymentMethod || 'Direct Deposit',
    hireDate:         emp.hire_date ?? emp.hireDate ?? '',
    emergencyContact: emp.emergency_contact ?? emp.emergencyContact ?? '',
    emergencyPhone:   emp.emergency_phone ?? emp.emergencyPhone ?? '',
    address:          emp.address ?? '',
    filingStatus:     emp.filing_status || emp.filingStatus || 'Single',
    employeeId:       emp.employee_id ?? '',
    ssn:              emp.ssn ?? '',
    portalPin:        emp.portal_pin ?? '',
    caf:              emp.caf ?? '',
    ptin:             emp.ptin ?? '',
    sorShortId:       emp.sor_short_id ?? emp.sorShortId ?? '',
    sorUsername:      emp.sor_username ?? emp.sorUsername ?? '',
    bank_name:        emp.bank_name ?? '',
    bank_account_type: emp.bank_account_type ?? 'Checking',
    routing_number:   emp.routing_number ?? '',
    account_number:   emp.account_number ?? '',
    pto_balance:      emp.pto_balance ?? 0,
    sick_balance:     emp.sick_balance ?? 0,
    vacation_balance: emp.vacation_balance ?? 0,
    perm_leads:       emp.perm_leads    ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_leads,
    perm_clients:     emp.perm_clients  ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_clients,
    perm_billing:     emp.perm_billing  ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_billing,
    perm_schedule:    emp.perm_schedule ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_schedule,
    perm_documents:   emp.perm_documents?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_documents,
    perm_irs:         emp.perm_irs      ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_irs,
    perm_comms:       emp.perm_comms    ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_comms,
    perm_reports:     emp.perm_reports  ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_reports,
    perm_hr:          emp.perm_hr       ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_hr,
    perm_settings:    emp.perm_settings ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate'].perm_settings,
  }
}

export default function Employees() {
  const { showToast, can, user, planTier } = useApp()
  const [employees, setEmployees] = useState([])
  const [confirmDel, setConfirmDel] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(blankEmp)
  const [tab, setTab]             = useState('info')
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [showReset, setShowReset]   = useState(false)
  const [resetSending, setResetSending] = useState(false)
  const [search, setSearch]       = useState('')
  const [empDocs, setEmpDocs]     = useState([])
  const [docUploading, setDocUploading] = useState(false)
  const [nextDocLabel, setNextDocLabel] = useState('W-4')

  // Guard: wait for auth before loading — prevents TCR employees showing in Nashville
  useEffect(() => { if (user) load() }, [user?.id])

  useEffect(() => {
    if (showForm && editing && form.name) {
      supabase.from('documents').select('*').eq('employee', form.name).order('created_at', { ascending: false })
        .then(({ data }) => setEmpDocs(data || []))
    } else {
      setEmpDocs([])
    }
  }, [showForm, editing])

  async function load() {
    setLoading(true)
    const { data } = await tf(supabase.from('employees').select('*')).order('name')
    // Exclude platform admin account — romy@taxrescrm.net is the TaxRes CRM
    // product owner account and must never appear in any office's employee list
    setEmployees((data || []).filter(e => e.email !== 'romy@taxrescrm.net'))
    setLoading(false)
  }

  async function openNew() {
    setEditing(null)
    const { data: empIds } = await supabase.from('employees').select('employee_id')
    let nextNum = 100
    if (empIds?.length) {
      const nums = empIds
        .map(e => parseInt((e.employee_id || '').replace(/\D/g, '')) || 0)
        .filter(n => n > 0)
      if (nums.length) nextNum = Math.max(...nums) + 1
    }
    setForm({ ...blankEmp, employeeId: `TCR-${nextNum}` })
    setTab('info')
    setShowForm(true)
  }

  function openEdit(emp) {
    setEditing(emp.id)
    setForm(fromDbRow(emp))
    setTab('info')
    setShowForm(true)
  }

  function applyRoleDefaults(role) {
    setForm(f => ({ ...f, access: role, ...ROLE_PERM_DEFAULTS[role] }))
  }

  async function save(silent = false) {
    if (!form.name || !form.email) { if (!silent) showToast('Name and email required', 'err'); return false }
    setSaving(true)
    setSaveError('')
    let payload = toDbPayload(form)
    let error, data
    // Retry loop: if PostgREST rejects an unknown column, strip it and retry (same pattern as Clients.jsx)
    for (let attempt = 0; attempt < 12; attempt++) {
      if (editing) {
        ;({ error } = await supabase.from('employees').update(payload).eq('id', editing))
      } else {
        ;({ error, data } = await supabase.from('employees').insert([payload]).select().single())
        if (!error && data?.id) setEditing(data.id)
      }
      if (!error) break
      const match = error.message?.match(/column ['"]?(\w+)['"]? (of relation .* )?does not exist/i)
        || error.message?.match(/Could not find the '(\w+)' column/i)
      if (match && match[1] in payload) {
        const { [match[1]]: _, ...rest } = payload
        payload = rest
        continue
      }
      break
    }
    setSaving(false)
    if (error) { setSaveError(error.message); if (!silent) showToast('Save error: ' + error.message, 'err'); return false }
    if (!silent) {
      showToast(editing ? 'Employee updated!' : 'Employee added!')
      setShowForm(false)
    } else {
      showToast('Auto-saved', 'ok')
    }
    load()
    return true
  }

  async function remove(id) {
    if (confirmDel !== id) { setConfirmDel(id); return }
    setConfirmDel(null)
    const { error } = await supabase.from('employees').delete().eq('id', id)
    if (error) { showToast('Error: ' + error.message, 'err'); return }
    setEmployees(prev => prev.filter(e => e.id !== id))
    showToast('Employee removed')
    load()
  }

  async function handleDocFiles(files) {
    if (!editing || !form.name) return
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { showToast(`"${file.name}" is over the 10MB limit and was skipped.`, 'err'); continue }
      setDocUploading(true)
      const path = `docs/${form.name.replace(/\s+/g,'-')}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
      if (!upErr) {
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
        const { data: inserted, error: insErr } = await supabase.from('documents').insert([{
          name: file.name, employee: form.name, docType: nextDocLabel,
          file_url: urlData?.signedUrl || '', file_name: file.name, file_size: file.size,
          created_at: new Date().toISOString()
        }]).select().single()
        if (!insErr && inserted) setEmpDocs(prev => [inserted, ...prev])
        else if (insErr) showToast('Save failed: ' + insErr.message, 'err')
      } else {
        showToast('Upload failed: ' + upErr.message, 'err')
      }
      setDocUploading(false)
    }
  }

  async function removeDoc(doc) {
    if (doc.file_name) {
      const path = doc.file_url?.split('/documents/')[1]
      if (path) await supabase.storage.from('documents').remove([path]).catch(()=>{})
    }
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) { showToast('Error: ' + error.message, 'err'); return }
    setEmpDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  async function sendReset() {
    if (!resetEmail) return
    setResetSending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + '/'
    })
    setResetSending(false)
    if (error) return showToast(error.message, 'err')
    showToast('Password reset link sent!')
    setShowReset(false)
    setResetEmail('')
  }

  const filtered = employees.filter(e =>
    !search || e.name?.toLowerCase().includes(search.toLowerCase()) || e.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{padding:'20px 24px',maxWidth:1100,margin:'0 auto'}}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--tx)' }}>Employees</div>
          <div style={{ fontSize: 13, color: 'var(--t3)' }}>{employees.length} team member{employees.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search employees…"
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13, width: 200 }}
          />
          <button className="btn" onClick={() => { setShowReset(true); setResetEmail('') }}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            🔑 Reset Password
          </button>
          {can('edit', 'employees') && (
            <button className="btn pri" onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Employee
            </button>
          )}
        </div>
      </div>

      {/* Employee cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--t3)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: 'var(--tx)' }}>No employees yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add your first team member to get started</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map(emp => (
            <div key={emp.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                {/* Avatar */}
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: TITLE_COLORS[emp.role] || ROLE_COLORS[emp.access] || '#64748b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 800, color: '#fff', flexShrink: 0, overflow: 'hidden'
                }}>
                  {emp.avatar_url
                    ? <img src={emp.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                    : (emp.name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--tx)' }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{emp.title || emp.role || 'Staff'}</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)' }}>{emp.email}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                      background: (TITLE_COLORS[emp.role] || ROLE_COLORS[emp.access] || '#64748b') + '22',
                      color: TITLE_COLORS[emp.role] || ROLE_COLORS[emp.access] || '#64748b',
                      border: '1px solid ' + (TITLE_COLORS[emp.role] || ROLE_COLORS[emp.access] || '#64748b') + '44'
                    }}>{emp.role || emp.title || emp.access || 'Staff'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn sm" onClick={() => { setShowReset(true); setResetEmail(emp.email || '') }} title="Reset password">🔑</button>
                  {can('edit', 'employees') && (
                    <>
                      <button className="btn sm" onClick={() => openEdit(emp)}>Edit</button>
                      <button className="btn sm" onClick={() => remove(emp.id)}
                        style={{ color: 'var(--bad)' }}>✕</button>
                    </>
                  )}
                </div>
              </div>

              {/* Permission chips */}
              <div style={{ marginTop: 14, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {PERM_SECTIONS.map(s => {
                  const level = emp[s.key] ?? ROLE_PERM_DEFAULTS[emp.access || 'Tax Associate']?.[s.key] ?? 0
                  if (level === 0) return null
                  const opt = LEVEL_OPTIONS[level]
                  return (
                    <span key={s.key} title={s.label + ': ' + opt.label} style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 12,
                      background: opt.color + '22', color: opt.color,
                      border: '1px solid ' + opt.color + '44', fontWeight: 600
                    }}>
                      {s.icon} {s.label.split(' ')[0]}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20
        }} onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div style={{
            background: 'var(--sf)', border: '1px solid var(--br)',
            borderRadius: 16, width: '100%', maxWidth: 620,
            maxHeight: '90vh', overflowY: 'auto'
          }}>
            {/* Modal header */}
            <div style={{
              padding: '20px 24px 16px',
              borderBottom: '1px solid var(--br)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--tx)' }}>
                {editing ? 'Edit Employee' : 'Add Employee'}
              </div>
              <button onClick={() => setShowForm(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--t3)', fontSize: 20, lineHeight: 1
              }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, padding: '12px 24px 0', borderBottom: '1px solid var(--br)' }}>
              {['info', ...(can('edit','employees') || form.email === user?.email ? ['irs'] : []), 'pay', ...(editing ? ['documents'] : []), ...(hasPlanFeature(planTier, 'advanced_user_permissions') ? ['permissions'] : [])].map(t => (
                <button key={t} onClick={async () => { if (showForm && !editing) { await save(true) } setTab(t) }} style={{
                  padding: '8px 18px', borderRadius: '8px 8px 0 0',
                  border: '1px solid var(--br)', borderBottom: tab === t ? '1px solid var(--sf)' : '1px solid var(--br)',
                  background: tab === t ? 'var(--sf)' : 'var(--s2)',
                  color: tab === t ? 'var(--tx)' : 'var(--t3)',
                  fontWeight: tab === t ? 700 : 400,
                  cursor: 'pointer', fontSize: 13, marginBottom: -1
                }}>
                  {t === 'info' ? '👤 Info' : t === 'pay' ? '💵 Pay & HR' : t === 'irs' ? '🏛️ IRS Info' : t === 'documents' ? '📁 Documents' : '🔐 Permissions'}
                </button>
              ))}
            </div>

            <div style={{ padding: 24 }}>
              {/* Pay & HR tab */}
              {tab === 'pay' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Pay Type</label>
                      <select value={form.payType||'Hourly'} onChange={e => setForm(f => ({ ...f, payType: e.target.value }))}>
                        <option>Hourly</option>
                        <option>Salary</option>
                        <option>1099 Contractor</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>{form.payType === 'Salary' ? 'Annual Salary ($)' : 'Hourly Rate ($/hr)'}</label>
                      <input type="text" inputMode="decimal" value={formatMoneyInput(form.hourlyRate||'')} onChange={e => setForm(f => ({ ...f, hourlyRate: parseMoney(e.target.value) }))} placeholder={form.payType==='Salary'?'52000':'25.00'}/>
                    </div>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Payment Method</label>
                      <select value={form.paymentMethod||'Direct Deposit'} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}>
                        <option>Direct Deposit</option>
                        <option>Check</option>
                        <option>Cash</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Hire Date</label>
                      <input type="date" value={form.hireDate||''} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))}/>
                    </div>
                  </div>
                  {(form.paymentMethod === 'Direct Deposit' || !form.paymentMethod) && (
                    <div style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:8, padding:'12px 14px', marginBottom:4 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:'var(--b2)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>🏦 Direct Deposit Banking Info</div>
                      <div className="form-grid2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                        <div className="field">
                          <label>Bank Name</label>
                          <input value={form.bank_name||''} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Chase Bank"/>
                        </div>
                        <div className="field">
                          <label>Account Type</label>
                          <select value={form.bank_account_type||'Checking'} onChange={e => setForm(f => ({ ...f, bank_account_type: e.target.value }))}>
                            <option>Checking</option>
                            <option>Savings</option>
                          </select>
                        </div>
                        <div className="field">
                          <label>Routing Number</label>
                          <input value={form.routing_number||''} onChange={e => setForm(f => ({ ...f, routing_number: e.target.value }))} placeholder="021000021" maxLength={9}/>
                        </div>
                        <div className="field">
                          <label>Account Number</label>
                          <input value={form.account_number||''} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} placeholder="••••••••••"/>
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:8, padding:'12px 14px', marginBottom:4 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--b2)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:10 }}>🌴 Time Off Balances</div>
                    <div className="form-grid2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                      <div className="field">
                        <label>PTO days</label>
                        <input type="number" step="0.5" value={form.pto_balance??0} onChange={e => setForm(f => ({ ...f, pto_balance: e.target.value }))}/>
                      </div>
                      <div className="field">
                        <label>Sick days</label>
                        <input type="number" step="0.5" value={form.sick_balance??0} onChange={e => setForm(f => ({ ...f, sick_balance: e.target.value }))}/>
                      </div>
                      <div className="field">
                        <label>Vacation days</label>
                        <input type="number" step="0.5" value={form.vacation_balance??0} onChange={e => setForm(f => ({ ...f, vacation_balance: e.target.value }))}/>
                      </div>
                    </div>
                    <div style={{ fontSize:11, color:'var(--t3)', marginTop:8 }}>Approving a request on the Time Off page automatically deducts the days from the matching balance here.</div>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Emergency Contact Name</label>
                      <input value={form.emergencyContact||''} onChange={e => setForm(f => ({ ...f, emergencyContact: e.target.value }))} placeholder="Jane Doe"/>
                    </div>
                    <div className="field">
                      <label>Emergency Contact Phone</label>
                      <input value={form.emergencyPhone||''} onChange={e => setForm(f => ({ ...f, emergencyPhone: e.target.value }))} placeholder="(305) 555-0000"/>
                    </div>
                  </div>
                  <div className="field">
                    <label>Filing Status</label>
                    <select value={form.filingStatus||'Single'} onChange={e => setForm(f => ({ ...f, filingStatus: e.target.value }))}>
                      <option>Single</option>
                      <option>Married Filing Jointly</option>
                      <option>Married Filing Separately</option>
                      <option>Head of Household</option>
                    </select>
                  </div>
                  <div style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--t3)', lineHeight:1.6 }}>
                    <strong style={{color:'var(--t2)'}}>ℹ️ Payroll note:</strong> Hourly Rate feeds directly into the Payroll page calculations. Overtime (1.5x) is applied automatically after 40 hours/week. 1099 contractors are exempt from federal/SS/Medicare withholding.
                  </div>
                </div>
              )}

              {/* IRS Info tab */}
              {tab === 'irs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--t3)', lineHeight:1.6, display:'flex', gap:8, alignItems:'flex-start' }}>
                    <span>🔒</span>
                    <span>This information is only visible to admins and this employee. Used when calling the IRS or logging into the IRS e-Services portal (SOR).</span>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>CAF Number</label>
                      <input value={form.caf||''} onChange={e => setForm(f => ({ ...f, caf: e.target.value }))} placeholder="0312-27862R"/>
                    </div>
                    <div className="field">
                      <label>PTIN</label>
                      <input value={form.ptin||''} onChange={e => setForm(f => ({ ...f, ptin: e.target.value }))} placeholder="P01982875"/>
                    </div>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>SOR Short ID</label>
                      <input value={form.sorShortId||''} onChange={e => setForm(f => ({ ...f, sorShortId: e.target.value }))} placeholder="JBF1CGA29O"/>
                    </div>
                    <div className="field">
                      <label>SOR Username</label>
                      <input value={form.sorUsername||''} onChange={e => setForm(f => ({ ...f, sorUsername: e.target.value }))} placeholder="rcruz187"/>
                    </div>
                  </div>
                </div>
              )}


              {tab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Full Name *</label>
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" />
                    </div>
                    <div className="field">
                      <label>Email *</label>
                      <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@taxcasereview.org" />
                    </div>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Phone</label>
                      <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 555-5555" />
                    </div>
                    <div className="field">
                      <label>Title</label>
                      <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Tax Analyst" />
                    </div>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Extension</label>
                      <input value={form.extension} onChange={e => setForm(f => ({ ...f, extension: e.target.value }))} placeholder="101" />
                    </div>
                    <div className="field">
                      <label>Direct Number</label>
                      <input value={form.direct_number} onChange={e => setForm(f => ({ ...f, direct_number: e.target.value }))} placeholder="+17725551234" />
                    </div>
                    <div className="field">
                      <label>Team</label>
                      <input value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))} placeholder="Resolution" />
                    </div>
                  </div>
                  <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="field">
                      <label>Employee ID</label>
                      <input value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="e.g. TCR-100" />
                    </div>
                    <div className="field">
                      <label>Social Security # <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400 }}>(stored securely)</span></label>
                      <input value={form.ssn} onChange={e => setForm(f => ({ ...f, ssn: e.target.value }))} placeholder="XXX-XX-XXXX" maxLength={11} />
                    </div>
                    <div className="field">
                      <label>Portal PIN <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400 }}>(4–6 digits, required to log into Employee Portal)</span></label>
                      <input type="password" value={form.portalPin} onChange={e => setForm(f => ({ ...f, portalPin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="••••" maxLength={6} inputMode="numeric" />
                    </div>
                  </div>
                  {form.employeeId && (
                    <div style={{ background: 'var(--s3)', border: '1px solid var(--br)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--t2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <span>🪪 Logs into the <strong>Employee Portal</strong> at <code style={{ background: 'var(--s2)', padding: '2px 6px', borderRadius: 4 }}>/employee</code> using their Employee ID + PIN. Make sure to set a PIN above.</span>
                      <button type="button" className="btn sec" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
                        onClick={() => { navigator.clipboard.writeText(window.location.origin + '/employee'); }}>
                        📋 Copy Portal Link
                      </button>
                    </div>
                  )}
                  <div className="field">
                    <label>Home Address</label>
                    <input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, Lake Park, FL 33403" />
                  </div>

                  {/* Role selector */}
                  <div className="field">
                    <label>Role / Access Level</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {ACCESS_LEVELS.map(r => {
                        const roleLabels = getRoleLabels()
                        const displayLabel = roleLabels[r] || r
                        return (
                          <button key={r} onClick={() => applyRoleDefaults(r)} style={{
                            padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                            border: '2px solid ' + (form.access === r ? ROLE_COLORS[r] : 'var(--br)'),
                            background: form.access === r ? ROLE_COLORS[r] + '22' : 'var(--s2)',
                            color: form.access === r ? ROLE_COLORS[r] : 'var(--t2)',
                            fontWeight: form.access === r ? 700 : 400,
                            fontSize: 13, transition: 'all .15s'
                          }}>
                            {displayLabel}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6 }}>
                      Selecting a role applies default permissions — you can customize them in the Permissions tab.
                    </div>
                  </div>
                </div>
              )}

              {/* Documents tab */}
              {tab === 'documents' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--t3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      📁 Employee Paperwork &amp; Documents
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t3)' }}>
                      Upload W4, I-9, direct deposit forms, contracts, or any other employee documents. Files are stored securely and only visible to admins.
                    </div>
                  </div>

                  <div
                    style={{ border: '2px dashed var(--br)', borderRadius: 10, padding: '1.25rem', textAlign: 'center', background: 'var(--s2)' }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); handleDocFiles(Array.from(e.dataTransfer.files)) }}
                  >
                    <label style={{ cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 24 }}>📎</span>
                      <span style={{ fontSize: 13, color: 'var(--b2)', fontWeight: 700 }}>
                        {docUploading ? 'Uploading…' : 'Click to upload or drag files here'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--t3)' }}>PDF, Word, images accepted · Max 10MB per file</span>
                      <input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                        onChange={e => handleDocFiles(Array.from(e.target.files || []))} />
                    </label>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                      Quick label for next upload
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {EMP_DOC_LABELS.map(t => (
                        <button key={t} onClick={() => setNextDocLabel(t)} style={{
                          padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                          border: '1px solid ' + (nextDocLabel === t ? 'var(--b2)' : 'var(--br)'),
                          background: nextDocLabel === t ? 'var(--b2)22' : 'var(--s2)',
                          color: nextDocLabel === t ? 'var(--b2)' : 'var(--t3)',
                        }}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {empDocs.length === 0 ? (
                    <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--t3)', padding: '12px 0' }}>
                      No documents yet. Upload W4, I-9, and other paperwork above.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {empDocs.map(d => (
                        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, padding: '8px 12px' }}>
                          <span style={{ fontSize: 14 }}>
                            {d.file_name?.toLowerCase().endsWith('.pdf') ? '📄' : /\.(jpg|jpeg|png)$/i.test(d.file_name || '') ? '🖼️' : '📁'}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--tx)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.name}
                          </span>
                          {d.docType && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--b2)22', color: 'var(--b2)', flexShrink: 0 }}>
                              {d.docType}
                            </span>
                          )}
                          {d.file_url && <a href={d.file_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--b2)', flexShrink: 0 }}>View</a>}
                          <button onClick={() => removeDoc(d)} style={{ background: 'none', border: 'none', color: 'var(--bad)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Permissions tab */}
              {tab === 'permissions' && hasPlanFeature(planTier, 'advanced_user_permissions') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{
                    background: 'var(--s2)', border: '1px solid var(--br)',
                    borderRadius: 8, padding: '10px 14px', marginBottom: 10,
                    fontSize: 13, color: 'var(--t3)', display: 'flex', gap: 8, alignItems: 'flex-start'
                  }}>
                    <span>ℹ️</span>
                    <span>Customize access for each section. These override the default role permissions. Click a role above (Info tab) to reset to defaults.</span>
                  </div>
                  {PERM_SECTIONS.map(section => {
                    const currentLevel = form[section.key] ?? 1
                    return (
                      <div key={section.key} style={{
                        border: '1px solid var(--br)', borderRadius: 10,
                        overflow: 'hidden', background: 'var(--s2)'
                      }}>
                        {/* Section header */}
                        <div style={{
                          padding: '12px 16px',
                          display: 'flex', alignItems: 'center', gap: 10,
                          borderBottom: '1px solid var(--br)',
                          background: 'var(--sf)'
                        }}>
                          <span style={{ fontSize: 18 }}>{section.icon}</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)' }}>{section.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--t3)' }}>{section.desc}</div>
                          </div>
                          <div style={{
                            marginLeft: 'auto',
                            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                            background: LEVEL_OPTIONS[currentLevel].color + '22',
                            color: LEVEL_OPTIONS[currentLevel].color,
                            border: '1px solid ' + LEVEL_OPTIONS[currentLevel].color + '44'
                          }}>
                            {LEVEL_OPTIONS[currentLevel].label}
                          </div>
                        </div>
                        {/* Level options */}
                        <div className="employees-level-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
                          {LEVEL_OPTIONS.map(opt => (
                            <div
                              key={opt.value}
                              onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, [section.key]: opt.value })) }}
                              style={{
                                padding: '10px 12px', cursor: 'pointer', textAlign: 'center',
                                borderRight: opt.value < 3 ? '1px solid var(--br)' : 'none',
                                background: currentLevel === opt.value ? opt.color + '18' : 'transparent',
                                transition: 'background .1s',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3
                              }}
                            >
                              <div style={{
                                width: 18, height: 18, borderRadius: '50%',
                                border: '2px solid ' + (currentLevel === opt.value ? opt.color : 'var(--br)'),
                                background: currentLevel === opt.value ? opt.color : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0
                              }}>
                                {currentLevel === opt.value && (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </div>
                              <div style={{ fontSize: 12, fontWeight: currentLevel === opt.value ? 700 : 500, color: currentLevel === opt.value ? opt.color : 'var(--t2)' }}>
                                {opt.label}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1.3 }}>{opt.desc}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--br)', flexWrap: 'wrap' }}>
                {saveError && <div style={{ width: '100%', fontSize: 12, color: '#ef4444', marginBottom: 6, padding: '6px 10px', background: '#ef444418', borderRadius: 6, border: '1px solid #ef444444' }}>⚠️ {saveError}</div>}
                <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn pri" onClick={() => save()} disabled={saving}>
                  {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Employee')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password reset modal */}
      {showReset && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001, padding: 20
        }} onClick={e => e.target === e.currentTarget && setShowReset(false)}>
          <div style={{
            background: 'var(--sf)', border: '1px solid var(--br)',
            borderRadius: 14, width: '100%', maxWidth: 400, padding: 28
          }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--tx)', marginBottom: 6 }}>🔑 Reset Password</div>
            <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 18 }}>
              A secure reset link will be emailed to the user. The link expires in 1 hour.
            </div>
            <div className="field">
              <label>Employee Email</label>
              <input
                type="email" value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                placeholder="employee@taxcasereview.org"
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setShowReset(false)}>Cancel</button>
              <button className="btn pri" onClick={sendReset} disabled={resetSending || !resetEmail}>
                {resetSending ? 'Sending…' : 'Send Reset Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-bg open" onClick={e=>e.target===e.currentTarget&&setConfirmDel(null)}>
          <div className="modal" style={{maxWidth:360,textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:12}}>🗑</div>
            <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Delete this employee?</div>
            <div style={{fontSize:13,color:'var(--t3)',marginBottom:20}}>This cannot be undone.</div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn sec" style={{flex:1,justifyContent:'center'}} onClick={()=>setConfirmDel(null)}>Cancel</button>
              <button className="btn del" style={{flex:1,justifyContent:'center'}} onClick={()=>remove(confirmDel)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


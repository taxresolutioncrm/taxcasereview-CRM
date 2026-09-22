import { useState, useEffect } from 'react'
import { formatMoneyInput, parseMoney, normalizeMoney } from '../lib/money'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import ComplianceGrids from './ComplianceGrids'
import PnLTab from './PnLTab'
import F433FTab from './F433FTab'

const BLANK_PROFILE = {
  dob:'', county:'', household_under_65:0, household_over_65:0,
  filing_status:'', tax_years_not_filed:'', has_lived_other_states:'', other_states_notes:'',
  employment_taxpayer_1:{}, employment_taxpayer_2:{},
  employment_spouse_1:{}, employment_spouse_2:{},
  business_1:{}, business_2:{},
  other_income:[],
  real_estate:[{},{},{},{}],
  vehicles:[{},{},{},{}],
  other_secured_debt:{},
  assets:[],
  cash_on_hand:20,
  credit_cards:[],
  expenses:{},
  irs_personal_liability:'', irs_civil_penalty_liability:'', irs_business_1120s_liability:'',
  irs_business_941_liability:'', irs_business_940_liability:'', state_personal_liability:'',
  recent_irs_notices:'',
  resolution_eta:'', total_recommended_fee:'', tax_prep_fee_only:'', proposed_resolution:'',
  notes:'',
  pl_base_year:{}, pl_missing_years:[],
  f433_extra:{}
}

// 2025 IRS Collection Financial Standards (effective April 21, 2025, in effect through June 2026)
const NATIONAL_STANDARD_FOOD_CLOTHING = (hh) => {
  if (hh <= 0) return 0
  if (hh === 1) return 839
  if (hh === 2) return 1481
  if (hh === 3) return 1753
  if (hh === 4) return 2129
  return 2129 + (hh - 4) * 394
}
const OOP_HEALTH_UNDER65 = 84
const OOP_HEALTH_65PLUS = 149
const VEHICLE_OWNERSHIP_STD = { 0: 0, 1: 662, 2: 1324 }
const PUBLIC_TRANSPORTATION_STD = 244

function n(v) { const x = parseFloat(v); return isNaN(x) ? 0 : x }
function fmt(v) { return '$' + n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function Field({ label, value, onChange, type='text', placeholder='', wide }) {
  // Money fields render as text so the thousands separators survive — a number
  // input silently refuses any value containing a comma. parseMoney strips them
  // back out before the value is stored, so nothing formatted reaches the row.
  const isMoney = type === 'number'
  const isCount = type === 'count'
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : {}}>
      <label>{label}</label>
      <input
        type={isMoney ? 'text' : isCount ? 'number' : type}
        inputMode={isMoney ? 'decimal' : undefined}
        value={isMoney ? formatMoneyInput(value) : (value ?? '')}
        onChange={e=>onChange(isMoney ? parseMoney(e.target.value) : e.target.value)}
        onBlur={isMoney ? (e=>onChange(normalizeMoney(e.target.value))) : undefined}
        placeholder={placeholder}/>
    </div>
  )
}

function SectionHeader({ children }) {
  return <div style={{fontSize:13,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',margin:'18px 0 8px',paddingTop:14,borderTop:'1px solid var(--br)'}}>{children}</div>
}

export default function FinancialProfile({ clientName, client, isLead = false }) {
  const { showToast, role } = useApp()
  const isTaxAdvisor = (role || '').trim().toLowerCase() === 'tax advisor'
  // Tax Advisors cannot access OIC Calculator, P&L, or 433 tabs
  const ADVISOR_RESTRICTED = ['oic', 'pnl', 'f433f']
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTabRaw] = useState(() => searchParams.get('fptab') || 'intake')
  // If a Tax Advisor somehow lands on a restricted tab (e.g. cached URL param),
  // immediately redirect them to the intake tab.
  useEffect(() => {
    if (isTaxAdvisor && ADVISOR_RESTRICTED.includes(tab)) {
      setTabRaw('intake')
    }
  }, [isTaxAdvisor, tab])

  function setTab(t) {
    if (isTaxAdvisor && ADVISOR_RESTRICTED.includes(t)) return
    setTabRaw(t)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('fptab', t)
      return next
    }, { replace: true })
  }
  const [profile, setProfile] = useState(BLANK_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { load() }, [clientName])

  // Convert "MM/DD/YYYY" (Clients tab format) to "YYYY-MM-DD" (HTML date input format)
  function toIsoDate(d) {
    if (!d) return ''
    const parts = String(d).split('/')
    if (parts.length === 3) {
      const [m, day, y] = parts
      if (y && m && day) return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`
    }
    return d // already ISO or unrecognized — leave as-is
  }

  // Fill in any blank Financial Profile fields using data already on the
  // client's record (Clients tab), without overwriting anything the user
  // has already entered in the Financial Profile.
  function seedFromClient(p) {
    if (!client) return p
    const next = { ...p }

    if (!next.dob) next.dob = toIsoDate(client.dob)
    if (!next.county) next.county = client.county || ''
    if (!next.filing_status) next.filing_status = client.filingStatus || ''

    // Business identity carries over from the lead/client record. Without this
    // the associate re-typed the entity name and EIN that were captured at
    // intake, and a mistyped EIN follows the case onto every form after it.
    if (client.business_name || client.ein) {
      const b = { ...(next.business_1 || {}) }
      if (!b.name) b.name = client.business_name || ''
      if (!b.ein)  b.ein  = client.ein || ''
      if (!b.address) {
        b.address = [client.biz_street, client.biz_city, client.biz_state, client.biz_zip]
          .filter(Boolean).join(', ')
      }
      next.business_1 = b
    }

    // Household size: taxpayer (+spouse if MFJ) + dependents, split by age 65
    if (!next.household_under_65 && !next.household_over_65) {
      const deps = client.dependents
        ? (typeof client.dependents === 'string' ? JSON.parse(client.dependents || '[]') : client.dependents)
        : []
      const isOver65 = (dobStr) => {
        if (!dobStr) return false
        const dob = new Date(toIsoDate(dobStr))
        if (isNaN(dob.getTime())) return false
        const age = (Date.now() - dob.getTime()) / (1000*60*60*24*365.25)
        return age >= 65
      }
      let under65 = 0, over65 = 0
      // Taxpayer
      if (isOver65(client.dob)) over65++; else under65++
      // Spouse (if MFJ/MFS and spouse name present)
      if (client.spouseName && (client.filingStatus||'').toLowerCase().includes('married')) {
        under65++ // no spouse DOB field on Clients — assume under 65
      }
      deps.forEach(d => { if (isOver65(d.dob)) over65++; else under65++ })
      if (under65 || over65) {
        next.household_under_65 = under65
        next.household_over_65 = over65
      }
    }

    // Business name from Clients (entityName / business_name)
    const bizName = client.entityName || client.business_name
    if (bizName && !next.business_1?.name) {
      next.business_1 = { ...(next.business_1||{}), name: bizName }
    }

    return next
  }

  async function load() {
    setLoading(true)
    let query = supabase.from('client_financial_profiles').select('*')
    if (client?.id) query = query.eq('client_id', String(client.id))
    else query = query.eq('client_name', clientName)
    const { data } = await query.maybeSingle()
    if (data) {
      const merged = { ...BLANK_PROFILE, ...data,
        real_estate: data.real_estate?.length ? data.real_estate : BLANK_PROFILE.real_estate,
        vehicles: data.vehicles?.length ? data.vehicles : BLANK_PROFILE.vehicles,
      }
      setProfile(seedFromClient(merged))
    } else {
      setProfile(seedFromClient(BLANK_PROFILE))
    }
    setLoading(false)
    setDirty(false)
  }

  function set(path, value) {
    setProfile(p => {
      const next = structuredClone(p)
      const keys = path.split('.')
      let obj = next
      for (let i=0;i<keys.length-1;i++) {
        if (obj[keys[i]] === undefined || obj[keys[i]] === null) obj[keys[i]] = {}
        obj = obj[keys[i]]
      }
      obj[keys[keys.length-1]] = value
      return next
    })
    setDirty(true)
  }

  function setArr(path, idx, key, value) {
    setProfile(p => {
      const next = structuredClone(p)
      if (!next[path]) next[path] = []
      if (!next[path][idx]) next[path][idx] = {}
      next[path][idx][key] = value
      return next
    })
    setDirty(true)
  }

  function addArrRow(path, blank={}) {
    setProfile(p => ({ ...p, [path]: [...(p[path]||[]), blank] }))
    setDirty(true)
  }

  function removeArrRow(path, idx) {
    setProfile(p => ({ ...p, [path]: p[path].filter((_,i)=>i!==idx) }))
    setDirty(true)
  }

  async function persist(profileToSave) {
    const payload = { ...profileToSave, client_name: clientName, client_id: client?.id ? String(client.id) : (profileToSave.client_id || null), updated_at: new Date().toISOString() }
    delete payload.id
    if (payload.client_id) {
      const { error } = await supabase.from('client_financial_profiles')
        .upsert(payload, { onConflict: 'tenant_id,client_id' })
      return error
    }
    if (profileToSave.id) {
      const { error } = await supabase.from('client_financial_profiles').update(payload).eq('id', profileToSave.id)
      return error
    }
    const { error } = await supabase.from('client_financial_profiles').insert(payload)
    return error
  }

  async function save() {
    setSaving(true)
    const error = await persist(profile)
    setSaving(false)
    if (error) { showToast('Error: '+error.message, 'err'); return }
    showToast('💾 Financial Profile saved')
    setDirty(false)
  }

  // Autosave: ~1.5s after the last edit, persist silently in the background.
  useEffect(() => {
    if (loading || !dirty) return
    const timer = setTimeout(async () => {
      setSaving(true)
      const error = await persist(profile)
      setSaving(false)
      if (!error) setDirty(false)
      // Silent on success; errors still surface so the user knows to retry/manually save.
      if (error) showToast('Autosave error: '+error.message, 'err')
    }, 1500)
    return () => clearTimeout(timer)
  }, [profile, dirty, loading])

  async function exportExcel() {
    setExporting(true)
    try {
      const { data: recs, error } = await supabase.from('client_compliance_records')
        .select('*').eq('client_name', clientName)
      if (error) { showToast('Error loading compliance data: '+error.message, 'err'); return }
      const { exportFinancialProfileToExcel } = await import('../lib/financialProfileExport')
      exportFinancialProfileToExcel(profile, client, recs || [])
      showToast('📥 Exported Financial Profile to Excel')
    } catch (err) {
      showToast('Export error: '+err.message, 'err')
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <div style={{padding:24,textAlign:'center',color:'var(--t3)'}}>Loading…</div>

  const totalHousehold = n(profile.household_under_65) + n(profile.household_over_65)

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'1px solid var(--br)',flexWrap:'wrap'}}>
        {[
          // Tax Advisors: Compliance, TO Intake, I&E, Assets & Equity only
          // Tax Associates, Admins, Managers: all tabs
          {key:'compliance', label:'📑 Compliance'},
          {key:'intake',     label:'📋 TO Intake'},
          {key:'ie',         label:'💰 I&E'},
          {key:'assets',     label:'🏦 Assets & Equity'},
          !isTaxAdvisor && {key:'oic',   label:'🧮 OIC Calculator'},
          !isTaxAdvisor && {key:'pnl',   label:'📊 P&L'},
          !isTaxAdvisor && {key:'f433f', label:'🗂️ 433'},
        ].filter(Boolean).map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{
            padding:'8px 16px', borderRadius:'8px 8px 0 0',
            border:'1px solid var(--br)', borderBottom: tab===t.key ? '1px solid var(--sf)' : '1px solid var(--br)',
            background: tab===t.key ? 'var(--sf)' : 'var(--s2)',
            color: tab===t.key ? 'var(--tx)' : 'var(--t3)',
            fontWeight: tab===t.key ? 700 : 400,
            cursor:'pointer', fontSize:13, marginBottom:-1
          }}>{t.label}</button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
          {saving
            ? <span style={{fontSize:11,color:'var(--t3)'}}>Saving…</span>
            : dirty
              ? <span style={{fontSize:11,color:'var(--warn)'}}>Unsaved changes…</span>
              : <span style={{fontSize:11,color:'var(--t3)'}}>✓ Saved</span>}
          <button className="btn sec" style={{marginBottom:6}} onClick={exportExcel} disabled={exporting}>{exporting?'Exporting…':'📥 Export to Excel'}</button>
          <button className="btn pri" style={{marginBottom:6}} onClick={save} disabled={saving}>{saving?'Saving…':'💾 Save Now'}</button>
        </div>
      </div>

      {tab === 'intake' && <IntakeTab profile={profile} set={set} setArr={setArr} addArrRow={addArrRow} removeArrRow={removeArrRow} totalHousehold={totalHousehold} />}
      {tab === 'ie'     && <IETab profile={profile} set={set} totalHousehold={totalHousehold} />}
      {tab === 'assets' && <AssetsTab profile={profile} set={set} setArr={setArr} addArrRow={addArrRow} removeArrRow={removeArrRow} />}
      {tab === 'oic'    && !isTaxAdvisor && <OICTab profile={profile} totalHousehold={totalHousehold} />}
      {tab === 'pnl'    && !isTaxAdvisor && <PnLTab profile={profile} set={set} />}
      {tab === 'compliance' && <ComplianceGrids clientName={clientName} />}
      {tab === 'f433f'  && !isTaxAdvisor && <F433FTab profile={profile} set={set} client={client} totalHousehold={totalHousehold}
                              income={calcIncome(profile)} exp={calcExpenses(profile, totalHousehold)} assets={calcAssets(profile)} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// INTAKE TAB
// ════════════════════════════════════════════════════════════════════════
function IntakeTab({ profile, set, setArr, addArrRow, removeArrRow, totalHousehold }) {
  return (
    <div>
      <SectionHeader>Household</SectionHeader>
      <div className="fg2">
        <Field label="Date of Birth" value={profile.dob} onChange={v=>set('dob',v)} type="date"/>
        <Field label="County" value={profile.county} onChange={v=>set('county',v)}/>
      </div>
      <div className="fg2">
        <Field label="Household Under 65" value={profile.household_under_65} onChange={v=>set('household_under_65',v)} type="count"/>
        <Field label="Household Over 65" value={profile.household_over_65} onChange={v=>set('household_over_65',v)} type="count"/>
      </div>
      <div className="fg2">
        <Field label="Filing Status" value={profile.filing_status} onChange={v=>set('filing_status',v)} placeholder="e.g. Married Filing Jointly"/>
        <Field label="Tax Years Not Filed" value={profile.tax_years_not_filed} onChange={v=>set('tax_years_not_filed',v)} placeholder="e.g. 2021, 2022, 2023"/>
      </div>
      <div className="fg2">
        <Field label="Has Client Lived in Another State?" value={profile.has_lived_other_states} onChange={v=>set('has_lived_other_states',v)}/>
        <Field label="Which States & Dates of Move" value={profile.other_states_notes} onChange={v=>set('other_states_notes',v)}/>
      </div>
      <div style={{fontSize:12,color:'var(--t3)',marginTop:6}}>Total Household Size: <strong style={{color:'var(--tx)'}}>{totalHousehold}</strong></div>

      <SectionHeader>Employment — Taxpayer</SectionHeader>
      <EmploymentBlock label="Employer 1" data={profile.employment_taxpayer_1} onChange={(k,v)=>set('employment_taxpayer_1.'+k,v)}/>
      <EmploymentBlock label="Employer 2" data={profile.employment_taxpayer_2} onChange={(k,v)=>set('employment_taxpayer_2.'+k,v)}/>

      <SectionHeader>Employment — Spouse</SectionHeader>
      <EmploymentBlock label="Employer 1" data={profile.employment_spouse_1} onChange={(k,v)=>set('employment_spouse_1.'+k,v)}/>
      <EmploymentBlock label="Employer 2" data={profile.employment_spouse_2} onChange={(k,v)=>set('employment_spouse_2.'+k,v)}/>

      <SectionHeader>Business 1</SectionHeader>
      <BusinessBlock data={profile.business_1} onChange={(k,v)=>set('business_1.'+k,v)}/>

      <SectionHeader>Business 2</SectionHeader>
      <BusinessBlock data={profile.business_2} onChange={(k,v)=>set('business_2.'+k,v)}/>

      <SectionHeader>Other Income</SectionHeader>
      {(profile.other_income||[]).map((row,i)=>(
        <div key={i} className="fg3" style={{alignItems:'end'}}>
          <Field label="Source" value={row.source} onChange={v=>setArr('other_income',i,'source',v)}/>
          <Field label="Monthly Amount" value={row.amount} onChange={v=>setArr('other_income',i,'amount',v)} type="number"/>
          <button className="btn del sm" onClick={()=>removeArrRow('other_income',i)} style={{marginBottom:14}}>Remove</button>
        </div>
      ))}
      <button className="btn sm" onClick={()=>addArrRow('other_income',{source:'',amount:''})}>+ Add Other Income</button>

      <SectionHeader>Real Estate</SectionHeader>
      {(profile.real_estate||[]).map((row,i)=>(
        <RealEstateBlock key={i} idx={i} row={row} onChange={(k,v)=>setArr('real_estate',i,k,v)}/>
      ))}

      <SectionHeader>Vehicles</SectionHeader>
      {(profile.vehicles||[]).map((row,i)=>(
        <VehicleBlock key={i} idx={i} row={row} onChange={(k,v)=>setArr('vehicles',i,k,v)}/>
      ))}

      <SectionHeader>Other Secured Debt (e.g. Student Loans)</SectionHeader>
      <div className="fg3">
        <Field label="Monthly Payment" value={profile.other_secured_debt?.monthly_payment} onChange={v=>set('other_secured_debt.monthly_payment',v)} type="number"/>
        <Field label="Final Payment Date" value={profile.other_secured_debt?.final_payment_date} onChange={v=>set('other_secured_debt.final_payment_date',v)}/>
        <Field label="Remaining Balance" value={profile.other_secured_debt?.remaining_balance} onChange={v=>set('other_secured_debt.remaining_balance',v)} type="number"/>
      </div>

      <SectionHeader>IRS / State Liability Snapshot</SectionHeader>
      <div className="fg3">
        <Field label="IRS Personal Liability (1040)" value={profile.irs_personal_liability} onChange={v=>set('irs_personal_liability',v)} type="number"/>
        <Field label="IRS Civil Penalty Liability" value={profile.irs_civil_penalty_liability} onChange={v=>set('irs_civil_penalty_liability',v)} type="number"/>
        <Field label="State Personal Liability" value={profile.state_personal_liability} onChange={v=>set('state_personal_liability',v)} type="number"/>
      </div>
      <div className="fg3">
        <Field label="IRS Business 1120s Liability" value={profile.irs_business_1120s_liability} onChange={v=>set('irs_business_1120s_liability',v)} type="number"/>
        <Field label="IRS Business 941 Liability" value={profile.irs_business_941_liability} onChange={v=>set('irs_business_941_liability',v)} type="number"/>
        <Field label="IRS Business 940 Liability" value={profile.irs_business_940_liability} onChange={v=>set('irs_business_940_liability',v)} type="number"/>
      </div>
      <Field label="Recent IRS Notices" value={profile.recent_irs_notices} onChange={v=>set('recent_irs_notices',v)} wide/>
      <div style={{height:14}}/>

      <SectionHeader>Resolution Plan</SectionHeader>
      <div className="fg2">
        <Field label="Resolution ETA (Estimation)" value={profile.resolution_eta} onChange={v=>set('resolution_eta',v)}/>
        <Field label="Proposed Resolution" value={profile.proposed_resolution} onChange={v=>set('proposed_resolution',v)}/>
      </div>
      <div className="fg2">
        <Field label="Total Recommended Fee" value={profile.total_recommended_fee} onChange={v=>set('total_recommended_fee',v)} type="number"/>
        <Field label="Tax Prep Fee Only" value={profile.tax_prep_fee_only} onChange={v=>set('tax_prep_fee_only',v)} type="number"/>
      </div>
      <Field label="Notes" value={profile.notes} onChange={v=>set('notes',v)} wide/>
      <div style={{height:10}}/>
    </div>
  )
}

function EmploymentBlock({ label, data, onChange }) {
  // Intake can store a section as explicit null (not just missing), and a
  // default param only covers undefined — so null must be handled here or
  // every field read below throws.
  data = data || {}
  return (
    <div style={{border:'1px solid var(--br)',borderRadius:8,padding:'12px 14px',marginBottom:12,background:'var(--s2)'}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:'var(--t2)'}}>{label}</div>
      <div className="fg2">
        <Field label="Employer Name" value={data.employer} onChange={v=>onChange('employer',v)}/>
        <Field label="Length of Time at Employer" value={data.length} onChange={v=>onChange('length',v)}/>
      </div>
      <div className="fg2">
        <Field label="Position at Company" value={data.position} onChange={v=>onChange('position',v)}/>
        <Field label="Pay Frequency" value={data.pay_frequency} onChange={v=>onChange('pay_frequency',v)} placeholder="Weekly, Bi-weekly, Monthly"/>
      </div>
      <div className="fg3">
        <Field label="Gross Monthly Salary" value={data.gross_monthly_salary} onChange={v=>onChange('gross_monthly_salary',v)} type="number"/>
        <Field label="Federal Taxes Withheld (Monthly)" value={data.fed_withheld} onChange={v=>onChange('fed_withheld',v)} type="number"/>
        <Field label="Med/SS Taxes Withheld (Monthly)" value={data.ss_med_withheld} onChange={v=>onChange('ss_med_withheld',v)} type="number"/>
      </div>
      <Field label="State Taxes Withheld (Monthly)" value={data.state_withheld} onChange={v=>onChange('state_withheld',v)} type="number"/>
    </div>
  )
}

function BusinessBlock({ data, onChange }) {
  data = data || {}
  return (
    <div style={{border:'1px solid var(--br)',borderRadius:8,padding:'12px 14px',marginBottom:12,background:'var(--s2)'}}>
      <div className="fg2">
        <Field label="Name of Business" value={data.name} onChange={v=>onChange('name',v)}/>
        <Field label="Business Address" value={data.address} onChange={v=>onChange('address',v)}/>
      </div>
      <div className="fg3">
        <Field label="EIN" value={data.ein} onChange={v=>onChange('ein',v)}/>
        <Field label="Business Structure" value={data.structure} onChange={v=>onChange('structure',v)} placeholder="LLC, S-Corp, etc."/>
        <Field label="% of Ownership" value={data.pct_ownership} onChange={v=>onChange('pct_ownership',v)}/>
      </div>
      <div className="fg2">
        <Field label="Date Business Opened" value={data.date_opened} onChange={v=>onChange('date_opened',v)} type="date"/>
        <Field label="Date Business Closed" value={data.date_closed} onChange={v=>onChange('date_closed',v)} type="date"/>
      </div>
      <div className="fg2">
        <Field label="Other Partners" value={data.other_partners} onChange={v=>onChange('other_partners',v)}/>
        <Field label="Number of Employees" value={data.num_employees} onChange={v=>onChange('num_employees',v)} type="count"/>
      </div>
      <div className="fg2">
        <Field label="Payroll Processor" value={data.payroll_processor} onChange={v=>onChange('payroll_processor',v)}/>
        <Field label="Current on 941 Filings & Payments?" value={data.current_941} onChange={v=>onChange('current_941',v)}/>
      </div>
      <div className="fg2">
        <Field label="Net Income from Business (Monthly)" value={data.net_income} onChange={v=>onChange('net_income',v)} type="number"/>
        <Field label="K-1 Distribution (Monthly)" value={data.k1_distribution} onChange={v=>onChange('k1_distribution',v)} type="number"/>
      </div>
      <Field label="Additional Notes" value={data.notes} onChange={v=>onChange('notes',v)} wide/>
      <div style={{height:8}}/>
    </div>
  )
}

function RealEstateBlock({ idx, row, onChange }) {
  return (
    <div style={{border:'1px solid var(--br)',borderRadius:8,padding:'12px 14px',marginBottom:12,background:'var(--s2)'}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:'var(--t2)'}}>
        Property {idx+1} {idx===0 && '(Primary Residence)'}
      </div>
      <Field label="Address" value={row.address} onChange={v=>onChange('address',v)} wide/>
      <div className="fg3">
        {idx===0 ? (
          <>
            <Field label="Monthly Rent Expense" value={row.monthly_rent} onChange={v=>onChange('monthly_rent',v)} type="number"/>
            <Field label="Monthly Mortgage Expense" value={row.mortgage_1} onChange={v=>onChange('mortgage_1',v)} type="number"/>
            <Field label="2nd Mortgage Payment" value={row.mortgage_2} onChange={v=>onChange('mortgage_2',v)} type="number"/>
          </>
        ) : (
          <>
            <Field label="Rental Income (Gross)" value={row.rental_income} onChange={v=>onChange('rental_income',v)} type="number"/>
            <Field label="2nd Mortgage Payment" value={row.mortgage_2} onChange={v=>onChange('mortgage_2',v)} type="number"/>
            <Field label="Monthly Mortgage Expense" value={row.mortgage_1} onChange={v=>onChange('mortgage_1',v)} type="number"/>
          </>
        )}
      </div>
      <div className="fg3">
        <Field label="Purchase Date (Year)" value={row.purchase_year} onChange={v=>onChange('purchase_year',v)}/>
        <Field label="Purchase Amount" value={row.purchase_amount} onChange={v=>onChange('purchase_amount',v)} type="number"/>
        <Field label="Refinance Date (Year)" value={row.refi_year} onChange={v=>onChange('refi_year',v)}/>
      </div>
      <div className="fg3">
        <Field label="Refinance Amount" value={row.refi_amount} onChange={v=>onChange('refi_amount',v)} type="number"/>
        <Field label="Value of Home (Zillow)" value={row.zillow_value} onChange={v=>onChange('zillow_value',v)} type="number"/>
        <Field label="Length of Mortgage" value={row.mortgage_length} onChange={v=>onChange('mortgage_length',v)}/>
      </div>
      <Field label="Balance of Mortgage" value={row.mortgage_balance} onChange={v=>onChange('mortgage_balance',v)} type="number"/>
    </div>
  )
}

function VehicleBlock({ idx, row, onChange }) {
  return (
    <div style={{border:'1px solid var(--br)',borderRadius:8,padding:'12px 14px',marginBottom:12,background:'var(--s2)'}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:'var(--t2)'}}>Vehicle {idx+1}</div>
      <div className="fg2">
        <Field label="Make / Model / Style" value={row.make_model} onChange={v=>onChange('make_model',v)}/>
        <Field label="Year" value={row.year} onChange={v=>onChange('year',v)}/>
      </div>
      <div className="fg3">
        <Field label="Purchase Date" value={row.purchase_date} onChange={v=>onChange('purchase_date',v)} type="date"/>
        <Field label="Purchase Amount" value={row.purchase_amount} onChange={v=>onChange('purchase_amount',v)} type="number"/>
        <Field label="Monthly Payment" value={row.monthly_payment} onChange={v=>onChange('monthly_payment',v)} type="number"/>
      </div>
      <div className="fg3">
        <Field label="Final Payment Date" value={row.final_payment_date} onChange={v=>onChange('final_payment_date',v)} type="date"/>
        <Field label="Mileage" value={row.mileage} onChange={v=>onChange('mileage',v)} type="count"/>
        <Field label="Current Value (KBB)" value={row.kbb_value} onChange={v=>onChange('kbb_value',v)} type="number"/>
      </div>
      <Field label="Remaining Balance" value={row.remaining_balance} onChange={v=>onChange('remaining_balance',v)} type="number"/>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// SHARED CALCULATIONS
// ════════════════════════════════════════════════════════════════════════
function calcIncome(profile) {
  const et1 = profile.employment_taxpayer_1 || {}, et2 = profile.employment_taxpayer_2 || {}
  const es1 = profile.employment_spouse_1 || {}, es2 = profile.employment_spouse_2 || {}
  const b1 = profile.business_1 || {}, b2 = profile.business_2 || {}
  const re = profile.real_estate || []

  const wagesT1 = n(et1.gross_monthly_salary)
  const wagesT2 = n(et2.gross_monthly_salary)
  const wagesS1 = n(es1.gross_monthly_salary)
  const wagesS2 = n(es2.gross_monthly_salary)

  const taxesT1 = n(et1.fed_withheld) + n(et1.ss_med_withheld) + n(et1.state_withheld)
  const taxesT2 = n(et2.fed_withheld) + n(et2.ss_med_withheld) + n(et2.state_withheld)
  const taxesS1 = n(es1.fed_withheld) + n(es1.ss_med_withheld) + n(es1.state_withheld)
  const taxesS2 = n(es2.fed_withheld) + n(es2.ss_med_withheld) + n(es2.state_withheld)

  const netBizIncome = n(b1.net_income) + n(b2.net_income)
  const seTax = netBizIncome * 0.153

  const k1 = n(b1.k1_distribution) + n(b2.k1_distribution)

  // Net rental income across properties 2-4 (rental_income - mortgage_1)
  let rentalIncome = 0
  re.forEach((p,i) => { if (i>0) rentalIncome += n(p.rental_income) - n(p.mortgage_1) })

  const otherIncome = (profile.other_income||[]).reduce((s,r)=>s+n(r.amount),0)

  const grossIncomeTotal = wagesT1+wagesT2+wagesS1+wagesS2 + netBizIncome + k1 + rentalIncome + otherIncome
  const taxesTotal = taxesT1+taxesT2+taxesS1+taxesS2 + seTax

  // C54 in I&E = total gross income (D54 = sum of taxes columns, used differently)
  // Net monthly income available = gross - taxes
  const netMonthlyIncome = grossIncomeTotal - taxesTotal

  return {
    wagesT1, wagesT2, wagesS1, wagesS2, taxesT1, taxesT2, taxesS1, taxesS2,
    netBizIncome, seTax, k1, rentalIncome, otherIncome,
    grossIncomeTotal, taxesTotal, netMonthlyIncome
  }
}

function calcExpenses(profile, totalHousehold) {
  const e = profile.expenses || {}
  const re = profile.real_estate?.[0] || {}
  const vehicles = profile.vehicles || []
  const osd = profile.other_secured_debt || {}
  const ccTotal = (profile.credit_cards||[]).reduce((s,c)=>s+n(c.min_payment),0)
  const income = calcIncome(profile)

  // National standards
  const foodClothingStd = NATIONAL_STANDARD_FOOD_CLOTHING(totalHousehold)
  const foodClothingActual = n(e.food_clothing) || foodClothingStd

  // Housing & Utilities (actual)
  const housing = n(re.mortgage_1) + n(re.mortgage_2) + n(e.homeowners_insurance) + n(e.property_taxes) +
    n(e.hoa_dues) + n(e.rent) + n(e.renters_insurance) + n(e.electricity) + n(e.water_sewer_trash) +
    n(e.waste_sewer) + n(e.trash) + n(e.heating_gas) + n(e.heating_propane) + n(e.cell_phone) +
    n(e.internet) + n(e.cable) + n(e.pest_control) + n(e.lawn) + n(e.maintenance)
  const housingStd = n(e.housing_standard) || 0 // local standard, manually entered

  // Vehicle
  const vehiclesWithPayment = vehicles.filter(v=>n(v.monthly_payment)>0).length
  const vehicle1Payment = n(vehicles[0]?.monthly_payment)
  const vehicle2Payment = n(vehicles[1]?.monthly_payment)
  const vehicleTotal = n(e.public_transportation) + vehicle1Payment + vehicle2Payment + n(e.car_misc)
  const vehicleStd = (e.public_transportation ? PUBLIC_TRANSPORTATION_STD : 0) + (VEHICLE_OWNERSHIP_STD[Math.min(vehiclesWithPayment,2)] || 0)

  // Health Care
  const oopHealthStd = n(profile.household_under_65)*OOP_HEALTH_UNDER65 + n(profile.household_over_65)*OOP_HEALTH_65PLUS
  const oopHealthActual = n(e.health_oop) || oopHealthStd
  const healthTotal = n(e.health_major_medical) + n(e.health_supplemental) + n(e.health_dental) + n(e.health_vision) + oopHealthActual

  // Credit cards
  const creditTotal = n(e.credit_card_min) || ccTotal

  // Court ordered
  const courtTotal = n(e.child_support) + n(e.court_judgment)

  // Child/dependent care
  const childCare = n(e.child_care)

  // Other secured debt
  const otherSecured = n(osd.monthly_payment)

  // Life insurance
  const lifeTotal = n(e.life_term) + n(e.life_whole)

  // Taxes (withholding from all sources + installment agreements)
  const taxesSubtotal = income.taxesTotal + n(e.irs_installment) + n(e.state_installment)

  const totalMonthlyExpenses = foodClothingActual + housing + vehicleTotal + healthTotal + creditTotal +
    courtTotal + childCare + otherSecured + lifeTotal + taxesSubtotal

  const netDisposableIncome = income.grossIncomeTotal - totalMonthlyExpenses

  // Amounts over National Standard (added back to NDI for OIC NDI)
  const homeOverNS = Math.max(0, housing - housingStd) + n(e.maintenance)
  const vehicle1OverNS = Math.max(0, vehicle1Payment - 588)
  const vehicle2OverNS = Math.max(0, vehicle2Payment - 588)

  const oicNDI = netDisposableIncome + homeOverNS + vehicle1OverNS + vehicle2OverNS

  return {
    foodClothingStd, foodClothingActual, housing, housingStd, vehicleTotal, vehicleStd,
    oopHealthStd, oopHealthActual, healthTotal, creditTotal, courtTotal, childCare,
    otherSecured, lifeTotal, taxesSubtotal, totalMonthlyExpenses, netDisposableIncome,
    homeOverNS, vehicle1OverNS, vehicle2OverNS, oicNDI,
    vehicle1Payment, vehicle2Payment
  }
}

function calcAssets(profile) {
  const assets = profile.assets || []
  const re = profile.real_estate || []
  const vehicles = profile.vehicles || []
  const cash = n(profile.cash_on_hand)

  const rows = []

  // Bank accounts
  const bankAccounts = assets.filter(a=>a.type==='bank_account')
  let bankTotal = { value:0, oic:0, loan:0, amount:0 }
  bankAccounts.forEach(a=>{
    const value = n(a.value), loan = n(a.loan_against)
    bankTotal.value += value; bankTotal.loan += loan
    bankTotal.oic += value; // OIC factor = 1.0 for bank accounts
  })
  bankTotal.amount = Math.max(0, (bankTotal.oic - bankTotal.loan) - 1000) // $1000 quick-sale exemption

  // Life insurance (0.7 factor)
  const lifeInsurance = assets.filter(a=>a.type==='life_insurance')
  let lifeTotal = { value:0, oic:0, loan:0, amount:0 }
  lifeInsurance.forEach(a=>{
    const value = n(a.value), loan = n(a.loan_against), oic = value*0.7
    lifeTotal.value+=value; lifeTotal.loan+=loan; lifeTotal.oic+=oic
    lifeTotal.amount += Math.max(0, oic-loan)
  })

  // Retirement (0.7 factor)
  const retirement = assets.filter(a=>a.type==='retirement')
  let retTotal = { value:0, oic:0, loan:0, amount:0 }
  retirement.forEach(a=>{
    const value = n(a.value), loan = n(a.loan_against), oic = value*0.7
    retTotal.value+=value; retTotal.loan+=loan; retTotal.oic+=oic
    retTotal.amount += Math.max(0, oic-loan)
  })

  // Vehicles (0.8 factor)
  let vehicleTotal = { value:0, oic:0, loan:0, amount:0 }
  vehicles.forEach(v=>{
    const value = n(v.kbb_value), loan = n(v.remaining_balance), oic = value*0.8
    if (!value) return
    vehicleTotal.value+=value; vehicleTotal.loan+=loan; vehicleTotal.oic+=oic
    vehicleTotal.amount += Math.max(0, oic-loan)
  })

  // Real estate (0.8 factor)
  let reTotal = { value:0, oic:0, loan:0, amount:0 }
  re.forEach((p,i)=>{
    const value = n(p.zillow_value), loan = n(p.mortgage_balance), oic = value*0.8
    if (!value) return
    reTotal.value+=value; reTotal.loan+=loan; reTotal.oic+=oic
    reTotal.amount += Math.max(0, oic-loan)
  })

  // Business assets (1.0 factor)
  const bizAssets = assets.filter(a=>a.type==='business_asset')
  let bizTotal = { value:0, oic:0, loan:0, amount:0 }
  bizAssets.forEach(a=>{
    const value = n(a.value), loan = n(a.loan_against)
    bizTotal.value+=value; bizTotal.loan+=loan; bizTotal.oic+=value
    bizTotal.amount += Math.max(0, value-loan)
  })

  // Additional assets (0.8 factor)
  const additional = assets.filter(a=>a.type==='additional_asset')
  let addlTotal = { value:0, oic:0, loan:0, amount:0 }
  additional.forEach(a=>{
    const value = n(a.value), loan = n(a.loan_against), oic = value*0.8
    addlTotal.value+=value; addlTotal.loan+=loan; addlTotal.oic+=oic
    addlTotal.amount += Math.max(0, oic-loan)
  })

  const grandTotal = {
    value: bankTotal.value+lifeTotal.value+retTotal.value+vehicleTotal.value+reTotal.value+bizTotal.value+addlTotal.value+cash,
    oic: bankTotal.oic+lifeTotal.oic+retTotal.oic+vehicleTotal.oic+reTotal.oic+bizTotal.oic+addlTotal.oic+cash,
    loan: bankTotal.loan+lifeTotal.loan+retTotal.loan+vehicleTotal.loan+reTotal.loan+bizTotal.loan+addlTotal.loan,
    amount: bankTotal.amount+lifeTotal.amount+retTotal.amount+vehicleTotal.amount+reTotal.amount+bizTotal.amount+addlTotal.amount+cash,
  }

  return { bankTotal, lifeTotal, retTotal, vehicleTotal, reTotal, bizTotal, addlTotal, cash, grandTotal, bankAccounts, lifeInsurance, retirement, bizAssets, additional }
}

// ════════════════════════════════════════════════════════════════════════
// I&E TAB
// ════════════════════════════════════════════════════════════════════════
function ExpField({ label, k, expenses, set, std }) {
  return (
    <div className="fp-expfield" style={{display:'grid',gridTemplateColumns: std!==undefined ? '1fr 140px 120px' : '1fr 140px', gap:10, alignItems:'center', padding:'7px 0'}}>
      <div style={{fontSize:14,fontWeight:500,color:'var(--tx)'}}>{label}</div>
      <input type="text" inputMode="decimal" value={formatMoneyInput(expenses[k])} onChange={e=>set('expenses.'+k, parseMoney(e.target.value))} onBlur={e=>set('expenses.'+k, normalizeMoney(e.target.value))} placeholder="0.00"
        style={{padding:'8px 10px',fontSize:14,background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)'}}/>
      {std!==undefined && <div style={{fontSize:13,color:'var(--t3)',textAlign:'right'}}>Std: {fmt(std)}</div>}
    </div>
  )
}

function SubtotalRow({ label, value }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderTop:'1px solid var(--br)',marginTop:6,fontWeight:700,fontSize:13}}>
      <span>{label}</span><span>{fmt(value)}</span>
    </div>
  )
}

function IETab({ profile, set, totalHousehold }) {
  const income = calcIncome(profile)
  const exp = calcExpenses(profile, totalHousehold)
  const e = profile.expenses || {}
  const re0 = profile.real_estate?.[0] || {}
  const vehicles = profile.vehicles || []

  return (
    <div>
      <SectionHeader>Income Summary (from Intake)</SectionHeader>
      <div className="card" style={{padding:'12px 16px',background:'var(--s2)',marginBottom:10}}>
        {[
          ['Wages (Taxpayer)', income.wagesT1+income.wagesT2],
          ['Wages (Spouse)', income.wagesS1+income.wagesS2],
          ['Net Business Income', income.netBizIncome],
          ['K-1 Distributions', income.k1],
          ['Net Rental Income', income.rentalIncome],
          ['Other Income', income.otherIncome],
        ].map(([l,v])=>(
          <div key={l} className="dr"><span className="dl">{l}</span><span className="dv">{fmt(v)}</span></div>
        ))}
        <SubtotalRow label="Gross Monthly Income" value={income.grossIncomeTotal}/>
        <div className="dr"><span className="dl">Total Taxes Withheld (incl. SE Tax)</span><span className="dv">{fmt(income.taxesTotal)}</span></div>
        <SubtotalRow label="Net Monthly Income" value={income.netMonthlyIncome}/>
      </div>

      <SectionHeader>Monthly Living Expenses</SectionHeader>

      <div style={{fontWeight:700,fontSize:13,marginTop:10,marginBottom:4,color:'var(--t2)'}}>Food, Clothing & Misc.</div>
      <div style={{fontSize:13,color:'var(--t2)',marginBottom:6}}>National Standard for household of {totalHousehold}: {fmt(exp.foodClothingStd)}</div>
      <ExpField label="Food, Clothing and Misc. (Actual — leave blank to use standard)" k="food_clothing" expenses={e} set={set} std={exp.foodClothingStd}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Housing & Utilities</div>
      <div style={{fontSize:13,color:'var(--t2)',marginBottom:6}}>1st/2nd mortgage pulled from Real Estate (Property 1): {fmt(n(re0.mortgage_1)+n(re0.mortgage_2))}</div>
      <ExpField label="Homeowner's Insurance" k="homeowners_insurance" expenses={e} set={set}/>
      <ExpField label="Property Taxes" k="property_taxes" expenses={e} set={set}/>
      <ExpField label="HOA Dues" k="hoa_dues" expenses={e} set={set}/>
      <ExpField label="Rent Payment" k="rent" expenses={e} set={set}/>
      <ExpField label="Renter's Insurance" k="renters_insurance" expenses={e} set={set}/>
      <ExpField label="Electricity" k="electricity" expenses={e} set={set}/>
      <ExpField label="Water/Sewer/Trash" k="water_sewer_trash" expenses={e} set={set}/>
      <ExpField label="Cell Phone" k="cell_phone" expenses={e} set={set}/>
      <ExpField label="Internet" k="internet" expenses={e} set={set}/>
      <ExpField label="Cable/Satellite TV" k="cable" expenses={e} set={set}/>
      <ExpField label="Pest Control" k="pest_control" expenses={e} set={set}/>
      <ExpField label="Lawn" k="lawn" expenses={e} set={set}/>
      <ExpField label="Maintenance/Repairs" k="maintenance" expenses={e} set={set}/>
      <ExpField label="Local Housing & Utilities Standard (for over-standard calc)" k="housing_standard" expenses={e} set={set}/>
      <SubtotalRow label="Housing & Utilities Subtotal" value={exp.housing}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Vehicle</div>
      <div style={{fontSize:12.5,color:'var(--t3)',marginBottom:6}}>
        Vehicle 1/2 payments pulled from Vehicles: {fmt(exp.vehicle1Payment)} / {fmt(exp.vehicle2Payment)} (Std $588 each)
      </div>
      <ExpField label="Public Transportation (Std $244)" k="public_transportation" expenses={e} set={set}/>
      <ExpField label="Car Misc (Operating Expenses)" k="car_misc" expenses={e} set={set}/>
      <SubtotalRow label="Vehicle Subtotal" value={exp.vehicleTotal}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Health Care</div>
      <div style={{fontSize:12.5,color:'var(--t3)',marginBottom:6}}>
        Out-of-pocket standard: {n(profile.household_under_65)} × $68 (under 65) + {n(profile.household_over_65)} × $142 (65+) = {fmt(exp.oopHealthStd)}
      </div>
      <ExpField label="Major Medical Insurance" k="health_major_medical" expenses={e} set={set}/>
      <ExpField label="Supplemental Medical / HSA" k="health_supplemental" expenses={e} set={set}/>
      <ExpField label="Dental Insurance" k="health_dental" expenses={e} set={set}/>
      <ExpField label="Vision Insurance" k="health_vision" expenses={e} set={set}/>
      <ExpField label="Out of Pocket Expenses (Actual — leave blank to use standard)" k="health_oop" expenses={e} set={set} std={exp.oopHealthStd}/>
      <SubtotalRow label="Health Care Subtotal" value={exp.healthTotal}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Credit Cards / Other Unallowed Expenses</div>
      <ExpField label="Credit Card Minimum Monthly Payments" k="credit_card_min" expenses={e} set={set}/>
      <SubtotalRow label="Credit Subtotal" value={exp.creditTotal}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Court Ordered</div>
      <ExpField label="Child Support" k="child_support" expenses={e} set={set}/>
      <ExpField label="Court Ordered Judgment" k="court_judgment" expenses={e} set={set}/>
      <SubtotalRow label="Court Ordered Subtotal" value={exp.courtTotal}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Child/Dependent Care</div>
      <ExpField label="Child/Dependent Care (Day Care)" k="child_care" expenses={e} set={set}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Other Secured Debt</div>
      <div style={{fontSize:12.5,color:'var(--t3)',marginBottom:6}}>Pulled from Intake: {fmt(exp.otherSecured)}</div>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Life Insurance</div>
      <ExpField label="Term Life Insurance" k="life_term" expenses={e} set={set}/>
      <ExpField label="Whole Life Insurance" k="life_whole" expenses={e} set={set}/>
      <SubtotalRow label="Life Insurance Subtotal" value={exp.lifeTotal}/>

      <div style={{fontWeight:700,fontSize:13,marginTop:14,marginBottom:4,color:'var(--t2)'}}>Taxes</div>
      <div style={{fontSize:12.5,color:'var(--t3)',marginBottom:6}}>Income taxes withheld (from Income Summary): {fmt(income.taxesTotal)}</div>
      <ExpField label="IRS Installment Agreement" k="irs_installment" expenses={e} set={set}/>
      <ExpField label="State Installment Agreement" k="state_installment" expenses={e} set={set}/>
      <SubtotalRow label="Taxes Subtotal" value={exp.taxesSubtotal}/>

      <div className="card" style={{padding:'14px 16px',background:'var(--blt)',marginTop:20,border:'1px solid var(--blue)'}}>
        <div className="dr"><span className="dl" style={{fontWeight:700}}>Total Monthly Living Expenses</span><span className="dv" style={{fontWeight:700}}>{fmt(exp.totalMonthlyExpenses)}</span></div>
        <div className="dr"><span className="dl" style={{fontWeight:700}}>Total Net Disposable Income (Gross Income − Expenses)</span><span className="dv" style={{fontWeight:700}}>{fmt(exp.netDisposableIncome)}</span></div>
        <div style={{height:1,background:'var(--br)',margin:'8px 0'}}/>
        <div className="dr"><span className="dl">Home Amount Over National Standard</span><span className="dv">{fmt(exp.homeOverNS)}</span></div>
        <div className="dr"><span className="dl">Vehicle 1 Amount Over Standard</span><span className="dv">{fmt(exp.vehicle1OverNS)}</span></div>
        <div className="dr"><span className="dl">Vehicle 2 Amount Over Standard</span><span className="dv">{fmt(exp.vehicle2OverNS)}</span></div>
        <div style={{height:1,background:'var(--br)',margin:'8px 0'}}/>
        <div className="dr"><span className="dl" style={{fontWeight:800,fontSize:14}}>OIC NDI (NDI + National Standard Add-Backs)</span><span className="dv" style={{fontWeight:800,fontSize:14,color:'var(--b2)'}}>{fmt(exp.oicNDI)}</span></div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// ASSETS & EQUITY TAB
// ════════════════════════════════════════════════════════════════════════
const ASSET_TYPES = {
  bank_account: { label:'Bank Accounts', factor:'1.0 (minus $1,000 exemption)' },
  life_insurance: { label:'Whole Life Policy', factor:'0.7' },
  retirement: { label:'Retirement Accounts', factor:'0.7' },
  business_asset: { label:'Business Assets', factor:'1.0' },
  additional_asset: { label:'Additional Assets', factor:'0.8' },
}

function AssetRow({ asset, idx, onChange, onRemove }) {
  const value = n(asset.value), loan = n(asset.loan_against)
  const factor = asset.type==='life_insurance' || asset.type==='retirement' || asset.type==='additional_asset' ? 0.8 : 1.0
  const realFactor = asset.type==='life_insurance' || asset.type==='retirement' ? 0.7 : asset.type==='additional_asset' ? 0.8 : 1.0
  const oicValue = value * realFactor
  const oicAmount = asset.type==='bank_account' ? null : Math.max(0, oicValue - loan)
  return (
    <div className="fg3" style={{alignItems:'end',marginBottom:6}}>
      <Field label="Description" value={asset.description} onChange={v=>onChange(idx,'description',v)}/>
      <Field label="Value" value={asset.value} onChange={v=>onChange(idx,'value',v)} type="number"/>
      <Field label="Loan Against" value={asset.loan_against} onChange={v=>onChange(idx,'loan_against',v)} type="number"/>
      <div style={{fontSize:12.5,color:'var(--t3)',marginBottom:14}}>
        OIC value: {fmt(oicValue)}{oicAmount!==null && <> · Equity: {fmt(oicAmount)}</>}
      </div>
      <div></div>
      <button className="btn del sm" onClick={()=>onRemove(idx)} style={{marginBottom:14}}>Remove</button>
    </div>
  )
}

function AssetsTab({ profile, set, setArr, addArrRow, removeArrRow }) {
  const calc = calcAssets(profile)
  const assets = profile.assets || []
  const re = profile.real_estate || []
  const vehicles = profile.vehicles || []
  const cc = profile.credit_cards || []

  function onChangeAsset(idx, key, value) {
    setArr('assets', idx, key, value)
  }

  const ccTotal = cc.reduce((acc,c)=>({balance:acc.balance+n(c.balance), limit:acc.limit+n(c.limit), min:acc.min+n(c.min_payment)}), {balance:0,limit:0,min:0})

  return (
    <div>
      {Object.entries(ASSET_TYPES).map(([type, meta]) => {
        const rows = assets.map((a,i)=>({...a,_idx:i})).filter(a=>a.type===type)
        const totals = type==='bank_account' ? calc.bankTotal : type==='life_insurance' ? calc.lifeTotal : type==='retirement' ? calc.retTotal : type==='business_asset' ? calc.bizTotal : calc.addlTotal
        return (
          <div key={type}>
            <SectionHeader>{meta.label} <span style={{textTransform:'none',fontWeight:400}}>(OIC Factor: {meta.factor})</span></SectionHeader>
            {rows.map(a=>(
              <AssetRow key={a._idx} asset={a} idx={a._idx} onChange={onChangeAsset} onRemove={removeArrRow.bind(null,'assets')}/>
            ))}
            <button className="btn sm" onClick={()=>addArrRow('assets',{type,description:'',value:'',loan_against:''})}>+ Add {meta.label.replace(/s$/,'')}</button>
            <SubtotalRow label={`${meta.label} OIC Amount`} value={totals.amount}/>
          </div>
        )
      })}

      <SectionHeader>Vehicles (from Intake — OIC Factor: 0.8)</SectionHeader>
      {vehicles.filter(v=>v.kbb_value).map((v,i)=>(
        <div key={i} className="dr"><span className="dl">{v.make_model || `Vehicle ${i+1}`} — KBB {fmt(v.kbb_value)}, Loan {fmt(v.remaining_balance)}</span><span className="dv">Equity: {fmt(Math.max(0,n(v.kbb_value)*0.8 - n(v.remaining_balance)))}</span></div>
      ))}
      <SubtotalRow label="Vehicles OIC Amount" value={calc.vehicleTotal.amount}/>

      <SectionHeader>Real Estate (from Intake — OIC Factor: 0.8)</SectionHeader>
      {re.filter(p=>p.zillow_value).map((p,i)=>(
        <div key={i} className="dr"><span className="dl">{p.address || `Property ${i+1}`} — Value {fmt(p.zillow_value)}, Mortgage {fmt(p.mortgage_balance)}</span><span className="dv">Equity: {fmt(Math.max(0,n(p.zillow_value)*0.8 - n(p.mortgage_balance)))}</span></div>
      ))}
      <SubtotalRow label="Real Estate OIC Amount" value={calc.reTotal.amount}/>

      <SectionHeader>Cash on Hand</SectionHeader>
      <Field label="Cash on Hand" value={profile.cash_on_hand} onChange={v=>set('cash_on_hand',v)} type="number"/>

      <SectionHeader>Credit Cards / Lines of Credit</SectionHeader>
      {cc.map((c,i)=>(
        <div key={i} className="fg3" style={{alignItems:'end',marginBottom:6}}>
          <Field label="Name of Credit Card" value={c.name} onChange={v=>setArr('credit_cards',i,'name',v)}/>
          <Field label="Balance Due" value={c.balance} onChange={v=>setArr('credit_cards',i,'balance',v)} type="number"/>
          <Field label="Credit Limit" value={c.limit} onChange={v=>setArr('credit_cards',i,'limit',v)} type="number"/>
          <Field label="Minimum Payment Due" value={c.min_payment} onChange={v=>setArr('credit_cards',i,'min_payment',v)} type="number"/>
          <div></div>
          <button className="btn del sm" onClick={()=>removeArrRow('credit_cards',i)} style={{marginBottom:14}}>Remove</button>
        </div>
      ))}
      <button className="btn sm" onClick={()=>addArrRow('credit_cards',{name:'',balance:'',limit:'',min_payment:''})}>+ Add Credit Card</button>
      <div className="card" style={{padding:'10px 16px',background:'var(--s2)',marginTop:10}}>
        <div className="dr"><span className="dl">Total Balance Due</span><span className="dv">{fmt(ccTotal.balance)}</span></div>
        <div className="dr"><span className="dl">Total Credit Limit</span><span className="dv">{fmt(ccTotal.limit)}</span></div>
        <div className="dr"><span className="dl">Total Minimum Payments</span><span className="dv">{fmt(ccTotal.min)}</span></div>
      </div>

      <div className="card" style={{padding:'14px 16px',background:'var(--blt)',marginTop:20,border:'1px solid var(--blue)'}}>
        <div className="dr"><span className="dl">Total Asset Value</span><span className="dv">{fmt(calc.grandTotal.value)}</span></div>
        <div className="dr"><span className="dl">Total Loans Against Assets</span><span className="dv">{fmt(calc.grandTotal.loan)}</span></div>
        <div className="dr"><span className="dl" style={{fontWeight:800,fontSize:14}}>Total OIC Asset Equity</span><span className="dv" style={{fontWeight:800,fontSize:14,color:'var(--b2)'}}>{fmt(calc.grandTotal.amount)}</span></div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// OIC CALCULATOR TAB
// ════════════════════════════════════════════════════════════════════════
function OICTab({ profile, totalHousehold }) {
  const exp = calcExpenses(profile, totalHousehold)
  const assets = calcAssets(profile)

  const futureIncome12 = Math.max(0, exp.oicNDI) * 12
  const futureIncome24 = Math.max(0, exp.oicNDI) * 24
  const assetEquity = assets.grandTotal.amount

  const oic12 = futureIncome12 + assetEquity
  const oicLump = futureIncome12 + assetEquity // lump sum future income also = NDI*12 per template
  const oic24 = futureIncome24 + assetEquity

  const downPayment12 = oic12 / 12
  const downPaymentLump = oicLump / 5
  const downPayment24 = oic24 / 24

  const payment12 = (oic12 - downPayment12) / 11
  const paymentLump = (oicLump - downPaymentLump) / 5
  const payment24 = (oic24 - downPayment24) / 23

  return (
    <div>
      <SectionHeader>Offer in Compromise — Calculated Offer Amounts</SectionHeader>
      <div style={{fontSize:12,color:'var(--t3)',marginBottom:14,lineHeight:1.6}}>
        Calculated from Net Disposable Income (I&E tab) and Asset Equity (Assets & Equity tab). Verify against current Form 656/433-A before submission.
      </div>

      <div className="fp-oic-grid" style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,textAlign:'center'}}>12-Month Offer</div>
          <div className="dr"><span className="dl">Future Income (NDI × 12)</span><span className="dv">{fmt(futureIncome12)}</span></div>
          <div className="dr"><span className="dl">Asset Equity</span><span className="dv">{fmt(assetEquity)}</span></div>
          <SubtotalRow label="OIC Amount" value={oic12}/>
          <div className="dr"><span className="dl">Down Payment (÷12)</span><span className="dv">{fmt(downPayment12)}</span></div>
          <div className="dr"><span className="dl">Monthly Payments (11x)</span><span className="dv">{fmt(payment12)}</span></div>
        </div>
        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,textAlign:'center'}}>Lump Sum Offer</div>
          <div className="dr"><span className="dl">Future Income (NDI × 12)</span><span className="dv">{fmt(futureIncome12)}</span></div>
          <div className="dr"><span className="dl">Asset Equity</span><span className="dv">{fmt(assetEquity)}</span></div>
          <SubtotalRow label="OIC Amount" value={oicLump}/>
          <div className="dr"><span className="dl">Down Payment (÷5)</span><span className="dv">{fmt(downPaymentLump)}</span></div>
          <div className="dr"><span className="dl">Remaining Payments (5x)</span><span className="dv">{fmt(paymentLump)}</span></div>
        </div>
        <div className="card" style={{padding:'14px 16px'}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,textAlign:'center'}}>24-Month Offer</div>
          <div className="dr"><span className="dl">Future Income (NDI × 24)</span><span className="dv">{fmt(futureIncome24)}</span></div>
          <div className="dr"><span className="dl">Asset Equity</span><span className="dv">{fmt(assetEquity)}</span></div>
          <SubtotalRow label="OIC Amount" value={oic24}/>
          <div className="dr"><span className="dl">Down Payment (÷24)</span><span className="dv">{fmt(downPayment24)}</span></div>
          <div className="dr"><span className="dl">Monthly Payments (23x)</span><span className="dv">{fmt(payment24)}</span></div>
        </div>
      </div>

      <div className="card" style={{padding:'14px 16px',marginTop:16,background:'var(--s2)'}}>
        <div className="dr"><span className="dl">Net Disposable Income (Monthly)</span><span className="dv">{fmt(exp.oicNDI)}</span></div>
        <div className="dr"><span className="dl">Total Asset Equity</span><span className="dv">{fmt(assetEquity)}</span></div>
      </div>
    </div>
  )
}




import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { triggerWorkflow } from '../lib/triggerWorkflow'
import TaxDocParser from '../components/TaxDocParser'
import { generateTaxReturnPdf, downloadTaxReturnPdf } from '../lib/taxReturnPdf'
import ClientLink from '../components/ClientLink'
import { FIRM } from '../lib/firmBranding'

const SQL_SETUP = `Tax Returns database setup is managed by secure Supabase migrations. Contact a platform administrator if this module reports that setup is required.`

const TAX_YEARS = ['2026','2025','2024','2023','2022','2021','2020','2019','2018','2017','2016','2015']
const FILING_STATUSES = ['Single','Married Filing Jointly','Married Filing Separately','Head of Household','Qualifying Surviving Spouse']
const RETURN_TYPES = [
  // Personal
  'Federal 1040','1040-SR Senior','1040-NR Non-Resident','1040-X Amended',
  // Business
  '1120 C-Corp','1120S S-Corp','1065 Partnership','1041 Estate/Trust',
  // Payroll
  '941 Quarterly Payroll','940 FUTA Annual',
  // State
  'State Return',
]
const RETURN_STATUSES = ['Draft','In Review','Client Review','Ready to File','Filed','Accepted','Rejected','Amended']

const BLANK_RETURN = {
  clientName: '', taxYear: '2024', returnType: 'Federal 1040',
  filingStatus: 'Single', status: 'Draft', assignedTo: '',
  // Income
  wages: '', interest: '', dividends: '', capitalGains: '', businessIncome: '',
  rentalIncome: '', retirementIncome: '', socialSecurity: '', otherIncome: '',
  // Adjustments
  studentLoanInterest: '', iraDeduction: '', selfEmployedHealth: '', selfEmployedTax: '',
  alimonyPaid: '', otherAdjustments: '',
  // Deductions
  deductionType: 'Standard', itemizedDeductions: '',
  stateLocalTax: '', mortgageInterest: '', charitableContrib: '', medicalExpenses: '',
  // Credits
  childTaxCredit: '', earnedIncomeCredit: '', childCareCredit: '', educationCredit: '', otherCredits: '',
  // Payments
  withholding: '', estimatedPayments: '', refundable: '',
  // Refund/Owed
  refundOrOwed: '', notes: '',
  // 941 Payroll fields
  q941_quarter: 'Q1', q941_numEmployees: '',
  q941_wages: '', q941_federalIncomeTax: '',
  q941_ss_wages: '', q941_medicare_wages: '',
  q941_ss_tax: '', q941_medicare_tax: '',
  q941_additional_medicare: '',
  q941_totalTax: '', q941_deposits: '', q941_balance: '',
  q941_overpayment: '', q941_refund: '',
  // 940 FUTA fields
  q940_totalWages: '', q940_exemptWages: '', q940_over7k: '',
  q940_futa_wages: '', q940_futa_rate: '0.006',
  q940_futa_tax: '', q940_state_credit: '',
  q940_net_futa: '', q940_deposits: '', q940_balance: '',
  q940_state: '',
  // 1120 C-Corp fields
  c_grossReceipts: '', c_returns: '', c_cogs: '',
  c_grossProfit: '', c_dividends: '', c_interest: '',
  c_grossRents: '', c_grossRoyalties: '', c_capitalGains: '',
  c_otherIncome: '',
  c_comp_officers: '', c_salaries: '', c_repairs: '',
  c_badDebts: '', c_rents: '', c_taxes: '', c_interest_ded: '',
  c_charitable: '', c_depreciation: '', c_depletion: '',
  c_advertising: '', c_pension: '', c_empBenefits: '',
  c_domesticProd: '', c_otherDed: '',
  c_specialDed_drd: '', c_specialDed_nol: '', c_specialDed_other: '',
  c_taxableIncome: '', c_tax: '', c_credits: '',
  c_deposits: '', c_balance: '',
  c_ein: '', c_stateInc: '', c_dateInc: '', c_totalAssets: '',
  // State return fields
  st_state: 'FL', st_filingType: 'Individual',
  st_agi: '', st_stateAdditions: '', st_stateSubtractions: '',
  st_stateIncome: '', st_stateDeduction: '', st_stateTaxableIncome: '',
  st_stateRate: '', st_stateTax: '', st_stateCredits: '',
  st_stateWithholding: '', st_stateRefund: '',
  st_localTax: '', st_localJurisdiction: '',
}

const TAX_RULES = {
  '2024': {
    standard: { 'Single': 14600, 'Married Filing Jointly': 29200, 'Married Filing Separately': 14600, 'Head of Household': 21900, 'Qualifying Surviving Spouse': 29200 },
    brackets: {
      'Single': [[11600,.10],[47150,.12],[100525,.22],[191950,.24],[243725,.32],[609350,.35],[Infinity,.37]],
      'Married Filing Jointly': [[23200,.10],[94300,.12],[201050,.22],[383900,.24],[487450,.32],[731200,.35],[Infinity,.37]],
      'Married Filing Separately': [[11600,.10],[47150,.12],[100525,.22],[191950,.24],[243725,.32],[365600,.35],[Infinity,.37]],
      'Head of Household': [[16550,.10],[63100,.12],[100500,.22],[191950,.24],[243700,.32],[609350,.35],[Infinity,.37]],
      'Qualifying Surviving Spouse': [[23200,.10],[94300,.12],[201050,.22],[383900,.24],[487450,.32],[731200,.35],[Infinity,.37]],
    },
  },
  '2025': {
    standard: { 'Single': 15750, 'Married Filing Jointly': 31500, 'Married Filing Separately': 15750, 'Head of Household': 23625, 'Qualifying Surviving Spouse': 31500 },
    brackets: {
      'Single': [[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[Infinity,.37]],
      'Married Filing Jointly': [[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],
      'Married Filing Separately': [[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[375800,.35],[Infinity,.37]],
      'Head of Household': [[17000,.10],[64850,.12],[103350,.22],[197300,.24],[250500,.32],[626350,.35],[Infinity,.37]],
      'Qualifying Surviving Spouse': [[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],
    },
  },
  '2026': {
    standard: { 'Single': 16100, 'Married Filing Jointly': 32200, 'Married Filing Separately': 16100, 'Head of Household': 24150, 'Qualifying Surviving Spouse': 32200 },
    brackets: {
      'Single': [[12400,.10],[50400,.12],[105700,.22],[201775,.24],[256225,.32],[640600,.35],[Infinity,.37]],
      'Married Filing Jointly': [[24800,.10],[100800,.12],[211400,.22],[403550,.24],[512450,.32],[768700,.35],[Infinity,.37]],
      'Married Filing Separately': [[12400,.10],[50400,.12],[105700,.22],[201775,.24],[256225,.32],[384350,.35],[Infinity,.37]],
      'Head of Household': [[17700,.10],[67450,.12],[105700,.22],[201750,.24],[256200,.32],[640600,.35],[Infinity,.37]],
      'Qualifying Surviving Spouse': [[24800,.10],[100800,.12],[211400,.22],[403550,.24],[512450,.32],[768700,.35],[Infinity,.37]],
    },
  },
}

function calcTotals(r) {
  const n = k => parseFloat(r[k] || 0) || 0
  const grossIncome = n('wages') + n('interest') + n('dividends') + n('capitalGains') +
    n('businessIncome') + n('rentalIncome') + n('retirementIncome') + n('socialSecurity') + n('otherIncome')
  const adjustments = n('studentLoanInterest') + n('iraDeduction') + n('selfEmployedHealth') +
    n('selfEmployedTax') + n('alimonyPaid') + n('otherAdjustments')
  const agi = grossIncome - adjustments
  const rules = TAX_RULES[String(r.taxYear || '')]

  // Historical returns remain editable/tracked, but we do not silently apply a
  // different year's federal thresholds. Unsupported years show no estimate.
  if (!rules) {
    return { grossIncome, adjustments, agi, deductions: null, taxableIncome: null, tax: null,
      credits: null, taxAfterCredits: null, payments: null, refundOrOwed: null, estimateUnsupported: true }
  }

  let deductions = 0
  if (r.deductionType === 'Standard') {
    deductions = rules.standard[r.filingStatus] ?? rules.standard.Single
  } else {
    deductions = n('stateLocalTax') + n('mortgageInterest') + n('charitableContrib') + n('medicalExpenses') + n('itemizedDeductions')
  }
  const taxableIncome = Math.max(0, agi - deductions)
  const brackets = rules.brackets[r.filingStatus] || rules.brackets.Single
  let tax = 0
  let remaining = taxableIncome
  let prev = 0
  for (const [limit, rate] of brackets) {
    const range = Math.min(remaining, limit - prev)
    if (range <= 0) break
    tax += range * rate
    remaining -= range
    prev = limit
    if (remaining <= 0) break
  }
  const credits = n('childTaxCredit') + n('earnedIncomeCredit') + n('childCareCredit') + n('educationCredit') + n('otherCredits')
  const taxAfterCredits = Math.max(0, tax - credits)
  const payments = n('withholding') + n('estimatedPayments') + n('refundable')
  const refundOrOwed = payments - taxAfterCredits

  return { grossIncome, adjustments, agi, deductions, taxableIncome, tax, credits, taxAfterCredits, payments, refundOrOwed, estimateUnsupported: false }
}
function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Math.round(n).toLocaleString()
}

export default function TaxReturns() {
  const { user } = useApp()
  const [returns, setReturns]   = useState([])
  const [clients, setClients]   = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]   = useState(true)
  const [view, setView]         = useState('list') // list | upload | edit
  const [current, setCurrent]   = useState(null)
  const [form, setForm]         = useState(BLANK_RETURN)
  const [saving, setSaving]     = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  const [genPdf, setGenPdf]     = useState(false)
  const [toast, setToast]       = useState('')
  const [search, setSearch]     = useState('')
  const [filterYear, setFilterYear] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [tab, setTab]           = useState('income')
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [preparer, setPreparer] = useState({ name:'', ptin:'', caf:'', efin:'' })
  const [efileStatus, setEfileStatus] = useState({ loading:true, configured:false, providerName:'', efinPresent:false, adapterConfigured:false, message:'' })

  useEffect(() => { if (user) { load(); loadPreparer(); loadEfileStatus() } }, [user?.id])

  async function loadEfileStatus() {
    setEfileStatus(s => ({ ...s, loading:true }))
    const { data, error } = await supabase.functions.invoke('submit-to-irs', { body: { action:'status' } })
    if (error || !data?.success) {
      setEfileStatus({
        loading:false,
        configured:false,
        providerName:'',
        efinPresent:false,
        adapterConfigured:false,
        message:data?.error || error?.message || 'E-file configuration could not be verified.'
      })
      return
    }
    setEfileStatus({
      loading:false,
      configured:Boolean(data.configured),
      providerName:data.providerName || '',
      efinPresent:Boolean(data.efinPresent),
      adapterConfigured:Boolean(data.adapterConfigured),
      message:data.message || ''
    })
  }

  async function loadPreparer() {
    const tid = user?.app_metadata?.tenant_id || user?.user_metadata?.tenant_id
    if (!tid) return
    const { data } = await supabase.from('settings')
      .select('preparer_name,ptin,caf_number,efin')
      .eq('tenant_id', tid)
      .maybeSingle()
    if (data) setPreparer({ name: data.preparer_name || '', ptin: data.ptin || '', caf: data.caf_number || '', efin: data.efin || '' })
  }

  async function load() {
    const [r, c, e] = await Promise.all([
      supabase.from('tax_returns').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id,name,ssn,filingStatus,assignedTo').order('name'),
      supabase.from('employees').select('name'),
    ])
    // Detect missing table
    if (r.error && (r.error.code === '42P01' || r.error.message?.includes('does not exist'))) {
      setSetupNeeded(true)
    } else {
      setSetupNeeded(false)
      setReturns(r.data || [])
    }
    setClients(c.data || [])
    setEmployees(e.data || [])
    setLoading(false)
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  function openNew() {
    setForm({ ...BLANK_RETURN })
    setCurrent(null)
    setTab('income')
    setView('upload')
  }

  function handleDocsParsed(parsedDocs) {
    console.log('handleDocsParsed received:', JSON.stringify(parsedDocs))
    // Auto-detect return type from uploaded docs
    const docTypes = parsedDocs.map(p => p.docType)
    let autoReturnType = null
    if (docTypes.some(d => d === 'K-1 (1065)'))       autoReturnType = '1065 Partnership'
    else if (docTypes.some(d => d === 'K-1 (1120-S)')) autoReturnType = '1120S S-Corp'
    else if (docTypes.some(d => d === 'Schedule C (prior)')) autoReturnType = 'Federal 1040'
    else if (docTypes.some(d => ['W-2','1099-NEC','1099-INT','1099-DIV','1099-R','1099-G'].includes(d))) autoReturnType = 'Federal 1040'

    // Helper to safely parse any numeric value Claude might return
    const n = (v) => { const f = parseFloat(String(v || '').replace(/[^0-9.-]/g,'')); return isNaN(f) ? 0 : f }

    // Map parsed doc data into the return form fields
    const updates = {}
    if (autoReturnType) updates.returnType = autoReturnType
    parsedDocs.forEach(({ docType, data }) => {
      if (!data) return
      console.log('Processing docType:', docType, 'data keys:', Object.keys(data))
      if (docType === 'W-2') {
        const w2Wages = data.wages ?? data.box1_wages ?? 0
        const w2Fed   = data.federalWithheld ?? data.box2_federal_withheld ?? 0
        updates.wages       = (n(updates.wages) + n(w2Wages)).toFixed(2)
        updates.withholding = (n(updates.withholding) + n(w2Fed)).toFixed(2)
        // Grab employer/employee info from first W-2
        if (!updates.w2_employer_name) updates.w2_employer_name = data.employer_name || ''
        if (!updates.w2_employer_ein)  updates.w2_employer_ein  = data.employer_ein  || ''
        if (!updates.w2_employee_ssn)  updates.w2_employee_ssn  = data.employee_ssn  || ''
        // Client name from W-2 employee name
        if (!updates.clientName && data.employee_name) updates.clientName = data.employee_name
      }
      if (docType === '1099-NEC') {
        const necComp = data.nonEmployeeCompensation ?? data.box1_nonemployee_comp ?? data.box1NonemployeeComp ?? 0
        const necFed = data.federalWithheld ?? data.box4_federal_withheld ?? 0
        updates.businessIncome = (n(updates.businessIncome) + n(necComp)).toFixed(2)
        updates.withholding = (n(updates.withholding) + n(necFed)).toFixed(2)
      }
      if (docType === '1099-INT') {
        updates.interest = (n(updates.interest) + n(data.box1_interest_income)).toFixed(2)
      }
      if (docType === '1099-DIV') {
        updates.dividends = (n(updates.dividends) + n(data.box1a_total_dividends)).toFixed(2)
        updates.capitalGains = (n(updates.capitalGains) + n(data.box2a_capital_gain_distrib)).toFixed(2)
      }
      if (docType === '1099-R') {
        updates.retirementIncome = (n(updates.retirementIncome) + n(data.box2a_taxable_amount)).toFixed(2)
        updates.withholding = (n(updates.withholding) + n(data.box4_federal_withheld)).toFixed(2)
      }
      if (docType === '1099-G') {
        updates.otherIncome = (n(updates.otherIncome) + n(data.box1_unemployment_comp)).toFixed(2)
      }
      if (docType === 'K-1 (1065)' || docType === 'K-1 (1120-S)') {
        updates.businessIncome = (parseFloat(updates.businessIncome || 0) + parseFloat(data.box1_ordinary_income || 0)).toFixed(2)
        updates.interest = (parseFloat(updates.interest || 0) + parseFloat(data.box5_interest || 0)).toFixed(2)
        updates.dividends = (parseFloat(updates.dividends || 0) + parseFloat(data.box6a_dividends || 0)).toFixed(2)
        updates.capitalGains = (parseFloat(updates.capitalGains || 0) + parseFloat(data.box9a_capital_gain || data.box9_capital_gain || 0)).toFixed(2)
      }
      if (docType === 'Schedule C (prior)') {
        updates.businessIncome = (parseFloat(updates.businessIncome || 0) + parseFloat(data.net_profit || 0)).toFixed(2)
      }
      // Try to grab client name from first doc if not set
      if (!updates.clientName && (data.employee_name || data.recipient_name)) {
        updates.clientName = data.employee_name || data.recipient_name
      }
    })
    console.log('handleDocsParsed updates to apply:', JSON.stringify(updates))
    setForm(f => {
      const merged = { ...f, ...updates }
      console.log('form after merge wages:', merged.wages, 'withholding:', merged.withholding)
      return merged
    })
    setTab('income')
    setView('edit')
    showToast(`✅ ${parsedDocs.length} document${parsedDocs.length > 1 ? 's' : ''} parsed — fields pre-filled!`)
  }

  // Log a note on the client's file for tax return events
  async function logReturnNote(noteText) {
    if (!form.clientName) return
    const tid = user?.app_metadata?.tenant_id || user?.user_metadata?.tenant_id
    const author = user?.user_metadata?.name || user?.email || 'Staff'
    // Look up client by name within this tenant
    const { data: clientRow } = await supabase.from('clients')
      .select('id').eq('tenant_id', tid).ilike('name', form.clientName.trim()).maybeSingle()
    const client_id = clientRow?.id || null
    await supabase.from('client_notes').insert({
      clientname: form.clientName,
      client_id,
      tenant_id: tid,
      text: noteText,
      author,
      type: 'Tax Return',
      note_type: 'Tax Return',
      visible_to_client: false,
      created_at: new Date().toISOString()
    })
  }

  function openEdit(ret) {
    setForm({ ...BLANK_RETURN, ...ret })
    setCurrent(ret)
    setTab('income')
    setView('edit')
  }

  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function onClientChange(name) {
    fld('clientName', name)
    const c = clients.find(c => c.name === name)
    if (c) {
      if (c.filingStatus) fld('filingStatus', c.filingStatus)
      if (c.assignedTo) fld('assignedTo', c.assignedTo)
    }
  }

  async function save() {
    if (!form.clientName) { showToast('Client name required'); return }
    setSaving(true)
    const payload = { ...form, updated_at: new Date().toISOString() }
    let error
    if (current?.id) {
      ;({ error } = await supabase.from('tax_returns').update(payload).eq('id', current.id))
    } else {
      payload.created_at = new Date().toISOString()
      const returnNum = 'TR-' + Date.now().toString().slice(-6)
      payload.returnNum = returnNum
      ;({ error } = await supabase.from('tax_returns').insert([payload]))
    }
    setSaving(false)
    if (error) {
      // If table doesn't exist yet, show helpful message
      if (error.message?.includes('does not exist') || error.code === '42P01') {
        showToast('⚠️ tax_returns table not created yet — see setup instructions')
      } else {
        showToast('Error: ' + error.message)
      }
      return
    }
    showToast('✅ Return saved!')
    load()
    setView('list')
  }

  async function generatePdf() {
    setGenPdf(true)
    try {
      const { generateTaxReturnPdf: gen, downloadTaxReturnPdf: dl } = await import('../lib/taxReturnPdf')
      const bytes = await gen(form, totals, preparer)
      dl(bytes, form)
      showToast('✅ PDF downloaded!')
    } catch(e) {
      showToast('PDF error: ' + e.message)
      console.error(e)
    } finally {
      setGenPdf(false)
    }
  }

  async function deleteReturn(id) { setConfirmDel(id) }
  async function confirmDeleteReturn() {
    const { error } = await supabase.from('tax_returns').delete().eq('id', confirmDel)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    setReturns(prev => prev.filter(i => i.id !== confirmDel)); setConfirmDel(null); showToast('Deleted')
  }

  async function updateStatus(id, status) {
    await supabase.from('tax_returns').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  const reps = employees.length > 0 ? employees.map(e => e.name) : ['Romy Cruz', 'Dana Richard', 'Yesenia Gonzalez']

  const filtered = returns.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || r.clientName?.toLowerCase().includes(q) || r.returnNum?.includes(q)
    const matchYear = filterYear === 'All' || r.taxYear === filterYear
    const matchStatus = filterStatus === 'All' || r.status === filterStatus
    return matchSearch && matchYear && matchStatus
  })

  const totals = calcTotals(form)
  const stdDed = { 'Single': 14600, 'Married Filing Jointly': 29200, 'Married Filing Separately': 14600, 'Head of Household': 21900, 'Qualifying Surviving Spouse': 29200 }

  const is1040    = form.returnType?.includes('1040') || form.returnType === 'Federal 1040'
  const is1120S   = form.returnType === '1120S S-Corp'
  const is1120C   = form.returnType === '1120 C-Corp'
  const is1065    = form.returnType === '1065 Partnership'
  const is941     = form.returnType === '941 Quarterly Payroll'
  const is940     = form.returnType === '940 FUTA Annual'
  const isState   = form.returnType === 'State Return'
  const isSchedC  = form.returnType === 'Federal 1040'
  const isBusiness = is1120S || is1065 || is1120C
  const isPayroll  = is941 || is940

  const statusColors = { Draft:'bn', 'In Review':'ba', 'Client Review':'ba', 'Ready to File':'bb', Filed:'bg', Accepted:'bg', Rejected:'br', Amended:'bw' }

  const MoneyField = ({ label, field, help }) => (
    <div className="field">
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        {help && <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 400 }}>{help}</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)', fontSize: 13 }}>$</span>
        <input
          type="number" min="0" step="0.01"
          value={form[field] || ''}
          onChange={e => fld(field, e.target.value)}
          style={{ paddingLeft: 22 }}
          placeholder="0"
        />
      </div>
    </div>
  )

  if (loading) return <div style={{ color: 'var(--t3)', padding: 20 }}>Loading…</div>

  // ── LIST VIEW ──
  if (view === 'upload') return (
    <div style={{ maxWidth: 700 }}>
      {toast && <div className="toast show">{toast}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn sec" style={{ fontSize: 12 }} onClick={() => setView('list')}>← Back</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>New Tax Return</h2>
      </div>

      {/* Client + year selector at top */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--t2)' }}>Step 1 — Select Client & Tax Year</div>
        <div className="fg2">
          <div className="field" style={{ margin: 0 }}>
            <label>Client Name</label>
            <input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} placeholder="Client name…" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Tax Year</label>
            <select value={form.taxYear} onChange={e => setForm(f => ({ ...f, taxYear: e.target.value }))}>
              {TAX_YEARS.map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--t2)' }}>Step 2 — Upload Documents (Optional)</div>
        <TaxDocParser
          clientName={form.clientName}
          taxYear={form.taxYear}
          onParsed={handleDocsParsed}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn pri" style={{ flex: 1, justifyContent: 'center', padding: 11, fontSize: 14, fontWeight: 700 }}
          onClick={() => { setTab('income'); setView('edit') }}>
          Continue → Fill Return
        </button>
        <button className="btn sec" style={{ justifyContent: 'center', padding: '11px 18px', fontSize: 13 }}
          onClick={() => { setForm(BLANK_RETURN); setTab('income'); setView('edit') }}>
          Start Blank
        </button>
      </div>
    </div>
  )

  if (view === 'list') return (
    <div>
      {toast && <div className="toast show">{toast}</div>}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>🧾 Tax Returns</h2>
      </div>

      {/* Stats bar + New Return button */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))', gap: 8, marginBottom: 14 }}>
        {[
          ['Total', returns.length, 'var(--blue)'],
          ['Draft', returns.filter(r => r.status === 'Draft').length, 'var(--t3)'],
          ['In Review', returns.filter(r => r.status === 'In Review' || r.status === 'Client Review').length, 'var(--warn)'],
          ['Ready', returns.filter(r => r.status === 'Ready to File').length, 'var(--blue)'],
          ['Filed', returns.filter(r => r.status === 'Filed' || r.status === 'Accepted').length, 'var(--ok)'],
          ['Rejected', returns.filter(r => r.status === 'Rejected').length, 'var(--bad)'],
        ].map(([label, val, color]) => (
          <div key={label} className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 20, color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>{label}</div>
          </div>
        ))}
        <button className="btn pri" onClick={openNew} style={{ fontSize: 14, fontWeight: 700, padding: '10px 12px', height: '100%', minHeight: 60 }}>+ New Return</button>
      </div>

      {/* Filing Requirement Reference Chart */}
      <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)', padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>📋 Filing Requirement Reference — When Must a Client File?</div>
          <div style={{ fontSize: 11, color: '#93c5fd', lineHeight: 1.5 }}>Not everyone is required to file a tax return. Use this chart to determine if filing is required based on gross income.</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#1e40af' }}>
                <th style={{ padding: '8px 12px', color: '#fff', textAlign: 'left', fontWeight: 700, borderRight: '1px solid #2563eb' }}>Filing Status</th>
                <th style={{ padding: '8px 12px', color: '#fff', textAlign: 'left', fontWeight: 700, borderRight: '1px solid #2563eb' }}>Age at End of Year</th>
                <th style={{ padding: '8px 12px', color: '#fff', textAlign: 'left', fontWeight: 700 }}>Gross Income Threshold</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Single',                    'Under 65',                   '$14,600'],
                ['',                          '65 or older',                '$16,550'],
                ['Married Filing Jointly',    'Under 65 (both spouses)',    '$29,200'],
                ['',                          '65 or older (one spouse)',   '$30,750'],
                ['',                          '65 or older (both spouses)', '$32,300'],
                ['Married Filing Separately', 'Any age',                    '$5'],
                ['Head of Household',         'Under 65',                   '$21,900'],
                ['',                          '65 or older',                '$23,850'],
                ['Qualifying Widow(er)',       'Under 65',                   '$29,200'],
                ['',                          '65 or older',                '$30,750'],
              ].map(([status, age, threshold], i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'var(--s2)' : 'var(--sf)', borderBottom: '1px solid var(--br)' }}>
                  <td style={{ padding: '7px 12px', color: 'var(--tx)', fontWeight: status ? 600 : 400, borderRight: '1px solid var(--br)' }}>{status}</td>
                  <td style={{ padding: '7px 12px', color: 'var(--t2)', borderRight: '1px solid var(--br)' }}>{age}</td>
                  <td style={{ padding: '7px 12px', color: 'var(--ok)', fontWeight: 700 }}>{threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 12px', fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--br)' }}>* 2024 tax year thresholds. Updated annually by the IRS. Self-employment income ≥ $400 always requires filing regardless of gross income.</div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search client or return #…"
          style={{ flex: 1, minWidth: 180, padding: '7px 12px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 12 }} />
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
          style={{ padding: '7px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 12 }}>
          <option value="All">All Years</option>
          {TAX_YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '7px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 12 }}>
          <option value="All">All Statuses</option>
          {RETURN_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {/* Returns table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            {returns.length === 0 ? 'No returns yet. Click "+ New Return" to get started.' : 'No returns match your filters.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--br)', background: 'var(--s2)' }}>
                {['Return #', 'Client', 'Year', 'Type', 'Filing Status', 'Rep', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(ret => (
                <tr key={ret.id} style={{ borderBottom: '1px solid var(--br)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--blue)' }}>{ret.returnNum || '—'}</td>
                  <td style={{ padding: '9px 12px', fontWeight: 600 }}><ClientLink name={ret.clientName} /></td>
                  <td style={{ padding: '9px 12px', color: 'var(--t2)' }}>{ret.taxYear}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--t2)' }}>{ret.returnType}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--t2)' }}>{ret.filingStatus}</td>
                  <td style={{ padding: '9px 12px', color: 'var(--t2)' }}>{ret.assignedTo || '—'}</td>
                  <td style={{ padding: '9px 12px' }}>
                    <select value={ret.status || 'Draft'}
                      onChange={e => updateStatus(ret.id, e.target.value)}
                      style={{ fontSize: 10, padding: '3px 6px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 4, color: 'var(--tx)', cursor: 'pointer' }}>
                      {RETURN_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn sec" style={{ fontSize: 10, padding: '3px 10px' }} onClick={() => openEdit(ret)}>Edit</button>
                      <button className="btn del" style={{ fontSize: 10, padding: '3px 8px' }} onClick={() => deleteReturn(ret.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )

  // ── EDIT VIEW ──
  const TABS = is941 ? [
    { key: 'q941',    label: '📋 941 Worksheet' },
    { key: 'summary', label: '📊 Summary' },
    { key: 'submit',  label: '📤 Submit / Export' },
  ] : is940 ? [
    { key: 'q940',    label: '📋 940 Worksheet' },
    { key: 'summary', label: '📊 Summary' },
    { key: 'submit',  label: '📤 Submit / Export' },
  ] : isState ? [
    { key: 'state',   label: '🏛 State Return' },
    { key: 'summary', label: '📊 Summary' },
    { key: 'submit',  label: '📤 Submit / Export' },
  ] : is1120C ? [
    { key: 'income',   label: '💰 Revenue' },
    { key: 'expenses', label: '📋 Deductions' },
    { key: 'special',  label: '⚡ Special Ded.' },
    { key: 'credits',  label: '⭐ Credits' },
    { key: 'payments', label: '💳 Payments' },
    { key: 'summary',  label: '📊 Summary' },
    { key: 'submit',   label: '📤 Submit / Export' },
  ] : isBusiness ? [
    { key: 'income',   label: '💰 Revenue' },
    { key: 'expenses', label: '📋 Expenses' },
    ...(is1120S ? [{ key: 'officers', label: '👔 Officers' }] : []),
    ...(is1065  ? [{ key: 'partners', label: '🤝 Partners' }] : []),
    { key: 'payments', label: '💳 Payments' },
    { key: 'summary',  label: '📊 Summary' },
    { key: 'submit',   label: '📤 Submit / Export' },
  ] : [
    { key: 'income',      label: '💰 Income' },
    { key: 'schedC',      label: '🏢 Schedule C', show: isSchedC },
    { key: 'adjustments', label: '📉 Adjustments' },
    { key: 'deductions',  label: '🏠 Deductions' },
    { key: 'credits',     label: '⭐ Credits' },
    { key: 'payments',    label: '💳 Payments' },
    { key: 'summary',     label: '📊 Summary' },
    { key: 'submit',      label: '📤 Submit / Export' },
  ]

  return (
    <div style={{ maxWidth: 900 }}>
      {toast && <div className="toast show">{toast}</div>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn" style={{ fontSize: 12 }} onClick={() => setView('list')}>← Back</button>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, flex: 1 }}>
          {current ? `Edit Return — ${form.clientName} (${form.taxYear})` : '🧾 New Tax Return'}
        </h2>
        <select value={form.status} onChange={e => fld('status', e.target.value)}
          style={{ fontSize: 11, padding: '5px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)' }}>
          {RETURN_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <button className="btn pri" onClick={save} disabled={saving}>{saving ? 'Saving…' : '💾 Save Return'}</button>
      </div>

      {/* Client + Meta */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', marginBottom: 10 }}>Return Info</div>
        <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Client *</label>
            <input list="client-list" value={form.clientName} onChange={e => onClientChange(e.target.value)} placeholder="Type client name…"/>
            <datalist id="client-list">{clients.map(c => <option key={c.id} value={c.name}/>)}</datalist>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Tax Year</label>
            <select value={form.taxYear} onChange={e => fld('taxYear', e.target.value)}>
              {TAX_YEARS.map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Return Type</label>
            <select value={form.returnType} onChange={e => fld('returnType', e.target.value)}>
              {RETURN_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Filing Status</label>
            <select value={form.filingStatus} onChange={e => fld('filingStatus', e.target.value)}>
              {FILING_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Assigned To</label>
            <select value={form.assignedTo} onChange={e => fld('assignedTo', e.target.value)}>
              <option value="">— Unassigned —</option>
              {reps.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--br)', marginBottom: 12, overflowX: 'auto' }}>
        {TABS.filter(t => t.show !== false).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 14px', fontSize: 11, fontWeight: tab === t.key ? 700 : 400,
              background: 'none', border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--blue)' : '2px solid transparent',
              color: tab === t.key ? 'var(--blue)' : 'var(--t2)', cursor: 'pointer',
              whiteSpace: 'nowrap', paddingBottom: 8 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── INCOME TAB ── */}
      {tab === 'income' && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Income Sources</div>
          <div className="fg2">
            <MoneyField label="Wages, Salaries, Tips (W-2)" field="wages" help="Box 1 of W-2"/>
            <MoneyField label="Taxable Interest (1099-INT)" field="interest" help="Schedule B"/>
            <MoneyField label="Ordinary Dividends (1099-DIV)" field="dividends" help="Schedule B"/>
            <MoneyField label="Capital Gains / Losses (1099-B)" field="capitalGains" help="Schedule D"/>
            <MoneyField label="Business / Self-Employment Income" field="businessIncome" help="Schedule C"/>
            <MoneyField label="Rental / Royalty Income" field="rentalIncome" help="Schedule E"/>
            <MoneyField label="Retirement / Pension (1099-R)" field="retirementIncome" help="Form 1099-R"/>
            <MoneyField label="Social Security Benefits" field="socialSecurity" help="SSA-1099"/>
            <MoneyField label="Other Income" field="otherIncome" help="Alimony, prizes, etc."/>
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--s3)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Gross Income</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--blue)' }}>{fmt(totals.grossIncome)}</span>
          </div>
        </div>
      )}

      {/* ── ADJUSTMENTS TAB ── */}
      {tab === 'adjustments' && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Above-the-Line Adjustments</div>
          <div className="fg2">
            <MoneyField label="Student Loan Interest" field="studentLoanInterest" help="Max $2,500"/>
            <MoneyField label="IRA Deduction" field="iraDeduction" help="Traditional IRA"/>
            <MoneyField label="Self-Employed Health Insurance" field="selfEmployedHealth"/>
            <MoneyField label="Deductible Self-Employment Tax" field="selfEmployedTax" help="50% of SE tax"/>
            <MoneyField label="Alimony Paid (pre-2019 agreements)" field="alimonyPaid"/>
            <MoneyField label="Other Adjustments" field="otherAdjustments"/>
          </div>
          <div className="form-grid2" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Total Adjustments</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--bad)' }}>-{fmt(totals.adjustments)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Adjusted Gross Income (AGI)</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--blue)' }}>{fmt(totals.agi)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── DEDUCTIONS TAB ── */}
      {tab === 'deductions' && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Deduction Method</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {['Standard', 'Itemized'].map(type => (
              <button key={type} onClick={() => fld('deductionType', type)}
                className={`btn ${form.deductionType === type ? 'pri' : 'sec'}`}
                style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>
                {type === 'Standard'
                  ? `Standard (${fmt(stdDed[form.filingStatus] || 14600)})`
                  : `Itemized (${fmt(totals.deductions)})`}
              </button>
            ))}
          </div>

          {form.deductionType === 'Standard' ? (
            <div style={{ padding: '14px 16px', background: 'var(--s3)', borderRadius: 6, fontSize: 13, color: 'var(--t2)', lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>2024 Standard Deduction</div>
              {[
                ['Single', 14600], ['Married Filing Jointly', 29200], ['Married Filing Separately', 14600],
                ['Head of Household', 21900], ['Qualifying Surviving Spouse', 29200]
              ].map(([s, amt]) => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between', fontWeight: s === form.filingStatus ? 700 : 400, color: s === form.filingStatus ? 'var(--blue)' : 'var(--t3)' }}>
                  <span>{s}</span><span>{fmt(amt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Schedule A — Itemized</div>
              <div className="fg2">
                <MoneyField label="State & Local Taxes (SALT)" field="stateLocalTax" help="Max $10,000"/>
                <MoneyField label="Mortgage Interest (1098)" field="mortgageInterest"/>
                <MoneyField label="Charitable Contributions" field="charitableContrib"/>
                <MoneyField label="Medical Expenses (>7.5% AGI)" field="medicalExpenses"/>
                <MoneyField label="Other Itemized" field="itemizedDeductions"/>
              </div>
            </>
          )}

          <div className="form-grid2" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Total Deduction</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--bad)' }}>-{fmt(totals.deductions)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Taxable Income</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--blue)' }}>{fmt(totals.taxableIncome)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── CREDITS TAB ── */}
      {tab === 'credits' && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Tax Credits</div>
          <div className="fg2">
            <MoneyField label="Child Tax Credit" field="childTaxCredit" help="Up to $2,000/child"/>
            <MoneyField label="Earned Income Tax Credit (EITC)" field="earnedIncomeCredit" help="Schedule EIC"/>
            <MoneyField label="Child & Dependent Care Credit" field="childCareCredit" help="Form 2441"/>
            <MoneyField label="Education Credit" field="educationCredit" help="Form 8863"/>
            <MoneyField label="Other Credits" field="otherCredits"/>
          </div>
          <div className="form-grid2" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Est. Tax Before Credits</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--warn)' }}>{fmt(totals.tax)}</div>
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>Tax After Credits</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--blue)' }}>{fmt(totals.taxAfterCredits)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYMENTS TAB ── */}
      {tab === 'payments' && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Payments & Withholding</div>
          <div className="fg2">
            <MoneyField label="Federal Tax Withheld (W-2 Box 2)" field="withholding"/>
            <MoneyField label="Estimated Tax Payments" field="estimatedPayments" help="Form 1040-ES"/>
            <MoneyField label="Refundable Credits" field="refundable" help="EITC, ACTC, etc."/>
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--s3)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Total Payments</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ok)' }}>{fmt(totals.payments)}</span>
          </div>

          {/* Notes */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Preparer Notes</div>
            <textarea value={form.notes || ''} onChange={e => fld('notes', e.target.value)}
              placeholder="Internal notes about this return…"
              style={{ width: '100%', minHeight: 80, padding: '8px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      )}

      {/* ── 941 QUARTERLY PAYROLL TAB ── */}
      {tab === 'q941' && is941 && (
        <div className="card">
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14}}>Form 941 — Employer's Quarterly Federal Tax Return</div>
          <div className="fg2">
            <div className="field"><label>Quarter</label>
              <select value={form.q941_quarter||'Q1'} onChange={e=>fld('q941_quarter',e.target.value)}>
                {['Q1 (Jan–Mar)','Q2 (Apr–Jun)','Q3 (Jul–Sep)','Q4 (Oct–Dec)'].map(q=><option key={q}>{q}</option>)}
              </select>
            </div>
            <MoneyField label="Number of Employees" field="q941_numEmployees"/>
          </div>
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',margin:'14px 0 10px'}}>Wages & Tax</div>
          <div className="fg2">
            <MoneyField label="Wages, Tips & Other Compensation (Line 2)" field="q941_wages" help="Total gross wages"/>
            <MoneyField label="Federal Income Tax Withheld (Line 3)" field="q941_federalIncomeTax"/>
            <MoneyField label="Taxable SS Wages (Line 5a)" field="q941_ss_wages" help="×12.4% = SS tax"/>
            <MoneyField label="Taxable Medicare Wages (Line 5c)" field="q941_medicare_wages" help="×2.9% = Medicare tax"/>
            <MoneyField label="Additional Medicare Tax Withheld (Line 5d)" field="q941_additional_medicare" help="0.9% on wages over $200k"/>
          </div>
          {(()=>{
            const n=f=>parseFloat(form[f]||0)
            const ssTax   = n('q941_ss_wages') * 0.124
            const medTax  = n('q941_medicare_wages') * 0.029
            const addMed  = n('q941_additional_medicare')
            const totalTax = n('q941_federalIncomeTax') + ssTax + medTax + addMed
            const deposits = n('q941_deposits')
            const balance  = totalTax - deposits
            return (
              <div style={{marginTop:14}}>
                <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Calculated Tax (auto)</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8,marginBottom:14}}>
                  {[
                    ['SS Tax (6.2% ×2)', ssTax, 'var(--tx)'],
                    ['Medicare Tax (1.45% ×2)', medTax, 'var(--tx)'],
                    ['Income Tax Withheld', n('q941_federalIncomeTax'), 'var(--tx)'],
                    ['Total Tax (Line 6)', totalTax, 'var(--blue)'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{padding:'10px 14px',background:'var(--s3)',borderRadius:6}}>
                      <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:800,color:c}}>${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Deposits & Balance</div>
                <div className="fg2">
                  <MoneyField label="Total Deposits Made (Line 13)" field="q941_deposits"/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
                  <div style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>Balance Due</div>
                    <div style={{fontSize:16,fontWeight:800,color:balance>0?'var(--bad)':'var(--ok)'}}>${Math.abs(balance).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                    <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>{balance>0?'Amount owed to IRS':'Overpayment'}</div>
                  </div>
                  <div style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>Total Tax</div>
                    <div style={{fontSize:16,fontWeight:800,color:'var(--blue)'}}>${totalTax.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                  </div>
                </div>
              </div>
            )
          })()}
          <div style={{marginTop:14}}>
            <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>Preparer Notes</div>
            <textarea value={form.notes||''} onChange={e=>fld('notes',e.target.value)} rows={2}
              style={{width:'100%',resize:'none',padding:'10px 14px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13,fontFamily:'inherit',boxSizing:'border-box'}}/>
          </div>
        </div>
      )}

      {/* ── 940 FUTA ANNUAL TAB ── */}
      {tab === 'q940' && is940 && (
        <div className="card">
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14}}>Form 940 — Employer's Annual FUTA Tax Return</div>
          <div className="field" style={{maxWidth:260}}>
            <label>State (for SUTA credit)</label>
            <select value={form.q940_state||'FL'} onChange={e=>fld('q940_state',e.target.value)}>
              {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',margin:'14px 0 10px'}}>Wages</div>
          <div className="fg2">
            <MoneyField label="Total Payments to All Employees (Line 3)" field="q940_totalWages"/>
            <MoneyField label="Exempt Payments (Line 4)" field="q940_exemptWages" help="Fringe benefits, retirement, etc."/>
            <MoneyField label="Payments Over $7,000 Per Employee (Line 5)" field="q940_over7k" help="Wages above the $7k FUTA wage base"/>
          </div>
          {(()=>{
            const n=f=>parseFloat(form[f]||0)
            const futaWages = Math.max(0, n('q940_totalWages') - n('q940_exemptWages') - n('q940_over7k'))
            const grossFuta = futaWages * 0.06
            // Max SUTA credit is 5.4% if state taxes paid on time
            const stateCredit = futaWages * 0.054
            const netFuta = Math.max(0, grossFuta - stateCredit)
            const balance = netFuta - n('q940_deposits')
            return (
              <div style={{marginTop:14}}>
                <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>FUTA Calculation (auto)</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8,marginBottom:14}}>
                  {[
                    ['FUTA Taxable Wages', futaWages, 'var(--tx)'],
                    ['Gross FUTA Tax (6.0%)', grossFuta, 'var(--tx)'],
                    ['Max State Credit (5.4%)', stateCredit, 'var(--ok)'],
                    ['Net FUTA Tax (0.6%)', netFuta, 'var(--blue)'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{padding:'10px 14px',background:'var(--s3)',borderRadius:6}}>
                      <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:800,color:c}}>${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:'10px 14px',background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,fontSize:12,color:'var(--warn)',marginBottom:14}}>
                  ⚠️ State credit assumes all SUTA taxes were paid in full and on time. Reduce credit if late payments were made.
                </div>
                <div className="fg2">
                  <MoneyField label="Total FUTA Tax Deposits Made" field="q940_deposits"/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
                  <div style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>Balance Due / Overpayment</div>
                    <div style={{fontSize:16,fontWeight:800,color:balance>0?'var(--bad)':'var(--ok)'}}>${Math.abs(balance).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                    <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>{balance>0?'Balance due':'Overpayment'}</div>
                  </div>
                  <div style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>Net FUTA Rate</div>
                    <div style={{fontSize:16,fontWeight:800,color:'var(--blue)'}}>0.6%</div>
                    <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>After full state credit</div>
                  </div>
                </div>
              </div>
            )
          })()}
          <div style={{marginTop:14}}>
            <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>Preparer Notes</div>
            <textarea value={form.notes||''} onChange={e=>fld('notes',e.target.value)} rows={2}
              style={{width:'100%',resize:'none',padding:'10px 14px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13,fontFamily:'inherit',boxSizing:'border-box'}}/>
          </div>
        </div>
      )}

      {/* ── STATE RETURN TAB ── */}
      {tab === 'state' && isState && (
        <div className="card">
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14}}>State Income Tax Return</div>
          <div className="fg2">
            <div className="field"><label>State</label>
              <select value={form.st_state||'FL'} onChange={e=>fld('st_state',e.target.value)}>
                {[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
                  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
                  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
                  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
                  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
                  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
                  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
                  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
                  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
                  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
                ].map(([code,name])=><option key={code} value={code}>{code} — {name}</option>)}
              </select>
            </div>
            <div className="field"><label>Filing Type</label>
              <select value={form.st_filingType||'Individual'} onChange={e=>fld('st_filingType',e.target.value)}>
                {['Individual','Joint','Married Separate','Head of Household','Corporate','Partnership','S-Corp'].map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* No income tax states */}
          {['AK','FL','NV','NH','SD','TN','TX','WA','WY'].includes(form.st_state||'FL') && (
            <div style={{padding:'20px',background:'rgba(34,197,94,.08)',border:'1px solid rgba(34,197,94,.25)',borderRadius:8,textAlign:'center',margin:'14px 0'}}>
              <div style={{fontSize:24,marginBottom:8}}>✅</div>
              <div style={{fontWeight:800,fontSize:16,marginBottom:4,color:'var(--ok)'}}>No State Income Tax</div>
              <div style={{fontSize:13,color:'var(--t2)'}}>
                {form.st_state} does not impose a personal state income tax.
                {form.st_state==='NH'?' (NH taxes interest & dividends only — check if applicable)':''}
                {form.st_state==='TN'?' (TN eliminated income tax in 2021)':''}
                {form.st_state==='WA'?' (WA has capital gains tax on gains over $262,000 — check if applicable)':''}
              </div>
              <div style={{marginTop:12,fontSize:12,color:'var(--t3)'}}>No state return filing required for income tax purposes.</div>
            </div>
          )}

          {/* States with income tax */}
          {!['AK','FL','NV','NH','SD','TN','TX','WA','WY'].includes(form.st_state||'FL') && (()=>{
            const STATE_RATES = {
              AL:{rate:5.0,std_single:2500,std_joint:7500},
              AZ:{rate:2.5,std_single:12950,std_joint:25900},
              AR:{rate:4.4,std_single:2200,std_joint:4400},
              CA:{rate:9.3,std_single:4803,std_joint:9606,brackets:true},
              CO:{rate:4.4,std_single:12950,std_joint:25900},
              CT:{rate:6.99,std_single:15000,std_joint:24000,brackets:true},
              DE:{rate:6.6,std_single:3250,std_joint:6500},
              GA:{rate:5.49,std_single:5400,std_joint:7100},
              HI:{rate:11.0,std_single:2200,std_joint:4400,brackets:true},
              ID:{rate:5.8,std_single:12950,std_joint:25900},
              IL:{rate:4.95,std_single:0,std_joint:0},
              IN:{rate:3.15,std_single:1000,std_joint:2000},
              IA:{rate:5.7,std_single:2210,std_joint:5450},
              KS:{rate:5.7,std_single:3500,std_joint:8000},
              KY:{rate:4.0,std_single:2980,std_joint:2980},
              LA:{rate:4.25,std_single:4500,std_joint:9000},
              ME:{rate:7.15,std_single:12950,std_joint:25900,brackets:true},
              MD:{rate:5.75,std_single:2400,std_joint:4850},
              MA:{rate:5.0,std_single:0,std_joint:0},
              MI:{rate:4.25,std_single:5000,std_joint:10000},
              MN:{rate:9.85,std_single:12900,std_joint:25800,brackets:true},
              MS:{rate:5.0,std_single:2300,std_joint:4600},
              MO:{rate:4.95,std_single:12950,std_joint:25900},
              MT:{rate:6.75,std_single:5000,std_joint:10000},
              NE:{rate:6.84,std_single:7900,std_joint:15800,brackets:true},
              NJ:{rate:10.75,std_single:1000,std_joint:2000,brackets:true},
              NM:{rate:5.9,std_single:12950,std_joint:25900,brackets:true},
              NY:{rate:10.9,std_single:8000,std_joint:16050,brackets:true},
              NC:{rate:4.5,std_single:12750,std_joint:25500},
              ND:{rate:2.5,std_single:12950,std_joint:25900},
              OH:{rate:3.99,std_single:0,std_joint:0},
              OK:{rate:4.75,std_single:6350,std_joint:12700},
              OR:{rate:9.9,std_single:2420,std_joint:4840,brackets:true},
              PA:{rate:3.07,std_single:0,std_joint:0},
              RI:{rate:5.99,std_single:9300,std_joint:18600,brackets:true},
              SC:{rate:6.5,std_single:12950,std_joint:25900,brackets:true},
              UT:{rate:4.65,std_single:792,std_joint:1584},
              VT:{rate:8.75,std_single:6500,std_joint:13000,brackets:true},
              VA:{rate:5.75,std_single:4500,std_joint:9000},
              WV:{rate:6.5,std_single:0,std_joint:0},
              WI:{rate:7.65,std_single:12180,std_joint:16280,brackets:true},
            }
            const info = STATE_RATES[form.st_state] || {rate:5.0,std_single:12950,std_joint:25900}
            const n=f=>parseFloat(form[f]||0)
            const stateIncome = n('st_stateIncome') || n('st_agi')
            const deduction = n('st_stateDeduction') || (form.st_filingType?.includes('Joint') ? info.std_joint : info.std_single)
            const taxable = Math.max(0, stateIncome - deduction - n('st_stateSubtractions') + n('st_stateAdditions'))
            const estTax = taxable * (info.rate / 100)
            const refund = n('st_stateWithholding') + n('st_stateCredits') - estTax

            return (
              <>
                {info.brackets && (
                  <div style={{padding:'8px 12px',background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.2)',borderRadius:6,fontSize:12,color:'var(--warn)',marginBottom:12}}>
                    ⚠️ {form.st_state} has progressive tax brackets. Rate shown ({info.rate}%) is the top marginal rate — actual tax calculated at flat rate for worksheet purposes.
                  </div>
                )}
                <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',margin:'14px 0 10px'}}>State Income Calculation</div>
                <div className="fg2">
                  <MoneyField label="Federal AGI (starting point)" field="st_agi" help="From federal return"/>
                  <MoneyField label="State Additions" field="st_stateAdditions" help="Items taxable by state but not federal"/>
                  <MoneyField label="State Subtractions" field="st_stateSubtractions" help="Items exempt from state tax"/>
                  <MoneyField label="State Standard/Itemized Deduction" field="st_stateDeduction" help={`Default: $${(form.st_filingType?.includes('Joint')?info.std_joint:info.std_single).toLocaleString()}`}/>
                  <MoneyField label="State Tax Credits" field="st_stateCredits"/>
                  <MoneyField label="State Tax Withheld (W-2 Box 17)" field="st_stateWithholding"/>
                </div>

                {/* Local tax */}
                <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',margin:'14px 0 10px'}}>Local / City Tax (if applicable)</div>
                <div className="fg2">
                  <div className="field"><label>City / Jurisdiction</label>
                    <input value={form.st_localJurisdiction||''} onChange={e=>fld('st_localJurisdiction',e.target.value)} placeholder="e.g. New York City, Philadelphia"/>
                  </div>
                  <MoneyField label="Local Tax Amount" field="st_localTax"/>
                </div>

                <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
                  {[
                    ['State Rate',`${info.rate}%`,'var(--tx)'],
                    ['State Taxable Income', `$${taxable.toLocaleString('en-US',{minimumFractionDigits:2})}`, 'var(--blue)'],
                    ['Est. State Tax', `$${estTax.toLocaleString('en-US',{minimumFractionDigits:2})}`, 'var(--warn)'],
                    [refund>=0?'State Refund':'State Owed', `$${Math.abs(refund).toLocaleString('en-US',{minimumFractionDigits:2})}`, refund>=0?'var(--ok)':'var(--bad)'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                      <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>{l}</div>
                      <div style={{fontSize:15,fontWeight:800,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}

          <div style={{marginTop:14}}>
            <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>Preparer Notes</div>
            <textarea value={form.notes||''} onChange={e=>fld('notes',e.target.value)} rows={2}
              style={{width:'100%',resize:'none',padding:'10px 14px',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:6,color:'var(--tx)',fontSize:13,fontFamily:'inherit',boxSizing:'border-box'}}/>
          </div>
        </div>
      )}

      {/* ── 1120 C-CORP INCOME TAB ── */}
      {tab === 'income' && is1120C && (
        <div className="card">
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14}}>Form 1120 — C-Corporation Income</div>
          <div className="fg2">
            <div className="field"><label>EIN</label><input value={form.c_ein||''} onChange={e=>fld('c_ein',e.target.value)} placeholder="XX-XXXXXXX"/></div>
            <div className="field"><label>State of Incorporation</label><input value={form.c_stateInc||''} onChange={e=>fld('c_stateInc',e.target.value)} placeholder="e.g. FL"/></div>
            <div className="field"><label>Date Incorporated</label><input type="date" value={form.c_dateInc||''} onChange={e=>fld('c_dateInc',e.target.value)}/></div>
            <MoneyField label="Total Assets (end of year)" field="c_totalAssets"/>
          </div>
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',margin:'14px 0 10px'}}>Gross Income</div>
          <div className="fg2">
            <MoneyField label="Gross Receipts / Sales (Line 1a)" field="c_grossReceipts"/>
            <MoneyField label="Returns & Allowances (Line 1b)" field="c_returns"/>
            <MoneyField label="Cost of Goods Sold (Line 2)" field="c_cogs"/>
            <MoneyField label="Dividends (Line 4)" field="c_dividends"/>
            <MoneyField label="Interest (Line 5)" field="c_interest"/>
            <MoneyField label="Gross Rents (Line 6)" field="c_grossRents"/>
            <MoneyField label="Gross Royalties (Line 7)" field="c_grossRoyalties"/>
            <MoneyField label="Capital Gains (Line 8)" field="c_capitalGains"/>
            <MoneyField label="Other Income (Line 10)" field="c_otherIncome"/>
          </div>
          {(()=>{
            const n=f=>parseFloat(form[f]||0)
            const grossInc = n('c_grossReceipts')-n('c_returns')-n('c_cogs')+n('c_dividends')+n('c_interest')+n('c_grossRents')+n('c_grossRoyalties')+n('c_capitalGains')+n('c_otherIncome')
            return (
              <div style={{marginTop:12,padding:'10px 14px',background:'var(--s3)',borderRadius:6,display:'flex',justifyContent:'space-between'}}>
                <span style={{fontSize:12,fontWeight:700}}>Total Income (Line 11)</span>
                <span style={{fontSize:16,fontWeight:800,color:'var(--blue)'}}>${grossInc.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 1120 C-CORP DEDUCTIONS TAB ── */}
      {tab === 'expenses' && is1120C && (
        <div className="card">
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14}}>Form 1120 — Deductions</div>
          <div className="fg2">
            <MoneyField label="Compensation of Officers (Line 12)" field="c_comp_officers" help="See Schedule E"/>
            <MoneyField label="Salaries & Wages (Line 13)" field="c_salaries"/>
            <MoneyField label="Repairs & Maintenance (Line 14)" field="c_repairs"/>
            <MoneyField label="Bad Debts (Line 15)" field="c_badDebts"/>
            <MoneyField label="Rents (Line 16)" field="c_rents"/>
            <MoneyField label="Taxes & Licenses (Line 17)" field="c_taxes"/>
            <MoneyField label="Interest (Line 18)" field="c_interest_ded"/>
            <MoneyField label="Charitable Contributions (Line 19)" field="c_charitable" help="Max 10% of taxable income"/>
            <MoneyField label="Depreciation (Form 4562, Line 20)" field="c_depreciation"/>
            <MoneyField label="Depletion (Line 21)" field="c_depletion"/>
            <MoneyField label="Advertising (Line 22)" field="c_advertising"/>
            <MoneyField label="Pension & Profit Sharing (Line 23)" field="c_pension"/>
            <MoneyField label="Employee Benefits (Line 24)" field="c_empBenefits"/>
            <MoneyField label="Domestic Production Deduction (Line 25)" field="c_domesticProd"/>
            <MoneyField label="Other Deductions (Line 26)" field="c_otherDed"/>
          </div>
          {(()=>{
            const n=f=>parseFloat(form[f]||0)
            const totalDed=['c_comp_officers','c_salaries','c_repairs','c_badDebts','c_rents','c_taxes','c_interest_ded','c_charitable','c_depreciation','c_depletion','c_advertising','c_pension','c_empBenefits','c_domesticProd','c_otherDed'].reduce((s,k)=>s+n(k),0)
            const grossInc=n('c_grossReceipts')-n('c_returns')-n('c_cogs')+n('c_dividends')+n('c_interest')+n('c_grossRents')+n('c_grossRoyalties')+n('c_capitalGains')+n('c_otherIncome')
            return (
              <div style={{marginTop:12,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div style={{padding:'10px 14px',background:'var(--s3)',borderRadius:6}}>
                  <div style={{fontSize:11,color:'var(--t3)',marginBottom:2}}>Total Deductions (Line 27)</div>
                  <div style={{fontSize:15,fontWeight:800,color:'var(--bad)'}}>${totalDed.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                </div>
                <div style={{padding:'10px 14px',background:'var(--s3)',borderRadius:6}}>
                  <div style={{fontSize:11,color:'var(--t3)',marginBottom:2}}>Taxable Income Before Special Ded.</div>
                  <div style={{fontSize:15,fontWeight:800,color:'var(--blue)'}}>${Math.max(0,grossInc-totalDed).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 1120 SPECIAL DEDUCTIONS TAB ── */}
      {tab === 'special' && is1120C && (
        <div className="card">
          <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:14}}>Special Deductions & Final Tax</div>
          <div className="fg2">
            <MoneyField label="Dividends Received Deduction (DRD)" field="c_specialDed_drd" help="Schedule C"/>
            <MoneyField label="Net Operating Loss (NOL)" field="c_specialDed_nol" help="Form 1139"/>
            <MoneyField label="Other Special Deductions" field="c_specialDed_other"/>
          </div>
          {(()=>{
            const n=f=>parseFloat(form[f]||0)
            const grossInc=n('c_grossReceipts')-n('c_returns')-n('c_cogs')+n('c_dividends')+n('c_interest')+n('c_grossRents')+n('c_grossRoyalties')+n('c_capitalGains')+n('c_otherIncome')
            const totalDed=['c_comp_officers','c_salaries','c_repairs','c_badDebts','c_rents','c_taxes','c_interest_ded','c_charitable','c_depreciation','c_depletion','c_advertising','c_pension','c_empBenefits','c_domesticProd','c_otherDed'].reduce((s,k)=>s+n(k),0)
            const specialDed=n('c_specialDed_drd')+n('c_specialDed_nol')+n('c_specialDed_other')
            const taxableInc=Math.max(0,grossInc-totalDed-specialDed)
            const corpTax=taxableInc*0.21
            return (
              <div style={{marginTop:14}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:8}}>
                  {[
                    ['Total Special Deductions', specialDed,'var(--ok)'],
                    ['Taxable Income (Line 30)', taxableInc,'var(--blue)'],
                    ['Corporate Tax @ 21% (Line 31)', corpTax,'var(--warn)'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                      <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>{l}</div>
                      <div style={{fontSize:15,fontWeight:800,color:c}}>${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:14,fontSize:11,color:'var(--t3)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>Credits & Payments</div>
                <div className="fg2">
                  <MoneyField label="Tax Credits (Schedule J)" field="c_credits"/>
                  <MoneyField label="Estimated Tax Deposits" field="c_deposits"/>
                </div>
                <div style={{marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <div style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>Tax After Credits</div>
                    <div style={{fontSize:15,fontWeight:800,color:'var(--warn)'}}>${Math.max(0,corpTax-n('c_credits')).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                  </div>
                  <div style={{padding:'12px 14px',background:'var(--s3)',borderRadius:6}}>
                    <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>{(corpTax-n('c_credits')-n('c_deposits'))>=0?'Balance Due':'Overpayment'}</div>
                    <div style={{fontSize:15,fontWeight:800,color:(corpTax-n('c_credits')-n('c_deposits'))>=0?'var(--bad)':'var(--ok)'}}>${Math.abs(corpTax-n('c_credits')-n('c_deposits')).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── SCHEDULE C TAB (1040 with self-employment) ── */}
      {tab === 'schedC' && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Schedule C — Profit or Loss from Business</div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Business Name</label>
            <input value={form.schedC_businessName || ''} onChange={e => fld('schedC_businessName', e.target.value)} placeholder="Business or DBA name"/>
          </div>
          <div className="fg2">
            <div className="field"><label>Business EIN (if any)</label><input value={form.schedC_ein || ''} onChange={e => fld('schedC_ein', e.target.value)} placeholder="XX-XXXXXXX"/></div>
            <div className="field"><label>Business Code (6-digit NAICS)</label><input value={form.schedC_naics || ''} onChange={e => fld('schedC_naics', e.target.value)} placeholder="e.g. 541213"/></div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', margin: '14px 0 10px' }}>Revenue</div>
          <div className="fg2">
            <MoneyField label="Gross Receipts / Sales" field="schedC_grossReceipts" help="Line 1"/>
            <MoneyField label="Returns & Allowances" field="schedC_returns" help="Line 2"/>
            <MoneyField label="Cost of Goods Sold" field="schedC_cogs" help="Line 4"/>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', margin: '14px 0 10px' }}>Expenses</div>
          <div className="fg2">
            <MoneyField label="Advertising" field="schedC_advertising"/>
            <MoneyField label="Car & Truck" field="schedC_carTruck"/>
            <MoneyField label="Commissions & Fees" field="schedC_commissions"/>
            <MoneyField label="Contract Labor" field="schedC_contractLabor"/>
            <MoneyField label="Depreciation (Form 4562)" field="schedC_depreciation"/>
            <MoneyField label="Employee Benefits" field="schedC_empBenefits"/>
            <MoneyField label="Insurance (not health)" field="schedC_insurance"/>
            <MoneyField label="Mortgage Interest" field="schedC_mortgageInterest"/>
            <MoneyField label="Other Interest" field="schedC_otherInterest"/>
            <MoneyField label="Legal & Professional" field="schedC_legal"/>
            <MoneyField label="Office Expenses" field="schedC_office"/>
            <MoneyField label="Rent — Vehicles/Equipment" field="schedC_rentVehicles"/>
            <MoneyField label="Rent — Other Business Property" field="schedC_rentOther"/>
            <MoneyField label="Repairs & Maintenance" field="schedC_repairs"/>
            <MoneyField label="Supplies" field="schedC_supplies"/>
            <MoneyField label="Taxes & Licenses" field="schedC_taxes"/>
            <MoneyField label="Travel" field="schedC_travel"/>
            <MoneyField label="Meals (50% deductible)" field="schedC_meals"/>
            <MoneyField label="Utilities" field="schedC_utilities"/>
            <MoneyField label="Wages (W-2 employees)" field="schedC_wages"/>
            <MoneyField label="Other Expenses" field="schedC_otherExp"/>
          </div>
          {(() => {
            const n = f => parseFloat(form[f] || 0)
            const gross = n('schedC_grossReceipts') - n('schedC_returns') - n('schedC_cogs')
            const totalExp = ['advertising','carTruck','commissions','contractLabor','depreciation','empBenefits','insurance','mortgageInterest','otherInterest','legal','office','rentVehicles','rentOther','repairs','supplies','taxes','travel','meals','utilities','wages','otherExp'].reduce((sum, k) => sum + n('schedC_' + k), 0)
            const netProfit = gross - totalExp
            return (
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[['Gross Profit', gross, 'var(--blue)'], ['Total Expenses', totalExp, 'var(--bad)'], ['Net Profit / Loss', netProfit, netProfit >= 0 ? 'var(--ok)' : 'var(--bad)']].map(([label, val, color]) => (
                  <div key={label} style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color }}>{val < 0 ? '-' : ''}{fmt(Math.abs(val))}</div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── BUSINESS REVENUE TAB (1120-S / 1065) ── */}
      {tab === 'income' && isBusiness && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
            {is1120S ? 'S-Corporation Revenue' : 'Partnership Revenue'}
          </div>
          <div className="fg2">
            <MoneyField label="Gross Receipts / Sales" field="biz_grossReceipts"/>
            <MoneyField label="Returns & Allowances" field="biz_returns"/>
            <MoneyField label="Cost of Goods Sold" field="biz_cogs"/>
            <MoneyField label="Other Income" field="biz_otherIncome"/>
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--s3)', borderRadius: 6, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Gross Income</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--blue)' }}>
              {fmt(parseFloat(form.biz_grossReceipts||0) - parseFloat(form.biz_returns||0) - parseFloat(form.biz_cogs||0) + parseFloat(form.biz_otherIncome||0))}
            </span>
          </div>
        </div>
      )}

      {/* ── BUSINESS EXPENSES TAB (1120-S / 1065) ── */}
      {tab === 'expenses' && isBusiness && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Business Deductions</div>
          <div className="fg2">
            <MoneyField label="Compensation of Officers" field="biz_officerComp" help="1120-S Line 7"/>
            <MoneyField label="Salaries & Wages (other)" field="biz_wages"/>
            <MoneyField label="Repairs & Maintenance" field="biz_repairs"/>
            <MoneyField label="Bad Debts" field="biz_badDebts"/>
            <MoneyField label="Rents" field="biz_rents"/>
            <MoneyField label="Taxes & Licenses" field="biz_taxes"/>
            <MoneyField label="Interest" field="biz_interest"/>
            <MoneyField label="Depreciation" field="biz_depreciation"/>
            <MoneyField label="Depletion" field="biz_depletion"/>
            <MoneyField label="Advertising" field="biz_advertising"/>
            <MoneyField label="Pension & Profit Sharing" field="biz_pension"/>
            <MoneyField label="Employee Benefits" field="biz_empBenefits"/>
            <MoneyField label="Other Deductions" field="biz_otherDed"/>
          </div>
          {(() => {
            const n = f => parseFloat(form[f] || 0)
            const totalDed = ['officerComp','wages','repairs','badDebts','rents','taxes','interest','depreciation','depletion','advertising','pension','empBenefits','otherDed'].reduce((sum,k) => sum + n('biz_'+k), 0)
            const grossInc = n('biz_grossReceipts') - n('biz_returns') - n('biz_cogs') + n('biz_otherIncome')
            const netInc = grossInc - totalDed
            return (
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[['Total Deductions', totalDed, 'var(--bad)'], ['Net Income', netInc, netInc >= 0 ? 'var(--ok)' : 'var(--bad)']].map(([label, val, color]) => (
                  <div key={label} style={{ padding: '10px 14px', background: 'var(--s3)', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color }}>{val < 0 ? '-' : ''}{fmt(Math.abs(val))}</div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── OFFICERS TAB (1120-S) ── */}
      {tab === 'officers' && is1120S && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>Officers & Shareholders</div>
          <div className="fg2">
            <MoneyField label="Total Officer Compensation" field="biz_officerComp"/>
            <MoneyField label="Shareholder Distributions" field="biz_distributions"/>
            <MoneyField label="Retained Earnings / E&P" field="biz_retainedEarnings"/>
            <MoneyField label="Net Income per S-Corp" field="biz_netIncomeSCorp"/>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', margin: '14px 0 10px' }}>K-1 Pass-Through (per Shareholder)</div>
          <div className="fg2">
            <MoneyField label="Ordinary Business Income (Box 1)" field="k1_ordinaryIncome"/>
            <MoneyField label="Net Rental Income (Box 2)" field="k1_rentalIncome"/>
            <MoneyField label="Interest Income (Box 5)" field="k1_interest"/>
            <MoneyField label="Dividends (Box 6)" field="k1_dividends"/>
            <MoneyField label="Capital Gains (Box 9)" field="k1_capitalGain"/>
            <MoneyField label="Section 179 Deduction (Box 11)" field="k1_sec179"/>
          </div>
        </div>
      )}

      {/* ── PARTNERS TAB (1065) ── */}
      {tab === 'partners' && is1065 && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>Partnership Information</div>
          <div className="fg2">
            <MoneyField label="Total Partnership Income" field="biz_partnershipIncome"/>
            <MoneyField label="Guaranteed Payments to Partners" field="biz_guaranteedPayments"/>
            <MoneyField label="Net Income / Loss" field="biz_netIncome"/>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', margin: '14px 0 10px' }}>K-1 Allocations (per Partner)</div>
          <div className="fg2">
            <MoneyField label="Ordinary Business Income (Box 1)" field="k1_ordinaryIncome"/>
            <MoneyField label="Net Rental Income (Box 2)" field="k1_rentalIncome"/>
            <MoneyField label="Guaranteed Payments (Box 4)" field="k1_guaranteedPayments"/>
            <MoneyField label="Interest Income (Box 5)" field="k1_interest"/>
            <MoneyField label="Dividends (Box 6)" field="k1_dividends"/>
            <MoneyField label="Net Capital Gain (Box 9)" field="k1_capitalGain"/>
            <MoneyField label="Section 179 (Box 12)" field="k1_sec179"/>
            <MoneyField label="Self-Employment Income (Box 14)" field="k1_selfEmpIncome"/>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Partner Details</div>
            <div className="fg2">
              <div className="field"><label>Partner 1 Name</label><input value={form.partner1_name||''} onChange={e=>fld('partner1_name',e.target.value)} placeholder="Full name"/></div>
              <div className="field"><label>Partner 1 Ownership %</label><input type="number" value={form.partner1_pct||''} onChange={e=>fld('partner1_pct',e.target.value)} placeholder="e.g. 50"/></div>
              <div className="field"><label>Partner 2 Name</label><input value={form.partner2_name||''} onChange={e=>fld('partner2_name',e.target.value)} placeholder="Full name"/></div>
              <div className="field"><label>Partner 2 Ownership %</label><input type="number" value={form.partner2_pct||''} onChange={e=>fld('partner2_pct',e.target.value)} placeholder="e.g. 50"/></div>
            </div>
          </div>
        </div>
      )}

      {/* ── SUMMARY TAB ── */}
      {tab === 'summary' && (
        <div>
          {/* Refund / Owed Banner */}
          <div style={{
            padding: '20px 24px', borderRadius: 8, marginBottom: 14,
            background: totals.refundOrOwed >= 0 ? 'var(--ok)22' : 'var(--bad)22',
            border: `1px solid ${totals.refundOrOwed >= 0 ? 'var(--ok)' : 'var(--bad)'}`,
            textAlign: 'center'
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
              {totals.refundOrOwed >= 0 ? '💚 Estimated Refund' : '🔴 Estimated Amount Owed'}
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, color: totals.refundOrOwed >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
              {fmt(Math.abs(totals.refundOrOwed))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
              Based on {form.taxYear} {form.filingStatus} · {form.returnType}
            </div>
          </div>

          {/* Full Calculation */}
          <div className="card">
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>Return Calculation Summary</div>
            {[
              ['Gross Income', totals.grossIncome, 'var(--tx)', false],
              ['Adjustments', -totals.adjustments, 'var(--bad)', false],
              ['Adjusted Gross Income (AGI)', totals.agi, 'var(--blue)', true],
              [`${form.deductionType} Deduction`, -totals.deductions, 'var(--bad)', false],
              ['Taxable Income', totals.taxableIncome, 'var(--blue)', true],
              ['Estimated Tax (calculated)', totals.tax, 'var(--warn)', false],
              ['Tax Credits', -totals.credits, 'var(--ok)', false],
              ['Tax After Credits', totals.taxAfterCredits, 'var(--warn)', true],
              ['Total Payments & Withholding', totals.payments, 'var(--ok)', false],
              [totals.refundOrOwed >= 0 ? 'REFUND' : 'BALANCE DUE', totals.refundOrOwed, totals.refundOrOwed >= 0 ? 'var(--ok)' : 'var(--bad)', true],
            ].map(([label, val, color, bold]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--br)', fontWeight: bold ? 700 : 400 }}>
                <span style={{ fontSize: 12, color: bold ? 'var(--tx)' : 'var(--t2)' }}>{label}</span>
                <span style={{ fontSize: bold ? 15 : 13, color, fontWeight: bold ? 800 : 600 }}>
                  {val < 0 ? '-' : ''}{fmt(Math.abs(val))}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="btn pri" onClick={save} disabled={saving} style={{ flex: 1, justifyContent: 'center' }}>
              {saving ? 'Saving…' : '💾 Save Return'}
            </button>
            <button className="btn sec" onClick={() => setView('list')} style={{ flex: 1, justifyContent: 'center' }}>
              ← Back to List
            </button>
          </div>
        </div>
      )}

      {/* ── SUBMIT / EXPORT TAB ── */}
      {/* PDF Download Banner */}
      {(tab === 'submit' || tab === 'summary') && (
        <div style={{ marginBottom: 12, padding: '14px 18px', background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>📄 Download Return Summary PDF</div>
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>Professional preparer worksheet with all income, deductions, and summary — ready to print or share with client.</div>
          </div>
          <button className="btn pri" style={{ whiteSpace: 'nowrap', padding: '10px 20px', fontWeight: 700, fontSize: 14 }}
            onClick={generatePdf} disabled={genPdf}>
            {genPdf ? '⏳ Generating…' : '⬇️ Download PDF'}
          </button>
        </div>
      )}

      {tab === 'submit' && (() => {
        const t = calcTotals(form)
        function downloadFile(content, filename, type='text/plain') {
          const blob = new Blob([content], { type })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = filename; a.click()
          URL.revokeObjectURL(url)
        }
        function printReturn() {
          const win = window.open('', '_blank')
          win.document.write(`<html><head><title>Tax Return — ${form.clientName} ${form.taxYear}</title>
            <style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#000}
            h1{font-size:18px;border-bottom:2px solid #000;padding-bottom:6px}
            h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:20px}
            .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eee}
            .bold{font-weight:700}.total{font-size:14px;font-weight:700;background:#f0f0f0;padding:6px 8px}
            .refund{background:#d4edda;padding:12px;text-align:center;font-size:18px;font-weight:700;border:2px solid #28a745}
            .owed{background:#f8d7da;padding:12px;text-align:center;font-size:18px;font-weight:700;border:2px solid #dc3545}
            .footer{margin-top:30px;border-top:1px solid #000;padding-top:10px;font-size:10px}
            </style></head><body>
            <h1>FEDERAL INCOME TAX RETURN — ${form.taxYear}</h1>
            <div class="row"><span>Taxpayer Name:</span><span class="bold">${form.clientName}</span></div>
            <div class="row"><span>Filing Status:</span><span>${form.filingStatus}</span></div>
            <div class="row"><span>Return Type:</span><span>${form.returnType}</span></div>
            <div class="row"><span>Prepared By:</span><span>${preparer.name || 'Tax Case Review'}</span></div>
            <div class="row"><span>PTIN:</span><span>${preparer.ptin || '—'}</span></div>
            <div class="row"><span>CAF#:</span><span>${preparer.caf || '—'}</span></div>
            <div class="row"><span>Preparation Date:</span><span>${new Date().toLocaleDateString()}</span></div>
            <h2>INCOME</h2>
            ${[['Wages', form.wages],['Interest',form.interest],['Dividends',form.dividends],['Capital Gains',form.capitalGains],['Business Income',form.businessIncome],['Rental Income',form.rentalIncome],['Retirement',form.retirementIncome],['Social Security',form.socialSecurity],['Other Income',form.otherIncome]].filter(([,v])=>parseFloat(v||0)>0).map(([l,v])=>`<div class="row"><span>${l}</span><span>$${Math.round(parseFloat(v||0)).toLocaleString()}</span></div>`).join('')}
            <div class="row total"><span>GROSS INCOME</span><span>$${Math.round(t.grossIncome).toLocaleString()}</span></div>
            <h2>ADJUSTMENTS & DEDUCTIONS</h2>
            <div class="row"><span>Total Adjustments</span><span>-$${Math.round(t.adjustments).toLocaleString()}</span></div>
            <div class="row"><span>Adjusted Gross Income</span><span>$${Math.round(t.agi).toLocaleString()}</span></div>
            <div class="row"><span>${form.deductionType} Deduction</span><span>-$${Math.round(t.deductions).toLocaleString()}</span></div>
            <div class="row total"><span>TAXABLE INCOME</span><span>$${Math.round(t.taxableIncome).toLocaleString()}</span></div>
            <h2>TAX & CREDITS</h2>
            <div class="row"><span>Estimated Tax</span><span>$${Math.round(t.tax).toLocaleString()}</span></div>
            <div class="row"><span>Tax Credits</span><span>-$${Math.round(t.credits).toLocaleString()}</span></div>
            <div class="row total"><span>TAX AFTER CREDITS</span><span>$${Math.round(t.taxAfterCredits).toLocaleString()}</span></div>
            <h2>PAYMENTS</h2>
            <div class="row"><span>Withholding</span><span>$${Math.round(parseFloat(form.withholding||0)).toLocaleString()}</span></div>
            <div class="row"><span>Estimated Payments</span><span>$${Math.round(parseFloat(form.estimatedPayments||0)).toLocaleString()}</span></div>
            <div class="row total"><span>TOTAL PAYMENTS</span><span>$${Math.round(t.payments).toLocaleString()}</span></div>
            <br/>
            <div class="${t.refundOrOwed >= 0 ? 'refund' : 'owed'}">${t.refundOrOwed >= 0 ? '✓ ESTIMATED REFUND' : '⚠ BALANCE DUE'}: $${Math.round(Math.abs(t.refundOrOwed)).toLocaleString()}</div>
            <div class="footer">
              Prepared by ${preparer.name || 'Tax Case Review'} · PTIN: ${preparer.ptin || 'N/A'} · CAF#: ${preparer.caf || 'N/A'}<br/>
              This is a tax preparation worksheet. The final return must be submitted through IRS-approved e-file software using EFIN: ${preparer.efin || 'N/A'}.
            </div>
            </body></html>`)
          win.document.close()
          win.print()
        }
        return (
          <div>
            {/* Preparer info card */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)', marginBottom: 12 }}>🪪 Preparer Credentials</div>
              <div className="form-grid2" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, maxWidth: 600 }}>
                <div className="field" style={{ margin: 0 }}><label>Preparer Name</label>
                  <input value={preparer.name} onChange={e => setPreparer(p => ({...p, name: e.target.value}))} placeholder="Your name" />
                </div>
                <div className="field" style={{ margin: 0 }}><label>PTIN</label>
                  <input value={preparer.ptin} onChange={e => setPreparer(p => ({...p, ptin: e.target.value}))} placeholder="P00000000" />
                </div>
                <div className="field" style={{ margin: 0 }}><label>CAF Number</label>
                  <input value={preparer.caf} onChange={e => setPreparer(p => ({...p, caf: e.target.value}))} placeholder="CAF number (for POA/transcripts)" />
                </div>
                <div className="field" style={{ margin: 0 }}><label>EFIN (e-file ID)</label>
                  <input value={preparer.efin} onChange={e => setPreparer(p => ({...p, efin: e.target.value}))} placeholder="6-digit EFIN" />
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
                💡 Save these in Settings → Firm Info to auto-populate on every return.
              </div>
            </div>

            {/* Return summary */}
            <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                ['Client', form.clientName],
                ['Tax Year', form.taxYear],
                ['Type', form.returnType],
                ['Status', form.status],
                [t.refundOrOwed >= 0 ? 'Refund' : 'Balance Due', (t.refundOrOwed >= 0 ? '+' : '-') + '$' + Math.round(Math.abs(t.refundOrOwed)).toLocaleString()],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx)', marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Status workflow */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)', marginBottom: 12 }}>📋 Filing Workflow</div>
              <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
                {['Draft','In Review','Client Review','Ready to File','Filed','Accepted'].map((s, i) => {
                  const statuses = ['Draft','In Review','Client Review','Ready to File','Filed','Accepted']
                  const idx = statuses.indexOf(form.status)
                  const done = i <= idx
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                      <div onClick={() => fld('status', s)} style={{
                        padding: '6px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                        background: done ? 'var(--blue)' : 'var(--s2)',
                        color: done ? '#fff' : 'var(--t3)',
                        border: s === form.status ? '2px solid var(--blue)' : '2px solid transparent',
                        transition: 'all .15s'
                      }}>{s}</div>
                      {i < 5 && <div style={{ width: 14, height: 2, background: done && i < idx ? 'var(--blue)' : 'var(--br)', flexShrink: 0 }} />}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Export actions */}
            <div className="card">
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)', marginBottom: 14 }}>📤 Export & Submit</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>

                <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--br)', background: 'var(--s2)' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>🖨️</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 4 }}>Print Return</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>Print a formatted return summary for client review and signature.</div>
                  <button className="btn pri" style={{ width: '100%', justifyContent: 'center' }} onClick={printReturn}>Print / Preview</button>
                </div>

                <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${efileStatus.configured ? 'rgba(34,197,94,.4)' : 'rgba(245,158,11,.35)'}`, background: efileStatus.configured ? 'rgba(34,197,94,.07)' : 'rgba(245,158,11,.06)' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>🏛️</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 4 }}>E-file Federal Return</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>
                    {efileStatus.loading
                      ? 'Checking e-file configuration…'
                      : efileStatus.configured
                        ? `Ready through ${efileStatus.providerName || 'configured e-file transmitter'}.`
                        : efileStatus.message || 'E-file is locked until both the office EFIN and approved transmitter connection are configured.'}
                  </div>
                  <button className="btn ok" style={{ width: '100%', justifyContent: 'center', opacity: efileStatus.configured && current?.id && form.status === 'Ready to File' ? 1 : 0.4 }}
                    disabled={!efileStatus.configured || !current?.id || form.status !== 'Ready to File'}
                    onClick={async () => {
                      if (!current?.id) { showToast('⚠️ Save the return before e-filing'); return }
                      if (!preparer.efin) { showToast('⚠️ Enter this office EFIN first'); return }
                      if (!efileStatus.configured) { showToast('⚠️ E-file is locked until the approved transmitter connection is configured'); return }
                      if (form.status !== 'Ready to File') { showToast('⚠️ Set status to Ready to File first'); return }
                      showToast('📡 Sending to e-file transmitter…')
                      const { data, error } = await supabase.functions.invoke('submit-to-irs', {
                        body: {
                          returnId: current.id,
                          returnData: {
                            ...form,
                            id: current.id,
                            grossIncome: t.grossIncome,
                            agi: t.agi,
                            taxableIncome: t.taxableIncome,
                            estimatedTax: t.tax,
                            taxAfterCredits: t.taxAfterCredits,
                            payments: t.payments,
                            refund: t.refundOrOwed > 0 ? t.refundOrOwed : 0,
                            amountOwed: t.refundOrOwed < 0 ? Math.abs(t.refundOrOwed) : 0
                          }
                        }
                      })
                      if (error || !data?.success) {
                        showToast(`❌ ${data?.error || error?.message || 'E-file transmission failed'}`)
                      } else {
                        const nextStatus = /accept/i.test(data.status || '') ? 'Accepted' : /reject/i.test(data.status || '') ? 'Rejected' : 'Filed'
                        fld('status', nextStatus)
                        showToast(`✅ ${data.message || 'Return transmitted'}${data.ackNumber ? ` · ACK ${data.ackNumber}` : ''}`)
                        await logReturnNote(`📄 ${form.taxYear} ${form.returnType} transmitted through ${data.providerName || 'the configured e-file provider'}. Status: ${data.status || nextStatus}.${data.submissionId ? ` Submission ID: ${data.submissionId}.` : ''}${data.ackNumber ? ` Acknowledgement: ${data.ackNumber}.` : ''} Preparer: ${preparer.name || 'Staff'} (EFIN: ${preparer.efin}).`)
                        load()
                      }
                    }}>
                    🏛️ E-file Return
                  </button>
                  {!efileStatus.loading && !efileStatus.configured && <div style={{fontSize:10,color:'var(--warn)',marginTop:8}}>Transmitter connection is not configured for this office. E-file remains locked.</div>}
                  {form.status !== 'Ready to File' && <div style={{fontSize:10,color:'var(--warn)',marginTop:8}}>Set status to <strong>Ready to File</strong> before transmission.</div>}
                </div>

                <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--br)', background: 'var(--s2)' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>📄</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 4 }}>Download XML</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>Download the CRM's MeF review XML for records or provider handoff. This file is not itself an IRS transmission.</div>
                  <button className="btn sec" style={{ width: '100%', justifyContent: 'center' }} onClick={() => {
                    const xml = generateMeFXML(form, t, preparer)
                    downloadFile(xml, `${form.clientName?.replace(/\s+/g,'_')}_${form.taxYear}_MeF.xml`, 'text/xml')
                  }}>⬇ Download XML</button>
                </div>

                <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--br)', background: 'var(--s2)' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>📋</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 4 }}>State Filing Export</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>Export a formatted state return worksheet with federal AGI carryover.</div>
                  <button className="btn sec" style={{ width: '100%', justifyContent: 'center' }} onClick={() => {
                    const txt = generateStateExport(form, t, preparer)
                    downloadFile(txt, `${form.clientName?.replace(/\s+/g,'_')}_${form.taxYear}_State.txt`)
                  }}>⬇ Download State Export</button>
                </div>

                <div style={{ padding: 16, borderRadius: 10, border: '1px solid var(--br)', background: 'var(--s2)' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>✅</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 4 }}>Mark as Filed</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>Manually mark this return as filed after submission.</div>
                  <button className="btn ok" style={{ width: '100%', justifyContent: 'center' }} onClick={async () => {
                    fld('status', 'Filed')
                    await supabase.from('tax_returns').update({ status: 'Filed', updated_at: new Date().toISOString() }).eq('id', current?.id)
                    showToast('✅ Return marked as Filed!')
                    await logReturnNote(`📄 ${form.taxYear} ${form.returnType} marked as filed. Preparer: ${preparer.name || 'Staff'}.`)
                    await triggerWorkflow('tax_return_filed', 'client', ret?.clientName || '', user?.user_metadata?.name || 'Staff').catch(()=>{})
                    load()
                  }} disabled={!current?.id}>Mark as Filed</button>
                </div>

              </div>

              <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(34,197,94,.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,.25)', fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>
                <strong style={{ color: '#22c55e' }}>🏛️ IRS e-file:</strong> Each TaxRes office uses its own EFIN. Actual transmission goes through the configured IRS-approved software/transmitter connection, with submissions isolated to the signed-in office. Your PTIN ({preparer.ptin || 'not set'}) and CAF# ({preparer.caf || 'not set'}) remain available for preparation and representation workflows.
              </div>
            </div>
          </div>
        )
      })()}
      <DeleteConfirmModal open={!!confirmDel} label="tax return" onConfirm={confirmDeleteReturn} onCancel={() => setConfirmDel(null)} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSION HELPERS — appended to TaxReturns.jsx
// These are exported for use by the Submit tab rendered inside TaxReturns
// ─────────────────────────────────────────────────────────────────────────────

export function generateMeFXML(ret, totals, preparer) {
  const n = k => parseFloat(ret[k] || 0) || 0
  const ts = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- IRS MeF Compatible Export — Generated ${ts} -->
<!-- IMPORTANT: This XML is for review purposes. Submit via IRS-approved e-file software. -->
<Return xmlns="http://www.irs.gov/efile" returnVersion="2024v5.0">
  <ReturnHeader binaryAttachmentCount="0">
    <ReturnTs>${ts}</ReturnTs>
    <TaxYr>${ret.taxYear || '2024'}</TaxYr>
    <PreparerFirmGrp>
      <PreparerFirmName>
        <BusinessNameLine1Txt>${FIRM.name || 'Tax Case Review'}</BusinessNameLine1Txt>
      </PreparerFirmName>
      <PreparerFirmEIN>Applied For</PreparerFirmEIN>
    </PreparerFirmGrp>
    <PreparerPersonGrp>
      <PTIN>${preparer.ptin || 'P00000000'}</PTIN>
      <PreparerPersonNm>${preparer.name || ''}</PreparerPersonNm>
      <SelfEmployedInd>X</SelfEmployedInd>
    </PreparerPersonGrp>
    <ReturnTypeCd>1040</ReturnTypeCd>
    <FilingSecurityInformation>
      <AtSubmissionCreationGrp>
        <TotalPreparationSubmissionTs>${ts}</TotalPreparationSubmissionTs>
      </AtSubmissionCreationGrp>
    </FilingSecurityInformation>
    <Filer>
      <PrimarySSN>${ret.clientSSN ? ret.clientSSN.replace(/\D/g,'') : '000000000'}</PrimarySSN>
      <NameLine1Txt>${ret.clientName || ''}</NameLine1Txt>
      <USAddrGrp>
        <AddressLine1Txt>${ret.clientAddress || ''}</AddressLine1Txt>
        <CityNm>${ret.clientCity || ''}</CityNm>
        <StateAbbreviationCd>${ret.clientState || ''}</StateAbbreviationCd>
        <ZIPCd>${ret.clientZip || ''}</ZIPCd>
      </USAddrGrp>
    </Filer>
    <FilingStatus>
      <${ret.filingStatus === 'Single' ? 'SingleInd' :
         ret.filingStatus === 'Married Filing Jointly' ? 'MarriedFilingJointlyInd' :
         ret.filingStatus === 'Married Filing Separately' ? 'MarriedFilingSeparatelyInd' :
         ret.filingStatus === 'Head of Household' ? 'HeadOfHouseholdInd' : 'SingleInd'}/>X</${ret.filingStatus === 'Single' ? 'SingleInd' :
         ret.filingStatus === 'Married Filing Jointly' ? 'MarriedFilingJointlyInd' :
         ret.filingStatus === 'Married Filing Separately' ? 'MarriedFilingSeparatelyInd' :
         ret.filingStatus === 'Head of Household' ? 'HeadOfHouseholdInd' : 'SingleInd'}>
    </FilingStatus>
  </ReturnHeader>
  <ReturnData documentCnt="1">
    <IRS1040 documentId="IRS1040" referenceDocumentId="GeneralDep">
      <!-- LINE 1 — Wages -->
      <WagesAmt>${Math.round(n('wages'))}</WagesAmt>
      <!-- LINE 2b — Taxable Interest -->
      <TaxableInterestAmt>${Math.round(n('interest'))}</TaxableInterestAmt>
      <!-- LINE 3b — Ordinary Dividends -->
      <OrdinaryDividendsAmt>${Math.round(n('dividends'))}</OrdinaryDividendsAmt>
      <!-- LINE 4b — Retirement -->
      <TaxableIRAPensionAmt>${Math.round(n('retirementIncome'))}</TaxableIRAPensionAmt>
      <!-- LINE 5b — Social Security -->
      <TaxableSocSecBnftAmt>${Math.round(n('socialSecurity') * 0.85)}</TaxableSocSecBnftAmt>
      <!-- LINE 7 — Capital Gains -->
      <CapitalGainLossAmt>${Math.round(n('capitalGains'))}</CapitalGainLossAmt>
      <!-- LINE 8 — Other Income -->
      <OtherIncomeAmt>${Math.round(n('otherIncome') + n('businessIncome') + n('rentalIncome'))}</OtherIncomeAmt>
      <!-- LINE 9 — Total Income -->
      <TotalIncomeAmt>${Math.round(totals.grossIncome)}</TotalIncomeAmt>
      <!-- LINE 11 — AGI -->
      <AdjustedGrossIncomeAmt>${Math.round(totals.agi)}</AdjustedGrossIncomeAmt>
      <!-- LINE 12 — Standard/Itemized Deduction -->
      <TotalDeductionsAmt>${Math.round(totals.deductions)}</TotalDeductionsAmt>
      <!-- LINE 15 — Taxable Income -->
      <TaxableIncomeAmt>${Math.round(totals.taxableIncome)}</TaxableIncomeAmt>
      <!-- LINE 16 — Tax -->
      <TentativeTaxAmt>${Math.round(totals.tax)}</TentativeTaxAmt>
      <!-- LINE 19 — Child Tax Credit -->
      <ChildTaxCreditAmt>${Math.round(n('childTaxCredit'))}</ChildTaxCreditAmt>
      <!-- LINE 24 — Total Tax -->
      <TotalTaxAmt>${Math.round(totals.taxAfterCredits)}</TotalTaxAmt>
      <!-- LINE 25a — Withholding -->
      <WithholdingTaxAmt>${Math.round(n('withholding'))}</WithholdingTaxAmt>
      <!-- LINE 26 — Estimated Payments -->
      <EstimatedTaxPaymentsAmt>${Math.round(n('estimatedPayments'))}</EstimatedTaxPaymentsAmt>
      <!-- LINE 33 — Total Payments -->
      <TotalPaymentsAmt>${Math.round(totals.payments)}</TotalPaymentsAmt>
      ${totals.refundOrOwed >= 0
        ? `<!-- LINE 35a — Refund -->\n      <OverpaidAmt>${Math.round(totals.refundOrOwed)}</OverpaidAmt>\n      <RefundAmt>${Math.round(totals.refundOrOwed)}</RefundAmt>`
        : `<!-- LINE 37 — Amount Owed -->\n      <BalanceDueAmt>${Math.round(Math.abs(totals.refundOrOwed))}</BalanceDueAmt>`}
    </IRS1040>
  </ReturnData>
</Return>`
}

export function generateStateExport(ret, totals, preparer) {
  const n = k => parseFloat(ret[k] || 0) || 0
  return `STATE TAX RETURN EXPORT
===============================================================
Prepared by: ${preparer.name || 'Tax Case Review'}
CAF#: ${preparer.caf || ''}  PTIN: ${preparer.ptin || ''}
Generated: ${new Date().toLocaleString()}

TAXPAYER INFORMATION
---------------------------------------------------------------
Name:           ${ret.clientName || ''}
SSN:            ${ret.clientSSN || '***-**-****'}
Tax Year:       ${ret.taxYear || '2024'}
Filing Status:  ${ret.filingStatus || ''}
Return Type:    ${ret.returnType || ''}

FEDERAL AGI (carry-over to state):  $${Math.round(totals.agi).toLocaleString()}

INCOME SUMMARY
---------------------------------------------------------------
Wages & Salaries:         $${Math.round(n('wages')).toLocaleString()}
Interest Income:          $${Math.round(n('interest')).toLocaleString()}
Dividend Income:          $${Math.round(n('dividends')).toLocaleString()}
Capital Gains:            $${Math.round(n('capitalGains')).toLocaleString()}
Business Income:          $${Math.round(n('businessIncome')).toLocaleString()}
Rental Income:            $${Math.round(n('rentalIncome')).toLocaleString()}
Retirement Income:        $${Math.round(n('retirementIncome')).toLocaleString()}
Social Security:          $${Math.round(n('socialSecurity')).toLocaleString()}
Other Income:             $${Math.round(n('otherIncome')).toLocaleString()}
                          ─────────────
GROSS INCOME:             $${Math.round(totals.grossIncome).toLocaleString()}

ADJUSTMENTS
---------------------------------------------------------------
Total Adjustments:        -$${Math.round(totals.adjustments).toLocaleString()}
ADJUSTED GROSS INCOME:    $${Math.round(totals.agi).toLocaleString()}

DEDUCTIONS
---------------------------------------------------------------
Method: ${ret.deductionType}
Total Deductions:         -$${Math.round(totals.deductions).toLocaleString()}
TAXABLE INCOME:           $${Math.round(totals.taxableIncome).toLocaleString()}

TAX CALCULATION
---------------------------------------------------------------
Estimated Federal Tax:    $${Math.round(totals.tax).toLocaleString()}
Tax Credits:              -$${Math.round(totals.credits).toLocaleString()}
Tax After Credits:        $${Math.round(totals.taxAfterCredits).toLocaleString()}

PAYMENTS
---------------------------------------------------------------
Federal Withholding:      $${Math.round(n('withholding')).toLocaleString()}
Estimated Payments:       $${Math.round(n('estimatedPayments')).toLocaleString()}
Total Payments:           $${Math.round(totals.payments).toLocaleString()}

RESULT
---------------------------------------------------------------
${totals.refundOrOwed >= 0
  ? `ESTIMATED REFUND:         $${Math.round(totals.refundOrOwed).toLocaleString()}`
  : `BALANCE DUE:              $${Math.round(Math.abs(totals.refundOrOwed)).toLocaleString()}`}

===============================================================
PREPARER DECLARATION
I declare that this return was prepared by the following:
Name:  ${preparer.name || ''}
PTIN:  ${preparer.ptin || ''}
CAF#:  ${preparer.caf || ''}
Date:  ${new Date().toLocaleDateString()}
===============================================================
NOTE: This export is for review and state filing reference.
Submit to the IRS via IRS-approved e-file software (Drake,
ProSeries, Lacerte, etc.) using your EFIN after review.
===============================================================`
}





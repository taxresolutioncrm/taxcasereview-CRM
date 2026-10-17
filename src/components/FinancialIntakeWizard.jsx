import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { FINANCIAL_INTAKE_STEPS, shouldShow } from '../lib/financialIntakeSchema'
import { getStateTaxRate } from '../lib/stateTaxRates'
import { estimateFederalWithholding, estimateFicaWithholding } from '../lib/federalTaxRates'
import { formatMoneyInput, parseMoney, normalizeMoney } from '../lib/money'
import { FIRM, loadFirmBrandingPublic } from '../lib/firmBranding'

const LOGO_URL = ''  // replaced by FIRM.logoUrl

// Renders the submitted answers into an email-safe HTML block, mirroring
// the same step/question iteration FinancialIntakeView.jsx uses in the CRM
// (so what the client receives matches what staff sees) -- just as inline
// HTML strings instead of React, since this needs to go through send-email.
function fmtAnswerVal(v) {
  if (v === undefined || v === null || v === '') return null
  return v
}
function renderAnswersHtml(answers) {
  const sections = FINANCIAL_INTAKE_STEPS.filter(s => s.id !== 'intro' && s.id !== 'done').map(step => {
    const visibleQuestions = step.questions.filter(q => q.type !== 'info' && shouldShow(q, answers))
    const rows = []

    visibleQuestions.forEach(q => {
      if (q.type === 'entries') {
        const entries = answers[q.id] || []
        if (!entries.length) return
        entries.forEach((entry, i) => {
          const fieldRows = q.entryFields.map(f => {
            const v = fmtAnswerVal(entry[f.id])
            if (v === null) return ''
            return `<tr><td style="padding:3px 0;color:#64748b;font-size:12.5px;">${f.label}</td><td style="padding:3px 0;text-align:right;font-weight:600;font-size:12.5px;">${v}</td></tr>`
          }).filter(Boolean).join('')
          if (fieldRows) {
            rows.push(`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px;"><div style="font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;margin-bottom:6px;">${q.label} — Entry ${i+1}</div><table style="width:100%;border-collapse:collapse;">${fieldRows}</table></div>`)
          }
        })
      } else {
        const v = fmtAnswerVal(answers[q.id])
        if (v === null) return
        rows.push(`<tr><td style="padding:5px 0;color:#64748b;font-size:13px;border-bottom:1px solid #f1f5f9;">${q.label}</td><td style="padding:5px 0;text-align:right;font-weight:600;font-size:13px;border-bottom:1px solid #f1f5f9;">${v}</td></tr>`)
      }
    })

    if (!rows.length) return ''
    const isEntryStyle = rows.some(r => r.startsWith('<div'))
    const body = isEntryStyle ? rows.join('') : `<table style="width:100%;border-collapse:collapse;">${rows.join('')}</table>`
    return `<div style="margin-bottom:20px;"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:8px;padding-top:12px;border-top:1px solid #e2e8f0;">${step.title}</div>${body}</div>`
  }).filter(Boolean).join('')

  return sections
}

async function sendIntakeCopyEmail(record) {
  if (!record?.id) return
  await supabase.functions.invoke('send-email', {
    body: { kind:'financial_intake_client_copy', intake_id:String(record.id) }
  })
}

// Shared wizard engine for the Financial Intake — separate from OrganizerWizard
// (Tax Organizer is for return-prep, sent during filing season; this is the
// resolution-case financial breakdown, sent once when a lead becomes a client).
// Persists answers to `financial_intake_responses`, autosaving on every change.
export default function FinancialIntakeWizard({ intakeId, embedded = false, onComplete }) {
  const [firmLogo, setFirmLogo] = useState('')
  const [record, setRecord] = useState(null)
  const [answers, setAnswers] = useState({})
  const [stepIdx, setStepIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [leadState, setLeadState] = useState(null) // for state tax auto-calc
  const [leadInfo, setLeadInfo] = useState(null)   // lead address, for prefills
  const saveTimer = useRef(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.rpc('financial_intake_load', { p_id: intakeId })
      if (error || !data) {
        // No record to source a tenant from → legacy first-row fallback so the
        // error page keeps its branding.
        await loadFirmBrandingPublic()
        setFirmLogo(FIRM.logoUrl || '')
        setError('Financial intake form not found or expired.')
        setLoading(false)
        return
      }
      const rec = data.record
      // Load the intake tenant's branding BEFORE render so FIRM.* interpolations
      // in the JSX are correct on first paint. If the RPC hasn't been extended
      // to return tenant_id yet, tenantHint is undefined and the RPC falls back
      // to the legacy first-row (TCR) — same as before this change.
      await loadFirmBrandingPublic(rec?.tenant_id)
      setFirmLogo(FIRM.logoUrl || '')
      setRecord(rec)
      setAnswers(rec.answers || {})
      if (rec.status === 'Submitted') setSubmitted(true)
      if (data.leadState) setLeadState(data.leadState)
      if (data.lead) {
        setLeadInfo(data.lead)
        if (data.lead.county && !(rec.answers || {}).county) {
          setAnswers(prev => ({ ...prev, county: data.lead.county }))
        }
      }
      setLoading(false)
    }
    if (intakeId) load()
  }, [intakeId])

  function setAnswer(id, value) {
    setAnswers(prev => {
      const next = { ...prev, [id]: value }
      scheduleSave(next)
      return next
    })
  }

  function scheduleSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(next), 900)
  }

  async function doSave(next) {
    setSaving(true)
    await supabase.rpc('financial_intake_save', { p_id: intakeId, p_answers: next })
    setSaving(false)
  }

  function addEntry(questionId, fields) {
    const current = answers[questionId] || []
    const blank = {}
    fields.forEach(f => blank[f.id] = '')
    // First property defaults to the address already on the lead — the client
    // is confirming what kind of property it is, not retyping where they live.
    if (questionId === 'real_estate_list' && current.length === 0 && leadInfo) {
      const line = [leadInfo.street, leadInfo.city, leadInfo.state, leadInfo.zip]
        .filter(Boolean).join(' ').trim()
      if (line) blank.address = line
    }
    setAnswer(questionId, [...current, blank])
  }
  // Federal and FICA are identical in every state, so neither waits on the
  // county — only the state line needs a jurisdiction, and without a county we
  // leave it alone rather than guess. A 0% state (FL, TX) still fills a real 0.
  function applyWithholding(entry, grossValue) {
    const gross = parseFloat(grossValue || 0)
    const next = { ...entry }
    if (!gross) return next

    if (!next.fed_withheld_manual) {
      next.fed_withheld = estimateFederalWithholding(gross, answers.filing_status)
    }
    if (!next.ss_med_withheld_manual) {
      next.ss_med_withheld = estimateFicaWithholding(gross)
    }
    if (!next.state_withheld_manual && leadState && (answers.county || '').trim()) {
      const rate = getStateTaxRate(leadState)
      if (rate !== null) next.state_withheld = Math.round(gross * rate * 100) / 100
    }
    return next
  }

  // Gross pay entered before these estimates existed — or on a form the client
  // is resuming — would otherwise sit next to empty withholding boxes until
  // someone happened to retype the gross figure.
  useEffect(() => {
    const jobs = answers.jobs_list
    if (!Array.isArray(jobs) || !jobs.length) return
    let changed = false
    const filled = jobs.map(j => {
      if (!j?.gross_monthly) return j
      const missing = [j.fed_withheld, j.ss_med_withheld].some(v => v === '' || v === undefined || v === null)
      if (!missing) return j
      changed = true
      return applyWithholding(j, j.gross_monthly)
    })
    if (changed) setAnswer('jobs_list', filled)
  }, [answers.jobs_list, answers.filing_status, leadState, answers.county])

  function updateEntry(questionId, idx, fieldId, value) {
    const current = [...(answers[questionId] || [])]
    current[idx] = { ...current[idx], [fieldId]: value }

    // Typing in a withholding box marks it as the client's own figure, so a
    // later change to gross pay never overwrites what they read off a stub.
    if (questionId === 'jobs_list' && ['fed_withheld','ss_med_withheld','state_withheld'].includes(fieldId)) {
      current[idx] = { ...current[idx], [fieldId + '_manual']: true }
    }

    // Changing gross pay recalculates every withholding line the client hasn't
    // overridden. This recalculates rather than only filling blanks: an
    // estimate left over from a previous gross figure is wrong, not stale.
    if (questionId === 'jobs_list' && fieldId === 'gross_monthly') {
      current[idx] = applyWithholding(current[idx], value)
    }

    setAnswer(questionId, current)
  }
  function removeEntry(questionId, idx) {
    const current = [...(answers[questionId] || [])]
    current.splice(idx, 1)
    setAnswer(questionId, current)
  }

  async function submit() {
    setSaving(true)
    let submitResult = null

    // Core lead fields to sync — the RPC applies these non-destructively
    // (COALESCE keeps whatever's already on the lead record), same intent
    // as the old "only fill blanks" check, just enforced server-side now.
    const leadPatch = {}
    if (answers.dob) leadPatch.dob = answers.dob
    if (answers.filing_status) {
      leadPatch.filingStatus = answers.filing_status === 'Widowed' ? 'Qualifying Widow(er)' : answers.filing_status
    }
    if (answers.county) leadPatch.county = answers.county

    // ── Comprehensive sync into client_financial_profiles ──────────────────
    // Maps all income, asset, expense, and debt answers into the structured
    // profile the tax associate will review on the Financial Profile tabs
    // (I&E, TO Intake, Assets & Equity). Non-destructive: upserts only --
    // if a profile row already exists and a field is already filled in by a
    // tax associate, we leave it alone and only fill blanks. This means a
    // rep who did a quick intake over the phone and typed some notes won't
    // get their work overwritten if the client later submits the wizard.
    try {
      const a = answers
      const n = v => parseFloat(v) || 0
      // Intake collects display labels; the profile's Assets & Equity tab
      // keys off specific internal type strings.
      const assetTypeToProfile = label => ({
        'Bank Account': 'bank_account',
        'Retirement Account (401k/IRA)': 'retirement',
        'Life Insurance (cash value)': 'life_insurance',
        'Business Asset': 'business_asset',
        'Other': 'additional_asset',
      }[label] || 'additional_asset')

      // Employment — wizard supports multiple jobs via `jobs_list` entries.
      // Map the first two taxpayer jobs and first two spouse jobs into the
      // four flat employment blocks the Financial Profile uses.
      const jobs = a.jobs_list || []
      const myJobs = jobs.filter(j => j.whose_job !== "My Spouse's")
      const spouseJobs = jobs.filter(j => j.whose_job === "My Spouse's")
      function mapJob(j) {
        if (!j) return {}
        return {
          employer: j.employer || '',
          position: j.position || '',
          length_employed: j.length_employed || '',
          pay_frequency: j.pay_frequency || '',
          gross_monthly_salary: n(j.gross_monthly), // profile uses gross_monthly_salary
          fed_withheld: n(j.fed_withheld),
          ss_med_withheld: n(j.ss_med_withheld),
          state_withheld: n(j.state_withheld),
        }
      }

      // Business — first two businesses from the wizard
      const businesses = a.business_list || []
      function mapBiz(b) {
        if (!b) return {}
        return {
          name: b.business_name || '',        // profile uses 'name' not 'business_name'
          ein: b.ein || '',
          structure: b.structure || '',
          pct_ownership: b.pct_ownership || '',
          num_employees: b.num_employees || '',
          net_income: n(b.net_income_monthly), // profile uses 'net_income' not 'net_income_monthly'
          current_941: b.current_941 || '',
          notes: b.notes || '',
        }
      }

      // Other income rows
      const otherIncome = (a.other_income_list || []).map(r => ({
        source: r.source || '',
        amount: n(r.monthly_amount),
      }))

      // Real estate rows
      const realEstate = (a.real_estate_list || []).map(r => ({
        address: r.address || '',
        property_type: r.property_type || '',
        zillow_value: n(r.estimated_value),   // profile uses zillow_value, not estimated_value
        mortgage_balance: n(r.mortgage_balance),
        mortgage_1: n(r.monthly_payment),     // profile reads mortgage_1/mortgage_2 for the housing expense calc
        rental_income: n(r.rental_income),
      }))

      // Vehicles rows
      const vehicles = (a.vehicles_list || []).map(v => ({
        make_model: v.make_model || '',
        kbb_value: n(v.estimated_value),      // profile uses kbb_value, not estimated_value
        remaining_balance: n(v.remaining_balance),
        monthly_payment: n(v.monthly_payment),
      }))

      // Financial assets (bank/retirement/insurance)
      const assets = (a.assets_list || []).map(asset => ({
        type: assetTypeToProfile(asset.asset_type),  // profile uses 'type', not 'asset_type', with different value strings
        description: asset.description || '',
        value: n(asset.value),
        loan_against: n(asset.loan_against),
      }))

      // Credit cards
      const creditCards = (a.credit_cards_list || []).map(c => ({
        name: c.card_name || '',        // profile uses 'name', not 'card_name'
        balance: n(c.balance),
        limit: n(c.credit_limit),       // profile uses 'limit', not 'credit_limit'
        min_payment: n(c.min_payment),
      }))

      // Expenses -- the intake only collects combined totals for a few
      // categories the profile splits into sub-fields (e.g. one "health
      // insurance" number vs. the profile's major-medical/dental/vision
      // split). Since I&E totals are purely additive across sub-fields,
      // mapping the combined intake number into one sub-field keeps the
      // total correct; the breakdown itself can be refined manually later.
      const expenses = {
        food_clothing: n(a.food_clothing),
        housing: n(a.housing_payment),
        homeowners_insurance: n(a.homeowners_renters_insurance),
        property_taxes: n(a.property_taxes),
        hoa_dues: n(a.hoa_dues),
        electricity: n(a.electricity),
        water_sewer_trash: n(a.water_sewer_trash),
        cell_phone: n(a.cell_phone),
        internet: n(a.internet),
        cable: n(a.cable),
        maintenance: n(a.maintenance),
        public_transportation: n(a.public_transportation),
        car_misc: n(a.car_misc),
        health_major_medical: n(a.health_insurance),
        health_dental: n(a.health_dental_vision),
        health_oop: n(a.health_oop),
        child_care: n(a.child_care),
        child_support: n(a.child_support),
        court_judgment: n(a.court_judgment),
        life_term: n(a.life_insurance),
        irs_installment: n(a.irs_installment),
        state_installment: n(a.state_installment),
      }


      // Other secured debt summary
      // Per-loan entries roll up into the profile's single Other Secured Debt
      // block, but the type breakdown is kept so the associate can see what the
      // debt actually is. Falls back to the old flat fields for intakes that
      // were filled in before the per-loan split.
      const debtRows = (a.other_debt_list || []).filter(r => r && (r.monthly_payment || r.remaining_balance || r.loan_type))
      const otherSecuredDebt = a.has_other_debt === 'Yes'
        ? (debtRows.length
            ? {
                monthly_payment: debtRows.reduce((t, r) => t + n(r.monthly_payment), 0),
                remaining_balance: debtRows.reduce((t, r) => t + n(r.remaining_balance), 0),
                breakdown: debtRows.map(r => ({
                  loan_type: r.loan_type || 'Other',
                  lender: r.lender || '',
                  monthly_payment: n(r.monthly_payment),
                  remaining_balance: n(r.remaining_balance),
                })),
              }
            : { monthly_payment: n(a.other_debt_payment), remaining_balance: n(a.other_debt_balance) })
        : {}

      const profileData = {
        client_name: record.client_name,
        // Household/basic fields
        dob: a.dob || null,
        county: a.county || '',
        filing_status: a.filing_status || '',
        household_under_65: n(a.household_under_65),
        household_over_65: n(a.household_over_65),
        tax_years_not_filed: a.tax_years_not_filed || '',
        has_lived_other_states: a.lived_other_states || '',
        other_states_notes: a.other_states_notes || '',
        // Employment
        employment_taxpayer_1: myJobs[0] ? mapJob(myJobs[0]) : undefined,
        employment_taxpayer_2: myJobs[1] ? mapJob(myJobs[1]) : undefined,
        employment_spouse_1: spouseJobs[0] ? mapJob(spouseJobs[0]) : undefined,
        employment_spouse_2: spouseJobs[1] ? mapJob(spouseJobs[1]) : undefined,
        // Business
        business_1: businesses[0] ? mapBiz(businesses[0]) : undefined,
        business_2: businesses[1] ? mapBiz(businesses[1]) : undefined,
        // Other income, real estate, vehicles, assets
        other_income: otherIncome.length ? otherIncome : undefined,
        real_estate: realEstate.length ? realEstate : undefined,
        vehicles: vehicles.length ? vehicles : undefined,
        assets: assets.length ? assets : undefined,
        cash_on_hand: n(a.cash_on_hand),
        // Debts
        credit_cards: creditCards.length ? creditCards : undefined,
        other_secured_debt: Object.keys(otherSecuredDebt).length ? otherSecuredDebt : undefined,
        // Monthly expenses
        expenses,
        updated_at: new Date().toISOString(),
      }

      // Strip undefined values -- only upsert fields the intake actually
      // collected so we don't accidentally zero out a field the tax associate
      // typed in manually just because this intake question was optional and
      // left blank.
      const cleanProfile = Object.fromEntries(
        Object.entries(profileData).filter(([, v]) => v !== undefined)
      )

      // Single server-side call: marks the intake Submitted, applies the
      // lead patch non-destructively, upserts the financial profile, and
      // creates a task + lead note — all inside one SECURITY DEFINER RPC.
      // Returns the assigned rep's email (if any) so we can notify them.
      const { data } = await supabase.rpc('financial_intake_submit', {
        p_id: intakeId,
        p_answers: answers,
        p_lead_patch: leadPatch,
        p_profile: cleanProfile,
      })
      submitResult = data
    } catch (e) { console.error('Financial intake -> financial profile sync error:', e) }

    // Notify the assigned rep that a client just submitted their intake.
    try {
      if (submitResult?.assigneeEmail && record?.id) {
        await supabase.functions.invoke('send-email', {
          body: { kind:'financial_intake_staff_notification', intake_id:String(record.id) }
        })
      }
    } catch (e) { console.error('Financial intake staff notification error:', e) }

    // Email a full copy of the submitted answers to the client.
    try { await sendIntakeCopyEmail(record) } catch (e) { console.error('Financial intake copy email error:', e) }
    setSaving(false)
    setSubmitted(true)
    if (onComplete) onComplete()
  }

  if (loading) return <div style={S.center}>Loading…</div>
  if (error) return <div style={S.center}>{error}</div>

  if (submitted) return (
    <div style={S.card}>
      <div style={{textAlign:'center', padding:'32px 16px'}}>
        <div style={{fontSize:48, marginBottom:12}}>✅</div>
        <div style={{fontSize:19, fontWeight:800, color:'#4ade80', marginBottom:8}}>Submitted — Thank You!</div>
        <div style={{color:'#94a3b8', fontSize:13.5, lineHeight:1.7}}>
          Thank you{record?.client_name ? `, ${record.client_name}` : ''}. Your financial information has been sent to {FIRM.name || 'your advisor'}, and your advisor will be reaching out soon.
          {!embedded && ' You may close this window.'}
        </div>
      </div>
    </div>
  )

  const visibleSteps = FINANCIAL_INTAKE_STEPS
  const step = visibleSteps[stepIdx]
  const visibleQuestions = step.questions.filter(q => shouldShow(q, answers))
  const isLast = stepIdx === visibleSteps.length - 1
  const isFirst = stepIdx === 0
  const progressPct = Math.round(((stepIdx + 1) / visibleSteps.length) * 100)

  return (
    <div style={S.card}>
      {!embedded && (
        <div style={{textAlign:'center', marginBottom:18}}>
          <img src={FIRM.logoUrl} style={{height:42, marginBottom:8}} onError={e=>e.target.style.display='none'}/>
          <div style={{fontSize:11, fontWeight:800, color:'#60a5fa', letterSpacing:'.1em', textTransform:'uppercase'}}>${FIRM.name}</div>
          <div style={{fontSize:11, color:'#64748b'}}>Financial Intake</div>
        </div>
      )}

      {/* Progress bar */}
      <div style={{marginBottom:18}}>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'#64748b', marginBottom:6}}>
          <span>Step {stepIdx+1} of {visibleSteps.length}</span>
          <span>{saving ? 'Saving…' : 'Saved'}</span>
        </div>
        <div style={{height:6, background:'#1e293b', borderRadius:3, overflow:'hidden'}}>
          <div style={{height:'100%', width:`${progressPct}%`, background:'#3b82f6', transition:'width .3s'}}/>
        </div>
      </div>

      <div style={{fontSize:18, fontWeight:800, color:'#f1f5f9', marginBottom:16}}>{step.title}</div>

      <div>
        {visibleQuestions.map(q => (
          <Question key={q.id} q={q} answers={answers} setAnswer={setAnswer}
            addEntry={addEntry} updateEntry={updateEntry} removeEntry={removeEntry} leadState={leadState}/>
        ))}
      </div>

      <div style={{display:'flex', gap:10, marginTop:24}}>
        {!isFirst && (
          <button onClick={()=>setStepIdx(i=>i-1)} style={S.btnSecondary}>← Back</button>
        )}
        {!isLast ? (
          <button onClick={()=>setStepIdx(i=>i+1)} style={S.btnPrimary}>Next →</button>
        ) : (
          <button onClick={submit} disabled={saving} style={S.btnSubmit}>{saving ? 'Submitting…' : 'Submit'}</button>
        )}
      </div>
    </div>
  )
}

function Question({ q, answers, setAnswer, addEntry, updateEntry, removeEntry, leadState }) {
  const val = answers[q.id]

  if (q.type === 'info') {
    return <div style={{...S.docBody, whiteSpace:'pre-wrap'}}>{q.text}</div>
  }

  return (
    <div style={{marginBottom:18}}>
      <label style={S.label}>{q.label}{q.optional && <span style={{color:'#64748b', fontWeight:400}}> (optional)</span>}</label>

      {q.type === 'yesno' && (
        <div style={{display:'flex', gap:10}}>
          {['Yes','No'].map(opt => (
            <button key={opt} onClick={()=>setAnswer(q.id, opt)} style={val===opt ? S.toggleActive : S.toggle}>{opt}</button>
          ))}
        </div>
      )}

      {q.type === 'select' && (
        <select value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={S.input}>
          <option value="">— Select —</option>
          {q.options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      )}

      {q.type === 'text' && (
        <input type="text" value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} placeholder={q.placeholder||''} style={S.input}/>
      )}

      {q.type === 'textarea' && (
        <textarea value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={{...S.input, minHeight:80, resize:'vertical'}}/>
      )}

      {q.type === 'number' && (
        // Text rather than number: a number input refuses to display commas,
        // and these figures get read back to clients. parseMoney strips the
        // separators again before anything is stored.
        <input type="text" inputMode="decimal" value={formatMoneyInput(val)}
          onChange={e=>setAnswer(q.id, parseMoney(e.target.value))}
          onBlur={e=>setAnswer(q.id, normalizeMoney(e.target.value))} style={S.input}/>
      )}

      {q.type === 'date' && (
        <input type="date" value={val||''} onChange={e=>setAnswer(q.id, e.target.value)} style={S.input}/>
      )}

      {q.type === 'entries' && (
        <div>
          {(val||[]).map((entry, idx) => (
            <div key={idx} style={{background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:8, padding:14, marginBottom:10}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
                <div style={{fontSize:11, fontWeight:700, color:'#60a5fa', textTransform:'uppercase'}}>Entry #{idx+1}</div>
                <button onClick={()=>removeEntry(q.id, idx)} style={{...S.linkBtn, color:'#f87171'}}>Remove</button>
              </div>
              {q.entryFields.map(f => (
                <div key={f.id} style={{marginBottom:8}}>
                  <div style={{fontSize:11, color:'#94a3b8', marginBottom:3}}>{f.label}{f.optional && ' (optional)'}</div>
                  {f.type === 'select' ? (
                    <select value={entry[f.id]||''} onChange={e=>updateEntry(q.id, idx, f.id, e.target.value)} style={S.inputSm}>
                      <option value="">— Select —</option>
                      {f.options.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'yesno' ? (
                    <div style={{display:'flex', gap:8}}>
                      {['Yes','No'].map(opt=>(
                        <button key={opt} onClick={()=>updateEntry(q.id, idx, f.id, opt)}
                          style={entry[f.id]===opt ? {...S.toggleActive, padding:'4px 14px', fontSize:12} : {...S.toggle, padding:'4px 14px', fontSize:12}}>{opt}</button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <input
                        type={f.type === 'date' ? 'date' : 'text'}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        placeholder={f.placeholder||''}
                        value={f.type === 'number' ? formatMoneyInput(entry[f.id]) : (entry[f.id]||'')}
                        onChange={e=>updateEntry(q.id, idx, f.id, f.type === 'number' ? parseMoney(e.target.value) : e.target.value)}
                        onBlur={f.type === 'number' ? (e=>updateEntry(q.id, idx, f.id, normalizeMoney(e.target.value))) : undefined}
                        style={S.inputSm}/>
                      {(f.id === 'fed_withheld' || f.id === 'ss_med_withheld') && (
                        <div style={{fontSize:10, color:'#60a5fa', marginTop:3}}>
                          Calculated from your gross pay{f.id === 'fed_withheld' ? ' and filing status' : ''}. You can override this.
                        </div>
                      )}
                      {f.id === 'state_withheld' && leadState && getStateTaxRate(leadState) !== null && (
                        <div style={{fontSize:10, color:'#60a5fa', marginTop:3}}>
                          Auto-estimated from {leadState} state tax rate ({Math.round((getStateTaxRate(leadState)||0)*100)}%) based on the county you entered. You can override this.
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          <button onClick={()=>addEntry(q.id, q.entryFields)} style={S.btnAdd}>+ Add Entry</button>
        </div>
      )}
    </div>
  )
}

const S = {
  center: { display:'flex', alignItems:'center', justifyContent:'center', minHeight:300, color:'#64748b', fontSize:13 },
  card: { background:'#0f172a', border:'1px solid #1e293b', borderRadius:14, padding:'24px 22px', maxWidth:560, margin:'0 auto', width:'100%' },
  label: { display:'block', fontSize:13, fontWeight:700, color:'#e2e8f0', marginBottom:8 },
  input: { width:'100%', padding:'10px 12px', background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:8, color:'#f1f5f9', fontSize:13.5, boxSizing:'border-box' },
  inputSm: { width:'100%', padding:'7px 10px', background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:6, color:'#f1f5f9', fontSize:12.5, boxSizing:'border-box' },
  toggle: { padding:'8px 22px', borderRadius:7, border:'1px solid #334155', background:'#0a1628', color:'#94a3b8', fontSize:13, fontWeight:600, cursor:'pointer' },
  toggleActive: { padding:'8px 22px', borderRadius:7, border:'1px solid #3b82f6', background:'#1d4ed8', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' },
  btnPrimary: { flex:1, padding:'13px', background:'#1d4ed8', color:'#fff', border:'none', borderRadius:9, fontSize:14, fontWeight:700, cursor:'pointer' },
  btnSecondary: { padding:'13px 20px', background:'transparent', color:'#94a3b8', border:'1px solid #334155', borderRadius:9, fontSize:14, fontWeight:600, cursor:'pointer' },
  btnSubmit: { flex:1, padding:'13px', background:'#16a34a', color:'#fff', border:'none', borderRadius:9, fontSize:14, fontWeight:700, cursor:'pointer' },
  btnAdd: { padding:'8px 16px', background:'transparent', border:'1px dashed #3b82f6', color:'#60a5fa', borderRadius:7, fontSize:12.5, fontWeight:600, cursor:'pointer' },
  linkBtn: { background:'none', border:'none', color:'#64748b', fontSize:11.5, cursor:'pointer', textDecoration:'underline', padding:0 },
  docBody: { background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:9, padding:16, fontSize:13, lineHeight:1.7, color:'#cbd5e1' },
}

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { FINANCIAL_INTAKE_STEPS, shouldShow } from '../lib/financialIntakeSchema'

function fmtVal(v) {
  if (v === undefined || v === null || v === '') return null
  return v
}

function EntryCard({ entry, fields }) {
  return (
    <div style={{background:'var(--s2)', border:'1px solid var(--br)', borderRadius:8, padding:'10px 12px', marginBottom:8}}>
      {fields.map(f => {
        const v = fmtVal(entry[f.id])
        if (v === null) return null
        return (
          <div key={f.id} style={{display:'flex', justifyContent:'space-between', gap:10, fontSize:12.5, padding:'3px 0'}}>
            <span style={{color:'var(--t3)'}}>{f.label}</span>
            <span style={{color:'var(--tx)', fontWeight:600, textAlign:'right'}}>{v}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function FinancialIntakeView({ clientName }) {
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [clientName])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('financial_intake_responses')
      .select('*').eq('client_name', clientName).order('created_at', { ascending: false }).limit(1).maybeSingle()
    setRecord(data || null)
    setLoading(false)
  }

  if (loading) return <div style={{padding:16, color:'var(--t3)', fontSize:13}}>Loading…</div>

  if (!record) return (
    <div style={{padding:16, color:'var(--t3)', fontSize:13, textAlign:'center'}}>
      No financial intake has been sent yet.
    </div>
  )

  const answers = record.answers || {}
  const intakeUrl = window.location.origin + '/financial-intake/' + record.id
  const linkActive = !record.public_access_revoked_at && Date.parse(record.public_access_expires_at || '') > Date.now()

  return (
    <div style={{padding:16}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10}}>
        <div>
          <span className={`bdg ${record.status==='Submitted' ? 'bg' : 'ba'}`} style={{fontSize:12}}>
            {record.status==='Submitted' ? '✅ Submitted' : '⏳ Sent — Not Yet Submitted'}
          </span>
          {record.submitted_at && <span style={{marginLeft:10, fontSize:12, color:'var(--t3)'}}>Submitted {new Date(record.submitted_at).toLocaleString()}</span>}
        </div>
        {linkActive ? <a href={intakeUrl} target="_blank" rel="noreferrer" style={{fontSize:12, color:'var(--blue)'}}>Open form ↗</a> : <span style={{fontSize:12,color:'var(--t3)'}}>Link expired or revoked · Send a new Financial Intake link</span>}
      </div>

      {FINANCIAL_INTAKE_STEPS.filter(s => s.id !== 'intro' && s.id !== 'done').map(step => {
        const visibleQuestions = step.questions.filter(q => q.type !== 'info' && shouldShow(q, answers))
        const hasAnyAnswer = visibleQuestions.some(q => {
          if (q.type === 'entries') return (answers[q.id] || []).length > 0
          return fmtVal(answers[q.id]) !== null
        })
        if (!hasAnyAnswer) return null

        return (
          <div key={step.id} style={{marginBottom:18}}>
            <div style={{fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--t3)', marginBottom:8, paddingTop:10, borderTop:'1px solid var(--br)'}}>{step.title}</div>
            {visibleQuestions.map(q => {
              if (q.type === 'entries') {
                const entries = answers[q.id] || []
                if (!entries.length) return null
                return (
                  <div key={q.id} style={{marginBottom:10}}>
                    <div style={{fontSize:12.5, color:'var(--t3)', marginBottom:6}}>{q.label}</div>
                    {entries.map((entry, i) => <EntryCard key={i} entry={entry} fields={q.entryFields}/>)}
                  </div>
                )
              }
              const v = fmtVal(answers[q.id])
              if (v === null) return null
              return (
                <div key={q.id} style={{display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'5px 0', borderBottom:'1px solid var(--br)'}}>
                  <span style={{color:'var(--t3)'}}>{q.label}</span>
                  <span style={{color:'var(--tx)', fontWeight:600, textAlign:'right'}}>{v}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

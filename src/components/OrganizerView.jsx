import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ORGANIZER_STEPS, shouldShow } from '../lib/organizerSchema'

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

// Tax Organizer is sent per filing year (unlike Financial Intake, which is a
// single one-time form) — a long-tenured client can accumulate a record per
// year. Rather than a list that keeps growing, this shows a year picker with
// status baked into each option, defaulting to the most recent year, so the
// page never gets longer no matter how many years pile up.
export default function OrganizerView({ clientName }) {
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [clientName])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('tax_organizer_responses')
      .select('*').eq('client_name', clientName).order('tax_year', { ascending: false }).order('created_at', { ascending: false })
    setRecords(data || [])
    setSelectedId(data && data.length ? data[0].id : null)
    setLoading(false)
  }

  if (loading) return <div style={{padding:16, color:'var(--t3)', fontSize:13}}>Loading…</div>

  if (!records.length) return (
    <div style={{padding:16, color:'var(--t3)', fontSize:13, textAlign:'center'}}>
      No tax organizer has been sent yet. Use the "Tax Organizer" Quick Action above to send one for a filing year.
    </div>
  )

  const record = records.find(r => r.id === selectedId) || records[0]
  const answers = record.answers || {}
  const organizerUrl = window.location.origin + '/organizer/' + record.id
  const linkActive = !record.public_access_revoked_at && Date.parse(record.public_access_expires_at || '') > Date.now()

  return (
    <div style={{padding:16}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10}}>
        <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{fontSize:12.5,fontWeight:700,maxWidth:260}}>
          {records.map(r => (
            <option key={r.id} value={r.id}>{r.tax_year} — {r.status === 'Submitted' ? 'Submitted' : 'Sent, Not Yet Submitted'}</option>
          ))}
        </select>
        {linkActive ? <a href={organizerUrl} target="_blank" rel="noreferrer" style={{fontSize:12, color:'var(--blue)'}}>Open form ↗</a> : <span style={{fontSize:12,color:'var(--t3)'}}>Link expired or revoked · Send a new Tax Organizer link</span>}
      </div>
      <div style={{marginBottom:14}}>
        <span className={`bdg ${record.status==='Submitted' ? 'bg' : 'ba'}`} style={{fontSize:12}}>
          {record.status==='Submitted' ? '✅ Submitted' : '⏳ Sent — Not Yet Submitted'}
        </span>
        {record.submitted_at && <span style={{marginLeft:10, fontSize:12, color:'var(--t3)'}}>Submitted {new Date(record.submitted_at).toLocaleString()}</span>}
      </div>

      {ORGANIZER_STEPS.filter(s => s.id !== 'intro' && s.id !== 'done').map(step => {
        const visibleQuestions = step.questions.filter(q => q.type !== 'info' && q.type !== 'upload' && shouldShow(q, answers))
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

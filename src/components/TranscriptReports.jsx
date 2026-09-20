import { useMemo, useState } from 'react'

const TABS = [
  'Account Overview',
  'CSED Calculations',
  'Penalties and Interest',
  'Payment History',
  'Bankruptcy',
  'Account Transactions',
  'Assessment Overview',
  'Documents',
]

function txRows(rows) {
  return rows.flatMap(r => (r.raw_analysis?.transactions || []).map(t => ({
    ...t,
    tax_year: r.tax_year,
    transcript_type: r.transcript_type,
    analysis_id: r.id,
  })))
}

function tableWrap(children) {
  return <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>{children}</div>
}

export default function TranscriptReports({ rows, money, openTranscriptFile }) {
  const [tab, setTab] = useState('Account Overview')
  const transactions = useMemo(() => txRows(rows), [rows])
  const payments = useMemo(() => transactions.filter(t => /payment|credit|refund|estimated tax|withholding/i.test(String(t.description || ''))), [transactions])
  const penalties = useMemo(() => transactions.filter(t => /penalt|interest/i.test(String(t.description || ''))), [transactions])
  const bankruptcy = useMemo(() => transactions.filter(t => ['520','521'].includes(String(t.code || '')) || /bankrupt/i.test(String(t.description || ''))), [transactions])
  const assessments = useMemo(() => transactions.filter(t => ['150','290','300','308'].includes(String(t.code || '')) || /assess|tax return filed/i.test(String(t.description || ''))), [transactions])

  const txTable = (items, empty) => items.length === 0
    ? <div style={{ color: 'var(--t3)', fontSize: 12, padding: 12 }}>{empty}</div>
    : tableWrap(
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <thead><tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
          {['Year','Code','Date','Description','Amount'].map(h => <th key={h} style={{ padding: '7px 10px', fontWeight: 600 }}>{h}</th>)}
        </tr></thead>
        <tbody>{items.map((t,i) => <tr key={t.analysis_id + ':' + i} style={{ borderTop: '1px solid var(--line)' }}>
          <td style={{ padding: '7px 10px', fontWeight: 700 }}>{t.tax_year || '—'}</td>
          <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{t.code || '—'}</td>
          <td style={{ padding: '7px 10px', color: 'var(--t2)' }}>{t.date || '—'}</td>
          <td style={{ padding: '7px 10px' }}>{t.description || '—'}</td>
          <td style={{ padding: '7px 10px', textAlign: 'right' }}>{money(t.amount)}</td>
        </tr>)}</tbody>
      </table>
    )

  return (
    <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {TABS.map(name => (
          <button key={name} className={tab === name ? 'btn' : 'btn sec'} style={{ fontSize: 10.5, padding: '4px 8px' }} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>

      {tab === 'Account Overview' && tableWrap(
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
            {['Period','Type','Return Filed','Filing Date','Filing Status','Principal Tax','Interest','Penalties','Payments / Credits','Refunds'].map(h =>
              <th key={h} style={{ padding: '7px 9px', fontWeight: 600 }}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map(r => {
            const a = r.raw_analysis || {}
            const tx = a.transactions || []
            const payments = tx.filter(t => /payment|credit|withholding|estimated tax/i.test(String(t.description || ''))).reduce((n,t) => n + Math.abs(Number(t.amount || 0)),0)
            const refunds = tx.filter(t => /refund/i.test(String(t.description || ''))).reduce((n,t) => n + Math.abs(Number(t.amount || 0)),0)
            const filed = r.flags?.unfiled_return ? 'No record' : (a.return_filed_date ? 'Yes' : '—')
            return <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '7px 9px', fontWeight: 700 }}>{r.tax_year || '—'}</td>
              <td style={{ padding: '7px 9px' }}>{r.transcript_type || '—'}</td>
              <td style={{ padding: '7px 9px' }}>{filed}</td>
              <td style={{ padding: '7px 9px' }}>{a.return_filed_date || '—'}</td>
              <td style={{ padding: '7px 9px' }}>{a.filing_status || '—'}</td>
              <td style={{ padding: '7px 9px', textAlign: 'right' }}>{money(r.total_balance)}</td>
              <td style={{ padding: '7px 9px', textAlign: 'right' }}>{money(r.accrued_interest)}</td>
              <td style={{ padding: '7px 9px', textAlign: 'right' }}>{money(r.accrued_penalty)}</td>
              <td style={{ padding: '7px 9px', textAlign: 'right' }}>{payments ? money(payments) : '—'}</td>
              <td style={{ padding: '7px 9px', textAlign: 'right' }}>{refunds ? money(refunds) : '—'}</td>
            </tr>
          })}</tbody>
        </table>
      )}

      {tab === 'CSED Calculations' && (
        <div>
          {tableWrap(<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
              {['Period','Assessment Date','Base 10-Year Date','Known Tolling Indicator','Review'].map(h => <th key={h} style={{ padding: '7px 10px', fontWeight: 600 }}>{h}</th>)}
            </tr></thead>
            <tbody>{rows.map(r => {
              const tx = r.raw_analysis?.transactions || []
              const toll = tx.some(t => /bankrupt|offer in compromise|collection due process|cdp|outside the country|military/i.test(String(t.description || '')))
              return <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '7px 10px', fontWeight: 700 }}>{r.tax_year || '—'}</td>
                <td style={{ padding: '7px 10px' }}>{r.assessment_date || '—'}</td>
                <td style={{ padding: '7px 10px' }}>{r.csed_estimate || '—'}</td>
                <td style={{ padding: '7px 10px' }}>{toll ? 'Yes — inspect transactions' : 'None detected'}</td>
                <td style={{ padding: '7px 10px', color: 'var(--t3)' }}>Verify IRS CSED before relying on this estimate.</td>
              </tr>
            })}</tbody>
          </table>)}
        </div>
      )}

      {tab === 'Penalties and Interest' && (
        <div>
          {tableWrap(<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead><tr style={{ color: 'var(--t3)', textAlign: 'left' }}>
              {['Period','Accrued Penalty','Accrued Interest','Balance'].map(h => <th key={h} style={{ padding: '7px 10px', fontWeight: 600 }}>{h}</th>)}
            </tr></thead>
            <tbody>{rows.map(r => <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '7px 10px', fontWeight: 700 }}>{r.tax_year || '—'}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right' }}>{money(r.accrued_penalty)}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right' }}>{money(r.accrued_interest)}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right' }}>{money(r.total_balance)}</td>
            </tr>)}</tbody>
          </table>)}
          <div style={{ marginTop: 10 }}>{txTable(penalties, 'No penalty or interest transaction lines were extracted.')}</div>
        </div>
      )}

      {tab === 'Payment History' && txTable(payments, 'No payment, credit, withholding, estimated-tax, or refund transaction lines were extracted.')}
      {tab === 'Bankruptcy' && txTable(bankruptcy, 'No bankruptcy indicators were extracted from the available transcript transactions.')}
      {tab === 'Account Transactions' && txTable(transactions, 'No account transaction lines were extracted.')}
      {tab === 'Assessment Overview' && txTable(assessments, 'No assessment transaction lines were extracted.')}

      {tab === 'Documents' && (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{r.tax_year || 'Unknown year'} · {r.transcript_type || 'Transcript'}</div>
                <div style={{ color: 'var(--t3)', fontSize: 10.5 }}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</div>
              </div>
              {(r.file_url || r.file_path) ? <button className="btn sec" style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => openTranscriptFile(r)}>Open PDF</button> : <span style={{ color: 'var(--t3)', fontSize: 11 }}>No PDF stored</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

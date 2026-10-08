import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

const DOC_TYPES = {
  'W-2': ['box1_wages','box2_federal_withheld','box3_ss_wages','box4_ss_withheld','box5_medicare_wages','box6_medicare_withheld','box12a_code','box12a_amount','box16_state_wages','box17_state_tax','employer_name','employer_ein','employee_ssn'],
  '1099-NEC': ['payer_name','payer_ein','recipient_ssn','box1_nonemployee_comp','box4_federal_withheld'],
  '1099-INT': ['payer_name','box1_interest_income','box4_federal_withheld','box8_tax_exempt_interest'],
  '1099-DIV': ['payer_name','box1a_total_dividends','box1b_qualified_dividends','box2a_capital_gain_distrib','box4_federal_withheld'],
  '1099-R': ['payer_name','box1_gross_distribution','box2a_taxable_amount','box4_federal_withheld','box7_distribution_code'],
  '1099-G': ['payer_name','box1_unemployment_comp','box4_federal_withheld','box10a_state'],
  'K-1 (1065)': ['partner_name','partner_ein','box1_ordinary_income','box2_rental_income','box5_interest','box6a_dividends','box9a_capital_gain'],
  'K-1 (1120-S)': ['shareholder_name','corporation_ein','box1_ordinary_income','box2_rental_income','box5_interest','box6a_dividends','box9_capital_gain','box16_items'],
  'Schedule C (prior)': ['business_name','business_ein','gross_receipts','returns_allowances','cost_of_goods','gross_profit','advertising','car_truck','commissions','contract_labor','depletion','depreciation','employee_benefits','insurance','interest_mortgage','interest_other','legal_professional','office_expense','pension_profit','rent_lease_vehicles','rent_lease_other','repairs','supplies','taxes_licenses','travel','meals','utilities','wages','other_expenses','net_profit'],
  'Other': ['description','amount','date','payer_name','recipient_name'],
}

const FIELD_LABELS = {
  box1_wages: 'Box 1 — Wages, Tips', box2_federal_withheld: 'Box 2 — Federal Withheld',
  box3_ss_wages: 'Box 3 — SS Wages', box4_ss_withheld: 'Box 4 — SS Withheld',
  box5_medicare_wages: 'Box 5 — Medicare Wages', box6_medicare_withheld: 'Box 6 — Medicare Withheld',
  box12a_code: 'Box 12a Code', box12a_amount: 'Box 12a Amount',
  box16_state_wages: 'Box 16 — State Wages', box17_state_tax: 'Box 17 — State Tax',
  employer_name: 'Employer Name', employer_ein: 'Employer EIN', employee_ssn: 'Employee SSN',
  box1_nonemployee_comp: 'Box 1 — Nonemployee Comp', box4_federal_withheld: 'Box 4 — Federal Withheld',
  payer_name: 'Payer Name', payer_ein: 'Payer EIN', recipient_ssn: 'Recipient SSN',
  box1_interest_income: 'Box 1 — Interest Income', box8_tax_exempt_interest: 'Box 8 — Tax-Exempt Interest',
  box1a_total_dividends: 'Box 1a — Total Dividends', box1b_qualified_dividends: 'Box 1b — Qualified Dividends',
  box2a_capital_gain_distrib: 'Box 2a — Capital Gain Distributions',
  box1_gross_distribution: 'Box 1 — Gross Distribution', box2a_taxable_amount: 'Box 2a — Taxable Amount',
  box7_distribution_code: 'Box 7 — Distribution Code',
  box1_unemployment_comp: 'Box 1 — Unemployment Compensation', box10a_state: 'Box 10a — State',
  partner_name: 'Partner Name', partner_ein: 'Partnership EIN',
  box1_ordinary_income: 'Box 1 — Ordinary Income', box2_rental_income: 'Box 2 — Rental Income',
  box5_interest: 'Box 5 — Interest', box6a_dividends: 'Box 6a — Dividends',
  box9a_capital_gain: 'Box 9a — Net Capital Gain',
  shareholder_name: 'Shareholder Name', corporation_ein: 'Corporation EIN',
  box9_capital_gain: 'Box 9 — Net Capital Gain', box16_items: 'Box 16 — Items Affecting Basis',
  business_name: 'Business Name', business_ein: 'Business EIN',
  gross_receipts: 'Gross Receipts', returns_allowances: 'Returns & Allowances',
  cost_of_goods: 'Cost of Goods Sold', gross_profit: 'Gross Profit',
  advertising: 'Advertising', car_truck: 'Car & Truck', commissions: 'Commissions',
  contract_labor: 'Contract Labor', depletion: 'Depletion', depreciation: 'Depreciation',
  employee_benefits: 'Employee Benefits', insurance: 'Insurance',
  interest_mortgage: 'Mortgage Interest', interest_other: 'Other Interest',
  legal_professional: 'Legal & Professional', office_expense: 'Office Expenses',
  pension_profit: 'Pension/Profit Sharing', rent_lease_vehicles: 'Vehicle Rent/Lease',
  rent_lease_other: 'Other Rent/Lease', repairs: 'Repairs & Maintenance',
  supplies: 'Supplies', taxes_licenses: 'Taxes & Licenses', travel: 'Travel',
  meals: 'Meals (50%)', utilities: 'Utilities', wages: 'Wages', other_expenses: 'Other Expenses',
  net_profit: 'Net Profit/Loss',
  description: 'Description', amount: 'Amount', date: 'Date',
  recipient_name: 'Recipient Name',
}

async function extractPdfContent(file) {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise

    // Try text extraction first
    let fullText = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      fullText += content.items.map((item) => item.str).join(' ') + '\n'
    }
    const hasText = fullText.trim().length > 30

    if (hasText) {
      console.log('PDF: text-based, length:', fullText.trim().length)
      return fullText.trim()
    }

    // Scanned/image PDF — use Tesseract OCR in the browser
    console.log('PDF: scanned/image — running Tesseract OCR on', pdf.numPages, 'pages')
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('eng')
    let ocrText = ''
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 2.0 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: ctx, viewport }).promise
      const { data: { text } } = await worker.recognize(canvas)
      ocrText += text + '\n'
    }
    await worker.terminate()
    console.log('Tesseract OCR complete, text length:', ocrText.length)
    return ocrText.trim()
  } catch (e) {
    console.error('extractPdfContent error:', e)
    return ''
  }
}

async function parseDocWithAI(file, docType) {
  const pdfText = await extractPdfContent(file)
  console.log('Final text length sent to Groq:', pdfText.length)

  const fields = DOC_TYPES[docType] || DOC_TYPES['Other']
  const fieldList = fields.map(f => `"${f}": "${FIELD_LABELS[f] || f}"`).join(', ')

  const { data: fnData, error: fnErr } = await supabase.functions.invoke('parse-tax-doc', {
    body: { pdfText, docType, fieldList }
  })

  if (fnErr) throw new Error(fnErr.message)
  if (fnData?.error) console.log('Edge fn error:', fnData.error)
  return fnData?.parsed || {}
}

export default function TaxDocParser({ clientName = '', clientId = null, taxYear = '2024', onParsed }) {
  const { myTenantId } = useApp()
  const [files, setFiles] = useState([])
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef()

  function addFiles(newFiles) {
    const items = Array.from(newFiles).map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      docType: guessDocType(file.name),
      status: 'pending',
      parsed: null,
      error: null,
    }))
    setFiles(prev => [...prev, ...items])
  }

  function guessDocType(name) {
    const n = name.toUpperCase()
    if (n.includes('W2') || n.includes('W-2')) return 'W-2'
    if (n.includes('1099-NEC') || n.includes('NEC')) return '1099-NEC'
    if (n.includes('1099-INT') || n.includes('INT')) return '1099-INT'
    if (n.includes('1099-DIV') || n.includes('DIV')) return '1099-DIV'
    if (n.includes('1099-R')) return '1099-R'
    if (n.includes('1099-G')) return '1099-G'
    if (n.includes('K1') || n.includes('K-1') || n.includes('1065')) return 'K-1 (1065)'
    if (n.includes('1120-S') || n.includes('1120S')) return 'K-1 (1120-S)'
    if (n.includes('SCHC') || n.includes('SCH-C') || n.includes('SCHEDULE-C')) return 'Schedule C (prior)'
    return 'W-2' // default to W-2 for unknown filenames
  }

  function setDocType(id, docType) {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, docType } : f))
  }

  function removeFile(id) {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  function updateParsedField(id, key, value) {
    let changed = null
    setFiles(prev => prev.map(f => {
      if (f.id !== id) return f
      changed = { ...f, parsed: { ...f.parsed, [key]: value } }
      return changed
    }))
    if (changed?.parsed && onParsed) {
      queueMicrotask(() => onParsed([{ docType: changed.docType, data: changed.parsed }], { mode:'review-edit', replace:false }))
    }
  }

  async function parseAll() {
    const pending = files.filter(f => f.status === 'pending')
    if (!pending.length) return
    setParsing(true)

    const results = []
    for (const item of pending) {
      setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'parsing' } : f))
      try {
        const parsed = await parseDocWithAI(item.file, item.docType)
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', parsed } : f))
        results.push({ item, parsed })
      } catch (e) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', error: e.message } : f))
      }
    }
    setParsing(false)

    // Auto-fire onParsed immediately — no second button click needed
    if (results.length > 0 && onParsed) {
      // Save to DB in background
      const inserts = results.map(({ item, parsed }) => ({
        tenant_id: myTenantId,
        client_id: clientId ? String(clientId) : null,
        client_name: clientName,
        tax_year: taxYear,
        doc_type: item.docType,
        file_name: item.file.name,
        parsed_data: parsed,
        created_at: new Date().toISOString(),
      }))
      try {
        const { error: saveError } = await supabase.from('tax_doc_uploads').insert(inserts)
        if (saveError) console.error('Failed to persist parsed tax-document metadata:', saveError)
      } catch (saveError) {
        console.error('Failed to persist parsed tax-document metadata:', saveError)
      }

      onParsed(results.map(({ item, parsed }) => ({ docType: item.docType, data: parsed })), { mode:'parse', replace:false })
    }
  }

  const hasPending = files.some(f => f.status === 'pending')

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 6px' }}>📎 Upload Tax Documents</h3>
        <p style={{ fontSize: 13, color: 'var(--t3)', margin: 0, lineHeight: 1.6 }}>
          Upload W-2s, 1099s, K-1s, or prior Schedule Cs. Claude will read each document and extract all values automatically.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        style={{
          border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--br)'}`,
          borderRadius: 10, padding: '32px 24px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? 'rgba(59,130,246,.06)' : 'var(--s2)',
          transition: 'all .2s', marginBottom: 16
        }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Drop tax documents here or click to browse</div>
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>PDF files supported · W-2, 1099-NEC, 1099-INT, 1099-DIV, 1099-R, K-1, Schedule C</div>
        <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
          onChange={e => addFiles(e.target.files)} />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {files.map(item => (
            <div key={item.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: item.parsed ? 12 : 0 }}>
                <span style={{ fontSize: 20 }}>
                  {item.status === 'pending' ? '📄' : item.status === 'parsing' ? '⏳' : item.status === 'done' ? '✅' : '❌'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                    {(item.file.size / 1024).toFixed(0)} KB
                    {item.status === 'parsing' && <span style={{ color: 'var(--blue)', marginLeft: 8 }}>Parsing with AI…</span>}
                    {item.status === 'done' && <span style={{ color: 'var(--ok)', marginLeft: 8 }}>✓ {Object.keys(item.parsed || {}).filter(k => item.parsed[k] !== null).length} fields extracted</span>}
                    {item.status === 'error' && <span style={{ color: 'var(--bad)', marginLeft: 8 }}>{item.error}</span>}
                  </div>
                </div>
                <select value={item.docType} onChange={e => setDocType(item.id, e.target.value)}
                  style={{ fontSize: 12, padding: '4px 8px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)' }}>
                  {Object.keys(DOC_TYPES).map(t => <option key={t}>{t}</option>)}
                </select>
                <button onClick={() => removeFile(item.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
              </div>

              {item.status === 'done' && item.parsed && (
                <div style={{ borderTop: '1px solid var(--br)', paddingTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                    Extracted Values — Review & Edit
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                    {Object.entries(item.parsed).filter(([, v]) => v !== null).map(([key, val]) => (
                      <div key={key}>
                        <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          {FIELD_LABELS[key] || key}
                        </div>
                        <input
                          value={val || ''}
                          onChange={e => updateParsedField(item.id, key, e.target.value)}
                          style={{ width: '100%', padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--br)', borderRadius: 5, color: 'var(--tx)', fontSize: 13 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Parse button */}
      {files.length > 0 && hasPending && (
        <button className="btn pri" style={{ width: '100%', justifyContent: 'center', padding: '11px', fontSize: 14, fontWeight: 700 }}
          onClick={parseAll} disabled={parsing}>
          {parsing ? '⏳ Parsing documents…' : `🤖 Parse ${files.filter(f => f.status === 'pending').length} Document${files.filter(f => f.status === 'pending').length > 1 ? 's' : ''} with AI`}
        </button>
      )}
    </div>
  )
}

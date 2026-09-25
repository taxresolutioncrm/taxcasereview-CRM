// ── Deterministic IRS transcript parser ──
// TDS transcripts are machine-generated with a rigid layout, so they parse
// reliably with patterns — no AI, no API cost, and transcript contents
// never leave the browser. Handles Account Transcript, Record of Account,
// Return Transcript, Wage & Income, and Verification of Non-filing.
//
// Output shape matches what IRSPortal.jsx stores in transcript_analyses.

const AMOUNT = /-?\$?\s?[\d,]+\.\d{2}-?/

function toNumber(str) {
  if (str === null || str === undefined) return null
  let s = String(str).replace(/[$,\s]/g, '')
  let neg = false
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1) }
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1) }
  const n = parseFloat(s)
  if (isNaN(n)) return null
  return neg ? -Math.abs(n) : n
}

function grabAmount(text, label) {
  // e.g. "ACCOUNT BALANCE: 12,345.67" / "ACCRUED INTEREST: 0.00 AS OF: ..."
  const re = new RegExp(label + String.raw`\s*:?\s*(` + AMOUNT.source + `)`, 'i')
  const m = text.match(re)
  return m ? toNumber(m[1]) : null
}

function grabText(text, label) {
  const re = new RegExp(label + String.raw`\s*:?\s*([^\n]+)`, 'i')
  const m = text.match(re)
  return m ? m[1].trim() : null
}

function detectType(text) {
  const t = text.slice(0, 2500)
  if (/Record of Account/i.test(t)) return 'Record of Account'
  if (/Account Transcript/i.test(t)) return 'Account Transcript'
  if (/Wage\s*(?:and|&)\s*Income/i.test(t)) return 'Wage and Income'
  if (/Verification of Non-?filing/i.test(t)) return 'Verification of Non-Filing'
  if (/(?:Tax )?Return Transcript/i.test(t)) return 'Return Transcript'
  return 'Other'
}

function detectTaxYear(text) {
  // "Tax Period Ending: Dec. 31, 2021" / "TAX PERIOD: Dec. 31, 2021" /
  // "Tax Period Requested: December, 2021" / "Tax Period Ending: 12-31-2021"
  let m = text.match(/Tax Period(?:\s+(?:Ending|Requested))?\s*:?\s*[^\n]*?((?:19|20)\d{2})/i)
  if (m) return m[1]
  m = text.match(/Period Ending\s*:?\s*[^\n]*?((?:19|20)\d{2})/i)
  return m ? m[1] : null
}

function parseTransactions(text) {
  // Transaction table rows on account-type transcripts:
  //   150  Tax return filed            20213205  08-30-2021   $5,231.00
  //   971  Notice issued                          03-14-2022   $0.00
  // Code = 3 digits at line start; cycle (6-8 digits) optional; date
  // MM-DD-YYYY; amount last.
  const out = []
  const lines = text.split('\n')
  let inTable = false
  for (const raw of lines) {
    const line = raw.trim()
    if (/^TRANSACTIONS\b/i.test(line) || /^CODE\s+EXPLANATION/i.test(line)) { inTable = true; continue }
    if (!inTable && !/^\d{3}\s/.test(line)) continue
    const m = line.match(new RegExp(
      String.raw`^(\d{3})\s+(.+?)\s+(?:(\d{6,8})\s+)?(\d{2}-\d{2}-\d{4})\s+(` + AMOUNT.source + String.raw`)\s*$`
    ))
    if (m) {
      out.push({
        code: m[1],
        description: m[2].trim(),
        date: m[4].replace(/-/g, '/'),
        amount: toNumber(m[5]),
      })
    }
  }
  return out
}

function parseWageIncome(text) {
  // W&I transcripts list each information return as a block:
  //   Form W-2 Wage and Tax Statement
  //   Employer: ... ACME CORP ...
  //   Wages, tips and other compensation: $52,341.00
  const out = []
  const formRe = /Form\s+(W-2G?|1099-[A-Z]{1,4}|1098(?:-[A-Z]+)?|5498(?:-[A-Z]+)?|SSA-1099|K-1|3921|3922)\b/gi
  let m
  const positions = []
  while ((m = formRe.exec(text)) !== null) positions.push({ form: m[1].toUpperCase(), idx: m.index })
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx
    const end = i + 1 < positions.length ? positions[i + 1].idx : Math.min(text.length, start + 2500)
    const block = text.slice(start, end)
    const payer = grabText(block, '(?:Employer|Payer|Issuer)(?:\\s*/\\s*Provider)?(?:\\s*Information)?[^:\\n]*') || ''
    const amt = grabAmount(block, '(?:Wages, tips and other compensation|Compensation|Gross distribution|Nonemployee compensation|Rents|Interest|Ordinary dividends|Original issue discount|Gross winnings|Payment Amount)')
    out.push({
      form: positions[i].form,
      payer: payer.replace(/\s{2,}/g, ' ').slice(0, 120),
      amount: amt,
    })
  }
  return out
}

export function parseIrsTranscript(text) {
  const type = detectType(text)
  const transactions = parseTransactions(text)
  const descAll = transactions.map(t => (t.description || '').toLowerCase()).join(' | ')
  const codes = new Set(transactions.map(t => t.code))

  const tc150 = transactions.find(t => t.code === '150')
  const accountBalance = grabAmount(text, 'ACCOUNT BALANCE')
  const nonFiling = type === 'Verification of Non-Filing' ||
    /couldn'?t be found|no record of (?:a )?return filed/i.test(text)

  const analysis = {
    transcript_type: type,
    tax_year: detectTaxYear(text),
    taxpayer_name: grabText(text, '(?:NAME\\(S\\) SHOWN ON RETURN|Taxpayer Name)') || null,
    filing_status: grabText(text, 'FILING STATUS'),
    account_balance: accountBalance,
    accrued_penalty: grabAmount(text, 'ACCRUED PENALTY'),
    accrued_interest: grabAmount(text, 'ACCRUED INTEREST'),
    adjusted_gross_income: grabAmount(text, 'ADJUSTED GROSS INCOME'),
    taxable_income: grabAmount(text, 'TAXABLE INCOME'),
    return_filed_date: tc150?.date || null,
    assessment_date: tc150?.date || null,
    transactions,
    wage_income: type === 'Wage and Income' ? parseWageIncome(text) : [],
    flags: {
      unfiled_return: nonFiling || (
        (type === 'Account Transcript' || type === 'Record of Account') &&
        transactions.length > 0 && !codes.has('150')
      ) || /substitute (?:for return|tax return prepared by (?:the )?IRS)/i.test(descAll),
      balance_due: Number(accountBalance) > 0,
      installment_agreement: /installment agreement/i.test(descAll),
      currently_not_collectible: codes.has('530') || /not collect[ai]ble/i.test(descAll),
      lien_filed: codes.has('582') || /\blien\b/i.test(descAll),
      levy_issued: /\blevy\b|\blevied\b/i.test(descAll),
    },
    csed_estimate: null,
  }

  if (analysis.assessment_date && /^\d{2}\/\d{2}\/\d{4}$/.test(analysis.assessment_date)) {
    const [mm, dd, yy] = analysis.assessment_date.split('/').map(Number)
    analysis.csed_estimate = `${String(mm).padStart(2, '0')}/${String(dd).padStart(2, '0')}/${yy + 10}`
  }

  return analysis
}

// ── PDF text extraction (pdf.js) ──
// Reconstructs lines by grouping text items on similar Y coordinates and
// sorting by X, which preserves the transcript's tabular rows well enough
// for the line-based patterns above.
export async function extractPdfText(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items = content.items
      .filter(it => it.str && it.str.trim() !== '')
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    // Group into lines by Y proximity
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines = []
    let current = null
    for (const it of items) {
      if (!current || Math.abs(current.y - it.y) > 3) {
        current = { y: it.y, parts: [it] }
        lines.push(current)
      } else {
        current.parts.push(it)
      }
    }
    const pageText = lines.map(l =>
      l.parts.sort((a, b) => a.x - b.x).map(pt => pt.str).join(' ').replace(/\s{2,}/g, '  ')
    ).join('\n')
    pages.push(pageText)
  }
  try { doc.destroy() } catch { /* noop */ }
  return pages.join('\n')
}


function htmlEntityDecode(value) {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = value
    return textarea.value
  }
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export async function extractHtmlText(file) {
  const raw = await file.text()
  const withBreaks = raw
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|pre|h[1-6]|table)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, '  ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return htmlEntityDecode(withBreaks)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractTranscriptText(file) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  if (type.includes('text/html') || /\.html?$/.test(name)) return extractHtmlText(file)
  return extractPdfText(file)
}
